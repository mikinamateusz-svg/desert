import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StalenessDetectionWorker,
  STALENESS_DETECTION_QUEUE,
  STALENESS_DETECTION_JOB,
} from './staleness-detection.worker.js';
import { StalenessDetectionService } from './staleness-detection.service.js';

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

const mockDetectionService = {
  detectStaleness: jest.fn().mockResolvedValue(undefined),
};
const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
};

describe('StalenessDetectionWorker', () => {
  let workerService: StalenessDetectionWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedWorkerEvents = {};
    capturedProcessor = undefined;
    capturedWorkerOptions = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StalenessDetectionWorker,
        { provide: StalenessDetectionService, useValue: mockDetectionService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    workerService = module.get<StalenessDetectionWorker>(StalenessDetectionWorker);
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

    it('creates Queue with correct name', () => {
      const { Queue } = jest.requireMock<{ Queue: jest.Mock }>('bullmq');
      expect(Queue).toHaveBeenCalledWith(
        STALENESS_DETECTION_QUEUE,
        expect.any(Object),
      );
    });

    it('creates Worker with correct queue name', () => {
      const { Worker } = jest.requireMock<{ Worker: jest.Mock }>('bullmq');
      expect(Worker).toHaveBeenCalledWith(
        STALENESS_DETECTION_QUEUE,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('schedules morning repeat job at 06:15 Europe/Warsaw', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STALENESS_DETECTION_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '15 6 * * *', tz: 'Europe/Warsaw' },
          jobId: 'staleness-morning',
        }),
      );
    });

    it('schedules afternoon repeat job at 14:15 Europe/Warsaw', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STALENESS_DETECTION_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '15 14 * * *', tz: 'Europe/Warsaw' },
          jobId: 'staleness-afternoon',
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
    it('calls detectionService.detectStaleness when job executes', async () => {
      expect(capturedProcessor).toBeDefined();
      await capturedProcessor!({});
      expect(mockDetectionService.detectStaleness).toHaveBeenCalledTimes(1);
    });
  });

  describe('backoffStrategy', () => {
    it('always returns 5 minutes regardless of attempt number (AC6)', () => {
      const settings = capturedWorkerOptions['settings'] as {
        backoffStrategy: (n: number) => number;
      };
      const fiveMin = 5 * 60 * 1000;
      expect(settings.backoffStrategy(1)).toBe(fiveMin);
      expect(settings.backoffStrategy(2)).toBe(fiveMin);
      expect(settings.backoffStrategy(5)).toBe(fiveMin);
    });
  });

  describe('failed event handler (AC6)', () => {
    it('logs error (ops alert) when all retries exhausted', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      capturedWorkerEvents['failed']({ attemptsMade: 2, opts: { attempts: 2 } }, new Error('DB timeout'));

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
        expect.stringContaining('5 min'),
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
      expect(mockRedisQuit).toHaveBeenCalledTimes(1);
    });
  });
});
