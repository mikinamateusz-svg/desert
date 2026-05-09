import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrentIngestionService } from './brent-ingestion.service.js';
import { PriceRiseSignalPublisher } from './price-rise-signal.publisher.js';
import {
  OrlenIngestionWorker,
  ORLEN_INGESTION_QUEUE,
  ORLEN_INGESTION_JOB,
} from './orlen-ingestion.worker.js';
import { OrlenIngestionService } from './orlen-ingestion.service.js';

// Mock ioredis — no real Redis connection
const mockRedisQuit = jest.fn().mockResolvedValue('OK');
const mockRedisInstance = { quit: mockRedisQuit };
jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedisInstance));

// Mock BullMQ
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);

let capturedProcessor: ((job: unknown) => Promise<void>) | undefined;
let capturedWorkerOptions: Record<string, unknown> = {};
let capturedWorkerEvents: Record<string, (...args: unknown[]) => void> = {};

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation(
    (_name: string, processor: (job: unknown) => Promise<void>, options: Record<string, unknown>) => {
      capturedProcessor = processor;
      capturedWorkerOptions = options;
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          capturedWorkerEvents[event] = handler;
        },
        close: mockWorkerClose,
      };
    },
  ),
}));

// Story 6.0 — ingest() now returns MovementRecord[] (was void). Default
// to an empty array so existing tests pass without modification.
const mockIngestionService = { ingest: jest.fn().mockResolvedValue([]) };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };
// Story 6.0 — Brent ingestion + rise-signal publisher are injected
// alongside Orlen. Defaults: Brent returns null (no movement to publish),
// publisher reports zero published events. onModuleInit runs against
// these mocks so the existing module-init assertions still hold.
const mockBrentIngestionService = { ingest: jest.fn().mockResolvedValue(null) };
const mockRiseSignalPublisher = {
  maybePublish: jest.fn().mockResolvedValue(0),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
};

