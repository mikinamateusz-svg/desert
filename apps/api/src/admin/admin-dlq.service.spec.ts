import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { AdminDlqService } from './admin-dlq.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<{
  id: string;
  submissionId: string;
  failedReason: string;
  attemptsMade: number;
  finishedOn: number;
  processedOn: number;
  timestamp: number;
}> = {}) {
  const {
    id = 'job-1',
    submissionId = 'sub-1',
    failedReason = 'timeout',
    attemptsMade = 4,
    finishedOn = Date.now(),
    processedOn = Date.now(),
    timestamp = Date.now(),
  } = overrides;

  return {
    id,
    data: { submissionId },
    failedReason,
    attemptsMade,
    finishedOn,
    processedOn,
    timestamp,
    retry: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue('failed'),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminDlqService', () => {
  let service: AdminDlqService;
  let prisma: jest.Mocked<PrismaService>;
  let storage: jest.Mocked<StorageService>;
  let mockQueue: {
    getJobs: jest.Mock;
    getJob: jest.Mock;
    getJobCounts: jest.Mock;
  };

  beforeEach(async () => {
    mockQueue = {
      getJobs: jest.fn().mockResolvedValue([]),
      getJob: jest.fn().mockResolvedValue(null),
      getJobCounts: jest.fn().mockResolvedValue({ failed: 0 }),
    };

    const mockWorker = {
      getQueue: jest.fn().mockReturnValue(mockQueue),
    };

    const mockPrisma = {
      submission: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const mockStorage = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDlqService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: PhotoPipelineWorker, useValue: mockWorker },
      ],
    }).compile();

    service = module.get<AdminDlqService>(AdminDlqService);
    prisma = module.get(PrismaService);
    storage = module.get(StorageService);

    // Initialise the cached queue reference (mirrors NestJS lifecycle)
    await service.onModuleInit();
    // Reset rate limiter so each test starts with a clean slate
    (service as unknown as { lastAlertSentAt: number }).lastAlertSentAt = 0;
  });

  afterEach(() => {
    delete process.env['SLACK_WEBHOOK_URL'];
    jest.restoreAllMocks();
  });

  // ── listDlq ─────────────────────────────────────────────────────────────

  describe('listDlq', () => {
    it('returns mapped jobs sorted oldest first', async () => {
      const job1 = makeJob({ id: 'job-1', submissionId: 'sub-1', timestamp: 1000 });
      const job2 = makeJob({ id: 'job-2', submissionId: 'sub-2', timestamp: 500 });
      mockQueue.getJobs.mockResolvedValue([job1, job2]);

      (prisma.submission.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-1', station_id: 'st-1', station: { name: 'Shell A1' } },
        { id: 'sub-2', station_id: null, station: null },
      ]);

      const result = await service.listDlq();

      // job2 (timestamp 500) should be first (oldest)
      expect(result[0].jobId).toBe('job-2');
      expect(result[1].jobId).toBe('job-1');
      expect(result[1].stationName).toBe('Shell A1');
      expect(result[0].stationName).toBeNull();
    });

    it('returns empty array when no failed jobs', async () => {
      mockQueue.getJobs.mockResolvedValue([]);
      const result = await service.listDlq();
      expect(result).toEqual([]);
    });
  });

  // ── retryJob ─────────────────────────────────────────────────────────────

  describe('retryJob', () => {
    it('throws NotFoundException when job not found', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      await expect(service.retryJob('missing-job', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('calls job.retry() and writes audit log on success', async () => {
      const job = makeJob({ id: 'job-1', submissionId: 'sub-1' });
      mockQueue.getJob.mockResolvedValue(job);

      await service.retryJob('job-1', 'admin-1');

      expect(job.retry).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: 'admin-1',
          action: 'DLQ_RETRY',
          submission_id: 'sub-1',
        }),
      });
    });
  });

  // ── discardJob ───────────────────────────────────────────────────────────

  describe('discardJob', () => {
    it('throws NotFoundException when job not found', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      await expect(service.discardJob('missing-job', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('happy path: updates submission, deletes R2 photo, removes job, writes audit', async () => {
      const job = makeJob({ id: 'job-1', submissionId: 'sub-1' });
      mockQueue.getJob.mockResolvedValue(job);

      (prisma.submission.findUnique as jest.Mock).mockResolvedValue({
        photo_r2_key: 'photos/sub-1.jpg',
      });

      await service.discardJob('job-1', 'admin-1');

      expect(prisma.submission.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-1', status: { notIn: [SubmissionStatus.rejected, SubmissionStatus.verified] } },
        data: {
          status: SubmissionStatus.rejected,
          flag_reason: 'dead_letter_discarded',
        },
      });
      expect(storage.deleteObject).toHaveBeenCalledWith('photos/sub-1.jpg');
      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: 'admin-1',
          action: 'DLQ_DISCARD',
          submission_id: 'sub-1',
        }),
      });
    });

    it('skips R2 delete when photo_r2_key is null', async () => {
      const job = makeJob({ id: 'job-1', submissionId: 'sub-1' });
      mockQueue.getJob.mockResolvedValue(job);

      (prisma.submission.findUnique as jest.Mock).mockResolvedValue({
        photo_r2_key: null,
      });

      await service.discardJob('job-1', 'admin-1');

      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(job.remove).toHaveBeenCalledTimes(1);
    });
  });

  // ── checkDlqAlert ────────────────────────────────────────────────────────

  describe('checkDlqAlert', () => {
    it('does not POST when failed count < 10', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ failed: 5 });
      process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.com/test';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response());

      await service.checkDlqAlert();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not POST when count equals exactly 9', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ failed: 9 });
      process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.com/test';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response());

      await service.checkDlqAlert();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POSTs to SLACK_WEBHOOK_URL when count >= 10', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ failed: 12 });
      process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.com/test';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response());

      await service.checkDlqAlert();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('12'),
        }),
      );
    });

    it('logs a warning (no POST) when SLACK_WEBHOOK_URL is not set and count >= 10', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ failed: 15 });
      delete process.env['SLACK_WEBHOOK_URL'];
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response());
      const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

      await service.checkDlqAlert();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('15'));
    });
  });
});
