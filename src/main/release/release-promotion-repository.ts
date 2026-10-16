import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  CompensationExecution,
  Deployment,
  MigrationExecution,
  ReleaseEnvironment,
  ReleaseScope,
  ReleaseStatus
} from '@shared/domain/release'
import type { AuditRepository } from '../storage/audit-repository'

/**
 * Persistência da promoção para Staging e Produção (SPEC-Release-04): deployments por ambiente,
 * migrations aplicadas e compensações. Arquivo à parte do `ReleaseRepository` (diário, lease e
 * estados), que já passa do limite de tamanho. Nada aqui recebe segredo, URL com credencial nem
 * saída de provedor: só ids externos, digests, checksums e códigos curtos.
 */

export class ReleasePromotionConflictError extends Error {
  constructor(
    readonly code:
      'release-not-found' | 'deployment-conflict' | 'migration-conflict' | 'compensation-conflict',
    message: string
  ) {
    super(message)
    this.name = 'ReleasePromotionConflictError'
  }
}

export type DeploymentKind = 'backend' | 'frontend'
export type PromotionEffectState = 'intended' | 'confirmed' | 'ambiguous' | 'failed'

export interface PromotionDeployment extends Deployment {
  readonly kind: DeploymentKind
  /** Deployment da última release concluída que este substituiu; destino da compensação. */
  readonly replacesExternalId: string | null
}

export interface DeploymentInput {
  readonly environment: ReleaseEnvironment
  readonly kind: DeploymentKind
  readonly artifactDigest: string
  readonly externalId: string
  readonly replacesExternalId: string | null
}

/** O que um rollback ainda pode precisar: ids de release, deployments, digests e referências de backup. */
export interface ProtectedArtifacts {
  readonly releaseIds: string[]
  readonly deploymentIds: string[]
  readonly digests: string[]
  readonly backupRefs: string[]
}

export interface PromotionMigration extends MigrationExecution {
  /** Backup que precedeu a migration; só Produção. */
  readonly backupRef: string | null
}

export interface MigrationInput {
  readonly environment: ReleaseEnvironment
  readonly migrationId: string
  readonly checksum: string
  readonly state: PromotionEffectState
  readonly backupRef?: string
}

export interface CompensationInput {
  readonly environment: ReleaseEnvironment
  /** Código curto (`frontend:restore:dpl_x`), nunca texto livre. */
  readonly action: string
}

const DIGEST_VALIDO = /^sha256:[a-f0-9]{64}$/
const ID_EXTERNO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ACAO_VALIDA = /^[a-z0-9][a-z0-9._:-]{0,127}$/i

/** Estados de migration que podem suceder o atual; `confirmed` é definitivo. */
const SUCESSORES: Readonly<Record<PromotionEffectState, readonly PromotionEffectState[]>> = {
  intended: ['intended', 'confirmed', 'ambiguous', 'failed'],
  ambiguous: ['ambiguous', 'confirmed', 'failed'],
  failed: ['failed', 'intended'],
  confirmed: ['confirmed']
}

interface DeploymentRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  environment: ReleaseEnvironment
  kind: DeploymentKind
  artifact_digest: string
  external_id: string
  replaces_external_id: string | null
  created_at: string
}

interface MigrationRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  environment: ReleaseEnvironment
  migration_id: string
  checksum: string
  state: PromotionEffectState
  backup_ref: string | null
  created_at: string
}

interface CompensationRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  environment: ReleaseEnvironment
  action: string
  state: PromotionEffectState
  created_at: string
}

const paramsDe = (scope: ReleaseScope): readonly string[] => [
  scope.userId,
  scope.workspaceId,
  scope.projectId
]

function toDeployment(row: DeploymentRow): PromotionDeployment {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
    projectId: row.project_id,
    releaseId: row.release_id,
    environment: row.environment,
    kind: row.kind,
    artifactDigest: row.artifact_digest,
    externalId: row.external_id,
    replacesExternalId: row.replaces_external_id,
    createdAt: row.created_at
  }
}

