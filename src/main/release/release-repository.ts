import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AuditRepository } from '../storage/audit-repository'
import {
  chaveIdempotenciaRelease,
  transicionarRelease,
  validarFingerprintPayload,
  type PreviewRun,
  type ReleaseEnvironment,
  type ReleaseRun,
  type ReleaseScope,
  type ReleaseStatus,
  type ReleaseStepRecord,
  type ReleaseStepState
} from '@shared/domain/release'
import type {
  PreviewQuery,
  ReleaseDetailView,
  ReleaseEnvironmentQuery,
  ReleaseQueueQuery,
  ReleaseQueueView,
  ReleaseQuery,
  ReleaseTimelineItem
} from '@shared/contracts/release'

export type ReleaseReason =
  | 'candidate-replaced'
  | 'state-transition'
  | 'transition-rejected'
  | 'step-intended'
  | 'step-confirmed'
  | 'step-ambiguous'
  | 'step-failed'
  | 'step-recovered-as-ambiguous'
  | 'gate-recorded'
  | 'preview-updated'

export class ReleaseConflictError extends Error {
  constructor(
    readonly code:
      | 'lane-busy'
      | 'lease-busy'
      | 'lease-expired'
      | 'lease-mismatch'
      | 'invalid-transition'
      | 'staging-freezes-candidate'
      | 'idempotency-payload-conflict'
      | 'reconciliation-required'
      | 'invalid-safe-payload'
      | 'step-order'
      | 'release-diary-incomplete'
      | 'release-not-found',
    message: string
  ) {
    super(message)
    this.name = 'ReleaseConflictError'
  }
}

interface ReleaseRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  sha: string
  status: ReleaseStatus
  stage_started_at: string | null
  created_at: string
  updated_at: string
}

interface StepRow {
  release_id: string
  environment: ReleaseEnvironment
  step: string
  idempotency_key: string
  payload_hash: string
  state: ReleaseStepState
  attempt: number
  updated_at: string
}

export interface ReleaseLease {
  readonly leaseId: string
  readonly ownerId: string
  readonly fencingToken: number
}

interface GateInput extends ReleaseScope {
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly gate: string
  readonly result: 'passed' | 'blocked' | 'unknown'
  readonly reasonCode: string | null
}

