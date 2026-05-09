import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PriceRiseAlertWorker, PRICE_RISE_ALERT_QUEUE, PRICE_RISE_ALERT_JOB } from './alert.worker.js';
import { PriceRiseAlertService } from './alert.service.js';

// ── Mock BullMQ and ioredis ───────────────────────────────────────────────────

const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerOn = jest.fn();
let capturedProcessor: ((job: unknown) => Promise<void>) | undefined;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation((_queue: string, processor: (job: unknown) => Promise<void>) => {
    capturedProcessor = processor;
    return {
      close: mockWorkerClose,
      on: mockWorkerOn,
    };
  }),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue(undefined),
  })),
);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSendRiseAlerts = jest.fn();

const mockAlertService = { sendRiseAlerts: mockSendRiseAlerts };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PriceRiseAlertWorker', () => {
  let worker: PriceRiseAlertWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceRiseAlertWorker,
        { provide: PriceRiseAlertService, useValue: mockAlertService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    worker = module.get(PriceRiseAlertWorker);
    await worker.onModuleInit();
  });

  afterEach(async () => {
    await worker.onModuleDestroy();
  });

  // Story 6.3 — Phase 1 cron schedule REMOVED. The polling-based
  // PriceRiseAlertWorker is replaced by Story 6.3's
  // PredictiveRiseAlertWorker which consumes Story 6.0's
  // price-rise-signals queue. The PriceRiseAlertService class +
  // queue/worker bindings remain for ops tooling and the leftover
  // repeat-jobs in Redis from prior deploys (which need manual
  // queue.removeRepeatable() cleanup).
  it('does NOT register the morning / afternoon Phase 1 cron schedule (Story 6.3 deprecation)', () => {
    expect(mockQueueAdd).not.toHaveBeenCalledWith(
      PRICE_RISE_ALERT_JOB,
      {},
      expect.objectContaining({ jobId: 'price-rise-alert-morning' }),
    );
    expect(mockQueueAdd).not.toHaveBeenCalledWith(
      PRICE_RISE_ALERT_JOB,
      {},
      expect.objectContaining({ jobId: 'price-rise-alert-afternoon' }),
    );
  });

  it('calls alertService.sendRiseAlerts when job runs', async () => {
    mockSendRiseAlerts.mockResolvedValue(undefined);
    expect(capturedProcessor).toBeDefined();
    await capturedProcessor!({}); // simulate BullMQ firing the job
    expect(mockSendRiseAlerts).toHaveBeenCalledTimes(1);
  });

  it('exposes getQueue() for ops use', () => {
    expect(worker.getQueue()).toBeDefined();
  });

  it('closes worker, queue, and Redis on destroy', async () => {
    await worker.onModuleDestroy();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
  });

  it('uses queue name ' + PRICE_RISE_ALERT_QUEUE, () => {
    const { Queue } = jest.requireMock('bullmq') as { Queue: jest.Mock };
    expect(Queue).toHaveBeenCalledWith(
      PRICE_RISE_ALERT_QUEUE,
      expect.anything(),
    );
  });
});
