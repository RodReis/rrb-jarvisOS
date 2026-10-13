import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { PreviewQuery } from '@shared/contracts/release'
import type { PreviewRun, PreviewStatus, ReleaseScope } from '@shared/domain/release'
import {
  gatesVigentes,
  transicaoDePreviewPermitida,
  validarEntradaDePreview,
  type PreviewGate,
  type PreviewGateResult,
  type PreviewProvider,
  type PreviewResource,
  type PreviewResourceKind,
  type PreviewResourceState
} from '@shared/domain/release-preview'
import type { AuditRepository } from '../storage/audit-repository'

/**
 * Persistência do PreviewRun (SPEC-Release-03). Um run por projeto + PR + SPEC; o SHA muda no
 * lugar. Quem escreve precisa ser dono do run (`lock_owner`): dois eventos do mesmo PR nunca
 * mutam ao mesmo tempo, e o dono que morreu perde a posse quando o prazo vence.
 *
 * `reason` é sempre um código curto — texto de provedor, URL com token ou saída de comando não
 * entram em evento, gate, recurso nem auditoria.
 */

export interface PreviewIdentity extends ReleaseScope {
  readonly pullRequest: number
  readonly specId: string
}

export interface PreviewClaimInput extends PreviewIdentity {
  readonly specRevision: string
  readonly headSha: string
}

export type PreviewClaim =
  | { readonly outcome: 'claimed'; readonly run: PreviewRun; readonly created: boolean }
  | { readonly outcome: 'busy'; readonly run: PreviewRun }

export interface PreviewTransitionPatch {
  readonly status: PreviewStatus
  readonly headSha?: string
  readonly specRevision?: string
  readonly reason?: string
}

export interface PreviewResourceInput {
  readonly kind: PreviewResourceKind
  readonly provider: PreviewProvider
  readonly externalId: string
  readonly url?: string | null
  readonly sourceSha: string
  readonly state: PreviewResourceState
  readonly reason?: string | null
}

export class PreviewOwnershipError extends Error {
  constructor() {
    super('O run do Preview pertence a outro executor ou a posse expirou.')
    this.name = 'PreviewOwnershipError'
  }
}

interface RunRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  pull_request: number
  spec_id: string
  spec_revision: string
  head_sha: string
  generation: number
  status: PreviewStatus
  lock_owner: string | null
  lock_expires_at: string | null
  lock_ttl_ms: number | null
  created_at: string
  updated_at: string
}

interface ResourceRow {
  id: string
  preview_id: string
  generation: number
  kind: PreviewResourceKind
  provider: PreviewProvider
  external_id: string
  url: string | null
  source_sha: string
  state: PreviewResourceState
  reason: string | null
  created_at: string
  updated_at: string
}

interface GateRow {
  id: string
  preview_id: string
  source_sha: string
  gate: string
  result: PreviewGateResult
  reason: string | null
  created_at: string
}

const COLUNAS_DO_RUN = `id,user_id,workspace_id,project_id,pull_request,spec_id,spec_revision,head_sha,
  generation,status,lock_owner,lock_expires_at,lock_ttl_ms,created_at,updated_at`
const CODIGO_VALIDO = /^[a-z0-9._:-]{1,64}$/

const scopeParams = (s: ReleaseScope): readonly string[] => [s.userId, s.workspaceId, s.projectId]

function ensureScope(scope: ReleaseScope): void {
  if (!scope.userId.trim() || !scope.workspaceId.trim() || !scope.projectId.trim())
    throw new TypeError('O escopo do Preview exige userId, workspaceId e projectId.')
}

function codigo(reason: string | null | undefined): string | null {
  if (reason === undefined || reason === null) return null
  if (!CODIGO_VALIDO.test(reason)) throw new TypeError('O motivo deve ser um código curto.')
  return reason
}

