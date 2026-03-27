import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StationClassificationWorker,
  STATION_CLASSIFICATION_QUEUE,
} from './station-classification.worker.js';
import { StationClassificationService } from './station-classification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── BullMQ mock ─────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
let capturedProcessor: ((job: unknown) => Promise<void>) | undefined;
let capturedWorkerEvents: Record<string, (...args: unknown[]) => void> = {};

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation(
    (_name: string, processor: (job: unknown) => Promise<void>) => {
      capturedProcessor = processor;
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          capturedWorkerEvents[event] = handler;
        },
        close: mockWorkerClose,
      };
    },
  ),
}));

// ─── Redis mock ───────────────────────────────────────────────────────────────

const mockRedisQuit = jest.fn().mockResolvedValue(undefined);
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ quit: mockRedisQuit })),
);

// ─── Service / prisma mocks ───────────────────────────────────────────────────

const mockClassify = jest.fn();
const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

const mockClassificationService = {
  classifyStation: mockClassify,
};
const mockPrisma = {
  $queryRaw: mockQueryRaw,
  $executeRaw: mockExecuteRaw,
};
const mockConfig = {
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    if (key === 'BULL_REDIS_URL') return 'redis://localhost:6379';
    if (key === 'GOOGLE_PLACES_API_KEY') return 'test-api-key';
    throw new Error(`Unexpected config key: ${key}`);
  }),
};

const fakeClassification = {
  brand: 'orlen',
  station_type: 'standard',
  voivodeship: 'mazowieckie',
  settlement_tier: 'metropolitan',
  is_border_zone_de: false,
};

const fakeStation = { id: 's1', name: 'Orlen', lat: 52.23, lng: 21.01 };

describe('StationClassificationWorker', () => {
  let workerInstance: StationClassificationWorker;
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedWorkerEvents = {};
    capturedProcessor = undefined;

    // Make all setTimeout delays instant so rate-limiting delay doesn't slow tests
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
      if (typeof fn === 'function') (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationClassificationWorker,
        { provide: StationClassificationService, useValue: mockClassificationService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    workerInstance = module.get<StationClassificationWorker>(StationClassificationWorker);
    await workerInstance.onModuleInit();
  });

  afterEach(() => {
    setTimeoutSpy?.mockRestore();
  });

  // ─── Initialisation ──────────────────────────────────────────────────────

  it('creates Queue with correct name', () => {
    const { Queue } = jest.requireMock<{ Queue: jest.Mock }>('bullmq');
    expect(Queue).toHaveBeenCalledWith(
      STATION_CLASSIFICATION_QUEUE,
      expect.objectContaining({ defaultJobOptions: expect.any(Object) }),
    );
  });

  it('creates Worker with correct queue name', () => {
    const { Worker } = jest.requireMock<{ Worker: jest.Mock }>('bullmq');
    expect(Worker).toHaveBeenCalledWith(
      STATION_CLASSIFICATION_QUEUE,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('getQueue returns the queue instance', () => {
    const queue = workerInstance.getQueue();
    expect(queue).toBeDefined();
    expect(queue.add).toBe(mockQueueAdd);
  });

  it('closes worker, queue and redis on destroy', async () => {
    await workerInstance.onModuleDestroy();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockRedisQuit).toHaveBeenCalledTimes(1);
  });

  it('logs error on job failure', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    capturedWorkerEvents['failed']?.(undefined, new Error('boom'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Station classification job failed',
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  // ─── processClassification ───────────────────────────────────────────────

  describe('processClassification', () => {
    it('classifies all stations returned in first batch then stops when empty', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([fakeStation])
        .mockResolvedValueOnce([]); // second batch empty → exit loop
      mockClassify.mockResolvedValue(fakeClassification);
      mockExecuteRaw.mockResolvedValue(1);

      await workerInstance.processClassification();

      expect(mockClassify).toHaveBeenCalledTimes(1);
      expect(mockClassify).toHaveBeenCalledWith(fakeStation, 'test-api-key');
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('processes multiple batches', async () => {
      const batch = Array.from({ length: 50 }, (_, i) => ({
        ...fakeStation,
        id: `s${i}`,
      }));
      mockQueryRaw
        .mockResolvedValueOnce(batch)       // first batch — 50 stations
        .mockResolvedValueOnce([fakeStation]) // second batch — 1 station
        .mockResolvedValueOnce([]);            // third batch — empty → stop
      mockClassify.mockResolvedValue(fakeClassification);
      mockExecuteRaw.mockResolvedValue(1);

      await workerInstance.processClassification();

      expect(mockClassify).toHaveBeenCalledTimes(51);
    });

    it('continues processing remaining stations when one classification fails', async () => {
      const stations = [
        { id: 's1', name: 'Orlen', lat: 52.23, lng: 21.01 },
        { id: 's2', name: 'BP', lat: 52.24, lng: 21.02 },
      ];
      mockQueryRaw.mockResolvedValueOnce(stations).mockResolvedValueOnce([]);
      mockClassify
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(fakeClassification);
      mockExecuteRaw.mockResolvedValue(1);

      await workerInstance.processClassification();

      // Despite s1 failing, s2 was still classified
      expect(mockClassify).toHaveBeenCalledTimes(2);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no unclassified stations exist', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await workerInstance.processClassification();

      expect(mockClassify).not.toHaveBeenCalled();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('increments classification_version (not hardcoded to 1)', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([fakeStation])
        .mockResolvedValueOnce([]);
      mockClassify.mockResolvedValue(fakeClassification);
      mockExecuteRaw.mockResolvedValue(1);

      await workerInstance.processClassification();

      const sqlCall = mockExecuteRaw.mock.calls[0];
      // The tagged template strings array is the first argument; check it contains
      // the increment expression rather than a hardcoded literal
      const sqlStrings: string[] = sqlCall[0];
      const fullSql = sqlStrings.join('?');
      expect(fullSql).toContain('classification_version + 1');
    });

    it('re-queries from offset 0 on every iteration (no pagination offset)', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([fakeStation])
        .mockResolvedValueOnce([]);
      mockClassify.mockResolvedValue(fakeClassification);
      mockExecuteRaw.mockResolvedValue(1);

      await workerInstance.processClassification();

      // Both SELECT calls should use the same SQL template (no OFFSET parameter)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
      const firstCallStrings: string[] = mockQueryRaw.mock.calls[0][0];
      const firstSql = firstCallStrings.join('?');
      expect(firstSql).not.toContain('OFFSET');
    });

    it('job processor delegates to processClassification', async () => {
      expect(capturedProcessor).toBeDefined();
      const processSpy = jest
        .spyOn(workerInstance, 'processClassification')
        .mockResolvedValue(undefined);

      await capturedProcessor!({});

      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });
});
