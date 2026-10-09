import type { WorkspaceId } from './entities'

export const RELEASE_STATUSES = [
  'queued',
  'preparing',
  'staging',
  'production',
  'stabilizing',
  'completed',
  'superseded',
  'failed',
  'degraded'
] as const

export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]
export type ReleaseEnvironment = 'staging' | 'production'
export type ReleaseStepState = 'intended' | 'confirmed' | 'ambiguous' | 'failed'

export interface ReleaseScope {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

export interface PreviewRun extends ReleaseScope {
  readonly id: string
  readonly pullRequest: number
  readonly headSha: string
  readonly status: 'queued' | 'preparing' | 'ready' | 'failed' | 'removed'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ReleaseRun extends ReleaseScope {
  readonly id: string
  readonly sha: string
  readonly status: ReleaseStatus
  readonly stageStartedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ReleaseStepRecord {
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly step: string
  readonly idempotencyKey: string
  readonly payloadHash: string
  readonly state: ReleaseStepState
  readonly attempt: number
  readonly updatedAt: string
}

export interface Artifact extends ReleaseScope {
  readonly id: string
  readonly releaseId: string
  readonly kind: 'backend-image' | 'frontend-bundle' | 'migration-bundle'
  readonly digest: string
  readonly createdAt: string
}

export interface Deployment extends ReleaseScope {
  readonly id: string
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly artifactDigest: string
  readonly externalId: string
  readonly createdAt: string
}

export interface MigrationExecution extends ReleaseScope {
  readonly id: string
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly migrationId: string
  readonly checksum: string
  readonly state: 'intended' | 'confirmed' | 'ambiguous' | 'failed'
  readonly createdAt: string
}

export interface GateResult extends ReleaseScope {
  readonly id: string
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly gate: string
  readonly result: 'passed' | 'blocked' | 'unknown'
  readonly reason: string | null
  readonly createdAt: string
}

export interface ConfigurationReference extends ReleaseScope {
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly name: string
  readonly version: string
}

export interface CompensationExecution extends ReleaseScope {
  readonly id: string
  readonly releaseId: string
  readonly environment: ReleaseEnvironment
  readonly action: string
  readonly state: 'intended' | 'confirmed' | 'ambiguous' | 'failed'
  readonly createdAt: string
}

export type ReleaseTransition =
  | { readonly ok: true; readonly status: ReleaseStatus; readonly stageStartedAt: string | null }
  | { readonly ok: false; readonly reason: 'invalid-transition' | 'staging-freezes-candidate' }

const TRANSITIONS: Readonly<Record<ReleaseStatus, readonly ReleaseStatus[]>> = {
  queued: ['preparing', 'superseded', 'failed'],
  preparing: ['staging', 'superseded', 'failed', 'degraded'],
  staging: ['production', 'failed', 'degraded'],
  production: ['stabilizing', 'failed', 'degraded'],
  stabilizing: ['completed', 'failed', 'degraded'],
  completed: [],
  superseded: [],
  failed: [],
  degraded: []
}

export function transicionarRelease(
  atual: ReleaseStatus,
  proximo: ReleaseStatus,
  stageStartedAt: string | null,
  agora: string
): ReleaseTransition {
  if (stageStartedAt && proximo === 'superseded') {
    return { ok: false, reason: 'staging-freezes-candidate' }
  }
  if (!TRANSITIONS[atual].includes(proximo)) return { ok: false, reason: 'invalid-transition' }
  return {
    ok: true,
    status: proximo,
    stageStartedAt: proximo === 'staging' ? (stageStartedAt ?? agora) : stageStartedAt
  }
}

export function chaveIdempotenciaRelease(
  projectId: string,
  environment: ReleaseEnvironment,
  releaseId: string,
  step: string
): string {
  return `${projectId}:${environment}:${releaseId}:${step}`
}

export function validarFingerprintPayload(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}
