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
    const prova =
      environment === 'production'
        ? {
            juncao: '',
            // Uma release revertida por rollback confirmado deixou de ser o que Produção serve:
            // compensar para ela devolveria a versão que o operador acabou de retirar.
            condicao: `r.status='completed' AND NOT EXISTS (
              SELECT 1 FROM release_rollback rb
               WHERE rb.from_release_id=d.release_id AND rb.state='confirmed'
                 AND rb.user_id=d.user_id AND rb.workspace_id=d.workspace_id
                 AND rb.project_id=d.project_id)`,
            ordem: 'r.updated_at'
          }
        : {
            juncao: `JOIN release_step s ON s.release_id=d.release_id AND s.user_id=d.user_id
                       AND s.workspace_id=d.workspace_id AND s.project_id=d.project_id
                       AND s.environment='staging' AND s.step='smoke_passed' AND s.state='confirmed'`,
            condicao: '1=1',
            ordem: 's.updated_at'
          }
    const row = this.db
      .prepare(
        `SELECT d.* FROM release_deployment d JOIN release_run r ON r.id=d.release_id ${prova.juncao}
         WHERE d.user_id=? AND d.workspace_id=? AND d.project_id=? AND d.environment=? AND d.kind=?
           AND d.release_id<>? AND ${prova.condicao}
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
