import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import type { AuditRepository } from '../storage/audit-repository'
import type {
  CancellationPhase,
  CancellationState,
  CorrectionInput,
  CorrectionState,
  EvidenceDetails,
  EvidenceInput,
  InclusionInput,
  ManifestInput,
  ProjectPause,
  PublicationState,
  PublicationTarget,
  ReleaseCancellation,
  ReleaseCorrection,
  ReleaseEvidence,
  ReleaseInclusion,
  ReleaseManifest,
  ReleasePublication,
  ReleaseRollback,
  RollbackState
} from './release-recovery-types'

import {
  type CancellationRow,
  type CorrectionRow,
  type EvidenceRow,
  type PublicationRow,
  type RollbackRow,
  toCancellation,
  toCorrection,
  toEvidence,
  toPublication,
  toRollback
} from './release-recovery-rows'

export type * from './release-recovery-types'

/**
 * Persistência da recuperação e da identidade de release (SPEC-Release-05): inclusões, evidência,
 * pausa de projeto, cancelamento, manifesto, publicação, correção devolvida à V2 e rollback. Nada
 * aqui recebe segredo, URL, texto de PR ou saída de provedor — só ids, digests, hashes e códigos
 * curtos. O que não parece código é recusado **antes** de chegar ao banco (fail closed); os CHECKs
 * da migration repetem a regra como segunda barreira.
 */

export class ReleaseRecoveryConflictError extends Error {
  constructor(
    readonly code:
      | 'release-not-found'
      | 'manifest-conflict'
      | 'publication-final'
      | 'cancellation-conflict'
      | 'rollback-conflict',
    message: string
  ) {
    super(message)
    this.name = 'ReleaseRecoveryConflictError'
  }
}

const CODIGO = /^[a-z0-9][a-z0-9._:-]{0,63}$/
const PASSO = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const CHAVE_DE_DETALHE = /^[a-z][a-z0-9_]{0,31}$/
const VALOR_DE_DETALHE = /^[A-Za-z0-9._:@/-]{0,64}$/
const ID_DE_SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ID_DE_FATIA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA = /^[a-f0-9]{7,64}$/
const SHA256 = /^[a-f0-9]{64}$/
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const REFERENCIA_EXTERNA = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MAX_DETALHES = 16

const paramsDe = (scope: ReleaseScope): readonly string[] => [
  scope.userId,
  scope.workspaceId,
  scope.projectId
]

/** Recusa o que não é código curto: é o que impede texto de provedor de virar motivo ou ação. */
export function exigirCodigo(valor: string, nome: string): string {
  return exigir(valor, CODIGO, nome)
}

function exigir(valor: string, padrao: RegExp, nome: string): string {
  if (!padrao.test(valor)) throw new TypeError(`${nome} inválido: só código curto é aceito.`)
  return valor
}

function inteiroPositivo(valor: number, nome: string): number {
  if (!Number.isSafeInteger(valor) || valor <= 0)
    throw new TypeError(`${nome} deve ser um inteiro positivo.`)
  return valor
}

function serializarDetalhes(detalhes: EvidenceDetails | undefined): string | null {
  if (!detalhes) return null
  const chaves = Object.keys(detalhes)
  if (chaves.length > MAX_DETALHES) throw new TypeError('Detalhes demais na evidência.')
  for (const chave of chaves) {
    exigir(chave, CHAVE_DE_DETALHE, 'Chave de detalhe')
    const valor: unknown = detalhes[chave]
    if (typeof valor === 'string') exigir(valor, VALOR_DE_DETALHE, 'Valor de detalhe')
    else if (typeof valor === 'number') {
      if (!Number.isFinite(valor)) throw new TypeError('Valor numérico de detalhe inválido.')
    } else if (typeof valor !== 'boolean') throw new TypeError('Valor de detalhe inválido.')
  }
  return JSON.stringify(detalhes)
}

