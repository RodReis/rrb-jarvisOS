import type { ReleaseEnvironment } from '@shared/domain/release'

/**
 * Tipos da persistência da recuperação e da identidade de release (SPEC-Release-05). Só forma de
 * dados — o repositório (`release-recovery-repository.ts`) é quem valida e grava.
 */

export type EvidenceKind =
  | 'step'
  | 'retry'
  | 'retries-exhausted'
  | 'compensation'
  | 'stabilization'
  | 'cancellation'
  | 'rollback'
  | 'correction'
  | 'publication'
  | 'recovery'
export type EvidenceState =
  'confirmed' | 'ambiguous' | 'failed' | 'compensated' | 'pending' | 'recorded'
export type EvidenceDetails = Readonly<Record<string, string | number | boolean>>

export interface EvidenceInput {
  readonly kind: EvidenceKind
  readonly state: EvidenceState
  readonly environment?: ReleaseEnvironment
  readonly step?: string
  /** Código curto (`backend_healthy-timeout`), nunca a mensagem do provedor. */
  readonly reason?: string
  /** Ação mínima como código (`check-provider-status`). */
  readonly action?: string
  readonly details?: EvidenceDetails
}

export interface ReleaseEvidence extends EvidenceInput {
  readonly id: string
  readonly releaseId: string
  readonly createdAt: string
}

export interface InclusionInput {
  readonly sha: string
  readonly pullRequest?: number
  readonly specId?: string
  /** Fatia da V2 que originou o trabalho; é por ela que a correção volta à V2. */
  readonly sliceId?: string
  readonly issue?: number
}

export interface ReleaseInclusion extends InclusionInput {
  readonly releaseId: string
  readonly createdAt: string
}

export interface ProjectPause {
  readonly id: string
  readonly releaseId: string
  readonly reason: string
  readonly createdAt: string
}

export type CancellationPhase = 'queued' | 'preparing' | 'staging' | 'production' | 'stabilizing'
export type CancellationState = 'requested' | 'done' | 'blocked'

export interface ReleaseCancellation {
  readonly id: string
  readonly releaseId: string
  readonly phase: CancellationPhase
  readonly state: CancellationState
  readonly reason: string | null
  readonly requestedAt: string
  readonly updatedAt: string
}

export interface ManifestInput {
  readonly tag: string
  readonly manifestJson: string
  readonly manifestSha256: string
  readonly changelog: string
}

export interface ReleaseManifest extends ManifestInput {
  readonly releaseId: string
  readonly createdAt: string
}

export type PublicationTarget = 'github-release'
export type PublicationState = 'pending' | 'published' | 'failed'

export interface ReleasePublication {
  readonly releaseId: string
  readonly target: PublicationTarget
  readonly state: PublicationState
  readonly reason: string | null
  readonly externalRef: string | null
  readonly attempts: number
  readonly updatedAt: string
}

export type CorrectionClass = 'health_or_test' | 'migration' | 'artifact'
export type CorrectionState = 'pending' | 'opened' | 'unavailable'

export interface CorrectionInput {
  readonly failureClass: CorrectionClass
  readonly environment: ReleaseEnvironment
  readonly step?: string
  readonly reason: string
  readonly dispatchKey: string
  readonly contextJson: string
  readonly contextSha256: string
}

export interface ReleaseCorrection extends CorrectionInput {
  readonly id: string
  readonly releaseId: string
  readonly state: CorrectionState
  readonly runId: string | null
  readonly stateReason: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type RollbackState = 'intended' | 'confirmed' | 'failed'

export interface ReleaseRollback {
  readonly id: string
  readonly fromReleaseId: string
  readonly toReleaseId: string
  readonly state: RollbackState
  readonly createdAt: string
  readonly updatedAt: string
}