export class ReleasePromotionRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository
  ) {}

  /** Transação imediata: o escritor toma o lock antes de ler, então a checagem e a gravação não se intercalam. */
  private escrita<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate()
  }

  /** A release existe **neste** escopo: FK sozinha não impede gravar sob o escopo de outro usuário. */
  private assertRelease(scope: ReleaseScope, releaseId: string): void {
    const achou = this.db
      .prepare(
        `SELECT 1 FROM release_run WHERE id=? AND user_id=? AND workspace_id=? AND project_id=?`
      )
      .get(releaseId, ...paramsDe(scope))
    if (!achou)
      throw new ReleasePromotionConflictError(
        'release-not-found',
        'Release não encontrada no escopo informado.'
      )
  }

  private auditar(
    scope: ReleaseScope,
    releaseId: string,
    environment: ReleaseEnvironment,
    kind: string,
    extra: Readonly<Record<string, string>> = {}
  ): void {
    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspaceId as 'noa' | 'jarvis',
      type: 'release-transition',
      payload: { projectId: scope.projectId, releaseId, environment, kind, ...extra }
    })
  }

  recordDeployment(
    scope: ReleaseScope,
    releaseId: string,
    input: DeploymentInput,
    now = new Date().toISOString()
  ): PromotionDeployment {
    if (!DIGEST_VALIDO.test(input.artifactDigest))
      throw new TypeError('O deployment exige digest sha256.')
    if (!ID_EXTERNO.test(input.externalId))
      throw new TypeError('O identificador externo do deployment é inválido.')
    if (input.replacesExternalId !== null && !ID_EXTERNO.test(input.replacesExternalId))
      throw new TypeError('O identificador do deployment substituído é inválido.')
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const atual = this.getDeployment(scope, releaseId, input.environment, input.kind)
      if (atual) {
        if (atual.externalId === input.externalId && atual.artifactDigest === input.artifactDigest)
          return atual
        throw new ReleasePromotionConflictError(
          'deployment-conflict',
          'A release já tem outro deployment neste ambiente e tipo: o candidato é imutável.'
        )
      }
      try {
        this.db
          .prepare(
            `INSERT INTO release_deployment
               (id,user_id,workspace_id,project_id,release_id,environment,kind,artifact_digest,
                external_id,replaces_external_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            randomUUID(),
            ...paramsDe(scope),
            releaseId,
            input.environment,
            input.kind,
            input.artifactDigest,
            input.externalId,
            input.replacesExternalId,
            now
          )
      } catch (erro) {
        if ((erro as { code?: unknown } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE')
          throw new ReleasePromotionConflictError(
            'deployment-conflict',
            'Este deployment já pertence a outra release neste ambiente.'
          )
        throw erro
      }
      this.auditar(scope, releaseId, input.environment, 'deployment-recorded', {
        deploymentKind: input.kind,
        digest: input.artifactDigest,
        externalId: input.externalId
      })
      return this.getDeployment(scope, releaseId, input.environment, input.kind)!
    })
  }

  getDeployment(
    scope: ReleaseScope,
    releaseId: string,
    environment: ReleaseEnvironment,
    kind: DeploymentKind
  ): PromotionDeployment | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_deployment
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? AND environment=? AND kind=?`
      )
      .get(...paramsDe(scope), releaseId, environment, kind) as DeploymentRow | undefined
    return row ? toDeployment(row) : null
  }

  listDeployments(scope: ReleaseScope, releaseId: string): PromotionDeployment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_deployment
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY environment, kind`
      )
      .all(...paramsDe(scope), releaseId) as DeploymentRow[]
    return rows.map(toDeployment)
  }

  /**
   * Último deployment do ambiente que a pipeline **provou saudável**, sem contar `exceto`. É o
   * destino da compensação e precisa ser resolvido na hora de compensar, nunca gravado antes:
   * uma release vizinha pode concluir no intervalo e mudar a resposta.
   *
   * - Produção: a última release **concluída** (passou a estabilização). Não é "o que estava no
   *   ar", que pode ser resíduo de uma release degradada.
   * - Staging: a última release que **confirmou o smoke** de Staging. Staging não é compensado
   *   quando só a Produção falha, então segue servindo essa release mesmo que ela não conclua.
   */
  lastKnownDeployment(
    scope: ReleaseScope,
    environment: ReleaseEnvironment,
    kind: DeploymentKind,
    exceto: string
  ): PromotionDeployment | null {
    if (environment === 'production') {
      // O que Produção serve: a última release concluída DEPOIS do rollback confirmado mais
      // recente; se nenhuma concluiu depois, a release para a qual o rollback voltou. Sem rollback,
      // a última concluída. Assim um rollback com salto (C → A) tira B de cena, e um rollback para
      // frente (A → B) vale. A `exceto` é a release que está falhando e nunca conta.
      const rollback = `SELECT %COL% FROM release_rollback rb
                         WHERE rb.state='confirmed' AND rb.user_id=d.user_id
                           AND rb.workspace_id=d.workspace_id AND rb.project_id=d.project_id
                         ORDER BY rb.updated_at DESC, rb.rowid DESC LIMIT 1`
      const row = this.db
        .prepare(
          `SELECT d.* FROM release_deployment d JOIN release_run r ON r.id=d.release_id
           WHERE d.user_id=? AND d.workspace_id=? AND d.project_id=? AND d.environment=? AND d.kind=?
             AND d.release_id<>? AND r.status='completed'
             AND (NOT EXISTS (SELECT 1 FROM release_rollback x
                               WHERE x.state='confirmed' AND x.user_id=d.user_id
                                 AND x.workspace_id=d.workspace_id AND x.project_id=d.project_id)
                  OR r.updated_at > (${rollback.replace('%COL%', 'rb.updated_at')})
                  OR r.id = (${rollback.replace('%COL%', 'rb.to_release_id')}))
           ORDER BY r.updated_at DESC, d.created_at DESC LIMIT 1`
        )
        .get(...paramsDe(scope), environment, kind, exceto) as DeploymentRow | undefined
      return row ? toDeployment(row) : null
    }
    const prova = {
      juncao: `JOIN release_step s ON s.release_id=d.release_id AND s.user_id=d.user_id
                 AND s.workspace_id=d.workspace_id AND s.project_id=d.project_id
                 AND s.environment='staging' AND s.step='smoke_passed' AND s.state='confirmed'`,
      ordem: 's.updated_at'
    }
    const row = this.db
      .prepare(
        `SELECT d.* FROM release_deployment d JOIN release_run r ON r.id=d.release_id ${prova.juncao}
         WHERE d.user_id=? AND d.workspace_id=? AND d.project_id=? AND d.environment=? AND d.kind=?
           AND d.release_id<>?
         ORDER BY ${prova.ordem} DESC, d.created_at DESC LIMIT 1`
      )
      .get(...paramsDe(scope), environment, kind, exceto) as DeploymentRow | undefined
    return row ? toDeployment(row) : null
  }

  recordMigration(
    scope: ReleaseScope,
    releaseId: string,
    input: MigrationInput,
    now = new Date().toISOString()
  ): PromotionMigration {
    if (!ID_EXTERNO.test(input.migrationId)) throw new TypeError('Id de migration inválido.')
    if (!/^[a-f0-9]{8,128}$/.test(input.checksum)) throw new TypeError('Checksum inválido.')
    if (input.backupRef !== undefined && !ID_EXTERNO.test(input.backupRef))
      throw new TypeError('A referência do backup é um identificador curto, nunca uma URL.')
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const atual = this.db
        .prepare(
          `SELECT * FROM release_migration_execution
           WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
             AND environment=? AND migration_id=?`
        )
        .get(...paramsDe(scope), releaseId, input.environment, input.migrationId) as
        MigrationRow | undefined
      if (atual && atual.checksum !== input.checksum)
        throw new ReleasePromotionConflictError(
          'migration-conflict',
          'A migration já foi registrada com outro checksum: nunca é reescrita.'
        )
      if (atual && !SUCESSORES[atual.state].includes(input.state))
        throw new ReleasePromotionConflictError(
          'migration-conflict',
          'Transição de estado de migration inválida.'
        )
      if (atual) {
        this.db
          .prepare(
            `UPDATE release_migration_execution SET state=?, backup_ref=COALESCE(?, backup_ref) WHERE id=?`
          )
          .run(input.state, input.backupRef ?? null, atual.id)
      } else {
        this.db
          .prepare(
            `INSERT INTO release_migration_execution
               (id,user_id,workspace_id,project_id,release_id,environment,migration_id,checksum,state,backup_ref,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            randomUUID(),
            ...paramsDe(scope),
            releaseId,
            input.environment,
            input.migrationId,
            input.checksum,
            input.state,
            input.backupRef ?? null,
            now
          )
      }
      this.auditar(scope, releaseId, input.environment, `migration-${input.state}`, {
        migrationId: input.migrationId,
        checksum: input.checksum
      })
      return this.listMigrations(scope, releaseId).find(
        (m) => m.environment === input.environment && m.migrationId === input.migrationId
      )!
    })
  }

  listMigrations(scope: ReleaseScope, releaseId: string): PromotionMigration[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_migration_execution
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY environment, created_at, migration_id`
      )
      .all(...paramsDe(scope), releaseId) as MigrationRow[]
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
      projectId: row.project_id,
      releaseId: row.release_id,
      environment: row.environment,
      migrationId: row.migration_id,
      checksum: row.checksum,
      state: row.state,
      backupRef: row.backup_ref,
      createdAt: row.created_at
    }))
  }

  /** Releases do projeto que ainda não chegaram a um estado terminal, da mais antiga à mais nova. */
  openReleases(scope: ReleaseScope): { id: string; sha: string; status: ReleaseStatus }[] {
    return this.db
      .prepare(
        `SELECT id,sha,status FROM release_run
         WHERE user_id=? AND workspace_id=? AND project_id=?
           AND status IN ('queued','preparing','staging','production','stabilizing')
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope)) as { id: string; sha: string; status: ReleaseStatus }[]
  }

  /**
   * O que nenhuma limpeza pode remover porque um rollback ainda pode precisar (SPEC-Release-05,
   * "proteção de artefatos"): tudo de releases não terminais, das `manter` últimas concluídas que
   * ainda valem (a que Produção serve e o alvo do rollback) e de qualquer rollback em andamento —
   * origem e destino. A que serve é a que o último rollback confirmado devolveu (ou a última concluída depois dele); a versão retirada não é alvo de nada.
   * Quem remover artefato, deployment ou backup (hoje ninguém o faz) consulta isto antes.
   */
  protectedArtifacts(scope: ReleaseScope, manter = 2): ProtectedArtifacts {
    const ids = new Set<string>(this.openReleases(scope).map((r) => r.id))
    // A que serve (descontados rollbacks) e as `manter - 1` concluídas imediatamente anteriores a ela.
    const servindo = this.lastKnownDeployment(scope, 'production', 'backend', '')
    if (servindo) {
      ids.add(servindo.releaseId)
      const anteriores = this.db
        .prepare(
          `SELECT r.id FROM release_run r
            WHERE r.user_id=? AND r.workspace_id=? AND r.project_id=? AND r.status='completed'
              AND r.id<>? AND r.updated_at < (SELECT updated_at FROM release_run WHERE id=?)
            ORDER BY r.updated_at DESC, r.rowid DESC LIMIT ?`
        )
        .all(...paramsDe(scope), servindo.releaseId, servindo.releaseId, manter - 1) as {
        id: string
      }[]
      for (const r of anteriores) ids.add(r.id)
    }
    // A release que pausou o projeto: o backup dela é a única referência de restore operacional.
    const pausa = this.db
      .prepare(
        `SELECT release_id FROM release_project_pause
          WHERE user_id=? AND workspace_id=? AND project_id=? AND resolved_at IS NULL`
      )
      .get(...paramsDe(scope)) as { release_id: string } | undefined
    if (pausa) ids.add(pausa.release_id)
    const emAndamento = this.db
      .prepare(
        `SELECT from_release_id, to_release_id FROM release_rollback
          WHERE user_id=? AND workspace_id=? AND project_id=? AND state='intended'`
      )
      .all(...paramsDe(scope)) as { from_release_id: string; to_release_id: string }[]
    for (const r of emAndamento) {
      ids.add(r.from_release_id)
      ids.add(r.to_release_id)
    }
    const deploymentIds = new Set<string>()
    const digests = new Set<string>()
    const backupRefs = new Set<string>()
    for (const id of ids) {
      for (const d of this.listDeployments(scope, id)) {
        deploymentIds.add(d.externalId)
        digests.add(d.artifactDigest)
      }
      for (const m of this.listMigrations(scope, id)) if (m.backupRef) backupRefs.add(m.backupRef)
      const artefatos = this.db
        .prepare(
          `SELECT digest FROM release_artifact
            WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
        )
        .all(...paramsDe(scope), id) as { digest: string }[]
      for (const a of artefatos) digests.add(a.digest)
    }
    return {
      releaseIds: [...ids],
      deploymentIds: [...deploymentIds],
      digests: [...digests],
      backupRefs: [...backupRefs]
    }
  }

  beginCompensation(
    scope: ReleaseScope,
    releaseId: string,
    input: CompensationInput,
    now = new Date().toISOString()
  ): string {
    if (!ACAO_VALIDA.test(input.action))
      throw new TypeError('A ação de compensação é um código curto, não texto livre.')
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO release_compensation
             (id,user_id,workspace_id,project_id,release_id,environment,action,state,created_at)
           VALUES (?,?,?,?,?,?,?, 'intended', ?)`
        )
        .run(id, ...paramsDe(scope), releaseId, input.environment, input.action, now)
      this.auditar(scope, releaseId, input.environment, 'compensation-intended', {
        action: input.action
      })
      return id
    })
  }

  finishCompensation(
    scope: ReleaseScope,
    releaseId: string,
    id: string,
    state: Exclude<PromotionEffectState, 'intended'>
  ): void {
    this.escrita(() => {
      const atual = this.db
        .prepare(
          `SELECT * FROM release_compensation
           WHERE id=? AND user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
        )
        .get(id, ...paramsDe(scope), releaseId) as CompensationRow | undefined
      if (!atual)
        throw new ReleasePromotionConflictError(
          'compensation-conflict',
          'Compensação não encontrada no escopo informado.'
        )
      if (atual.state !== 'intended')
        throw new ReleasePromotionConflictError(
          'compensation-conflict',
          'Somente uma compensação em intenção pode ser fechada.'
        )
      this.db.prepare(`UPDATE release_compensation SET state=? WHERE id=?`).run(state, id)
      this.auditar(scope, releaseId, atual.environment, `compensation-${state}`, {
        action: atual.action
      })
    })
  }

  listCompensations(scope: ReleaseScope, releaseId: string): CompensationExecution[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_compensation
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope), releaseId) as CompensationRow[]
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
      projectId: row.project_id,
      releaseId: row.release_id,
      environment: row.environment,
      action: row.action,
      state: row.state,
      createdAt: row.created_at
    }))
  }
}