export class ReleaseRecoveryRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository
  ) {}

  /** Transação imediata: o escritor toma o lock antes de ler, então checagem e gravação não se intercalam. */
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
      throw new ReleaseRecoveryConflictError(
        'release-not-found',
        'Release não encontrada no escopo informado.'
      )
  }

  private auditar(
    scope: ReleaseScope,
    releaseId: string,
    kind: string,
    extra: Readonly<Record<string, string>> = {}
  ): void {
    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspaceId as 'noa' | 'jarvis',
      type: 'release-transition',
      payload: { projectId: scope.projectId, releaseId, kind, ...extra }
    })
  }

  // --- inclusões ---------------------------------------------------------------------------

  recordInclusion(
    scope: ReleaseScope,
    releaseId: string,
    input: InclusionInput,
    now = new Date().toISOString()
  ): void {
    exigir(input.sha, SHA, 'SHA')
    if (input.pullRequest !== undefined) inteiroPositivo(input.pullRequest, 'PR')
    if (input.issue !== undefined) inteiroPositivo(input.issue, 'Issue')
    if (input.specId !== undefined) exigir(input.specId, ID_DE_SPEC, 'SPEC')
    if (input.sliceId !== undefined) exigir(input.sliceId, ID_DE_FATIA, 'Fatia')
    this.escrita(() => {
      this.assertRelease(scope, releaseId)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO release_inclusion
             (user_id,workspace_id,project_id,release_id,sha,pull_request,spec_id,slice_id,issue,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          ...paramsDe(scope),
          releaseId,
          input.sha,
          input.pullRequest ?? null,
          input.specId ?? null,
          input.sliceId ?? null,
          input.issue ?? null,
          now
        )
    })
  }

  inclusions(scope: ReleaseScope, releaseId: string): ReleaseInclusion[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_inclusion
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY created_at, pull_request, sha`
      )
      .all(...paramsDe(scope), releaseId) as {
      release_id: string
      sha: string
      pull_request: number | null
      spec_id: string | null
      slice_id: string | null
      issue: number | null
      created_at: string
    }[]
    return rows.map((row) => ({
      releaseId: row.release_id,
      sha: row.sha,
      createdAt: row.created_at,
      ...(row.pull_request ? { pullRequest: row.pull_request } : {}),
      ...(row.spec_id ? { specId: row.spec_id } : {}),
      ...(row.slice_id ? { sliceId: row.slice_id } : {}),
      ...(row.issue ? { issue: row.issue } : {})
    }))
  }

  /** O candidato consolidado carrega o que a release substituída carregava. Repetir não duplica. */
  inheritInclusions(scope: ReleaseScope, fromReleaseId: string, toReleaseId: string): void {
    this.escrita(() => {
      this.assertRelease(scope, fromReleaseId)
      this.assertRelease(scope, toReleaseId)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO release_inclusion
             (user_id,workspace_id,project_id,release_id,sha,pull_request,spec_id,slice_id,issue,created_at)
           SELECT user_id,workspace_id,project_id,?,sha,pull_request,spec_id,slice_id,issue,created_at
             FROM release_inclusion
            WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
        )
        .run(toReleaseId, ...paramsDe(scope), fromReleaseId)
    })
  }

  // --- evidência ---------------------------------------------------------------------------

  appendEvidence(
    scope: ReleaseScope,
    releaseId: string,
    input: EvidenceInput,
    now = new Date().toISOString()
  ): string {
    if (input.step !== undefined) exigir(input.step, PASSO, 'Passo')
    if (input.reason !== undefined) exigir(input.reason, CODIGO, 'Motivo')
    if (input.action !== undefined) exigir(input.action, CODIGO, 'Ação')
    const detalhes = serializarDetalhes(input.details)
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO release_evidence
             (id,user_id,workspace_id,project_id,release_id,environment,kind,step,state,reason,action,details,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          ...paramsDe(scope),
          releaseId,
          input.environment ?? null,
          input.kind,
          input.step ?? null,
          input.state,
          input.reason ?? null,
          input.action ?? null,
          detalhes,
          now
        )
      return id
    })
  }

  evidence(scope: ReleaseScope, releaseId: string): ReleaseEvidence[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_evidence
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope), releaseId) as EvidenceRow[]
    return rows.map(toEvidence)
  }

  // --- pausa do projeto --------------------------------------------------------------------

  pauseProject(
    scope: ReleaseScope,
    releaseId: string,
    reason: string,
    now = new Date().toISOString()
  ): void {
    exigir(reason, CODIGO, 'Motivo da pausa')
    this.escrita(() => {
      this.assertRelease(scope, releaseId)
      if (this.activePause(scope)) return
      this.db
        .prepare(
          `INSERT INTO release_project_pause (id,user_id,workspace_id,project_id,release_id,reason,created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(randomUUID(), ...paramsDe(scope), releaseId, reason, now)
      this.auditar(scope, releaseId, 'project-paused', { reason })
    })
  }

  activePause(scope: ReleaseScope): ProjectPause | null {
    const row = this.db
      .prepare(
        `SELECT id,release_id,reason,created_at FROM release_project_pause
         WHERE user_id=? AND workspace_id=? AND project_id=? AND resolved_at IS NULL`
      )
      .get(...paramsDe(scope)) as
      { id: string; release_id: string; reason: string; created_at: string } | undefined
    return row
      ? { id: row.id, releaseId: row.release_id, reason: row.reason, createdAt: row.created_at }
      : null
  }

  /**
   * `true` quando havia pausa ativa a resolver. A cadeia de auditoria diz **como** foi liberada:
   * `acknowledged` é a declaração do operador, sem prova na nuvem.
   */
  resolvePause(
    scope: ReleaseScope,
    now = new Date().toISOString(),
    como: { readonly acknowledged: boolean } = { acknowledged: false }
  ): boolean {
    return this.escrita(() => {
      const ativa = this.activePause(scope)
      if (!ativa) return false
      this.db
        .prepare(
          `UPDATE release_project_pause SET resolved_at=? WHERE id=? AND resolved_at IS NULL`
        )
        .run(now, ativa.id)
      this.auditar(scope, ativa.releaseId, 'project-resumed', {
        acknowledged: String(como.acknowledged),
        reason: ativa.reason
      })
      return true
    })
  }

  // --- cancelamento ------------------------------------------------------------------------

  requestCancellation(
    scope: ReleaseScope,
    releaseId: string,
    phase: CancellationPhase,
    now = new Date().toISOString()
  ): ReleaseCancellation {
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const existente = this.cancellation(scope, releaseId)
      if (existente) return existente
      this.db
        .prepare(
          `INSERT INTO release_cancellation
             (id,user_id,workspace_id,project_id,release_id,phase,state,reason,requested_at,updated_at)
           VALUES (?,?,?,?,?,?, 'requested', NULL, ?, ?)`
        )
        .run(randomUUID(), ...paramsDe(scope), releaseId, phase, now, now)
      this.auditar(scope, releaseId, 'cancellation-requested', { phase })
      return this.cancellation(scope, releaseId)!
    })
  }

  cancellation(scope: ReleaseScope, releaseId: string): ReleaseCancellation | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_cancellation
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
      )
      .get(...paramsDe(scope), releaseId) as CancellationRow | undefined
    return row ? toCancellation(row) : null
  }

  /** Fecha o pedido uma vez. `blocked` = efeito incerto impediu parar com segurança; pode reabrir. */
  finishCancellation(
    scope: ReleaseScope,
    releaseId: string,
    state: Exclude<CancellationState, 'requested'>,
    reason: string | null,
    now = new Date().toISOString()
  ): void {
    if (reason !== null) exigir(reason, CODIGO, 'Motivo do cancelamento')
    this.escrita(() => {
      const atual = this.cancellation(scope, releaseId)
      if (!atual)
        throw new ReleaseRecoveryConflictError(
          'cancellation-conflict',
          'Não há pedido de cancelamento a fechar.'
        )
      if (atual.state === 'done')
        throw new ReleaseRecoveryConflictError(
          'cancellation-conflict',
          'O cancelamento já foi concluído.'
        )
      this.db
        .prepare(`UPDATE release_cancellation SET state=?, reason=?, updated_at=? WHERE id=?`)
        .run(state, reason, now, atual.id)
      this.auditar(scope, releaseId, `cancellation-${state}`)
    })
  }

  // --- manifesto e publicação --------------------------------------------------------------

  saveManifest(
    scope: ReleaseScope,
    releaseId: string,
    input: ManifestInput,
    now = new Date().toISOString()
  ): ReleaseManifest {
    exigir(input.tag, TAG, 'Tag')
    exigir(input.manifestSha256, SHA256, 'Hash do manifesto')
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const atual = this.manifest(scope, releaseId)
      if (atual) {
        if (atual.manifestSha256 === input.manifestSha256 && atual.tag === input.tag) return atual
        throw new ReleaseRecoveryConflictError(
          'manifest-conflict',
          'A release já tem manifesto: a identidade é imutável.'
        )
      }
      try {
        this.db
          .prepare(
            `INSERT INTO release_manifest
               (user_id,workspace_id,project_id,release_id,tag,manifest_json,manifest_sha256,changelog,created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          )
          .run(
            ...paramsDe(scope),
            releaseId,
            input.tag,
            input.manifestJson,
            input.manifestSha256,
            input.changelog,
            now
          )
      } catch (erro) {
        if ((erro as { code?: unknown } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE')
          throw new ReleaseRecoveryConflictError(
            'manifest-conflict',
            'Esta tag já pertence a outra release do projeto.'
          )
        throw erro
      }
      this.auditar(scope, releaseId, 'manifest-saved', { tag: input.tag })
      return this.manifest(scope, releaseId)!
    })
  }

  manifest(scope: ReleaseScope, releaseId: string): ReleaseManifest | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_manifest
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
      )
      .get(...paramsDe(scope), releaseId) as
      | {
          release_id: string
          tag: string
          manifest_json: string
          manifest_sha256: string
          changelog: string
          created_at: string
        }
      | undefined
    return row
      ? {
          releaseId: row.release_id,
          tag: row.tag,
          manifestJson: row.manifest_json,
          manifestSha256: row.manifest_sha256,
          changelog: row.changelog,
          createdAt: row.created_at
        }
      : null
  }

  /**
   * A release concluída imediatamente antes desta (pelo instante de conclusão) e a tag dela, se
   * houver: o elo "release anterior" do manifesto. Tag ausente = release anterior à identidade.
   */
  previousCompleted(
    scope: ReleaseScope,
    releaseId: string
  ): { releaseId: string; tag: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT r.id AS id, m.tag AS tag FROM release_run r
           LEFT JOIN release_manifest m ON m.release_id=r.id AND m.user_id=r.user_id
             AND m.workspace_id=r.workspace_id AND m.project_id=r.project_id
          WHERE r.user_id=? AND r.workspace_id=? AND r.project_id=? AND r.status='completed'
            AND r.id<>? AND r.updated_at < (SELECT updated_at FROM release_run WHERE id=?)
          ORDER BY r.updated_at DESC, r.rowid DESC LIMIT 1`
      )
      .get(...paramsDe(scope), releaseId, releaseId) as
      { id: string; tag: string | null } | undefined
    return row ? { releaseId: row.id, tag: row.tag } : null
  }

  setPublication(
    scope: ReleaseScope,
    releaseId: string,
    target: PublicationTarget,
    input: { state: PublicationState; reason?: string; externalRef?: string },
    now = new Date().toISOString()
  ): void {
    if (input.reason !== undefined) exigir(input.reason, CODIGO, 'Motivo da publicação')
    if (input.externalRef !== undefined)
      exigir(input.externalRef, REFERENCIA_EXTERNA, 'Referência externa')
    this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const atual = this.publication(scope, releaseId, target)
      if (atual?.state === 'published')
        throw new ReleaseRecoveryConflictError(
          'publication-final',
          'A publicação já foi confirmada e não volta atrás.'
        )
      this.db
        .prepare(
          `INSERT INTO release_publication
             (user_id,workspace_id,project_id,release_id,target,state,reason,external_ref,attempts,updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,?)
           ON CONFLICT(user_id,workspace_id,project_id,release_id,target) DO UPDATE SET
             state=excluded.state, reason=excluded.reason,
             external_ref=COALESCE(excluded.external_ref, release_publication.external_ref),
             attempts=release_publication.attempts+1, updated_at=excluded.updated_at`
        )
        .run(
          ...paramsDe(scope),
          releaseId,
          target,
          input.state,
          input.reason ?? null,
          input.externalRef ?? null,
          now
        )
      this.auditar(scope, releaseId, `publication-${input.state}`, { target })
    })
  }

  publication(
    scope: ReleaseScope,
    releaseId: string,
    target: PublicationTarget
  ): ReleasePublication | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_publication
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? AND target=?`
      )
      .get(...paramsDe(scope), releaseId, target) as PublicationRow | undefined
    return row ? toPublication(row) : null
  }

  /** Publicações de releases **concluídas** que ainda não foram confirmadas: a pendência de evidência. */
  pendingPublications(scope: ReleaseScope): ReleasePublication[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM release_publication p JOIN release_run r ON r.id=p.release_id
         WHERE p.user_id=? AND p.workspace_id=? AND p.project_id=?
           AND p.state<>'published' AND r.status='completed'
         ORDER BY r.created_at, p.rowid`
      )
      .all(...paramsDe(scope)) as PublicationRow[]
    return rows.map(toPublication)
  }

  // --- correção devolvida à V2 -------------------------------------------------------------

  saveCorrection(
    scope: ReleaseScope,
    releaseId: string,
    input: CorrectionInput,
    now = new Date().toISOString()
  ): ReleaseCorrection {
    exigir(input.reason, CODIGO, 'Motivo da correção')
    if (input.step !== undefined) exigir(input.step, PASSO, 'Passo')
    exigir(input.contextSha256, SHA256, 'Hash do contexto')
    return this.escrita(() => {
      this.assertRelease(scope, releaseId)
      const existente = this.correction(scope, releaseId)
      if (existente) return existente
      this.db
        .prepare(
          `INSERT INTO release_correction
             (id,user_id,workspace_id,project_id,release_id,failure_class,environment,step,reason,
              state,dispatch_key,context_json,context_sha256,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?,?,?,?,?)`
        )
        .run(
          randomUUID(),
          ...paramsDe(scope),
          releaseId,
          input.failureClass,
          input.environment,
          input.step ?? null,
          input.reason,
          input.dispatchKey,
          input.contextJson,
          input.contextSha256,
          now,
          now
        )
      this.auditar(scope, releaseId, 'correction-recorded', { failureClass: input.failureClass })
      return this.correction(scope, releaseId)!
    })
  }

  markCorrection(
    scope: ReleaseScope,
    releaseId: string,
    input: { state: CorrectionState; runId?: string; reason?: string },
    now = new Date().toISOString()
  ): void {
    if (input.reason !== undefined) exigir(input.reason, CODIGO, 'Motivo')
    if (input.runId !== undefined) exigir(input.runId, ID_DE_FATIA, 'Run')
    this.escrita(() => {
      this.assertRelease(scope, releaseId)
      this.db
        .prepare(
          `UPDATE release_correction SET state=?, run_id=COALESCE(?, run_id), state_reason=?, updated_at=?
           WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
        )
        .run(
          input.state,
          input.runId ?? null,
          input.reason ?? null,
          now,
          ...paramsDe(scope),
          releaseId
        )
      this.auditar(scope, releaseId, `correction-${input.state}`)
    })
  }

  correction(scope: ReleaseScope, releaseId: string): ReleaseCorrection | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_correction
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?`
      )
      .get(...paramsDe(scope), releaseId) as CorrectionRow | undefined
    return row ? toCorrection(row) : null
  }

  /** Correções de releases do projeto que carregaram a SPEC: o histórico que a V2 recebe. */
  correctionsForSpec(scope: ReleaseScope, specId: string): ReleaseCorrection[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM release_correction c
          WHERE c.user_id=? AND c.workspace_id=? AND c.project_id=?
            AND EXISTS (SELECT 1 FROM release_inclusion i
                         WHERE i.release_id=c.release_id AND i.user_id=c.user_id
                           AND i.workspace_id=c.workspace_id AND i.project_id=c.project_id
                           AND i.spec_id=?)
          ORDER BY c.created_at, c.rowid`
      )
      .all(...paramsDe(scope), specId) as CorrectionRow[]
    return rows.map(toCorrection)
  }

  /** A SPEC concluiu (`completed`) alguma release depois de `depoisDe`? Resolve um achado anterior. */
  specConcludedAfter(scope: ReleaseScope, specId: string, depoisDe: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM release_run r
            WHERE r.user_id=? AND r.workspace_id=? AND r.project_id=? AND r.status='completed'
              AND r.updated_at>?
              AND EXISTS (SELECT 1 FROM release_inclusion i
                           WHERE i.release_id=r.id AND i.user_id=r.user_id
                             AND i.workspace_id=r.workspace_id AND i.project_id=r.project_id
                             AND i.spec_id=?)
            LIMIT 1`
        )
        .get(...paramsDe(scope), depoisDe, specId)
    )
  }

  /** Correções pendentes do projeto: a V2 ainda não foi acionada (ou o acionamento falhou). */
  pendingCorrections(scope: ReleaseScope): ReleaseCorrection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_correction
         WHERE user_id=? AND workspace_id=? AND project_id=? AND state='pending'
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope)) as CorrectionRow[]
    return rows.map(toCorrection)
  }

  // --- rollback ----------------------------------------------------------------------------

  beginRollback(
    scope: ReleaseScope,
    fromReleaseId: string,
    toReleaseId: string,
    now = new Date().toISOString()
  ): string {
    if (fromReleaseId === toReleaseId)
      throw new ReleaseRecoveryConflictError(
        'rollback-conflict',
        'Rollback para a própria release não faz sentido.'
      )
    return this.escrita(() => {
      this.assertRelease(scope, fromReleaseId)
      this.assertRelease(scope, toReleaseId)
      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO release_rollback
             (id,user_id,workspace_id,project_id,from_release_id,to_release_id,state,created_at,updated_at)
           VALUES (?,?,?,?,?,?, 'intended', ?, ?)`
        )
        .run(id, ...paramsDe(scope), fromReleaseId, toReleaseId, now, now)
      this.auditar(scope, fromReleaseId, 'rollback-intended', { toReleaseId })
      return id
    })
  }

  finishRollback(
    scope: ReleaseScope,
    id: string,
    state: Exclude<RollbackState, 'intended'>,
    now = new Date().toISOString()
  ): void {
    this.escrita(() => {
      const atual = this.db
        .prepare(
          `SELECT * FROM release_rollback WHERE id=? AND user_id=? AND workspace_id=? AND project_id=?`
        )
        .get(id, ...paramsDe(scope)) as RollbackRow | undefined
      if (!atual || atual.state !== 'intended')
        throw new ReleaseRecoveryConflictError(
          'rollback-conflict',
          'Somente um rollback em intenção pode ser fechado.'
        )
      this.db
        .prepare(`UPDATE release_rollback SET state=?, updated_at=? WHERE id=?`)
        .run(state, now, id)
      this.auditar(scope, atual.from_release_id, `rollback-${state}`, {
        toReleaseId: atual.to_release_id
      })
    })
  }

  rollbacks(scope: ReleaseScope, fromReleaseId: string): ReleaseRollback[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_rollback
         WHERE user_id=? AND workspace_id=? AND project_id=? AND from_release_id=?
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope), fromReleaseId) as RollbackRow[]
    return rows.map(toRollback)
  }
}
