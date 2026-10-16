import type {
  CancellationPhase,
  CancellationState,
  CorrectionClass,
  CorrectionState,
  EvidenceDetails,
  EvidenceKind,
  EvidenceState,
  PublicationState,
  PublicationTarget,
  ReleaseCancellation,
  ReleaseCorrection,
  ReleaseEvidence,
  ReleasePublication,
  ReleaseRollback,
  RollbackState
} from './release-recovery-types'
import type { ReleaseEnvironment } from '@shared/domain/release'

/** Linhas do SQLite da recuperação e seus mapeamentos para os tipos do domínio. */

export interface EvidenceRow {
  id: string
  release_id: string
  environment: ReleaseEnvironment | null
  kind: EvidenceKind
  step: string | null
  state: EvidenceState
  reason: string | null
  action: string | null
  details: string | null
  created_at: string
}

export interface CancellationRow {
  id: string
  release_id: string
  phase: CancellationPhase
  state: CancellationState
  reason: string | null
  requested_at: string
  updated_at: string
}

export interface CorrectionRow {
  id: string
  release_id: string
  failure_class: CorrectionClass
  environment: ReleaseEnvironment
  step: string | null
  reason: string
  state: CorrectionState
  run_id: string | null
  state_reason: string | null
  dispatch_key: string
  context_json: string
  context_sha256: string
  created_at: string
  updated_at: string
}

export interface PublicationRow {
  release_id: string
  target: PublicationTarget
  state: PublicationState
  reason: string | null
  external_ref: string | null
  attempts: number
  updated_at: string
}

export interface RollbackRow {
  id: string
  from_release_id: string
  to_release_id: string
  state: RollbackState
  created_at: string
  updated_at: string
}

export const toEvidence = (row: EvidenceRow): ReleaseEvidence => ({
  id: row.id,
  releaseId: row.release_id,
  kind: row.kind,
  state: row.state,
  createdAt: row.created_at,
  ...(row.environment ? { environment: row.environment } : {}),
  ...(row.step ? { step: row.step } : {}),
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.action ? { action: row.action } : {}),
  ...(row.details ? { details: JSON.parse(row.details) as EvidenceDetails } : {})
})

export const toCancellation = (row: CancellationRow): ReleaseCancellation => ({
  id: row.id,
  releaseId: row.release_id,
  phase: row.phase,
  state: row.state,
  reason: row.reason,
  requestedAt: row.requested_at,
  updatedAt: row.updated_at
})

export const toCorrection = (row: CorrectionRow): ReleaseCorrection => ({
  id: row.id,
  releaseId: row.release_id,
  failureClass: row.failure_class,
  environment: row.environment,
  reason: row.reason,
  state: row.state,
  runId: row.run_id,
  stateReason: row.state_reason,
  dispatchKey: row.dispatch_key,
  contextJson: row.context_json,
  contextSha256: row.context_sha256,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.step ? { step: row.step } : {})
})

export const toPublication = (row: PublicationRow): ReleasePublication => ({
  releaseId: row.release_id,
  target: row.target,
  state: row.state,
  reason: row.reason,
  externalRef: row.external_ref,
  attempts: row.attempts,
  updatedAt: row.updated_at
})

export const toRollback = (row: RollbackRow): ReleaseRollback => ({
  id: row.id,
  fromReleaseId: row.from_release_id,
  toReleaseId: row.to_release_id,
  state: row.state,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})
