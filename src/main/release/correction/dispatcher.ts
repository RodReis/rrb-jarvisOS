import type {
  ReleaseEnvironmentQuery,
  ReleaseQuery,
  ReleaseQueueQuery
} from '@shared/contracts/release';
import type { ReleaseStatus } from '@shared/domain/release';
import { ReleaseConflictError, ReleaseRepository } from '../release-repository';
import { ReleaseOrchestrator } from './release-orchestrator';
import { ReleaseEvidenceWriter } from './evidence-writer';

export interface CompensationResult {
  releaseId: string;
  failedStep: string;
  action: string;
  state: 'confirmed' | 'ambiguous' | 'failed';
  externalRef?: string;
}

export class ReleaseCorrectionDispatcher {
  constructor(
    private readonly repository: ReleaseRepository,
    private readonly orchestrator: ReleaseOrchestrator,
    private readonly evidenceWriter: ReleaseEvidenceWriter,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Attempts to execute a release step with retry logic and compensation.
   * @param query The release query.
   * @param step The step to execute.
   * @param payloadHash The hash of the payload for the step.
   * @param maxRetries Maximum number of retries (default: 3).
   * @returns A promise that resolves to the outcome of the step.
   */
  async executeStepWithRetry(
    query: ReleaseEnvironmentQuery,
    step: string,
    payloadHash: string,
    maxRetries: number = 3
  ): Promise<CompensationResult> {
    let retries = 0;
    let lastError: unknown = null;

    while (retries <= maxRetries) {
      try {
        // Acquire a lease for the step
        const lease = this.repository.acquireLease(query, 'correction-dispatcher', 5000, this.now());
        const outcome = await this.orchestrator.runStep(query, step, payloadHash, lease);

        // If the step is confirmed or failed, we can return the result
        if (outcome.state === 'confirmed' || outcome.state === 'failed') {
          // Write evidence for the outcome
          await this.evidenceWriter.writeStepEvidence({
            releaseId: query.releaseId,
            step,
            state: outcome.state,
            timestamp: this.now(),
            details: { repeated: outcome.repeated }
          });

          return {
            releaseId: query.releaseId,
            failedStep: step,
            action: outcome.state === 'confirmed' ? 'apply' : 'compensate',
            state: outcome.state
          };
        }

        // If the state is ambiguous, we need to reconcile before retrying
        if (outcome.state === 'ambiguous') {
          // Reconcile the step
          const reconciliation = await this.orchestrator.reconcileStep(query, step, lease);
          // Write evidence for the reconciliation
          await this.evidenceWriter.writeStepEvidence({
            releaseId: query.releaseId,
            step,
            state: reconciliation.state,
            timestamp: this.now(),
            details: { repeated: reconciliation.repeated, reconciled: true }
          });

          if (reconciliation.state === 'confirmed' || reconciliation.state === 'failed') {
            return {
              releaseId: query.releaseId,
              failedStep: step,
              action: reconciliation.state === 'confirmed' ? 'apply' : 'compensate',
              state: reconciliation.state
            };
          }
          // If still ambiguous, we may retry (if retries left)
        }

        // If we get here, the step is still in progress or we need to retry
        retries++;
        if (retries <= maxRetries) {
          // Wait for a backoff period (simplified: fixed delay)
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      } catch (error) {
        lastError = error;
        // If it's a conflict error that requires reconciliation, we handle it above.
        // For other errors, we increment retry and try again.
        if (error instanceof ReleaseConflictError && error.code === 'reconciliation-required') {
          // This case is handled in the runStep method, but we catch it here for safety.
          // We'll treat it as ambiguous and retry.
          retries++;
          if (retries <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          }
          continue;
        }
        // For other errors, we retry if we have retries left.
        retries++;
        if (retries <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
    }

    // If we've exhausted retries, we return a failed state with the last error.
    return {
      releaseId: query.releaseId,
      failedStep: step,
      action: 'compensate',
      state: 'failed',
      externalRef: String(lastError)
    };
  }

  /**
   * Handles compensation for a failed step.
   * @param query The release query.
   * @param failedStep The step that failed.
   * @param compensationAction The action to take for compensation.
   */
  async compensate(
    query: ReleaseEnvironmentQuery,
    failedStep: string,
    compensationAction: string
  ): Promise<void> {
    // Implement compensation logic based on the step and action.
    // This is a placeholder; the actual compensation would depend on the step.
    // For example, if the step was deploying a frontend, we might revert to a previous version.
    // We'll write evidence for the compensation.
    await this.evidenceWriter.writeCompensationEvidence({
      releaseId: query.releaseId,
      failedStep,
      action: compensationAction,
      state: 'compensated',
      timestamp: this.now()
    });
  }
}