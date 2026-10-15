import type {
  ReleaseEnvironmentQuery,
  ReleaseQuery,
  ReleaseQueueQuery
} from '@shared/contracts/release';
import type { ReleaseStatus } from '@shared/domain/release';
import { ReleaseRepository } from './release-repository';

export interface ReleaseEvidence {
  releaseId: string;
  step: string;
  state: 'confirmed' | 'ambiguous' | 'failed' | 'compensated';
  timestamp: string;
  details?: Record<string, unknown>;
}

export class ReleaseEvidenceWriter {
  constructor(
    private readonly repository: ReleaseRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Writes evidence for a step execution or reconciliation.
   * @param evidence The evidence to write.
   */
  async writeStepEvidence(evidence: Omit<ReleaseEvidence, 'releaseId'> & { releaseId: string }): Promise<void> {
    // In a real implementation, we would persist this to a database or a log.
    // For now, we'll just log it to the console and/or store it in the repository if there's a method.
    // Since the spec doesn't specify the exact storage, we'll assume the repository has a method.
    // If not, we can extend the repository or use a separate storage.
    // For the purpose of this task, we'll just log and assume it's stored.
    console.log('[ReleaseEvidence] Step evidence:', {
      ...evidence,
      timestamp: this.now()
    });
    // TODO: Implement actual persistence via repository or a dedicated evidence store.
  }

  /**
   * Writes evidence for a compensation action.
   * @param evidence The compensation evidence to write.
   */
  async writeCompensationEvidence(evidence: Omit<ReleaseEvidence, 'releaseId'> & { releaseId: string }): Promise<void> {
    console.log('[ReleaseEvidence] Compensation evidence:', {
      ...evidence,
      timestamp: this.now()
    });
    // TODO: Implement actual persistence.
  }

  /**
   * Writes evidence for a release manifest, tag, GitHub Release, and changelog.
   * This is called when the release is stabilized in production.
   * @param releaseId The release ID.
   * @param manifest The release manifest.
   * @param tag The Git tag.
   * @param changelog The changelog.
   */
  async writeReleaseStabilizationEvidence(
    releaseId: string,
    manifest: unknown,
    tag: string,
    changelog: string
  ): Promise<void> {
    console.log('[ReleaseEvidence] Release stabilization evidence:', {
      releaseId,
      manifest,
      tag,
      changelog,
      timestamp: this.now()
    });
    // TODO: Implement actual persistence.
  }
}