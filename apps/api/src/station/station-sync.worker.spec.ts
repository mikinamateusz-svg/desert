import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StationSyncWorker, STATION_SYNC_QUEUE, STATION_SYNC_JOB } from './station-sync.worker.js';
import { StationSyncService } from './station-sync.service.js';

// P5: mock ioredis so no real Redis connection is created
const mockRedisQuit = jest.fn().mockResolvedValue('OK');
const mockRedisInstance = { quit: mockRedisQuit };
jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedisInstance));

// Mock BullMQ entirely
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

const mockSyncService = { runSync: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') };

describe('StationSyncWorker', () => {
  let workerService: StationSyncWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedWorkerEvents = {};
    capturedProcessor = undefined;
    capturedWorkerOptions = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationSyncWorker,
        { provide: StationSyncService, useValue: mockSyncService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    workerService = module.get<StationSyncWorker>(StationSyncWorker);
    await workerService.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('retrieves REDIS_URL via getOrThrow', () => {
      expect(mockConfig.getOrThrow).toHaveBeenCalledWith('REDIS_URL');
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
        STATION_SYNC_QUEUE,
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 4,
            backoff: { type: 'custom' },
          }),
        }),
      );
    });

    it('creates Worker with correct queue name', () => {
      const { Worker } = jest.requireMock<{ Worker: jest.Mock }>('bullmq');
      expect(Worker).toHaveBeenCalledWith(
        STATION_SYNC_QUEUE,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('schedules repeat job with correct cron pattern', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STATION_SYNC_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '0 2 * * 0' },
        }),
      );
    });

    it('schedules repeat job with attempts: 4 and custom backoff', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STATION_SYNC_JOB,
        {},
        expect.objectContaining({
          attempts: 4,
          backoff: { type: 'custom' },
        }),
      );
    });

    it('uses stable jobId for idempotent repeat scheduling', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STATION_SYNC_JOB,
        {},
        expect.objectContaining({
          jobId: 'weekly-station-sync',
        }),
      );
    });
  });

  describe('job processor', () => {
    it('calls syncService.runSync when job executes', async () => {
      expect(capturedProcessor).toBeDefined();
      await capturedProcessor!({});
      expect(mockSyncService.runSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('backoffStrategy', () => {
    it('returns 1h delay after 1st failure', () => {
      const settings = capturedWorkerOptions['settings'] as { backoffStrategy: (n: number) => number };
      expect(settings.backoffStrategy(1)).toBe(1 * 60 * 60 * 1000);
    });

    it('returns 6h delay after 2nd failure', () => {
      const settings = capturedWorkerOptions['settings'] as { backoffStrategy: (n: number) => number };
      expect(settings.backoffStrategy(2)).toBe(6 * 60 * 60 * 1000);
    });

    it('returns 24h delay after 3rd failure', () => {
      const settings = capturedWorkerOptions['settings'] as { backoffStrategy: (n: number) => number };
      expect(settings.backoffStrategy(3)).toBe(24 * 60 * 60 * 1000);
    });

    it('returns 24h delay for any attempt beyond 3rd', () => {
      const settings = capturedWorkerOptions['settings'] as { backoffStrategy: (n: number) => number };
      expect(settings.backoffStrategy(4)).toBe(24 * 60 * 60 * 1000);
      expect(settings.backoffStrategy(10)).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('failed event handler', () => {
    it('logs error when all retries are exhausted (attemptsMade >= attempts)', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      capturedWorkerEvents['failed']({ attemptsMade: 4, opts: { attempts: 4 } }, new Error('API down'));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('manual intervention'),
        expect.anything(),
      );
      expect(warnSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('logs warn (not error) on intermediate failure', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      capturedWorkerEvents['failed']({ attemptsMade: 1, opts: { attempts: 4 } }, new Error('timeout'));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('retrying'),
        expect.anything(),
      );
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('handles undefined job gracefully (logs error)', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(() => {
        capturedWorkerEvents['failed'](undefined, new Error('crash'));
      }).not.toThrow();

      errorSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and dedicated Redis connection', async () => {
      await workerService.onModuleDestroy();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
      expect(mockRedisQuit).toHaveBeenCalledTimes(1);
    });
  });
});
