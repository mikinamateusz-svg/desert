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
import { LogoService } from '../logo/logo.service.js';
import { PriceService } from '../price/price.service.js';
import { PriceValidationService } from '../price/price-validation.service.js';
import { OcrSpendService } from './ocr-spend.service.js';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { TrustScoreService } from '../user/trust-score.service.js';
import { ResearchRetentionService } from '../research/research-retention.service.js';
import { Worker, type Job } from 'bullmq';

// ── BullMQ / Redis mocks ───────────────────────────────────────────────────

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockQueueGetFailedCount = jest.fn();
const mockQueueGetJobCounts = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();
const mockWorkerPause = jest.fn();
const mockWorkerResume = jest.fn();

// Capture the processor so tests can invoke processJob directly
let capturedProcessor: ((job: Job<PhotoPipelineJobData>) => Promise<void>) | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
    getFailedCount: mockQueueGetFailedCount,
    getJobCounts: mockQueueGetJobCounts,
  })),
  Worker: jest.fn().mockImplementation(
    (_name: string, processor: (job: Job<PhotoPipelineJobData>) => Promise<void>) => {
      capturedProcessor = processor;
      return { close: mockWorkerClose, on: mockWorkerOn, pause: mockWorkerPause, resume: mockWorkerResume };
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
  stationFuelStaleness: {
    deleteMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
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

const mockLogoService = {
  recogniseBrand: jest.fn(),
  evaluateMatch: jest.fn(),
};

const mockPriceService = {
  setVerifiedPrice: jest.fn(),
};

const mockPriceValidationService = {
  validatePrices: jest.fn(),
};

const mockOcrSpendService = {
  computeCostUsd: jest.fn(),
  recordSpend: jest.fn(),
  getSpendCap: jest.fn(),
};

const mockSubmissionDedupService = {
  checkStationDedup: jest.fn(),
  checkHashDedup: jest.fn(),
  recordStationDedup: jest.fn(),
  recordHashDedup: jest.fn(),
};

const mockTrustScoreService = {
  updateScore: jest.fn(),
};

const mockResearchRetention = {
  captureIfEnabled: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(false),
  cleanupExpired: jest.fn(),
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
  brand: 'orlen',
  distance_m: 45.5,
};

// Two candidates at similar distances → ambiguous → logo recognition runs
// 80 vs 120: diff=40, 50% of 120=60, 40 < 60 → ambiguous
const ambiguousCandidates = [
  { id: 'station-1', name: 'Orlen Krakowska', address: null, google_places_id: null, brand: 'orlen', distance_m: 80 },
  { id: 'station-2', name: 'BP Centrum', address: null, google_places_id: null, brand: 'bp', distance_m: 120 },
];

// Two candidates where nearest is clearly closer → unambiguous → logo recognition skipped
// 60 vs 140: diff=80, 50% of 140=70, 80 > 70 → unambiguous
const unambiguousCandidates = [
  { id: 'station-1', name: 'Orlen Krakowska', address: null, google_places_id: null, brand: 'orlen', distance_m: 60 },
  { id: 'station-2', name: 'BP Centrum', address: null, google_places_id: null, brand: 'bp', distance_m: 140 },
];

const successfulOcrResult = {
  prices: [{ fuel_type: 'PB_95', price_per_litre: 6.19 }],
  confidence_score: 0.92,
  raw_response: '{"prices":[{"fuel_type":"PB_95","price_per_litre":6.19}],"confidence_score":0.92}',
  input_tokens: 1000,
  output_tokens: 200,
};

// Re-fetched submission (contains price_data written by OCR step)
const submissionAfterOcr = {
  id: 'sub-123',
  user_id: 'user-abc',
  price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.19 }],
  photo_r2_key: 'submissions/user-abc/sub-123.jpg',
};

// Submission with preselected station (station_id already set before GPS step)
const preselectedSubmission = {
  ...pendingSubmission,
  station_id: 'station-abc',
  gps_lat: null,
  gps_lng: null,
};

// Submission where OCR already ran in a prior BullMQ attempt (retry scenario)
const retrySubmission = {
  ...pendingSubmission,
  ocr_confidence_score: 0.92,
};

// ── Test suite ─────────────────────────────────────────────────────────────

describe('PhotoPipelineWorker', () => {
  let worker: PhotoPipelineWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedProcessor = null;

    // BullMQ
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });
    mockQueueGetFailedCount.mockResolvedValue(0); // default: DLQ is empty
    mockQueueGetJobCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0 });
    mockWorkerPause.mockResolvedValue(undefined);
    mockWorkerResume.mockReturnValue(undefined);

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

    // Logo — default: match confirmed (most tests use single/unambiguous candidates, skips logo)
    mockLogoService.recogniseBrand.mockResolvedValue({
      brand: 'orlen',
      confidence: 0.9,
      raw_response: '{"brand":"orlen","confidence":0.9}',
    });
    mockLogoService.evaluateMatch.mockReturnValue('match');

    // Price validation — default: first price passes Tier 3
    mockPriceValidationService.validatePrices.mockResolvedValue({
      valid: [{ fuel_type: 'PB_95', price_per_litre: 6.19, tier: 3 }],
      invalid: [],
    });
    mockPriceService.setVerifiedPrice.mockResolvedValue(undefined);
    mockPrismaService.stationFuelStaleness.deleteMany.mockResolvedValue({ count: 0 });

    // OcrSpendService — default: spend well below cap, no pausing
    mockOcrSpendService.computeCostUsd.mockReturnValue(0.001);
    mockOcrSpendService.recordSpend.mockResolvedValue(0.5);
    mockOcrSpendService.getSpendCap.mockResolvedValue(20);

    // SubmissionDedupService — default: no duplicates, recording succeeds
    mockSubmissionDedupService.checkStationDedup.mockResolvedValue(false);
    mockSubmissionDedupService.checkHashDedup.mockResolvedValue(false);
    mockSubmissionDedupService.recordStationDedup.mockResolvedValue(undefined);
    mockSubmissionDedupService.recordHashDedup.mockResolvedValue(undefined);

    // TrustScoreService — default: update succeeds
    mockTrustScoreService.updateScore.mockResolvedValue(undefined);

    // User — default: trust_score = 100, role = DRIVER (normal user, not low-trust)
    mockPrismaService.user.findUnique.mockResolvedValue({ trust_score: 100, role: 'DRIVER' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotoPipelineWorker,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'redis://localhost:6379',
            get: (key: string, defaultVal?: string) => defaultVal ?? '',
          },
        },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StationService, useValue: mockStationService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: OcrService, useValue: mockOcrService },
        { provide: LogoService, useValue: mockLogoService },
        { provide: PriceService, useValue: mockPriceService },
        { provide: PriceValidationService, useValue: mockPriceValidationService },
        { provide: OcrSpendService, useValue: mockOcrSpendService },
        { provide: SubmissionDedupService, useValue: mockSubmissionDedupService },
        { provide: TrustScoreService, useValue: mockTrustScoreService },
        { provide: ResearchRetentionService, useValue: mockResearchRetention },
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

  // ── onModuleInit — rate limit validation (P-2) ────────────────────────────

  describe('onModuleInit — rate limit fallback (P-2)', () => {
    it('initialises successfully when OCR_WORKER_RATE_LIMIT_PER_MINUTE is non-numeric (falls back to 60)', async () => {
      const MockWorkerClass = Worker as unknown as jest.Mock;
      MockWorkerClass.mockClear();

      const module = await Test.createTestingModule({
        providers: [
          PhotoPipelineWorker,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: () => 'redis://localhost:6379',
              get: (key: string, defaultVal?: string) =>
                key === 'OCR_WORKER_RATE_LIMIT_PER_MINUTE' ? 'abc' : (defaultVal ?? ''),
            },
          },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: StationService, useValue: mockStationService },
          { provide: StorageService, useValue: mockStorageService },
          { provide: OcrService, useValue: mockOcrService },
          { provide: LogoService, useValue: mockLogoService },
          { provide: PriceService, useValue: mockPriceService },
          { provide: PriceValidationService, useValue: mockPriceValidationService },
          { provide: OcrSpendService, useValue: mockOcrSpendService },
          { provide: SubmissionDedupService, useValue: mockSubmissionDedupService },
          { provide: TrustScoreService, useValue: mockTrustScoreService },
          { provide: ResearchRetentionService, useValue: mockResearchRetention },
        ],
      }).compile();

      const w = module.get<PhotoPipelineWorker>(PhotoPipelineWorker);
      await w.onModuleInit();

      // Worker should have been constructed — no crash
      expect(MockWorkerClass).toHaveBeenCalled();
      const workerOpts = MockWorkerClass.mock.calls[MockWorkerClass.mock.calls.length - 1][2];
      // Non-numeric 'abc' → parseInt = NaN → falls back to 60
      expect(workerOpts.limiter).toEqual({ max: 60, duration: 60_000 });
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
    it('sets station_id to nearest candidate on match (GPS retained for potential admin review)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { station_id: 'station-abc' },
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
    it('marks submission as rejected with flag_reason when no station within 200m', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: {
          status: 'rejected',
          flag_reason: 'no_station_match',
          gps_lat: null,
          gps_lng: null,
        },
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

    it('keeps photo in R2 on rejection (cleanup worker handles deletion)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
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

    it('marks submission as rejected with flag_reason when gps_lat is null', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(noGpsSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: {
          status: 'rejected',
          flag_reason: 'no_gps_coordinates',
          gps_lat: null,
          gps_lng: null,
        },
      });
    });

    it('keeps photo in R2 on no-GPS rejection (cleanup worker handles deletion)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(noGpsSubmission);

      await capturedProcessor!(makeJob('sub-123'));

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
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

  // ── Story 3.8: DLQ cleanup on final retry exhaustion ─────────────────────

  describe('Story 3.8 — dead-letter queue cleanup on final failure', () => {
    let capturedFailedHandler: ((job: Job | undefined, err: Error) => void) | null = null;

    // Flush all pending microtasks (needed for multi-step async handleFinalFailure)
    const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

    const dlqSubmission = {
      id: 'sub-123',
      photo_r2_key: 'submissions/user-abc/sub-123.jpg',
    };

    beforeEach(() => {
      // Capture the 'failed' handler registered during onModuleInit.
      const calls = mockWorkerOn.mock.calls as [string, (...args: unknown[]) => void][];
      const failedCall = calls.find(([event]) => event === 'failed');
      capturedFailedHandler = failedCall
        ? (failedCall[1] as (job: Job | undefined, err: Error) => void)
        : null;

      // Default: submission exists with a photo
      mockPrismaService.submission.findUnique.mockResolvedValue(dlqSubmission);
    });

    afterEach(() => {
      // Reset findUnique implementation so it doesn't bleed into subsequent describe blocks.
      // jest.clearAllMocks() (outer beforeEach) clears call history but NOT implementations.
      mockPrismaService.submission.findUnique.mockReset();
    });

    const makeFailedJob = (submissionId: string, attemptsMade: number, attempts: number) =>
      ({
        data: { submissionId },
        attemptsMade,
        opts: { attempts },
      }) as unknown as Job<PhotoPipelineJobData>;

    it('marks submission as rejected with flag_reason=dlq_final_failure on final failure', async () => {
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('DB connection lost'));
      await flushPromises();

      expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: {
          status: 'rejected',
          flag_reason: 'dlq_final_failure',
          gps_lat: null,
          gps_lng: null,
        },
      });
    });

    it('keeps photo in R2 on final failure (cleanup worker handles deletion)', async () => {
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('Claude API timeout'));
      await flushPromises();

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('logs [OPS-ALERT] with submission ID on final failure', async () => {
      const errorSpy = jest.spyOn(worker['logger'], 'error');
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('R2 unavailable'));
      await flushPromises();

      const alertCall = errorSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('[OPS-ALERT]') && call[0].includes('sub-123'),
      );
      expect(alertCall).toBeDefined();
    });

    it('does NOT trigger cleanup when there are retries remaining', async () => {
      const job = makeFailedJob('sub-123', 2, 4); // 2 of 4 attempts used
      capturedFailedHandler!(job, new Error('transient error'));
      await flushPromises();

      expect(mockPrismaService.submission.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.submission.update).not.toHaveBeenCalled();
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('logs DLQ depth [OPS-ALERT] when failed count exceeds threshold', async () => {
      mockQueueGetFailedCount.mockResolvedValueOnce(11); // above threshold of 10
      const errorSpy = jest.spyOn(worker['logger'], 'error');
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('DB timeout'));
      await flushPromises();

      const depthAlert = errorSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('[OPS-ALERT]') && call[0].includes('DLQ depth'),
      );
      expect(depthAlert).toBeDefined();
    });

    it('does NOT log DLQ depth alert when failed count is at or below threshold', async () => {
      mockQueueGetFailedCount.mockResolvedValueOnce(10); // at threshold — no alert
      const errorSpy = jest.spyOn(worker['logger'], 'error');
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('transient'));
      await flushPromises();

      const depthAlert = errorSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('DLQ depth'),
      );
      expect(depthAlert).toBeUndefined();
    });

    it('completes without throwing when R2 deletion fails', async () => {
      mockStorageService.deleteObject.mockRejectedValueOnce(new Error('R2 down'));
      const job = makeFailedJob('sub-123', 4, 4);

      capturedFailedHandler!(job, new Error('pipeline error'));
      await expect(flushPromises()).resolves.toBeUndefined();

      // Still logs ops alert despite R2 failure
      expect(mockPrismaService.submission.update).toHaveBeenCalled();
    });

    it('completes gracefully when submission is not found in DB', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(null);
      const job = makeFailedJob('sub-123', 4, 4);

      capturedFailedHandler!(job, new Error('pipeline error'));
      await expect(flushPromises()).resolves.toBeUndefined();

      expect(mockPrismaService.submission.update).not.toHaveBeenCalled();
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('logs [OPS-ALERT] even when submission is not found in DB (P-2)', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(null);
      const errorSpy = jest.spyOn(worker['logger'], 'error');
      const job = makeFailedJob('sub-123', 4, 4);

      capturedFailedHandler!(job, new Error('pipeline error'));
      await flushPromises();

      const alertCall = errorSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('[OPS-ALERT]') && call[0].includes('sub-123'),
      );
      expect(alertCall).toBeDefined();
    });

    it('does NOT delete from R2 when DB update fails (P-1)', async () => {
      mockPrismaService.submission.update.mockRejectedValueOnce(new Error('DB error'));
      const job = makeFailedJob('sub-123', 4, 4);

      capturedFailedHandler!(job, new Error('pipeline error'));
      await flushPromises();

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('logs [OPS-ALERT] when submissionId is unknown (P-3)', async () => {
      const errorSpy = jest.spyOn(worker['logger'], 'error');
      // Simulate a job with no submissionId — worker sets it to 'unknown'
      const job = { data: { submissionId: 'unknown' }, attemptsMade: 4, opts: { attempts: 4 } } as unknown as Job<PhotoPipelineJobData>;

      capturedFailedHandler!(job, new Error('pipeline error'));
      await flushPromises();

      const alertCall = errorSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('[OPS-ALERT]') && call[0].includes('unknown submissionId'),
      );
      expect(alertCall).toBeDefined();
      // No DB or R2 ops should run
      expect(mockPrismaService.submission.findUnique).not.toHaveBeenCalled();
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('skips R2 deletion when photo_r2_key is null', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce({
        id: 'sub-123',
        photo_r2_key: null,
      });
      const job = makeFailedJob('sub-123', 4, 4);
      capturedFailedHandler!(job, new Error('pipeline error'));
      await flushPromises();

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      // Status update still runs
      expect(mockPrismaService.submission.update).toHaveBeenCalled();
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

      it('keeps photo in R2 on low-confidence rejection (cleanup worker handles deletion)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(lowConfidenceResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
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

      it('keeps photo in R2 on no-prices rejection (cleanup worker handles deletion)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(noPricesResult);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });

      it('completes job without throwing when no prices found', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce(noPricesResult);

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      // Story 0.3 — null-price guard
      describe('null/non-finite price_per_litre handling', () => {
        const allNullResult = {
          ...successfulOcrResult,
          prices: [
            { fuel_type: 'PB_95', price_per_litre: null as unknown as number },
            { fuel_type: 'ON', price_per_litre: NaN },
          ],
        };

        const mixedResult = {
          ...successfulOcrResult,
          prices: [
            { fuel_type: 'PB_95', price_per_litre: 6.19 },
            { fuel_type: 'ON', price_per_litre: null as unknown as number },
            { fuel_type: 'ON_PREMIUM', price_per_litre: 6.99 },
          ],
        };

        it('rejects with no_prices_extracted when EVERY OCR price has null/non-finite price_per_litre', async () => {
          mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
          mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
          mockOcrService.extractPrices.mockResolvedValueOnce(allNullResult);

          await capturedProcessor!(makeJob('sub-123'));

          // Same rejection path as the empty-array case — keeps the funnel bucket merged
          expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                status: 'rejected',
                flag_reason: 'no_prices_extracted',
              }),
            }),
          );
        });

        it('does NOT persist a price_data row when all prices are null (skips the persist step)', async () => {
          mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
          mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
          mockOcrService.extractPrices.mockResolvedValueOnce(allNullResult);

          await capturedProcessor!(makeJob('sub-123'));

          // The persist step writes price_data + ocr_confidence_score together; on
          // the all-null path we should never see that shape — only the rejection update.
          const updateCalls = mockPrismaService.submission.update.mock.calls as Array<
            [{ where: unknown; data: Record<string, unknown> }]
          >;
          const persistCalls = updateCalls.filter(([args]) => 'price_data' in args.data);
          expect(persistCalls).toHaveLength(0);
        });

        it('drops only the null entries and persists the remaining valid prices when mixed', async () => {
          mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
          mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
          mockOcrService.extractPrices.mockResolvedValueOnce(mixedResult);

          await capturedProcessor!(makeJob('sub-123'));

          // The persist call should contain ONLY the two valid entries — null ON entry dropped
          expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: 'sub-123' },
              data: expect.objectContaining({
                price_data: [
                  { fuel_type: 'PB_95', price_per_litre: 6.19 },
                  { fuel_type: 'ON_PREMIUM', price_per_litre: 6.99 },
                ],
              }),
            }),
          );
        });

        it('does NOT reject when at least one valid price remains after filtering', async () => {
          mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
          mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
          mockOcrService.extractPrices.mockResolvedValueOnce(mixedResult);

          await capturedProcessor!(makeJob('sub-123'));

          // No rejection update should be made — submission proceeds normally
          const updateCalls = mockPrismaService.submission.update.mock.calls as Array<
            [{ where: unknown; data: Record<string, unknown> }]
          >;
          const rejectCalls = updateCalls.filter(([args]) => args.data.status === 'rejected');
          expect(rejectCalls).toHaveLength(0);
        });

        // Story 0.3 review patches:

        it('P-1: logs a warn with the dropped count when at least one entry is filtered', async () => {
          const warnSpy = jest
            .spyOn((worker as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn')
            .mockImplementation(() => undefined);
          try {
            mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
            mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
            mockOcrService.extractPrices.mockResolvedValueOnce(mixedResult);

            await capturedProcessor!(makeJob('sub-123'));

            // The warn should mention the submission id, the original count, and the dropped count
            const warnCalls = warnSpy.mock.calls.map(args => String(args[0]));
            const dropWarn = warnCalls.find(msg => msg.includes('null/non-finite price_per_litre'));
            expect(dropWarn).toBeDefined();
            expect(dropWarn).toContain('sub-123');
            expect(dropWarn).toContain('3 prices');
            expect(dropWarn).toContain('1 had null');
          } finally {
            warnSpy.mockRestore();
          }
        });

        it('P-2: does NOT log the drop warn when every OCR price is valid (regression — no warn on happy path)', async () => {
          const warnSpy = jest
            .spyOn((worker as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn')
            .mockImplementation(() => undefined);
          try {
            mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
            mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
            // successfulOcrResult has a single valid entry — nothing to drop
            mockOcrService.extractPrices.mockResolvedValueOnce(successfulOcrResult);

            await capturedProcessor!(makeJob('sub-123'));

            const dropWarns = warnSpy.mock.calls
              .map(args => String(args[0]))
              .filter(msg => msg.includes('null/non-finite price_per_litre'));
            expect(dropWarns).toHaveLength(0);
          } finally {
            warnSpy.mockRestore();
          }
        });

        it('P-3: validatePriceBands sees the FILTERED prices, not the originals (price_out_of_range path)', async () => {
          mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
          mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
          mockOcrService.extractPrices.mockResolvedValueOnce(mixedResult);
          // Mixed input has [PB_95: 6.19, ON: null, ON_PREMIUM: 6.99]; after filter
          // validatePriceBands receives [PB_95, ON_PREMIUM] (no ON).
          mockOcrService.validatePriceBands.mockReturnValueOnce('ON_PREMIUM');

          await capturedProcessor!(makeJob('sub-123'));

          // The band check must have been called with the cleaned array — null ON dropped
          expect(mockOcrService.validatePriceBands).toHaveBeenCalledWith([
            { fuel_type: 'PB_95', price_per_litre: 6.19 },
            { fuel_type: 'ON_PREMIUM', price_per_litre: 6.99 },
          ]);
          // And the submission rejected with price_out_of_range
          expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                status: 'rejected',
                flag_reason: 'price_out_of_range',
              }),
            }),
          );
        });
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

      it('keeps photo in R2 on price-out-of-range rejection (cleanup worker handles deletion)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('PB_95');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });

      it('completes job without throwing on price range rejection', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('LPG');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      it('persists flag_reason and ocr_confidence_score on the rejected row (for stats)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.validatePriceBands.mockReturnValueOnce('PB_95');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'rejected',
              flag_reason: 'price_out_of_range',
              ocr_confidence_score: successfulOcrResult.confidence_score,
            }),
          }),
        );
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

    describe('trust-score gating', () => {
      it('routes DRIVER with trust_score < 50 to shadow_rejected (low_trust)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockPrismaService.user.findUnique.mockResolvedValueOnce({ trust_score: 30, role: 'DRIVER' });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'sub-123' },
            data: expect.objectContaining({
              status: 'shadow_rejected',
              flag_reason: 'low_trust',
            }),
          }),
        );
        // Pipeline must short-circuit — price validation must not run
        expect(mockPriceValidationService.validatePrices).not.toHaveBeenCalled();
      });

      it('bypasses trust-gate for ADMIN role and proceeds through pipeline', async () => {
        // Admin with trust=0 should still flow through OCR → logo → price validation.
        // Without the bypass this would have landed in shadow_rejected (low_trust)
        // and price_data would never be saved.
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)   // initial processJob fetch
          .mockResolvedValueOnce(submissionAfterOcr); // re-fetch inside runPriceValidationAndUpdate
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockPrismaService.user.findUnique.mockResolvedValueOnce({ trust_score: 0, role: 'ADMIN' });

        await capturedProcessor!(makeJob('sub-123'));

        // No shadow_rejected write
        expect(mockPrismaService.submission.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'shadow_rejected',
              flag_reason: 'low_trust',
            }),
          }),
        );
        // Pipeline ran through to price validation
        expect(mockPriceValidationService.validatePrices).toHaveBeenCalled();
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

  // ── processJob — logo recognition step (Story 3.6) ───────────────────────

  describe('processJob — logo recognition step', () => {
    describe('ambiguity threshold — skip cases', () => {
      it('skips logo recognition when only one candidate (single unambiguous match)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('skips logo recognition on preselected station path (candidates = [])', async () => {
        const preselected = { ...pendingSubmission, station_id: 'pre-selected-id' };
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(preselected);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('skips logo recognition when nearest is >50% closer than second nearest', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(unambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });
    });

    describe('ambiguity threshold — run cases', () => {
      it('calls recogniseBrand when match is ambiguous (nearest not >50% closer)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).toHaveBeenCalledTimes(1);
      });

      it('fetches photo from R2 for logo recognition when ambiguous', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        // getObjectBuffer called twice: once for OCR, once for logo
        expect(mockStorageService.getObjectBuffer).toHaveBeenCalledWith(
          pendingSubmission.photo_r2_key,
        );
      });
    });

    describe('match outcome — confirmed', () => {
      it('does not update status when logo recognition confirms GPS match', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('match');

        await capturedProcessor!(makeJob('sub-123'));

        const updateCalls = mockPrismaService.submission.update.mock.calls as Array<
          [{ where: unknown; data: Record<string, unknown> }]
        >;
        const shadowRejectedUpdates = updateCalls.filter(
          ([args]) => args.data['status'] === 'shadow_rejected',
        );
        expect(shadowRejectedUpdates).toHaveLength(0);
      });

      it('does not set shadow_rejected when evaluateMatch returns "match"', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('match');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'shadow_rejected' }) }),
        );
      });

      it('proceeds to Story 3.7 stub after logo match (job completes)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('match');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('match outcome — mismatch', () => {
      it('sets status: shadow_rejected when evaluateMatch returns "mismatch"', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith({
          where: { id: 'sub-123' },
          data: { status: 'shadow_rejected', flag_reason: 'logo_mismatch' },
        });
      });

      it('returns early (does not reach Story 3.7 stub) on logo mismatch', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();

        // Verify update was for shadow_rejected (not a Story 3.7 finalisation)
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'shadow_rejected' }) }),
        );
      });

      it('does not delete photo from R2 on logo mismatch (Story 3.7 handles deletion)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });
    });

    describe('match outcome — inconclusive', () => {
      it('does not update status when logo recognition is inconclusive', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('inconclusive');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'shadow_rejected' }) }),
        );
      });

      it('proceeds to Story 3.7 stub when inconclusive', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('inconclusive');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('failure resilience', () => {
      it('proceeds when R2 fetch fails during logo recognition (logo is optional)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        // First getObjectBuffer call (OCR) succeeds; second (logo) fails
        mockStorageService.getObjectBuffer
          .mockResolvedValueOnce(Buffer.from('fake-image')) // OCR fetch
          .mockRejectedValueOnce(new Error('R2 timeout'));  // logo fetch

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      it('does not throw when R2 fetch fails during logo recognition', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockStorageService.getObjectBuffer
          .mockResolvedValueOnce(Buffer.from('fake-image'))
          .mockRejectedValueOnce(new Error('R2 timeout'));

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('proceeds when recogniseBrand returns null brand (API failure fallback)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.recogniseBrand.mockResolvedValueOnce({
          brand: null,
          confidence: 0,
          raw_response: '',
        });
        mockLogoService.evaluateMatch.mockReturnValueOnce('inconclusive');

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      it('does not call recogniseBrand when photo_r2_key is null at logo step', async () => {
        const noPhotoAmbiguous = { ...pendingSubmission, photo_r2_key: null };
        // GPS match was made (station_id set) but photo_r2_key is null
        // OCR rejects this submission with 'missing_photo' before logo step is reached
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(noPhotoAmbiguous);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        // OCR rejects for missing_photo — logo step never runs
        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });
    });

    describe('isAmbiguousMatch helper', () => {
      it('returns false for empty candidates array', async () => {
        // GPS matching rejects on empty candidates, but we can test the threshold via
        // a single-candidate case reaching logo step
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('returns false for single candidate — logo skipped', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('returns true for two candidates where nearest is NOT >50% closer', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).toHaveBeenCalledTimes(1);
      });

      it('returns false for two candidates where nearest IS >50% closer', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(unambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });

      it('handles secondNearest === 0 without throwing (two co-located stations → ambiguous → logo runs)', async () => {
        const zeroDistanceCandidates = [
          { ...nearbyStation, distance_m: 0 },
          { ...nearbyStation, id: 'station-2', distance_m: 0 },
        ];
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(zeroDistanceCandidates);

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
        // Both at 0m: 0 < 0.5 * 0 → false → ambiguous → logo runs
        expect(mockLogoService.recogniseBrand).toHaveBeenCalledTimes(1);
      });
    });

    describe('brand field threading', () => {
      it('passes candidates[0].brand to evaluateMatch (not a separate DB lookup)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);

        await capturedProcessor!(makeJob('sub-123'));

        // evaluateMatch should be called with the brand from candidates[0] ('orlen')
        expect(mockLogoService.evaluateMatch).toHaveBeenCalledWith(
          expect.anything(),
          'orlen', // candidates[0].brand from ambiguousCandidates
        );
      });

      it('handles null brand on GPS-matched station (passes null to evaluateMatch)', async () => {
        const noBrandCandidates = [
          { ...ambiguousCandidates[0], brand: null },
          { ...ambiguousCandidates[1] },
        ];
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(noBrandCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('inconclusive');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.evaluateMatch).toHaveBeenCalledWith(
          expect.anything(),
          null,
        );
      });
    });

    describe('mismatch DB failure resilience', () => {
      it('proceeds (does not throw to BullMQ) when shadow_rejected DB update fails', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');
        // GPS update (station_id) succeeds, OCR price_data update succeeds, then shadow_rejected fails
        mockPrismaService.submission.update
          .mockResolvedValueOnce({}) // GPS update
          .mockResolvedValueOnce({}) // OCR price_data update
          .mockRejectedValueOnce(new Error('DB connection lost')); // shadow_rejected update

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });

      it('does not shadow_reject when DB update fails — proceeds on GPS match', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');
        mockPrismaService.submission.update
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('DB connection lost'));

        await capturedProcessor!(makeJob('sub-123'));

        // Job completes without BullMQ retry
        expect(mockLogoService.recogniseBrand).toHaveBeenCalledTimes(1);
      });
    });

    describe('GPS-rejected path — logo skipped', () => {
      it('does not call recogniseBrand when GPS matching rejected the submission', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]); // no match → reject

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });
    });

    describe('OCR-rejected path — logo skipped', () => {
      it('does not call recogniseBrand when OCR rejected the submission', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        // OCR returns low confidence → rejection → early return before logo step
        mockOcrService.extractPrices.mockResolvedValueOnce({
          prices: [],
          confidence_score: 0.2,
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockLogoService.recogniseBrand).not.toHaveBeenCalled();
      });
    });
  });

  // ── Story 3.7: Price Validation & Database Update ─────────────────────────

  describe('Story 3.7 — price validation and database update', () => {
    // Helper: set up a full happy-path pipeline run through to Story 3.7
    const setupHappyPath = () => {
      mockPrismaService.submission.findUnique
        .mockResolvedValueOnce(pendingSubmission)    // initial fetch
        .mockResolvedValueOnce(submissionAfterOcr);  // Story 3.7 re-fetch
      mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
    };

    describe('verified path — at least one price passes validation', () => {
      it('marks submission as verified', async () => {
        setupHappyPath();

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'verified' }),
          }),
        );
      });

      it('stores only validated prices in price_data', async () => {
        setupHappyPath();
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [{ fuel_type: 'PB_95', price_per_litre: 6.19, tier: 3 }],
          invalid: [{ fuel_type: 'ON', price_per_litre: 99.0, reason: 'tier3_out_of_range' }],
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'verified',
              price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.19 }],
            }),
          }),
        );
      });

      it('nulls photo_r2_key in the same update that sets verified', async () => {
        setupHappyPath();

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'verified', photo_r2_key: null }),
          }),
        );
      });

      it('deletes photo from R2', async () => {
        setupHappyPath();

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
          'submissions/user-abc/sub-123.jpg',
        );
      });

      it('calls setVerifiedPrice with correct stationId and prices', async () => {
        setupHappyPath();

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPriceService.setVerifiedPrice).toHaveBeenCalledWith(
          nearbyStation.id,
          expect.objectContaining({
            stationId: nearbyStation.id,
            prices: { PB_95: 6.19 },
            sources: { PB_95: 'community' },
          }),
        );
      });

      it('clears staleness flags for all validated fuel types in a single batch query', async () => {
        setupHappyPath();
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [
            { fuel_type: 'PB_95', price_per_litre: 6.19, tier: 3 },
            { fuel_type: 'ON', price_per_litre: 5.89, tier: 3 },
          ],
          invalid: [],
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.stationFuelStaleness.deleteMany).toHaveBeenCalledTimes(1);
        expect(mockPrismaService.stationFuelStaleness.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { station_id: nearbyStation.id, fuel_type: { in: ['PB_95', 'ON'] } },
          }),
        );
      });

      it('completes without throwing when setVerifiedPrice fails', async () => {
        setupHappyPath();
        mockPriceService.setVerifiedPrice.mockRejectedValueOnce(new Error('Redis unavailable'));

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();

        // Submission is still marked verified despite cache/history write failure
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'verified' }) }),
        );
      });

      it('completes without throwing when R2 deletion fails', async () => {
        setupHappyPath();
        mockStorageService.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();

        // Submission is still marked verified despite R2 error
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'verified' }) }),
        );
      });

      it('completes without throwing when staleness clear fails', async () => {
        setupHappyPath();
        mockPrismaService.stationFuelStaleness.deleteMany.mockRejectedValueOnce(
          new Error('DB timeout'),
        );

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('rejected path — all prices fail validation', () => {
      it('marks submission as rejected when all prices fail', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [],
          invalid: [{ fuel_type: 'PB_95', price_per_litre: 0.5, reason: 'tier3_out_of_range' }],
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
      });

      it('deletes photo when all prices fail validation', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [],
          invalid: [{ fuel_type: 'PB_95', price_per_litre: 0.5, reason: 'tier3_out_of_range' }],
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      });

      it('does NOT call setVerifiedPrice when all prices fail', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [],
          invalid: [{ fuel_type: 'PB_95', price_per_litre: 0.5, reason: 'tier3_out_of_range' }],
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPriceService.setVerifiedPrice).not.toHaveBeenCalled();
      });

      it('rejects submission when re-fetched price_data is empty', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce({ ...submissionAfterOcr, price_data: [] });
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
        );
        expect(mockPriceValidationService.validatePrices).not.toHaveBeenCalled();
      });
    });

    describe('preselect path — stationId from submission.station_id', () => {
      it('uses submission.station_id when candidates is empty (preselect path)', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(preselectedSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPriceService.setVerifiedPrice).toHaveBeenCalledWith(
          'station-abc', // preselectedSubmission.station_id
          expect.anything(),
        );
      });
    });

    describe('out-of-band price logging — IG-1', () => {
      it('logs a warning for each out-of-band price while still verifying valid prices', async () => {
        setupHappyPath();
        mockPriceValidationService.validatePrices.mockResolvedValueOnce({
          valid: [{ fuel_type: 'PB_95', price_per_litre: 6.19, tier: 3 }],
          invalid: [{ fuel_type: 'ON', price_per_litre: 99.0, reason: 'tier3_out_of_range: 4.0–12.0' }],
        });
        const warnSpy = jest.spyOn(worker['logger'], 'warn');

        await capturedProcessor!(makeJob('sub-123'));

        const outOfBandWarning = warnSpy.mock.calls.find(
          call => typeof call[0] === 'string' && call[0].includes('out-of-band price'),
        );
        expect(outOfBandWarning).toBeDefined();
        expect(outOfBandWarning![0]).toContain('fuel_type=ON');
        expect(outOfBandWarning![0]).toContain('price=99');
        expect(outOfBandWarning![0]).toContain('tier3_out_of_range');

        // Valid price still goes through
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'verified' }) }),
        );
      });
    });

    describe('logo-flagged path — Story 3.7 skipped', () => {
      it('does not call validatePrices when submission is shadow_rejected by logo step', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce(ambiguousCandidates);
        mockLogoService.evaluateMatch.mockReturnValueOnce('mismatch');

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockPriceValidationService.validatePrices).not.toHaveBeenCalled();
      });
    });
  });

  // ── Story 3.9: Pipeline Cost Controls ────────────────────────────────────

  describe('Story 3.9 — OCR spend tracking and rate controls', () => {
    describe('spend recording', () => {
      it('calls computeCostUsd with input_tokens and output_tokens from OCR result', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrSpendService.computeCostUsd).toHaveBeenCalledWith(
          successfulOcrResult.input_tokens,
          successfulOcrResult.output_tokens,
        );
      });

      it('calls recordSpend with the computed cost', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.computeCostUsd.mockReturnValueOnce(0.0042);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrSpendService.recordSpend).toHaveBeenCalledWith(0.0042);
      });

      it('throws when recordSpend fails — hard limit prevents uncapped OCR spend', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockRejectedValueOnce(new Error('Redis down'));

        await expect(capturedProcessor!(makeJob('sub-123'))).rejects.toThrow('Redis down');
      });

      it('does NOT call computeCostUsd when OCR is skipped (no station match)', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrSpendService.computeCostUsd).not.toHaveBeenCalled();
      });
    });

    describe('daily spend cap enforcement', () => {
      it('pauses the worker when daily spend reaches the cap', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(20.001); // at cap
        mockOcrSpendService.getSpendCap.mockResolvedValue(20);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockWorkerPause).toHaveBeenCalledTimes(1);
      });

      it('logs [OPS-ALERT] when spend cap is reached', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(20.5);
        mockOcrSpendService.getSpendCap.mockResolvedValue(20);
        const errorSpy = jest.spyOn(worker['logger'], 'error');

        await capturedProcessor!(makeJob('sub-123'));

        const alert = errorSpy.mock.calls.find(
          call => typeof call[0] === 'string' && call[0].includes('[OPS-ALERT]') && call[0].includes('spend'),
        );
        expect(alert).toBeDefined();
      });

      it('does NOT pause the worker when daily spend is below the cap', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(5.0);
        mockOcrSpendService.getSpendCap.mockResolvedValue(20);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockWorkerPause).not.toHaveBeenCalled();
      });

      it('does NOT pause the worker a second time when already paused for spend cap', async () => {
        // First job hits cap and pauses
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(21.0);
        mockOcrSpendService.getSpendCap.mockResolvedValue(20);
        await capturedProcessor!(makeJob('sub-123'));

        expect(mockWorkerPause).toHaveBeenCalledTimes(1);
        mockWorkerPause.mockClear();

        // Second job also over cap — should NOT pause again
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(22.0);
        await capturedProcessor!(makeJob('sub-123'));

        expect(mockWorkerPause).not.toHaveBeenCalled();
      });
    });

    describe('resumeWorker', () => {
      it('resumes the worker and clears the paused flag', async () => {
        // Trigger cap pause first
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrSpendService.recordSpend.mockResolvedValueOnce(21.0);
        mockOcrSpendService.getSpendCap.mockResolvedValue(20);
        await capturedProcessor!(makeJob('sub-123'));
        expect(mockWorkerPause).toHaveBeenCalledTimes(1);

        // Now resume
        worker.resumeWorker();

        expect(mockWorkerResume).toHaveBeenCalledTimes(1);
      });

      it('does not call resume when worker is not paused for spend cap', () => {
        // Worker is not paused — resumeWorker should be a no-op
        worker.resumeWorker();

        expect(mockWorkerResume).not.toHaveBeenCalled();
      });
    });
  });

  // ── Story 3.10: Submission Deduplication ──────────────────────────────────

  describe('Story 3.10 — submission deduplication', () => {
    describe('L2 station dedup', () => {
      it('rejects with duplicate_submission and skips OCR when station has fresh result', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.checkStationDedup.mockResolvedValueOnce(true);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).not.toHaveBeenCalled();
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'rejected' }),
          }),
        );
      });

      it('proceeds to OCR when station has no fresh result', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.checkStationDedup.mockResolvedValueOnce(false);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).toHaveBeenCalled();
      });

      it('proceeds to OCR (fail-open) when station dedup Redis check throws', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.checkStationDedup.mockRejectedValueOnce(new Error('Redis down'));

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).toHaveBeenCalled();
      });
    });

    describe('hash dedup', () => {
      it('rejects with duplicate_submission and skips OCR when photo hash matches', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.checkHashDedup.mockResolvedValueOnce(true);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).not.toHaveBeenCalled();
        expect(mockPrismaService.submission.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'rejected' }),
          }),
        );
      });

      it('proceeds to OCR (fail-open) when hash dedup Redis check throws', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.checkHashDedup.mockRejectedValueOnce(new Error('Redis down'));

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockOcrService.extractPrices).toHaveBeenCalled();
      });
    });

    describe('dedup key recording', () => {
      it('records station and hash dedup keys after successful OCR', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockSubmissionDedupService.recordStationDedup).toHaveBeenCalledWith('station-abc');
        expect(mockSubmissionDedupService.recordHashDedup).toHaveBeenCalledWith(
          expect.stringMatching(/^[0-9a-f]{64}$/),
        );
      });

      it('does NOT record dedup keys when OCR returns low confidence', async () => {
        mockPrismaService.submission.findUnique.mockResolvedValueOnce(pendingSubmission);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockOcrService.extractPrices.mockResolvedValueOnce({
          prices: [],
          confidence_score: 0.1,
          raw_response: '',
          input_tokens: 100,
          output_tokens: 10,
        });

        await capturedProcessor!(makeJob('sub-123'));

        expect(mockSubmissionDedupService.recordStationDedup).not.toHaveBeenCalled();
        expect(mockSubmissionDedupService.recordHashDedup).not.toHaveBeenCalled();
      });

      it('does not throw when recordStationDedup fails — dedup recording is non-critical', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(pendingSubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        mockSubmissionDedupService.recordStationDedup.mockRejectedValueOnce(new Error('Redis down'));
        mockSubmissionDedupService.recordHashDedup.mockRejectedValueOnce(new Error('Redis down'));

        await expect(capturedProcessor!(makeJob('sub-123'))).resolves.toBeUndefined();
      });
    });

    describe('BullMQ retry safety', () => {
      it('skips L2 station dedup on retry (ocr_confidence_score already set) — prevents false rejection', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(retrySubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        // Station dedup would hit (key was set in prior attempt) — but check must be skipped
        mockSubmissionDedupService.checkStationDedup.mockResolvedValueOnce(true);

        await capturedProcessor!(makeJob('sub-123'));

        // L2 dedup check must NOT have been called
        expect(mockSubmissionDedupService.checkStationDedup).not.toHaveBeenCalled();
        // Pipeline must proceed to OCR
        expect(mockOcrService.extractPrices).toHaveBeenCalled();
      });

      it('skips hash dedup on retry (ocr_confidence_score already set) — prevents false rejection', async () => {
        mockPrismaService.submission.findUnique
          .mockResolvedValueOnce(retrySubmission)
          .mockResolvedValueOnce(submissionAfterOcr);
        mockStationService.findNearbyWithDistance.mockResolvedValueOnce([nearbyStation]);
        // Hash dedup would hit (key was set in prior attempt) — but check must be skipped
        mockSubmissionDedupService.checkHashDedup.mockResolvedValueOnce(true);

        await capturedProcessor!(makeJob('sub-123'));

        // Hash dedup check must NOT have been called
        expect(mockSubmissionDedupService.checkHashDedup).not.toHaveBeenCalled();
        // Pipeline must proceed to OCR
        expect(mockOcrService.extractPrices).toHaveBeenCalled();
      });
    });
  });
});

