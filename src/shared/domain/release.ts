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
  failed: ['preparing', 'degraded'],
  degraded: ['preparing', 'failed']
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

export function validarPayloadSemSegredos(value: unknown): boolean {
  return serializarPayloadSeguro(value) !== null
}

export function serializarPayloadSeguro(value: unknown): string | null {
  const forbidden = new Set([
    'auth',
    'authorization',
    'secret',
    'token',
    'password',
    'credential',
    'privatekey',
    'apikey',
    'accesskey',
    'clientsecret',
    'refreshtoken',
    'providerkey',
    'signingkey',
    'encryptionkey'
  ])
  const visit = (item: unknown): string | null => {
    if (item === null) return 'null'
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number') return Number.isFinite(item) ? JSON.stringify(item) : null
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) return null
      const entries = Array.from(item, visit)
      return entries.every((entry) => entry !== null) ? `[${entries.join(',')}]` : null
    }
    if (
      typeof item !== 'object' ||
      (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
    ) {
      return null
    }
    const keys = Reflect.ownKeys(item)
    if (keys.some((key) => typeof key !== 'string')) return null
    const sorted = (keys as string[]).sort()
    const serialized: string[] = []
    for (const key of sorted) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (
        forbidden.has(normalized) ||
        /(secret|token|password|credential|privatekey|apikey|accesskey)$/.test(normalized)
      ) {
        return null
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return null
      const child = visit(descriptor.value)
      if (child === null) return null
      serialized.push(`${JSON.stringify(key)}:${child}`)
    }
    return `{${serialized.join(',')}}`
  }

  return visit(value)
}
