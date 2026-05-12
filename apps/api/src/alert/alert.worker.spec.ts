import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PriceRiseAlertWorker, PRICE_RISE_ALERT_QUEUE, PRICE_RISE_ALERT_JOB } from './alert.worker.js';
import { PriceRiseAlertService } from './alert.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// Hardening-2: worker injects the shared REDIS_CLIENT for the Queue's
// non-blocking side. Stub is minimal because the bullmq mock above
// replaces Queue so the connection is never actually used.
const mockRedisShared = {} as never;

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

// Hardening-2: shared quit mock so tests can assert it was called
// exactly once on destroy (proves the queue-side ioredis was NOT also
// opened and closed alongside it).
const mockRedisQuit = jest.fn().mockResolvedValue(undefined);
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ quit: mockRedisQuit })),
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
        { provide: REDIS_CLIENT, useValue: mockRedisShared },
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
    // Hardening-2: only ONE per-worker blocking ioredis is owned by
    // this class (queue side reuses the shared REDIS_CLIENT, which
    // is RedisModule's responsibility to close). Asserting exactly
    // 1 quit catches a regression that re-introduces redisForQueue.
    mockRedisQuit.mockClear();
    await worker.onModuleDestroy();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockRedisQuit).toHaveBeenCalledTimes(1);
  });

  it('uses queue name ' + PRICE_RISE_ALERT_QUEUE, () => {
    const { Queue } = jest.requireMock('bullmq') as { Queue: jest.Mock };
    expect(Queue).toHaveBeenCalledWith(
      PRICE_RISE_ALERT_QUEUE,
      expect.anything(),
    );
  });
});