function toRun(row: RunRow): PreviewRun {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
    projectId: row.project_id,
    pullRequest: row.pull_request,
    specId: row.spec_id,
    specRevision: row.spec_revision,
    headSha: row.head_sha,
    generation: row.generation,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toResource(row: ResourceRow): PreviewResource {
  return {
    id: row.id,
    previewId: row.preview_id,
    generation: row.generation,
    kind: row.kind,
    provider: row.provider,
    externalId: row.external_id,
    ...(row.url ? { url: row.url } : {}),
    sourceSha: row.source_sha,
    state: row.state,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class PreviewRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository
  ) {}

  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /** Escrita imediata: dois executores no mesmo PR serializam aqui em vez de falhar com SQLITE_BUSY. */
  private immediate<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate()
  }

  private row(id: string): RunRow {
    const row = this.db.prepare(`SELECT ${COLUNAS_DO_RUN} FROM preview_run WHERE id=?`).get(id) as
      RunRow | undefined
    if (!row) throw new TypeError('Preview não encontrado.')
    return row
  }

  /**
   * Confere a posse e a **renova**: cada escrita do dono estende o prazo pelo mesmo intervalo da
   * tomada. Uma etapa lenta de provedor, entre duas escritas, é o único trecho sem renovação.
   */
  private assertOwner(row: RunRow, owner: string, now: string): void {
    if (row.lock_owner !== owner || !row.lock_expires_at || row.lock_expires_at <= now)
      throw new PreviewOwnershipError()
    if (row.lock_ttl_ms)
      this.db
        .prepare(`UPDATE preview_run SET lock_expires_at=? WHERE id=? AND lock_owner=?`)
        .run(new Date(Date.parse(now) + row.lock_ttl_ms).toISOString(), row.id, owner)
  }

  /** Estende a posse antes de uma etapa longa de provedor. */
  renew(previewId: string, owner: string, now = new Date().toISOString()): void {
    this.assertOwner(this.row(previewId), owner, now)
  }

  private event(
    run: RunRow,
    kind: string,
    fromStatus: string | null,
    toStatus: string | null,
    headSha: string | null,
    reason: string | null,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO preview_event
          (id,user_id,workspace_id,project_id,preview_id,kind,from_status,to_status,head_sha,reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        randomUUID(),
        run.user_id,
        run.workspace_id,
        run.project_id,
        run.id,
        kind,
        fromStatus,
        toStatus,
        headSha,
        reason,
        now
      )
    this.audit.append({
      user_id: run.user_id,
      workspace_id: run.workspace_id as 'noa' | 'jarvis',
      type: 'release-transition',
      payload: {
        projectId: run.project_id,
        previewId: run.id,
        pullRequest: run.pull_request,
        kind,
        ...(fromStatus ? { fromStatus } : {}),
        ...(toStatus ? { toStatus } : {}),
        ...(headSha ? { headSha } : {}),
        ...(reason ? { reason } : {})
      }
    })
  }

  /**
   * Cria o run (se não existir) e toma a posse dele. Um segundo executor no mesmo PR recebe
   * `busy` até o prazo vencer: evento repetido não duplica efeito.
   */
  claim(
    input: PreviewClaimInput,
    owner: string,
    ttlMs: number,
    now = new Date().toISOString()
  ): PreviewClaim {
    ensureScope(input)
    validarEntradaDePreview(input)
    if (!owner.trim() || !Number.isFinite(ttlMs) || ttlMs <= 0)
      throw new TypeError('A posse do Preview exige dono e prazo positivo.')
    return this.immediate(() => {
      const existente = this.db
        .prepare(
          `SELECT ${COLUNAS_DO_RUN} FROM preview_run WHERE user_id=? AND workspace_id=? AND project_id=?
           AND pull_request=? AND spec_id=?`
        )
        .get(...scopeParams(input), input.pullRequest, input.specId) as RunRow | undefined
      const expira = new Date(Date.parse(now) + ttlMs).toISOString()
      if (!existente) {
        const id = randomUUID()
        this.db
          .prepare(
            `INSERT INTO preview_run
              (id,user_id,workspace_id,project_id,pull_request,spec_id,spec_revision,head_sha,generation,
               status,lock_owner,lock_expires_at,lock_ttl_ms,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,1,'queued',?,?,?,?,?)`
          )
          .run(
            id,
            ...scopeParams(input),
            input.pullRequest,
            input.specId,
            input.specRevision,
            input.headSha,
            owner,
            expira,
            ttlMs,
            now,
            now
          )
        const criado = this.row(id)
        this.event(criado, 'preview-created', null, 'queued', input.headSha, null, now)
        return { outcome: 'claimed', run: toRun(criado), created: true }
      }
      const emUso =
        existente.lock_owner !== null &&
        existente.lock_owner !== owner &&
        existente.lock_expires_at !== null &&
        existente.lock_expires_at > now
      if (emUso) return { outcome: 'busy', run: toRun(existente) }
      this.db
        .prepare(`UPDATE preview_run SET lock_owner=?, lock_expires_at=?, lock_ttl_ms=? WHERE id=?`)
        .run(owner, expira, ttlMs, existente.id)
      return { outcome: 'claimed', run: toRun(this.row(existente.id)), created: false }
    })
  }

  release(previewId: string, owner: string): void {
    this.db
      .prepare(
        `UPDATE preview_run SET lock_owner=NULL, lock_expires_at=NULL, lock_ttl_ms=NULL WHERE id=? AND lock_owner=?`
      )
      .run(previewId, owner)
  }

  /** Muda o estado; `headSha` novo troca o SHA no mesmo run. Reabrir (`removed`→`queued`) sobe a geração. */
  transition(
    previewId: string,
    owner: string,
    patch: PreviewTransitionPatch,
    now = new Date().toISOString()
  ): PreviewRun {
    const reason = codigo(patch.reason)
    return this.transaction(() => {
      const atual = this.row(previewId)
      this.assertOwner(atual, owner, now)
      if (!transicaoDePreviewPermitida(atual.status, patch.status))
        throw new TypeError('Transição de Preview inválida.')
      const headSha = patch.headSha ?? atual.head_sha
      validarEntradaDePreview({
        pullRequest: atual.pull_request,
        headSha,
        specId: atual.spec_id,
        specRevision: patch.specRevision ?? atual.spec_revision
      })
      const generation =
        atual.status === 'removed' && patch.status === 'queued'
          ? atual.generation + 1
          : atual.generation
      this.db
        .prepare(
          `UPDATE preview_run SET status=?, head_sha=?, spec_revision=?, generation=?, updated_at=? WHERE id=?`
        )
        .run(
          patch.status,
          headSha,
          patch.specRevision ?? atual.spec_revision,
          generation,
          now,
          previewId
        )
      const mudou = atual.status !== patch.status || atual.head_sha !== headSha
      if (mudou || reason)
        this.event(atual, 'preview-updated', atual.status, patch.status, headSha, reason, now)
      return toRun(this.row(previewId))
    })
  }

  /** Um recurso por run + geração + tipo: criar de novo é atualizar o mesmo registro. */
  upsertResource(
    previewId: string,
    owner: string,
    input: PreviewResourceInput,
    now = new Date().toISOString()
  ): PreviewResource {
    const reason = codigo(input.reason)
    if (!input.externalId.trim()) throw new TypeError('O recurso exige o identificador externo.')
    return this.transaction(() => {
      const run = this.row(previewId)
      this.assertOwner(run, owner, now)
      this.db
        .prepare(
          `INSERT INTO preview_resource
            (id,user_id,workspace_id,project_id,preview_id,generation,kind,provider,external_id,url,
             source_sha,state,reason,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(preview_id,generation,kind) DO UPDATE SET
             provider=excluded.provider, external_id=excluded.external_id, url=excluded.url,
             source_sha=excluded.source_sha, state=excluded.state, reason=excluded.reason,
             updated_at=excluded.updated_at`
        )
        .run(
          randomUUID(),
          run.user_id,
          run.workspace_id,
          run.project_id,
          previewId,
          run.generation,
          input.kind,
          input.provider,
          input.externalId,
          input.url ?? null,
          input.sourceSha,
          input.state,
          reason,
          now,
          now
        )
      const row = this.db
        .prepare(`SELECT * FROM preview_resource WHERE preview_id=? AND generation=? AND kind=?`)
        .get(previewId, run.generation, input.kind) as ResourceRow
      return toResource(row)
    })
  }

  resources(previewId: string, generation?: number): PreviewResource[] {
    const run = this.row(previewId)
    const rows = this.db
      .prepare(
        `SELECT * FROM preview_resource WHERE preview_id=? AND generation=? ORDER BY created_at, kind`
      )
      .all(previewId, generation ?? run.generation) as ResourceRow[]
    return rows.map(toResource)
  }

  recordGate(
    previewId: string,
    owner: string,
    input: { sourceSha: string; gate: string; result: PreviewGateResult; reason?: string | null },
    now = new Date().toISOString()
  ): PreviewGate {
    const reason = codigo(input.reason)
    return this.transaction(() => {
      const run = this.row(previewId)
      this.assertOwner(run, owner, now)
      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO preview_gate
            (id,user_id,workspace_id,project_id,preview_id,generation,source_sha,gate,result,reason,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          run.user_id,
          run.workspace_id,
          run.project_id,
          previewId,
          run.generation,
          input.sourceSha,
          input.gate,
          input.result,
          reason,
          now
        )
      return {
        id,
        previewId,
        sourceSha: input.sourceSha,
        gate: input.gate,
        result: input.result,
        reason,
        createdAt: now
      }
    })
  }

  /**
   * Gates do SHA e da geração correntes; os de SHAs anteriores (e os de uma geração anterior do
   * mesmo SHA, depois de fechar e reabrir o PR) permanecem gravados, mas não valem.
   */
  currentGates(previewId: string): PreviewGate[] {
    const run = this.row(previewId)
    const rows = this.db
      .prepare(
        `SELECT * FROM preview_gate WHERE preview_id=? AND generation=? ORDER BY created_at, rowid`
      )
      .all(previewId, run.generation) as GateRow[]
    const todos: PreviewGate[] = rows.map((r) => ({
      id: r.id,
      previewId: r.preview_id,
      sourceSha: r.source_sha,
      gate: r.gate,
      result: r.result,
      reason: r.reason,
      createdAt: r.created_at
    }))
    return [...gatesVigentes(todos, run.head_sha)]
  }

  find(identity: PreviewIdentity): PreviewRun | null {
    ensureScope(identity)
    const row = this.db
      .prepare(
        `SELECT ${COLUNAS_DO_RUN} FROM preview_run WHERE user_id=? AND workspace_id=? AND project_id=?
         AND pull_request=? AND spec_id=?`
      )
      .get(...scopeParams(identity), identity.pullRequest, identity.specId) as RunRow | undefined
    return row ? toRun(row) : null
  }

  get(previewId: string): PreviewRun {
    return toRun(this.row(previewId))
  }

  previews(query: PreviewQuery): PreviewRun[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUNAS_DO_RUN} FROM preview_run
         WHERE user_id=? AND workspace_id=? AND project_id=? AND pull_request=? ORDER BY created_at, id`
      )
      .all(...scopeParams(query), query.pullRequest) as RunRow[]
    return rows.map(toRun)
  }
}