function toRelease(row: ReleaseRow): ReleaseRun {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
    projectId: row.project_id,
    sha: row.sha,
    status: row.status,
    stageStartedAt: row.stage_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toStep(row: StepRow): ReleaseStepRecord {
  return {
    releaseId: row.release_id,
    environment: row.environment,
    step: row.step,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    state: row.state,
    attempt: row.attempt,
    updatedAt: row.updated_at
  }
}

function scopeParams(scope: ReleaseScope): readonly string[] {
  return [scope.userId, scope.workspaceId, scope.projectId]
}

function ensureScope(scope: ReleaseScope): void {
  if (!scope.userId.trim() || !scope.workspaceId.trim() || !scope.projectId.trim()) {
    throw new TypeError('O escopo da release exige userId, workspaceId e projectId.')
  }
}

export class ReleaseRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository
  ) {}

  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  private event(
    scope: ReleaseScope,
    releaseId: string,
    kind: ReleaseReason,
    now: string,
    environment: ReleaseEnvironment | null = null,
    fromStatus: string | null = null,
    toStatus: string | null = null,
    reason: string | null = null
  ): void {
    this.db
      .prepare(
        `INSERT INTO release_event
          (id,user_id,workspace_id,project_id,release_id,environment,kind,from_status,to_status,reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        randomUUID(),
        scope.userId,
        scope.workspaceId,
        scope.projectId,
        releaseId,
        environment,
        kind,
        fromStatus,
        toStatus,
        reason,
        now
      )
    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspaceId as 'noa' | 'jarvis',
      type: 'release-transition',
      payload: {
        projectId: scope.projectId,
        releaseId,
        ...(environment ? { environment } : {}),
        kind,
        ...(fromStatus ? { fromStatus } : {}),
        ...(toStatus ? { toStatus } : {}),
        ...(reason ? { reason } : {})
      }
    })
  }

  enqueue(
    scope: ReleaseScope,
    sha: string,
    now = new Date().toISOString()
  ): { release: ReleaseRun; created: boolean } {
    ensureScope(scope)
    if (!/^[a-f0-9]{7,64}$/i.test(sha))
      throw new TypeError('O SHA deve conter de 7 a 64 caracteres hexadecimais.')
    return this.transaction(() => {
      const existingSha = this.db
        .prepare(
          `SELECT * FROM release_run WHERE user_id=? AND workspace_id=? AND project_id=? AND sha=?`
        )
        .get(...scopeParams(scope), sha) as ReleaseRow | undefined
      if (existingSha) return { release: toRelease(existingSha), created: false }
      const candidate = this.db
        .prepare(
          `SELECT r.* FROM release_candidate c JOIN release_run r ON r.id=c.release_id
            WHERE c.user_id=? AND c.workspace_id=? AND c.project_id=?`
        )
        .get(...scopeParams(scope)) as ReleaseRow | undefined
      if (candidate?.sha === sha) return { release: toRelease(candidate), created: false }

      if (
        candidate &&
        !candidate.stage_started_at &&
        ['queued', 'preparing'].includes(candidate.status)
      ) {
        const unresolvedStep = this.db
          .prepare(
            `SELECT 1 FROM release_step WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
            AND state IN ('intended','ambiguous') LIMIT 1`
          )
          .get(...scopeParams(scope), candidate.id)
        if (unresolvedStep) {
          throw new ReleaseConflictError(
            'reconciliation-required',
            'Resolva passos incertos antes de consolidar outro SHA.'
          )
        }
        this.db
          .prepare(
            "UPDATE release_run SET status='superseded',updated_at=? WHERE id=? AND stage_started_at IS NULL"
          )
          .run(now, candidate.id)
        this.event(
          scope,
          candidate.id,
          'candidate-replaced',
          now,
          null,
          candidate.status,
          'superseded'
        )
        this.db
          .prepare(
            `UPDATE release_lease SET expires_at=?,updated_at=?
            WHERE user_id=? AND workspace_id=? AND project_id=?
              AND EXISTS (SELECT 1 FROM release_environment_lane l
                WHERE l.user_id=release_lease.user_id AND l.workspace_id=release_lease.workspace_id
                  AND l.project_id=release_lease.project_id AND l.environment=release_lease.environment
                  AND l.active_release_id=?)`
          )
          .run(now, now, ...scopeParams(scope), candidate.id)
        this.db
          .prepare(
            `UPDATE release_environment_lane SET active_release_id=NULL,updated_at=?
            WHERE user_id=? AND workspace_id=? AND project_id=? AND active_release_id=?`
          )
          .run(now, ...scopeParams(scope), candidate.id)
        this.db
          .prepare(
            'DELETE FROM release_candidate WHERE user_id=? AND workspace_id=? AND project_id=?'
          )
          .run(...scopeParams(scope))
      }

      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO release_run (id,user_id,workspace_id,project_id,sha,status,stage_started_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'queued',NULL,?,?)`
        )
        .run(id, ...scopeParams(scope), sha, now, now)
      this.db
        .prepare(
          `INSERT INTO release_candidate (user_id,workspace_id,project_id,release_id,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id,workspace_id,project_id) DO UPDATE SET release_id=excluded.release_id,updated_at=excluded.updated_at`
        )
        .run(...scopeParams(scope), id, now)
      this.event(scope, id, 'state-transition', now, null, null, 'queued')
      const release = this.get({ ...scope, releaseId: id })
      if (!release) throw new Error('A release recém criada não foi localizada.')
      return { release, created: true }
    })
  }

  acquireLease(
    query: ReleaseEnvironmentQuery,
    ownerId: string,
    durationMs: number,
    now = new Date().toISOString()
  ): ReleaseLease {
    ensureScope(query)
    if (!ownerId.trim() || !Number.isSafeInteger(durationMs) || durationMs < 1_000) {
      throw new TypeError('Lease exige dono e duração inteira mínima de 1 segundo.')
    }
    return this.transaction(() => {
      if (!this.get(query))
        throw new ReleaseConflictError(
          'release-not-found',
          'Release não encontrada no escopo informado.'
        )
      const lane = this.db
        .prepare(
          `SELECT active_release_id FROM release_environment_lane
          WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?`
        )
        .get(...scopeParams(query), query.environment) as
        { active_release_id: string | null } | undefined
      if (lane?.active_release_id && lane.active_release_id !== query.releaseId) {
        throw new ReleaseConflictError(
          'lane-busy',
          'Já existe outra release ativa neste projeto e ambiente.'
        )
      }
      this.db
        .prepare(
          `INSERT INTO release_environment_lane (user_id,workspace_id,project_id,environment,active_release_id,updated_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,workspace_id,project_id,environment)
         DO UPDATE SET active_release_id=excluded.active_release_id,updated_at=excluded.updated_at
         WHERE release_environment_lane.active_release_id IS NULL OR release_environment_lane.active_release_id=excluded.active_release_id`
        )
        .run(...scopeParams(query), query.environment, query.releaseId, now)

      const previous = this.db
        .prepare(
          `SELECT fencing_token,expires_at FROM release_lease
          WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?`
        )
        .get(...scopeParams(query), query.environment) as
        { fencing_token: number; expires_at: string } | undefined
      if (previous && previous.expires_at > now) {
        throw new ReleaseConflictError(
          'lease-busy',
          'Outro writer ainda possui o lease deste ambiente.'
        )
      }
      const lease = {
        leaseId: randomUUID(),
        ownerId,
        fencingToken: (previous?.fencing_token ?? 0) + 1
      }
      const expiresAt = new Date(Date.parse(now) + durationMs).toISOString()
      this.db
        .prepare(
          `INSERT INTO release_lease (user_id,workspace_id,project_id,environment,lease_id,owner_id,fencing_token,expires_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,workspace_id,project_id,environment)
         DO UPDATE SET lease_id=excluded.lease_id,owner_id=excluded.owner_id,fencing_token=excluded.fencing_token,
           expires_at=excluded.expires_at,updated_at=excluded.updated_at`
        )
        .run(
          ...scopeParams(query),
          query.environment,
          lease.leaseId,
          lease.ownerId,
          lease.fencingToken,
          expiresAt,
          now
        )
      return lease
    })
  }

  renewLease(
    query: ReleaseEnvironmentQuery,
    lease: ReleaseLease,
    durationMs: number,
    now = new Date().toISOString()
  ): void {
    const changed = this.db
      .prepare(
        `UPDATE release_lease SET expires_at=?,updated_at=?
        WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?
          AND lease_id=? AND owner_id=? AND fencing_token=? AND expires_at>?`
      )
      .run(
        new Date(Date.parse(now) + durationMs).toISOString(),
        now,
        ...scopeParams(query),
        query.environment,
        lease.leaseId,
        lease.ownerId,
        lease.fencingToken,
        now
      )
    if (changed.changes !== 1)
      throw new ReleaseConflictError('lease-expired', 'O lease expirou ou perdeu o fencing token.')
  }

  releaseLease(
    query: ReleaseEnvironmentQuery,
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): void {
    const changed = this.db
      .prepare(
        `UPDATE release_lease SET expires_at=?,updated_at=? WHERE user_id=? AND workspace_id=? AND project_id=?
        AND environment=? AND lease_id=? AND owner_id=? AND fencing_token=? AND expires_at>?`
      )
      .run(
        now,
        now,
        ...scopeParams(query),
        query.environment,
        lease.leaseId,
        lease.ownerId,
        lease.fencingToken,
        now
      )
    if (changed.changes !== 1)
      throw new ReleaseConflictError(
        'lease-mismatch',
        'Somente o dono vigente pode liberar o lease.'
      )
  }

  transition(
    query: ReleaseEnvironmentQuery,
    next: ReleaseStatus,
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): ReleaseRun {
    ensureScope(query)
    const result = this.transaction(() => {
      this.assertLease(query, lease, now)
      const current = this.get(query)
      if (!current)
        throw new ReleaseConflictError(
          'release-not-found',
          'Release não encontrada no escopo informado.'
        )
      const reject = (code: ReleaseConflictError['code'], reason: string) => {
        this.event(
          query,
          current.id,
          'transition-rejected',
          now,
          query.environment,
          current.status,
          next,
          reason
        )
        return { error: new ReleaseConflictError(code, reason) }
      }
      const decision = transicionarRelease(current.status, next, current.stageStartedAt, now)
      if (!decision.ok) {
        return reject(decision.reason, 'Transição inválida ou candidata congelada em Staging.')
      }
      const expectedEnvironment =
        next === 'production' || ['production', 'stabilizing'].includes(current.status)
          ? 'production'
          : 'staging'
      if (query.environment !== expectedEnvironment) {
        return reject('invalid-transition', 'Transição solicitada na lane de ambiente incorreta.')
      }
      if (next === 'staging' && !this.hasConfirmedSteps(query, ['prepared'])) {
        return reject('release-diary-incomplete', 'Passo prepared precisa estar confirmado.')
      }
      const stagingQuery = { ...query, environment: 'staging' as const }
      const productionQuery = { ...query, environment: 'production' as const }
      const completeDiary = [
        'prepared',
        'database_migrated',
        'backend_healthy',
        'frontend_promoted',
        'smoke_passed'
      ]
      if (next === 'production' && !this.hasConfirmedSteps(stagingQuery, completeDiary)) {
        return reject('release-diary-incomplete', 'Diário de Staging incompleto ou não confirmado.')
      }
      if (next === 'stabilizing' && !this.hasConfirmedSteps(productionQuery, completeDiary)) {
        return reject(
          'release-diary-incomplete',
          'Diário de Produção incompleto ou não confirmado.'
        )
      }
      if (
        ['completed', 'superseded', 'failed', 'degraded'].includes(next) &&
        this.hasUnresolvedSteps(query)
      ) {
        return reject(
          'reconciliation-required',
          'Efeitos intended/ambiguous precisam ser reconciliados antes do estado terminal.'
        )
      }
      const changed = this.db
        .prepare(
          `UPDATE release_run SET status=?,stage_started_at=?,updated_at=?
          WHERE id=? AND user_id=? AND workspace_id=? AND project_id=? AND status=?`
        )
        .run(
          decision.status,
          decision.stageStartedAt,
          now,
          query.releaseId,
          ...scopeParams(query),
          current.status
        )
      if (changed.changes !== 1)
        throw new ReleaseConflictError('invalid-transition', 'A release mudou durante a transição.')

      if (next === 'staging' || next === 'production') this.assertLane(query)
      if (current.status === 'staging' && next === 'production')
        this.clearLane({ ...query, environment: 'staging' }, query.releaseId, now)
      if (next === 'completed') {
        this.clearLane({ ...query, environment: 'production' }, query.releaseId, now)
        this.db
          .prepare(
            'DELETE FROM release_candidate WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?'
          )
          .run(...scopeParams(query), query.releaseId)
      }
      if (next === 'failed' || next === 'degraded') {
        this.clearLane(query, query.releaseId, now)
      }
      this.event(
        query,
        current.id,
        'state-transition',
        now,
        query.environment,
        current.status,
        decision.status
      )
      const updated = this.get(query)
      if (!updated) throw new Error('A release desapareceu durante a transição.')
      return { release: updated }
    })
    if ('error' in result) throw result.error
    return result.release
  }

  beginStep(
    query: ReleaseEnvironmentQuery,
    step: string,
    payloadHash: string,
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): {
    readonly state: 'ready' | 'already-confirmed' | 'reconcile-required'
    readonly record: ReleaseStepRecord
  } {
    ensureScope(query)
    if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(step) || !validarFingerprintPayload(payloadHash)) {
      throw new ReleaseConflictError(
        'invalid-safe-payload',
        'Passo inválido ou fingerprint não-SHA-256.'
      )
    }
    const idempotencyKey = chaveIdempotenciaRelease(
      query.projectId,
      query.environment,
      query.releaseId,
      step
    )
    return this.transaction(() => {
      this.assertLease(query, lease, now)
      const release = this.get(query)
      if (!release)
        throw new ReleaseConflictError(
          'release-not-found',
          'Release não encontrada no escopo informado.'
        )
      const old = this.db
        .prepare(
          `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
          WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? AND environment=? AND step=?`
        )
        .get(...scopeParams(query), query.releaseId, query.environment, step) as StepRow | undefined
      if (old && old.payload_hash !== payloadHash) {
        throw new ReleaseConflictError(
          'idempotency-payload-conflict',
          'A chave idempotente já foi usada com outro payload.'
        )
      }
      if (old?.state === 'confirmed') return { state: 'already-confirmed', record: toStep(old) }
      if (old && (old.state === 'ambiguous' || old.state === 'intended')) {
        throw new ReleaseConflictError(
          'reconciliation-required',
          'Passo incerto deve ser reconciliado antes de qualquer repetição.'
        )
      }
      if (this.nextExpectedStep(query, release.status) !== step) {
        throw new ReleaseConflictError(
          'step-order',
          'Passo fora da fase, do ambiente ou da ordem definida para a release.'
        )
      }
      const attempt = (old?.attempt ?? 0) + 1
      this.db
        .prepare(
          `INSERT INTO release_step
          (user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'intended',?,?)
         ON CONFLICT(user_id,workspace_id,project_id,release_id,environment,step)
         DO UPDATE SET state='intended',attempt=excluded.attempt,updated_at=excluded.updated_at
         WHERE release_step.payload_hash=excluded.payload_hash`
        )
        .run(
          ...scopeParams(query),
          query.releaseId,
          query.environment,
          step,
          idempotencyKey,
          payloadHash,
          attempt,
          now
        )
      this.event(
        query,
        query.releaseId,
        'step-intended',
        now,
        query.environment,
        old?.state ?? null,
        'intended',
        step
      )
      return { state: 'ready', record: this.getStep(query, step)! }
    })
  }

  finishStep(
    query: ReleaseEnvironmentQuery,
    step: string,
    payloadHash: string,
    state: Exclude<ReleaseStepState, 'intended'>,
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): ReleaseStepRecord {
    return this.transaction(() => {
      this.assertLease(query, lease, now)
      const previous = this.getStep(query, step)
      if (!previous || previous.payloadHash !== payloadHash) {
        throw new ReleaseConflictError(
          'idempotency-payload-conflict',
          'Intenção ausente ou payload diferente para confirmar o passo.'
        )
      }
      if (previous.state === 'confirmed') return previous
      if (previous.state !== 'intended')
        throw new ReleaseConflictError(
          'reconciliation-required',
          'Somente intenção vigente pode ser concluída.'
        )
      this.db
        .prepare(
          `UPDATE release_step SET state=?,updated_at=? WHERE user_id=? AND workspace_id=? AND project_id=?
          AND release_id=? AND environment=? AND step=? AND state='intended'`
        )
        .run(state, now, ...scopeParams(query), query.releaseId, query.environment, step)
      const kind =
        state === 'confirmed'
          ? 'step-confirmed'
          : state === 'ambiguous'
            ? 'step-ambiguous'
            : 'step-failed'
      this.event(query, query.releaseId, kind, now, query.environment, 'intended', state, step)
      return this.getStep(query, step)!
    })
  }

  resolveAmbiguous(
    query: ReleaseEnvironmentQuery,
    step: string,
    state: 'confirmed' | 'failed',
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): ReleaseStepRecord {
    return this.transaction(() => {
      this.assertLease(query, lease, now)
      const previous = this.getStep(query, step)
      if (!previous) throw new ReleaseConflictError('release-not-found', 'Passo não encontrado.')
      if (previous.state !== 'ambiguous') {
        if (previous.state === state) return previous
        throw new ReleaseConflictError(
          'reconciliation-required',
          'O passo não está em estado ambíguo.'
        )
      }
      const release = this.get(query)
      if (!release || this.nextExpectedStep(query, release.status) !== step) {
        throw new ReleaseConflictError(
          'step-order',
          'Reconciliação fora da fase, ambiente ou ordem definida para a release.'
        )
      }
      this.db
        .prepare(
          `UPDATE release_step SET state=?,updated_at=? WHERE user_id=? AND workspace_id=? AND project_id=?
          AND release_id=? AND environment=? AND step=? AND state='ambiguous'`
        )
        .run(state, now, ...scopeParams(query), query.releaseId, query.environment, step)
      this.event(
        query,
        query.releaseId,
        state === 'confirmed' ? 'step-confirmed' : 'step-failed',
        now,
        query.environment,
        'ambiguous',
        state,
        step
      )
      return this.getStep(query, step)!
    })
  }

  recoverIntended(query: ReleaseEnvironmentQuery, now = new Date().toISOString()): number {
    return this.transaction(() => {
      const pending = this.db
        .prepare(
          `SELECT step FROM release_step WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
          AND environment=? AND state='intended'`
        )
        .all(...scopeParams(query), query.releaseId, query.environment) as { step: string }[]
      for (const item of pending) {
        this.db
          .prepare(
            `UPDATE release_step SET state='ambiguous',updated_at=? WHERE user_id=? AND workspace_id=?
            AND project_id=? AND release_id=? AND environment=? AND step=? AND state='intended'`
          )
          .run(now, ...scopeParams(query), query.releaseId, query.environment, item.step)
        this.event(
          query,
          query.releaseId,
          'step-recovered-as-ambiguous',
          now,
          query.environment,
          'intended',
          'ambiguous',
          item.step
        )
      }
      return pending.length
    })
  }

  recordGate(input: GateInput, now = new Date().toISOString()): void {
    ensureScope(input)
    if (
      !/^[a-z][a-z0-9._-]{0,63}$/i.test(input.gate) ||
      (input.reasonCode && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input.reasonCode))
    ) {
      throw new TypeError('Gate ou código de motivo inválido.')
    }
    this.transaction(() => {
      if (!this.get(input))
        throw new ReleaseConflictError(
          'release-not-found',
          'Release não encontrada no escopo informado.'
        )
      this.db
        .prepare(
          `INSERT INTO release_gate_result (id,user_id,workspace_id,project_id,release_id,environment,gate,result,reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          randomUUID(),
          ...scopeParams(input),
          input.releaseId,
          input.environment,
          input.gate,
          input.result,
          input.reasonCode,
          now
        )
      this.event(
        input,
        input.releaseId,
        'gate-recorded',
        now,
        input.environment,
        null,
        input.result,
        input.gate
      )
    })
  }

  upsertPreview(
    input: Omit<PreviewRun, 'createdAt' | 'updatedAt'>,
    now = new Date().toISOString()
  ): PreviewRun {
    ensureScope(input)
    if (
      !Number.isSafeInteger(input.pullRequest) ||
      input.pullRequest < 1 ||
      !/^[a-f0-9]{7,64}$/i.test(input.headSha)
    ) {
      throw new TypeError('Preview exige número de PR positivo e SHA válido.')
    }
    const allowed: Readonly<Record<PreviewRun['status'], readonly PreviewRun['status'][]>> = {
      queued: ['preparing', 'failed', 'removed'],
      preparing: ['ready', 'failed', 'removed'],
      ready: ['removed'],
      failed: ['removed'],
      removed: []
    }
    return this.transaction(() => {
      const previous = this.db
        .prepare(
          `SELECT id,status,created_at FROM preview_run WHERE user_id=? AND workspace_id=? AND project_id=?
          AND pull_request=? AND head_sha=?`
        )
        .get(...scopeParams(input), input.pullRequest, input.headSha) as
        { id: string; status: PreviewRun['status']; created_at: string } | undefined
      if (
        previous &&
        previous.status !== input.status &&
        !allowed[previous.status].includes(input.status)
      ) {
        throw new TypeError('Transição de Preview inválida.')
      }
      const id = previous?.id ?? input.id
      const createdAt = previous?.created_at ?? now
      this.db
        .prepare(
          `INSERT INTO preview_run (id,user_id,workspace_id,project_id,pull_request,head_sha,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,workspace_id,project_id,pull_request,head_sha)
         DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`
        )
        .run(
          id,
          ...scopeParams(input),
          input.pullRequest,
          input.headSha,
          input.status,
          createdAt,
          now
        )
      if (!previous || previous.status !== input.status) {
        this.db
          .prepare(
            `INSERT INTO preview_event (id,user_id,workspace_id,project_id,preview_id,kind,from_status,to_status,created_at)
           VALUES (?,?,?,?,?,'preview-updated',?,?,?)`
          )
          .run(randomUUID(), ...scopeParams(input), id, previous?.status ?? null, input.status, now)
        this.audit.append({
          user_id: input.userId,
          workspace_id: input.workspaceId,
          type: 'release-transition',
          payload: {
            projectId: input.projectId,
            previewId: id,
            pullRequest: input.pullRequest,
            kind: 'preview-updated',
            ...(previous ? { fromStatus: previous.status } : {}),
            toStatus: input.status
          }
        })
      }
      return { ...input, id, createdAt, updatedAt: now }
    })
  }

  get(query: ReleaseQuery): ReleaseRun | null {
    ensureScope(query)
    const row = this.db
      .prepare(
        'SELECT * FROM release_run WHERE id=? AND user_id=? AND workspace_id=? AND project_id=?'
      )
      .get(query.releaseId, ...scopeParams(query)) as ReleaseRow | undefined
    return row ? toRelease(row) : null
  }

  getStep(query: ReleaseEnvironmentQuery, step: string): ReleaseStepRecord | null {
    const row = this.db
      .prepare(
        `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
        WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? AND environment=? AND step=?`
      )
      .get(...scopeParams(query), query.releaseId, query.environment, step) as StepRow | undefined
    return row ? toStep(row) : null
  }

  assertStepPhase(
    query: ReleaseEnvironmentQuery,
    step: string,
    lease: ReleaseLease,
    now = new Date().toISOString()
  ): void {
    this.transaction(() => {
      this.assertLease(query, lease, now)
      const release = this.get(query)
      if (!release) throw new ReleaseConflictError('release-not-found', 'Release não encontrada.')
      if (this.nextExpectedStep(query, release.status) !== step)
        throw new ReleaseConflictError(
          'step-order',
          'Passo fora da fase, do ambiente ou da ordem definida para a release.'
        )
    })
  }

  queue(query: ReleaseQueueQuery): ReleaseQueueView {
    ensureScope(query)
    const candidateRow = this.db
      .prepare(
        `SELECT r.* FROM release_candidate c JOIN release_run r ON r.id=c.release_id
        WHERE c.user_id=? AND c.workspace_id=? AND c.project_id=?`
      )
      .get(...scopeParams(query)) as ReleaseRow | undefined
    const active = this.db
      .prepare(
        `SELECT environment,active_release_id FROM release_environment_lane
        WHERE user_id=? AND workspace_id=? AND project_id=?`
      )
      .all(...scopeParams(query)) as {
      environment: ReleaseEnvironment
      active_release_id: string | null
    }[]
    const pending = this.db
      .prepare(
        `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
        WHERE user_id=? AND workspace_id=? AND project_id=? AND state IN ('intended','ambiguous') ORDER BY updated_at`
      )
      .all(...scopeParams(query)) as StepRow[]
    const candidate = candidateRow ? toRelease(candidateRow) : null
    const minimalAction = pending.length
      ? 'reconcile'
      : candidate && ['queued', 'preparing'].includes(candidate.status)
        ? 'resume'
        : candidate && ['failed', 'degraded'].includes(candidate.status)
          ? 'resolve-blocker'
          : 'none'
    return {
      candidate,
      activeEnvironments: {
        staging: active.find((lane) => lane.environment === 'staging')?.active_release_id ?? null,
        production:
          active.find((lane) => lane.environment === 'production')?.active_release_id ?? null
      },
      pendingReconciliation: pending.map(toStep),
      minimalAction
    }
  }

  detail(query: ReleaseQuery): ReleaseDetailView | null {
    const release = this.get(query)
    if (!release) return null
    const steps = this.db
      .prepare(
        `SELECT release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at FROM release_step
        WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY updated_at`
      )
      .all(...scopeParams(query), query.releaseId) as StepRow[]
    const gates = this.db
      .prepare(
        `SELECT id,user_id,workspace_id,project_id,release_id,environment,gate,result,reason,created_at AS createdAt FROM release_gate_result
        WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY created_at`
      )
      .all(...scopeParams(query), query.releaseId) as {
      id: string
      user_id: string
      workspace_id: string
      project_id: string
      release_id: string
      environment: ReleaseEnvironment
      gate: string
      result: 'passed' | 'blocked' | 'unknown'
      reason: string | null
      createdAt: string
    }[]
    const timeline = this.timeline(query)
    const pending = steps.some((step) => step.state === 'intended' || step.state === 'ambiguous')
    const minimalAction = pending
      ? 'reconcile'
      : ['queued', 'preparing'].includes(release.status)
        ? 'resume'
        : ['failed', 'degraded'].includes(release.status)
          ? 'resolve-blocker'
          : 'none'
    return {
      release,
      steps: steps.map(toStep),
      gates: gates.map((gate) => ({
        id: gate.id,
        userId: gate.user_id,
        workspaceId: gate.workspace_id as ReleaseScope['workspaceId'],
        projectId: gate.project_id,
        releaseId: gate.release_id,
        environment: gate.environment,
        gate: gate.gate,
        result: gate.result,
        reason: gate.reason,
        createdAt: gate.createdAt
      })),
      timeline,
      minimalAction
    }
  }

  timeline(query: ReleaseQuery): ReleaseTimelineItem[] {
    const rows = this.db
      .prepare(
        `SELECT id,release_id,environment,kind,from_status,to_status,reason,created_at FROM release_event
        WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? ORDER BY created_at,id`
      )
      .all(...scopeParams(query), query.releaseId) as {
      id: string
      release_id: string
      environment: ReleaseEnvironment | null
      kind: string
      from_status: string | null
      to_status: string | null
      reason: string | null
      created_at: string
    }[]
    return rows.map((row) => ({
      id: row.id,
      releaseId: row.release_id,
      environment: row.environment,
      kind: row.kind,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      createdAt: row.created_at
    }))
  }

  previews(query: PreviewQuery): PreviewRun[] {
    const rows = this.db
      .prepare(
        `SELECT id,user_id,workspace_id,project_id,pull_request,head_sha,status,created_at,updated_at FROM preview_run
        WHERE user_id=? AND workspace_id=? AND project_id=? AND pull_request=? ORDER BY created_at`
      )
      .all(...scopeParams(query), query.pullRequest) as {
      id: string
      user_id: string
      workspace_id: string
      project_id: string
      pull_request: number
      head_sha: string
      status: PreviewRun['status']
      created_at: string
      updated_at: string
    }[]
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
      projectId: row.project_id,
      pullRequest: row.pull_request,
      headSha: row.head_sha,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  private assertLease(query: ReleaseEnvironmentQuery, lease: ReleaseLease, now: string): void {
    const row = this.db
      .prepare(
        `SELECT 1 FROM release_lease WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?
        AND lease_id=? AND owner_id=? AND fencing_token=? AND expires_at>?`
      )
      .get(
        ...scopeParams(query),
        query.environment,
        lease.leaseId,
        lease.ownerId,
        lease.fencingToken,
        now
      )
    if (!row)
      throw new ReleaseConflictError(
        'lease-mismatch',
        'Escritor não possui lease vigente neste projeto/ambiente.'
      )
    this.assertLane(query)
  }

  private assertLane(query: ReleaseEnvironmentQuery): void {
    const row = this.db
      .prepare(
        `SELECT active_release_id FROM release_environment_lane
        WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?`
      )
      .get(...scopeParams(query), query.environment) as
      { active_release_id: string | null } | undefined
    if (row?.active_release_id !== query.releaseId) {
      throw new ReleaseConflictError(
        'lane-busy',
        'A lane do ambiente não pertence à release atual.'
      )
    }
  }

  private clearLane(query: ReleaseEnvironmentQuery, releaseId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE release_environment_lane SET active_release_id=NULL,updated_at=?
        WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=? AND active_release_id=?`
      )
      .run(now, ...scopeParams(query), query.environment, releaseId)
    this.db
      .prepare(
        `UPDATE release_lease SET expires_at=?,updated_at=?
        WHERE user_id=? AND workspace_id=? AND project_id=? AND environment=?`
      )
      .run(now, now, ...scopeParams(query), query.environment)
  }

  private hasConfirmedSteps(query: ReleaseEnvironmentQuery, steps: readonly string[]): boolean {
    const confirmed = new Set(
      (
        this.db
          .prepare(
            `SELECT step FROM release_step WHERE user_id=? AND workspace_id=? AND project_id=?
            AND release_id=? AND environment=? AND state='confirmed'`
          )
          .all(...scopeParams(query), query.releaseId, query.environment) as { step: string }[]
      ).map((row) => row.step)
    )
    return steps.every((step) => confirmed.has(step))
  }

  private hasUnresolvedSteps(query: ReleaseEnvironmentQuery): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM release_step WHERE user_id=? AND workspace_id=? AND project_id=?
          AND release_id=? AND state IN ('intended','ambiguous') LIMIT 1`
        )
        .get(...scopeParams(query), query.releaseId)
    )
  }

  private nextExpectedStep(query: ReleaseEnvironmentQuery, status: ReleaseStatus): string | null {
    const expectedEnvironment = status === 'production' ? 'production' : 'staging'
    if (query.environment !== expectedEnvironment) return null
    const sequence =
      status === 'preparing'
        ? ['prepared']
        : status === 'staging'
          ? ['database_migrated', 'backend_healthy', 'frontend_promoted', 'smoke_passed']
          : status === 'production'
            ? [
                'prepared',
                'database_migrated',
                'backend_healthy',
                'frontend_promoted',
                'smoke_passed'
              ]
            : []
    const confirmed = new Set(
      (
        this.db
          .prepare(
            `SELECT step FROM release_step WHERE user_id=? AND workspace_id=? AND project_id=?
            AND release_id=? AND environment=? AND state='confirmed'`
          )
          .all(...scopeParams(query), query.releaseId, query.environment) as { step: string }[]
      ).map((row) => row.step)
    )
    return sequence.find((step) => !confirmed.has(step)) ?? null
  }
}
