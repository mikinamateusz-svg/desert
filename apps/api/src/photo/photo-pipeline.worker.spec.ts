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
import { OcrService } from '../ocr/ocr.service.js';
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
  getObjectBuffer: jest.fn(),
};

const mockOcrService = {
  extractPrices: jest.fn(),
  validatePriceBands: jest.fn(),
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

const successfulOcrResult = {
  prices: [{ fuel_type: 'PB_95', price_per_litre: 6.19 }],
  confidence_score: 0.92,
  raw_response: '{"prices":[{"fuel_type":"PB_95","price_per_litre":6.19}],"confidence_score":0.92}',
};

// ── Test suite ─────────────────────────────────────────────────────────────

describe('PhotoPipelineWorker', () => {
  let worker: PhotoPipelineWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedProcessor = null;

    // BullMQ
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });

    // DB
    mockPrismaService.submission.update.mockResolvedValue({});

    // Station
    mockStationService.findNearbyWithDistance.mockResolvedValue([]);

    // Storage — default success so GPS tests pass through OCR step
    mockStorageService.deleteObject.mockResolvedValue(undefined);
    mockStorageService.getObjectBuffer.mockResolvedValue(Buffer.from('fake-image'));

    // OCR — default success so GPS tests are unaffected by OCR step
    mockOcrService.extractPrices.mockResolvedValue(successfulOcrResult);
    mockOcrService.validatePriceBands.mockReturnValue(null); // all prices in range

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotoPipelineWorker,
        { provide: ConfigService, useValue: { getOrThrow: () => 'redis://localhost:6379' } },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StationService, useValue: mockStationService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: OcrService, useValue: mockOcrService },
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

    it('does not delete R2 photo on successful GPS match (OCR succeeds)', async () => {
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

    it('does not delete R2 photo for preselected station (OCR succeeds)', async () => {
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

    it('does not call OCR when GPS matching rejects the submission', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockOcrService.extractPrices).not.toHaveBeenCalled();
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

  // ── failed event — GDPR GPS null on final retry exhaustion ───────────────

  describe('failed event — GPS null on final failure', () => {
    let capturedFailedHandler: ((job: Job | undefined, err: Error) => void) | null = null;

    beforeEach(() => {
      // mockWorkerOn is already cleared by jest.clearAllMocks() in outer beforeEach.
      // Capture the 'failed' handler registered during onModuleInit.
      const calls = mockWorkerOn.mock.calls as [string, (...args: unknown[]) => void][];
      const failedCall = calls.find(([event]) => event === 'failed');
      capturedFailedHandler = failedCall
        ? (failedCall[1] as (job: Job | undefined, err: Error) => void)
        : null;
    });

    const makeFailedJob = (submissionId: string, attemptsMade: number, attempts: number) =>
      ({
        data: { submissionId },
        attemptsMade,
        opts: { attempts },
      }) as unknown as Job<PhotoPipelineJobData>;

    it('nulls GPS coords on final retry exhaustion', async () => {
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('DB connection lost'));

      // Allow the async update to be enqueued (it is a floating promise)
      await Promise.resolve();

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { gps_lat: null, gps_lng: null },
      });
    });

    it('does not null GPS when there are retries remaining', async () => {
      const job = makeFailedJob('sub-123', 2, 4); // 2 of 4 attempts used
      capturedFailedHandler!(job, new Error('transient error'));

      await Promise.resolve();

      expect(mockPrismaService.submission.update).not.toHaveBeenCalled();
    });
  });

  // ── processJob — OCR step (Story 3.5) ────────────────────────────────────

  describe('processJob — OCR step', () => {
    describe('successful OCR', () => {
      it('calls getObjectBuffer with the submission photo_r2_key', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.getObjectBuffer).toHaveBeenCalledWith(
          'submissions/user-abc/sub-123.jpg',
        );
      });

      it('calls extractPrices with the photo buffer', async () => {
        const fakeBuffer = Buffer.from('fake-image-bytes');
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockStorageService.getObjectBuffer.mockResolvedValueOnce(fakeBuffer);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).toHaveBeenCalledWith(fakeBuffer);
      });

      it('updates price_data and ocr_confidence_score on the Submission', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
          where: { id: 'sub-123' },
          data: {
            price_data: successfulOcrResult.prices,
            ocr_confidence_score: successfulOcrResult.confidence_score,
          },
        });
      });

      it('does NOT delete R2 photo on OCR success (Story 3.7 handles deletion)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });

      it('does NOT change status to verified (Story 3.7 handles verification)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        // No update call should set status to anything
        const updateCalls = mockPrismaService.submission.update.mock.calls as Array<
          [{ where: unknown; data: Record<string, unknown> }]
        >;
        const statusUpdates = updateCalls.filter(([args]) => 'status' in args.data);
        expect(statusUpdates).toHaveLength(0);
      });
    });

    describe('low confidence rejection', () => {
      const lowConfidenceResult = { ...successfulOcrResult, confidence_score: 0.3 };

      it('rejects submission when confidence_score < 0.4', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(lowConfidenceResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
      });

      it('deletes photo from R2 on low-confidence rejection', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(lowConfidenceResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
          'submissions/user-abc/sub-123.jpg',
        );
      });

      it('completes job without throwing on low confidence', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(lowConfidenceResult);

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      it('does not update price_data when confidence is low', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(lowConfidenceResult);

        await capturedProcessor!(makeJob('sub-123'));

        const updateCalls = mockPrismaService.submission.update.mock.calls as Array<
          [{ where: unknown; data: Record<string, unknown> }]
        >;
        const priceDataUpdates = updateCalls.filter(([args]) => 'price_data' in args.data);
        expect(priceDataUpdates).toHaveLength(0);
      });
    });

    describe('no prices extracted', () => {
      const noPricesResult = { ...successfulOcrResult, prices: [], confidence_score: 0.7 };

      it('rejects submission when prices array is empty', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(noPricesResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
      });

      it('deletes photo from R2 on no-prices rejection', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(noPricesResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
          'submissions/user-abc/sub-123.jpg',
        );
      });

      it('completes job without throwing when no prices found', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(noPricesResult);

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('price out of range', () => {
      it('rejects submission when validatePriceBands returns a fuel type', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('PB_95');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
      });

      it('deletes photo from R2 on price-out-of-range rejection', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('PB_95');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
          'submissions/user-abc/sub-123.jpg',
        );
      });

      it('completes job without throwing on price range rejection', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('LPG');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('missing photo_r2_key', () => {
      const noPhotoSubmission = { ...pendingSubmission, photo_r2_key: null };

      it('rejects submission without calling Claude when photo_r2_key is null', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(noPhotoSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).not.toHaveBeenCalled();
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
      });

      it('does not call getObjectBuffer when photo_r2_key is null', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(noPhotoSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.getObjectBuffer).not.toHaveBeenCalled();
      });

      it('completes job without throwing on missing photo', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(noPhotoSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('transient OCR failure', () => {
      it('throws when getObjectBuffer fails so BullMQ retries', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockStorageService.getObjectBuffer.mockRejectedValueOnce(new Error('R2 unavailable'));

        await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow('R2 unavailable');
      });

      it('throws when extractPrices throws so BullMQ retries', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockRejectedValueOnce(new Error('Claude API 503'));

        await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow('Claude API 503');
      });

      it('does NOT delete photo when extractPrices throws (photo needed for retry)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockRejectedValueOnce(new Error('Claude API 503'));

        await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow();
        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });
    });

    describe('OCR skipped for already-rejected submission (GPS path)', () => {
      it('does not call extractPrices when GPS matching rejected the submission', async () => {
        // GPS: no station match → rejectSubmission → return null → processJob returns early
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]); // no match

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).not.toHaveBeenCalled();
      });
    });
  });

  // ── processJob — R2 cleanup resilience ───────────────────────────────────

  describe('processJob — R2 cleanup resilience', () => {
    it('does not throw when R2 deleteObject fails during GPS rejection', async () => {
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
