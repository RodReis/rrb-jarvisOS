import type {
  GateResult,
  PreviewRun,
  ReleaseEnvironment,
  ReleaseRun,
  ReleaseStepRecord
} from '@shared/domain/release'
import type { WorkspaceId } from '@shared/domain/entities'

export interface ReleaseQueueQuery {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

export interface ReleaseQuery extends ReleaseQueueQuery {
  readonly releaseId: string
}

export interface ReleaseEnvironmentQuery extends ReleaseQuery {
  readonly environment: ReleaseEnvironment
}

export interface ReleaseTimelineItem {
  readonly id: string
  readonly releaseId: string
  readonly environment: ReleaseEnvironment | null
  readonly kind: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly reason: string | null
  readonly createdAt: string
}

export interface ReleaseQueueView {
  readonly candidate: ReleaseRun | null
  readonly activeEnvironments: Readonly<Record<ReleaseEnvironment, string | null>>
  readonly pendingReconciliation: readonly ReleaseStepRecord[]
  readonly minimalAction: 'none' | 'resume' | 'reconcile' | 'resolve-blocker'
}

export interface ReleaseDetailView {
  readonly release: ReleaseRun
  readonly steps: readonly ReleaseStepRecord[]
  readonly gates: readonly GateResult[]
  readonly timeline: readonly ReleaseTimelineItem[]
  readonly minimalAction: ReleaseQueueView['minimalAction']
}

export interface PreviewQuery extends ReleaseQueueQuery {
  readonly pullRequest: number
}

export interface PreviewView {
  readonly previews: readonly PreviewRun[]
}
