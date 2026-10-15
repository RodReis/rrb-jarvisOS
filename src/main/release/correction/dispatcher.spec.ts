import { ReleaseCorrectionDispatcher } from './dispatcher';
import { ReleaseEvidenceWriter } from './evidence-writer';

// Mocks
const mockRepository = {
  acquireLease: jest.fn(),
  enqueue: jest.fn(),
  beginStep: jest.fn(),
  finishStep: jest.fn(),
  getStep: jest.fn(),
  resolveAmbiguous: jest.fn(),
  recoverIntended: jest.fn(),
  assertStepPhase: jest.fn(),
  queue: jest.fn(),
  detail: jest.fn(),
  transition: jest.fn(),
};

const mockOrchestrator = {
  runStep: jest.fn(),
  reconcileStep: jest.fn(),
  enqueue: jest.fn(),
  queue: jest.fn(),
  detail: jest.fn(),
};

const mockEvidenceWriter = {
  writeStepEvidence: jest.fn(),
  writeCompensationEvidence: jest.fn(),
  writeReleaseStabilizationEvidence: jest.fn(),
};

describe('ReleaseCorrectionDispatcher', () => {
  let dispatcher: ReleaseCorrectionDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
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
      // First call returns ambiguous, second call returns confirmed
      mockOrchestrator.runStep
        .mockResolvedValueOnce({ state: 'ambiguous', repeated: false }) // First attempt
        .mockResolvedValueOnce({ state: 'confirmed', repeated: false }); // Second attempt (after retry)

      mockOrchestrator.reconcileStep.mockResolvedValue({ state: 'confirmed', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 3);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'apply',
        state: 'confirmed',
      });
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(2);
      expect(mockOrchestrator.reconcileStep).toHaveBeenCalledTimes(1);
    });

    it('should return failed after max retries are exhausted', async () => {
      mockOrchestrator.runStep.mockResolvedValue({ state: 'ambiguous', repeated: false });
      mockOrchestrator.reconcileStep.mockResolvedValue({ state: 'ambiguous', repeated: false });

      const result = await dispatcher.executeStepWithRetry(query, step, payloadHash, 2);

      expect(result).toEqual({
        releaseId: 'release-1',
        failedStep: 'deploy-frontend',
        action: 'compensate',
        state: 'failed',
      });
      // Initial attempt + 2 retries = 3 calls to runStep
      expect(mockOrchestrator.runStep).toHaveBeenCalledTimes(3);
      // Each runStep that returns ambiguous leads to a reconcileStep call
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
        step: 'deploy-backend',
        action: 'rollback-to-previous',
        state: 'compensated',
        timestamp: expect.any(String),
      });
    });
  });
});