describe('OrlenIngestionWorker', () => {
  let workerService: OrlenIngestionWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedWorkerEvents = {};
    capturedProcessor = undefined;
    capturedWorkerOptions = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrlenIngestionWorker,
        { provide: OrlenIngestionService, useValue: mockIngestionService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: BrentIngestionService, useValue: mockBrentIngestionService },
        { provide: PriceRiseSignalPublisher, useValue: mockRiseSignalPublisher },
      ],
    }).compile();

    workerService = module.get<OrlenIngestionWorker>(OrlenIngestionWorker);
    await workerService.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('retrieves REDIS_URL via getOrThrow', () => {
      expect(mockConfig.getOrThrow).toHaveBeenCalledWith('BULL_REDIS_URL');
    });

    it('creates a dedicated Redis connection with maxRetriesPerRequest: null', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = jest.requireMock<jest.Mock>('ioredis');
      expect(Redis).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.objectContaining({ maxRetriesPerRequest: null }),
      );
    });

    it('creates Queue with correct name and defaultJobOptions', () => {
      const { Queue } = jest.requireMock<{ Queue: jest.Mock }>('bullmq');
      expect(Queue).toHaveBeenCalledWith(
        ORLEN_INGESTION_QUEUE,
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 2,
            backoff: { type: 'custom' },
          }),
        }),
      );
    });

    it('creates Worker with correct queue name', () => {
      const { Worker } = jest.requireMock<{ Worker: jest.Mock }>('bullmq');
      expect(Worker).toHaveBeenCalledWith(
        ORLEN_INGESTION_QUEUE,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('schedules morning repeat job at 06:00 Europe/Warsaw', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        ORLEN_INGESTION_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '0 6 * * *', tz: 'Europe/Warsaw' },
          jobId: 'orlen-morning',
        }),
      );
    });

    it('schedules afternoon repeat job at 14:00 Europe/Warsaw', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        ORLEN_INGESTION_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '0 14 * * *', tz: 'Europe/Warsaw' },
          jobId: 'orlen-afternoon',
        }),
      );
    });

    it('schedules jobs with attempts: 2 and custom backoff', () => {
      for (const call of mockQueueAdd.mock.calls) {
        expect(call[2]).toEqual(
          expect.objectContaining({
            attempts: 2,
            backoff: { type: 'custom' },
          }),
        );
      }
    });

    it('registers both morning and afternoon jobs (2 queue.add calls)', () => {
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    });
  });

  describe('job processor', () => {
    it('calls ingestionService.ingest when job executes', async () => {
      expect(capturedProcessor).toBeDefined();
      await capturedProcessor!({});
      expect(mockIngestionService.ingest).toHaveBeenCalledTimes(1);
    });

    // ── Story 6.0 — Brent integration ────────────────────────────────────

    it('publishes ORLEN movements to the rise-signal queue after ingest', async () => {
      mockIngestionService.ingest.mockResolvedValueOnce([
        { signalType: 'orlen_rack_pb95', pctChange: 0.04, significantMovement: true, recordedAt: new Date() },
      ]);

      await capturedProcessor!({});

      expect(mockRiseSignalPublisher.maybePublish).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ signalType: 'orlen_rack_pb95' }),
        ]),
      );
    });

    it('AC3 — Brent ingestion failure does NOT fail the job; ORLEN still publishes', async () => {
      mockIngestionService.ingest.mockResolvedValueOnce([
        { signalType: 'orlen_rack_pb95', pctChange: 0.04, significantMovement: true, recordedAt: new Date() },
      ]);
      mockBrentIngestionService.ingest.mockRejectedValueOnce(new Error('Alpha Vantage 503'));

      // Job should resolve successfully despite Brent throwing
      await expect(capturedProcessor!({})).resolves.toBeUndefined();

      // Publisher receives ORLEN movements only (no brent record appended)
      const call = mockRiseSignalPublisher.maybePublish.mock.calls[0][0];
      expect(call).toHaveLength(1);
      expect(call[0].signalType).toBe('orlen_rack_pb95');
    });

    it('appends Brent movement to the publisher batch when Brent returns a record', async () => {
      mockIngestionService.ingest.mockResolvedValueOnce([
        { signalType: 'orlen_rack_pb95', pctChange: 0.01, significantMovement: false, recordedAt: new Date() },
      ]);
      mockBrentIngestionService.ingest.mockResolvedValueOnce({
        signalType: 'brent_crude_pln',
        pctChange: 0.05,
        significantMovement: true,
        recordedAt: new Date(),
      });

      await capturedProcessor!({});

      const call = mockRiseSignalPublisher.maybePublish.mock.calls[0][0];
      expect(call).toHaveLength(2);
      expect(call.map((m: { signalType: string }) => m.signalType)).toEqual([
        'orlen_rack_pb95',
        'brent_crude_pln',
      ]);
    });
  });

  describe('backoffStrategy', () => {
    it('always returns 30 minutes regardless of attempt number', () => {
      const settings = capturedWorkerOptions['settings'] as { backoffStrategy: (n: number) => number };
      const thirtyMin = 30 * 60 * 1000;
      expect(settings.backoffStrategy(1)).toBe(thirtyMin);
      expect(settings.backoffStrategy(2)).toBe(thirtyMin);
      expect(settings.backoffStrategy(5)).toBe(thirtyMin);
    });
  });

  describe('failed event handler', () => {
    it('logs error (ops alert) when all retries exhausted', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      capturedWorkerEvents['failed']({ attemptsMade: 2, opts: { attempts: 2 } }, new Error('503'));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ops alert'),
        expect.anything(),
      );
      expect(warnSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('logs warn (not error) on intermediate failure before retry', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      capturedWorkerEvents['failed']({ attemptsMade: 1, opts: { attempts: 2 } }, new Error('timeout'));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('30 min'),
      );
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('handles undefined job gracefully', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(() => {
        capturedWorkerEvents['failed'](undefined, new Error('crash'));
      }).not.toThrow();

      errorSpy.mockRestore();
    });
  });

  describe('getQueue', () => {
    it('returns the queue instance', () => {
      const queue = workerService.getQueue();
      expect(queue).toBeDefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and Redis connection', async () => {
      await workerService.onModuleDestroy();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
      expect(mockRedisQuit).toHaveBeenCalledTimes(2);
    });
  });
});
