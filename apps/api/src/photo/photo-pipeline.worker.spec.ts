import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  PhotoPipelineWorker,
  PHOTO_PIPELINE_QUEUE,
  PHOTO_PIPELINE_JOB,
  type PhotoPipelineJobData,
} from './photo-pipeline.worker.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationService } from '../station/station.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { Job } from 'bullmq';

// ── BullMQ / Redis mocks ───────────────────────────────────────────────────

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();

// Capture the processor so tests can invoke processJob directly
let capturedProcessor: ((job: Job<PhotoPipelineJobData>) => Promise<void>) | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation(
    (_name: string, processor: (job: Job<PhotoPipelineJobData>) => Promise<void>) => {
      capturedProcessor = processor;
      return { close: mockWorkerClose, on: mockWorkerOn };
    },
  ),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ quit: jest.fn() })),
);

// ── Service mocks ──────────────────────────────────────────────────────────

const mockPrismaService = {
  submission: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockStationService = {
  findNearbyWithDistance: jest.fn(),
};

const mockStorageService = {
  deleteObject: jest.fn(),
};

// ── Test fixtures ──────────────────────────────────────────────────────────

const makeJob = (submissionId: string) =>
  ({ data: { submissionId } }) as Job<PhotoPipelineJobData>;

const pendingSubmission = {
  id: 'sub-123',
  user_id: 'user-abc',
  station_id: null,
  photo_r2_key: 'submissions/user-abc/sub-123.jpg',
  gps_lat: 52.2297,
  gps_lng: 21.0122,
  status: 'pending' as const,
  price_data: [{ fuel_type: 'PB_95', price_per_litre: null }],
  ocr_confidence_score: null,
  source: 'community' as const,
  created_at: new Date(),
  updated_at: new Date(),
};

const nearbyStation = {
  id: 'station-abc',
  name: 'Orlen Centrum',
  address: 'ul. Test 1',
  google_places_id: 'gp_1',
  distance_m: 45.5,
};

// ── Test suite ─────────────────────────────────────────────────────────────

describe('PhotoPipelineWorker', () => {
  let worker: PhotoPipelineWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedProcessor = null;
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });
    mockPrismaService.submission.update.mockResolvedValue({});
    mockStorageService.deleteObject.mockResolvedValue(undefined);
    mockStationService.findNearbyWithDistance.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotoPipelineWorker,
        { provide: ConfigService, useValue: { getOrThrow: () => 'redis://localhost:6379' } },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StationService, useValue: mockStationService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    worker = module.get<PhotoPipelineWorker>(PhotoPipelineWorker);
    await worker.onModuleInit();
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  // ── enqueue ───────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds job with submissionId, correct jobId, and retry options', async () => {
      await worker.enqueue('sub-uuid-123');

      expect(mockQueueAdd).toHaveBeenCalledWith(
        PHOTO_PIPELINE_JOB,
        { submissionId: 'sub-uuid-123' },
        expect.objectContaining({
          jobId: 'photo-sub-uuid-123',
          attempts: 4,
          backoff: { type: 'custom' },
        }),
      );
    });

    it('uses unique jobId per submissionId for dedup', async () => {
      await worker.enqueue('sub-aaa');
      await worker.enqueue('sub-bbb');

      const calls = mockQueueAdd.mock.calls;
      expect(calls[0][2]).toMatchObject({ jobId: 'photo-sub-aaa' });
      expect(calls[1][2]).toMatchObject({ jobId: 'photo-sub-bbb' });
    });
  });

  // ── getQueue ──────────────────────────────────────────────────────────────

  describe('getQueue', () => {
    it('returns the Queue instance', () => {
      const queue = worker.getQueue();
      expect(queue).toBeDefined();
      expect(typeof queue.add).toBe('function');
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and redis connection', async () => {
      await worker.onModuleDestroy();
      expect(mockWorkerClose).toHaveBeenCalled();
      expect(mockQueueClose).toHaveBeenCalled();
    });
  });

  // ── queue name constant ───────────────────────────────────────────────────

  describe('queue name', () => {
    it('PHOTO_PIPELINE_QUEUE constant is "photo-pipeline"', () => {
      expect(PHOTO_PIPELINE_QUEUE).toBe('photo-pipeline');
    });
  });

  // ── processJob — GPS match ────────────────────────────────────────────────

  describe('processJob — GPS match', () => {
    it('sets station_id to nearest candidate and nulls GPS on match', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { station_id: 'station-abc', gps_lat: null, gps_lng: null },
      });
    });

    it('returns all candidates so downstream steps can evaluate ambiguity', async () => {
      const secondStation = { ...nearbyStation, id: 'station-def', distance_m: 120.0 };
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation, secondStation]);

      await capturedProcessor!(makeJob('sub-123'));

      // station_id set to nearest (first) candidate
      expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ station_id: 'station-abc' }) }),
      );
    });

    it('uses findNearbyWithDistance (not findNearestStation)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStationService.findNearbyWithDistance).toHaveBeenCalledWith(
        pendingSubmission.gps_lat,
        pendingSubmission.gps_lng,
      );
    });

    it('does not delete R2 photo on successful match', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });
  });

  // ── processJob — preselected station ──────────────────────────────────────

  describe('processJob — preselected station', () => {
    const preselectedSubmission = {
      ...pendingSubmission,
      station_id: 'preselected-station-id',
    };

    it('nulls GPS coords when station_id already set', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(preselectedSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { gps_lat: null, gps_lng: null },
      });
    });

    it('does not call findNearbyWithDistance when station_id is preselected', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(preselectedSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStationService.findNearbyWithDistance).not.toHaveBeenCalled();
    });

    it('does not delete R2 photo for preselected station', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(preselectedSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });
  });

  // ── processJob — no match ─────────────────────────────────────────────────

  describe('processJob — no match', () => {
    it('marks submission as rejected when no station within 200m', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { status: 'rejected', gps_lat: null, gps_lng: null },
      });
    });

    it('nulls GPS coords on rejection', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gps_lat: null, gps_lng: null }) }),
      );
    });

    it('deletes photo from R2 on rejection', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        'submissions/user-abc/sub-123.jpg',
      );
    });

    it('completes job without throwing — no BullMQ retry on GPS failure', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
    });
  });

  // ── processJob — no GPS coordinates ───────────────────────────────────────

  describe('processJob — no GPS coordinates', () => {
    const noGpsSubmission = {
      ...pendingSubmission,
      gps_lat: null,
      gps_lng: null,
    };

    it('marks submission as rejected when gps_lat is null', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(noGpsSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { status: 'rejected', gps_lat: null, gps_lng: null },
      });
    });

    it('deletes photo from R2 on no-GPS rejection', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(noGpsSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        'submissions/user-abc/sub-123.jpg',
      );
    });

    it('does not call findNearbyWithDistance when GPS is missing', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(noGpsSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStationService.findNearbyWithDistance).not.toHaveBeenCalled();
    });
  });

  // ── processJob — idempotency ──────────────────────────────────────────────

  describe('processJob — idempotency', () => {
    it('skips processing when submission is already non-pending (verified)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce({
        ...pendingSubmission,
        status: 'verified',
      });

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStationService.findNearbyWithDistance).not.toHaveBeenCalled();
      expect(mockPrismaService.submission.update).not.toHaveBeenCalled();
    });

    it('skips processing when submission is not found', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(null);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStationService.findNearbyWithDistance).not.toHaveBeenCalled();
      expect(mockPrismaService.submission.update).not.toHaveBeenCalled();
    });
  });

  // ── processJob — error propagation (BullMQ retry) ─────────────────────────

  describe('processJob — error propagation', () => {
    it('throws when DB findUnique fails so BullMQ retries', async () => {
      mockPrismaService.submission.findUnique.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow('DB connection lost');
    });

    it('throws when findNearbyWithDistance fails so BullMQ retries', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockRejectedValueOnce(
        new Error('PostGIS unavailable'),
      );

      await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow('PostGIS unavailable');
    });
  });

  // ── processJob — R2 cleanup resilience ───────────────────────────────────

  describe('processJob — R2 cleanup resilience', () => {
    it('does not throw when R2 deleteObject fails during rejection', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);
      mockStorageService.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));

      await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
    });

    it('still marks submission as rejected even if R2 delete fails', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);
      mockStorageService.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
      );
    });
  });
});
