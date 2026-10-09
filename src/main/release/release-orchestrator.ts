import { randomUUID } from 'node:crypto'
import type {
  ReleaseEnvironmentQuery,
  ReleaseQuery,
  ReleaseQueueQuery
} from '@shared/contracts/release'
import type { PreviewRun, ReleaseStatus } from '@shared/domain/release'
import { ReleaseConflictError, ReleaseRepository, type ReleaseLease } from './release-repository'

export interface ReleaseEffectRequest {
  readonly releaseId: string
  readonly projectId: string
  readonly environment: ReleaseEnvironmentQuery['environment']
  readonly step: string
  readonly idempotencyKey: string
  readonly payloadHash: string
  readonly payload: unknown
}

export type ReleaseReconciliationRequest = Omit<ReleaseEffectRequest, 'payload'>

export interface ReleasePort {
  execute(request: ReleaseEffectRequest): Promise<'confirmed' | 'ambiguous' | 'failed'>
  reconcile(request: ReleaseReconciliationRequest): Promise<'applied' | 'not-applied' | 'unknown'>
}

export interface ReleaseStepOutcome {
  readonly state: 'confirmed' | 'ambiguous' | 'failed'
  readonly repeated: boolean
}

export class PreviewCoordinator {
  constructor(private readonly repository: ReleaseRepository) {}

  register(input: Omit<PreviewRun, 'id' | 'createdAt' | 'updatedAt'>): PreviewRun {
    return this.repository.upsertPreview({ ...input, id: randomUUID() })
  }

  update(input: PreviewRun): PreviewRun {
    return this.repository.upsertPreview(input)
  }
}

export class ReleaseOrchestrator {
  constructor(
    private readonly repository: ReleaseRepository,
    private readonly port: ReleasePort,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  enqueue(query: ReleaseQueueQuery, sha: string) {
    return this.repository.enqueue(query, sha)
  }

  acquireWriter(query: ReleaseEnvironmentQuery, ownerId: string, durationMs: number): ReleaseLease {
    return this.repository.acquireLease(query, ownerId, durationMs, this.now())
  }

  transition(query: ReleaseEnvironmentQuery, next: ReleaseStatus, lease: ReleaseLease) {
    return this.repository.transition(query, next, lease, this.now())
  }

  async runStep(
    query: ReleaseEnvironmentQuery,
    step: string,
    payload: unknown,
    lease: ReleaseLease
  ): Promise<ReleaseStepOutcome> {
    let begun: ReturnType<ReleaseRepository['beginStep']>
    try {
      begun = this.repository.beginStep(query, step, payload, lease, this.now())
    } catch (error) {
      if (!(error instanceof ReleaseConflictError) || error.code !== 'reconciliation-required')
        throw error
      const reconciled = await this.reconcileStep(query, step, lease)
      if (reconciled.state !== 'failed') {
        return { state: reconciled.state, repeated: false }
      }
      begun = this.repository.beginStep(query, step, payload, lease, this.now())
    }

    if (begun.state === 'already-confirmed') return { state: 'confirmed', repeated: false }
    const request: ReleaseEffectRequest = {
      releaseId: query.releaseId,
      projectId: query.projectId,
      environment: query.environment,
      step,
      idempotencyKey: begun.record.idempotencyKey,
      payloadHash: begun.record.payloadHash,
      payload
    }
    let state: 'confirmed' | 'ambiguous' | 'failed'
    try {
      state = await this.port.execute(request)
    } catch {
      // A thrown transport result cannot prove whether the remote effect occurred.
      state = 'ambiguous'
    }
    this.repository.finishStep(query, step, begun.record.payloadHash, state, lease, this.now())
    return { state, repeated: false }
  }

  async reconcileStep(
    query: ReleaseEnvironmentQuery,
    step: string,
    lease: ReleaseLease
  ): Promise<{ readonly state: 'confirmed' | 'failed' | 'ambiguous'; readonly repeated: false }> {
    const current = this.repository.getStep(query, step)
    if (!current)
      throw new ReleaseConflictError(
        'release-not-found',
        'Passo não encontrado para reconciliação.'
      )
    if (current.state === 'confirmed' || current.state === 'failed') {
      return { state: current.state, repeated: false }
    }
    if (current.state === 'intended') this.repository.recoverIntended(query, this.now())
    const ambiguous = this.repository.getStep(query, step)
    if (!ambiguous || ambiguous.state !== 'ambiguous') {
      throw new ReleaseConflictError(
        'reconciliation-required',
        'O passo não chegou a um estado reconciliável.'
      )
    }
    const result = await this.port
      .reconcile({
        releaseId: query.releaseId,
        projectId: query.projectId,
        environment: query.environment,
        step,
        idempotencyKey: ambiguous.idempotencyKey,
        payloadHash: ambiguous.payloadHash
      })
      .catch(() => 'unknown' as const)
    if (result === 'unknown') return { state: 'ambiguous', repeated: false }
    const state = result === 'applied' ? 'confirmed' : 'failed'
    this.repository.resolveAmbiguous(query, step, state, lease, this.now())
    return { state, repeated: false }
  }

  queue(query: ReleaseQueueQuery) {
    return this.repository.queue(query)
  }

  detail(query: ReleaseQuery) {
    return this.repository.detail(query)
  }
}
