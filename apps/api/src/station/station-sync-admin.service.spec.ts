import { Test, TestingModule } from '@nestjs/testing';
import { StationSyncAdminService } from './station-sync-admin.service.js';
import { StationSyncWorker, STATION_SYNC_JOB, JOB_OPTIONS } from './station-sync.worker.js';
import { PrismaService } from '../prisma/prisma.service.js';

const makeJob = (id: string, finishedOn?: number) => ({ id, finishedOn });

const mockQueue = {
  getJobCounts: jest.fn(),
  getJobs: jest.fn(),
  add: jest.fn(),
};

const mockWorker = { getQueue: jest.fn().mockReturnValue(mockQueue) };
const mockPrisma = { station: { count: jest.fn() } };

describe('StationSyncAdminService', () => {
  let service: StationSyncAdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockWorker.getQueue.mockReturnValue(mockQueue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationSyncAdminService,
        { provide: StationSyncWorker, useValue: mockWorker },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StationSyncAdminService>(StationSyncAdminService);
  });

  describe('triggerSync', () => {
    it('enqueues a job and returns queued status when nothing is running', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.add.mockResolvedValueOnce({ id: 'job-1' });

      const result = await service.triggerSync();

      expect(result).toEqual({ status: 'queued', jobId: 'job-1' });
      expect(mockQueue.add).toHaveBeenCalledWith(STATION_SYNC_JOB, {}, JOB_OPTIONS);
    });

    it('returns already_running when active jobs exist', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 1, waiting: 0 });
      mockQueue.getJobs.mockResolvedValueOnce([makeJob('job-running')]);

      const result = await service.triggerSync();

      expect(result).toEqual({ status: 'already_running', jobId: 'job-running' });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('returns already_running when waiting jobs exist', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 1 });
      mockQueue.getJobs.mockResolvedValueOnce([makeJob('job-waiting')]);

      const result = await service.triggerSync();

      expect(result).toEqual({ status: 'already_running', jobId: 'job-waiting' });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('returns unknown jobId when queue returns no active jobs (edge case)', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 1, waiting: 0 });
      mockQueue.getJobs.mockResolvedValueOnce([]);

      const result = await service.triggerSync();

      expect(result.jobId).toBe('unknown');
    });
  });

  describe('getStatus', () => {
    it('returns running status when active jobs exist', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 1, waiting: 0 });
      mockQueue.getJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockPrisma.station.count.mockResolvedValueOnce(8000);

      const result = await service.getStatus();

      expect(result.status).toBe('running');
      expect(result.stationCount).toBe(8000);
    });

    it('returns idle when no active jobs and last completed is more recent than last failed', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs
        .mockResolvedValueOnce([makeJob('c1', 2000)]) // completed
        .mockResolvedValueOnce([makeJob('f1', 1000)]); // failed — older
      mockPrisma.station.count.mockResolvedValueOnce(8000);

      const result = await service.getStatus();

      expect(result.status).toBe('idle');
    });

    it('returns failed when last failed is more recent than last completed', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs
        .mockResolvedValueOnce([makeJob('c1', 1000)]) // completed — older
        .mockResolvedValueOnce([makeJob('f1', 2000)]); // failed — newer
      mockPrisma.station.count.mockResolvedValueOnce(100);

      const result = await service.getStatus();

      expect(result.status).toBe('failed');
    });

    it('returns failed when there is a failed job and no completed job', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs
        .mockResolvedValueOnce([]) // no completed
        .mockResolvedValueOnce([makeJob('f1', 1000)]);
      mockPrisma.station.count.mockResolvedValueOnce(0);

      const result = await service.getStatus();

      expect(result.status).toBe('failed');
    });

    it('returns idle with null timestamps when no jobs have run yet', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockPrisma.station.count.mockResolvedValueOnce(0);

      const result = await service.getStatus();

      expect(result.status).toBe('idle');
      expect(result.lastCompletedAt).toBeNull();
      expect(result.lastFailedAt).toBeNull();
    });

    it('formats finishedOn as ISO string', async () => {
      const ts = new Date('2026-03-01T10:00:00.000Z').getTime();
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs
        .mockResolvedValueOnce([makeJob('c1', ts)])
        .mockResolvedValueOnce([]);
      mockPrisma.station.count.mockResolvedValueOnce(8000);

      const result = await service.getStatus();

      expect(result.lastCompletedAt).toBe('2026-03-01T10:00:00.000Z');
    });

    it('includes stationCount from prisma', async () => {
      mockQueue.getJobCounts.mockResolvedValueOnce({ active: 0, waiting: 0 });
      mockQueue.getJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockPrisma.station.count.mockResolvedValueOnce(7843);

      const result = await service.getStatus();

      expect(result.stationCount).toBe(7843);
    });
  });
});
