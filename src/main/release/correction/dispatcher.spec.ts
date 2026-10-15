import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReleaseCorrectionDispatcher } from './dispatcher';
import { ReleaseEvidenceWriter } from './evidence-writer';

// Mocks
const mockRepository = {
  acquireLease: vi.fn(),
  enqueue: vi.fn(),
  beginStep: vi.fn(),
  finishStep: vi.fn(),
  getStep: vi.fn(),
  resolveAmbiguous: vi.fn(),
  recoverIntended: vi.fn(),
  assertStepPhase: vi.fn(),
  queue: vi.fn(),
  detail: vi.fn(),
  transition: vi.fn(),
};

const mockOrchestrator = {
  runStep: vi.fn(),
  reconcileStep: vi.fn(),
  enqueue: vi.fn(),
  queue: vi.fn(),
  detail: vi.fn(),
};

const mockEvidenceWriter = {
  writeStepEvidence: vi.fn(),
  writeCompensationEvidence: vi.fn(),
  writeReleaseStabilizationEvidence: vi.fn(),
};

describe('ReleaseCorrectionDispatcher', () => {
  let dispatcher: ReleaseCorrectionDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatcher = new ReleaseCorrectionDispatcher(
      mockRepository as any,
      mockOrchestrator as any,
      mockEvidenceWriter as any
    );
  });

  describe('executeStepWithRetry', () => {
    const query = {
      releaseId: 'release-1',
      projectId: 'project-1',
      environment: 'staging',
    };
    const step = 'deploy-frontend';
    const payloadHash = 'hash123';

    it('should return confirmed when the step succeeds on first attempt', async () => {
      mockOrchestrator.runStep.mockResolvedValue({ state: 'confirmed', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 3);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'apply',
        state: 'confirmed',
      });
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(1);
      expect(mockEvidenceWriter.writeStepEvidence).toHaveBeenCalledWith({
        releaseId: 'release-1',
        step: 'deploy-frontend',
        state: 'confirmed',
        timestamp: expect.any(String),
        details: { repeated: false },
      });
    });

    it('should return failed when the step fails on first attempt and retries are exhausted', async () => {
      mockOrchestrator.runStep.mockResolvedValue({ state: 'failed', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 1);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'compensate',
        state: 'failed',
      });
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(1);
    });

    it('should retry on ambiguous state and then succeed', async () => {
      // First call returns ambiguous, reconcile returns ambiguous -> then we retry (because still ambiguous and retries left)
      // Second call (retry) returns confirmed
      mockOrchestrator.runStep
        .mockResolvedValueOnce({ state: 'ambiguous', repeated: false }) // first runStep
        .mockResolvedValueOnce({ state: 'confirmed', repeated: false }); // second runStep (after retry)
      mockOrchestrator.reconcileStep.mockResolvedValueOnce({ state: 'ambiguous', repeated: false }); // first reconcile

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 3);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'apply',
        state: 'confirmed',
      });
      // runStep called twice (initial attempt and retry)
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(2);
      // reconcile called once (after first runStep)
      expect(mockOrchestrator.reconcileStep).toHaveBeenCalledTimes(1);
      // evidence for first runStep (ambiguous) and first reconcile (ambiguous) and second runStep (confirmed)
      expect(mockEvidenceWriter.writeStepEvidence).toHaveBeenCalledTimes(3);
    });

    it('should return failed after max retries are exhausted', async () => {
      // Both runStep and reconcileStep always return ambiguous
      mockOrchestrator.runStep.mockResolvedValue({ state: 'ambiguous', repeated: false });
      mockOrchestrator.reconcileStep.mockResolvedValue({ state: 'ambiguous', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 2);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'compensate',
        state: 'failed',
      });
      // maxRetries=2 means: initial attempt + 2 retries = 3 total attempts
      // Each attempt includes one runStep and one reconcileStep (since ambiguous)
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(3);
      expect(mockOrchestrator.reconcileStep).toHaveBeenCalledTimes(3);
    });

    it('should handle ReleaseConflictError and retry', async () => {
      const mockError = new Error('ReleaseConflictError');
      // Mock the orchestrator to throw an error on the first call, then succeed
      mockOrchestrator.runStep
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce({ state: 'confirmed', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 3);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'apply',
        state: 'confirmed',
      });
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(2);
    });
  });

  describe('compensate', () => {
    it('should write compensation evidence', async () => {
      const query = {
        releaseId: 'release-1',
        projectId: 'project-1',
        environment: 'staging',
      };
      const failedStep = 'deploy-backend';
      const compensationAction = 'rollback-to-previous';

      await dispatcher.compensate(query, failedStep, compensationAction);

      expect(mockEvidenceWriter.writeCompensationEvidence).toHaveBeenCalledWith({
        releaseId: 'release-1',
        step: failedStep,
        action: compensationAction,
        state: 'compensated',
        timestamp: expect.any(String),
      });
    });
  });
});