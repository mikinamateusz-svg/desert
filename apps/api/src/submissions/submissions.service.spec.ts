import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { SubmissionsService } from './submissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';
import { SubmissionDedupService } from '../photo/submission-dedup.service.js';
import { PriceService } from '../price/price.service.js';
import { PriceCacheService } from '../price/price-cache.service.js';

const mockPrismaService = {
  submission: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  adminAuditLog: {
    create: jest.fn(),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: jest.fn((fn: (tx: any) => Promise<any>) => {
    const tx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { findUnique: (...args: any[]) => mockPrismaService.user.findUnique(...args) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      submission: { create: (...args: any[]) => mockPrismaService.submission.create(...args) },
    };
    return fn(tx);
  }),
};

const mockStorageService = {
  uploadBuffer: jest.fn(),
  getObjectBuffer: jest.fn(),
  deleteObject: jest.fn(),
};

const mockPhotoPipelineWorker = {
  enqueue: jest.fn(),
};

const mockSubmissionDedupService = {
  checkStationDedup: jest.fn(),
  liftDedup: jest.fn(),
};

const mockPriceService = {
  setVerifiedPrice: jest.fn(),
};

const mockPriceCacheService = {
  invalidate: jest.fn(),
};

// Stable UUID for assertions; preserve real createHash for SubmissionDedupService.computePhotoHash.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto') as typeof import('node:crypto');
  return {
    ...actual,
    randomUUID: jest.fn().mockReturnValue('fixed-uuid-1234'),
  };
});

const baseSubmission = {
  id: 'sub-uuid-1',
  user_id: 'user-uuid',
  station_id: 'station-uuid',
  station: { id: 'station-uuid', name: 'BP Warszawa Centrum' },
  price_data: [{ fuel_type: 'petrol_95', price_per_litre: 6.49 }],
  photo_r2_key: null,
  ocr_confidence_score: 0.95,
  status: 'verified' as const,
  created_at: new Date('2026-03-20T12:00:00Z'),
  updated_at: new Date('2026-03-20T12:00:00Z'),
};

describe('SubmissionsService', () => {
  let service: SubmissionsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockSubmissionDedupService.checkStationDedup.mockResolvedValue(false);
    mockSubmissionDedupService.liftDedup.mockResolvedValue(undefined);
    // Default: user is not shadow-banned
    mockPrismaService.user.findUnique.mockResolvedValue({ shadow_banned: false });
    // Default audit-log create resolves so flag-wrong tests don't have to set it
    mockPrismaService.adminAuditLog.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PhotoPipelineWorker, useValue: mockPhotoPipelineWorker },
        { provide: SubmissionDedupService, useValue: mockSubmissionDedupService },
        { provide: PriceService, useValue: mockPriceService },
        { provide: PriceCacheService, useValue: mockPriceCacheService },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
  });

  // ── getMySubmissions ────────────────────────────────────────────────────────

  describe('getMySubmissions', () => {
    it('should return paginated list with total', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([baseSubmission]);
      mockPrismaService.submission.count.mockResolvedValueOnce(1);

      const result = await service.getMySubmissions('user-uuid', 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data[0].station?.name).toBe('BP Warszawa Centrum');
      expect(result.data[0].price_data[0].price_per_litre).toBe(6.49);
    });

    it('launders shadow_rejected to pending when flag_reason is shadow_banned (Story 4.3 secrecy)', async () => {
      const shadowBannedSub = {
        ...baseSubmission,
        status: 'shadow_rejected' as const,
        flag_reason: 'shadow_banned' as const,
      };
      mockPrismaService.submission.findMany.mockResolvedValueOnce([shadowBannedSub]);
      mockPrismaService.submission.count.mockResolvedValueOnce(1);

      const result = await service.getMySubmissions('user-uuid', 1, 20);

      expect(result.data[0].status).toBe('pending');
      expect(result.data[0].flag_reason).toBeNull();
    });

    it('passes shadow_rejected through for non-shadow-banned reasons (Story 3.14 visibility)', async () => {
      const subs = [
        { ...baseSubmission, id: '1', status: 'verified' as const, flag_reason: null as string | null },
        { ...baseSubmission, id: '2', status: 'rejected' as const, flag_reason: null as string | null },
        { ...baseSubmission, id: '3', status: 'pending' as const, flag_reason: null as string | null },
        // user-flagged: visible
        { ...baseSubmission, id: '4', status: 'shadow_rejected' as const, flag_reason: 'user_flagged_wrong' as const },
        // shadow-banned: laundered
        { ...baseSubmission, id: '5', status: 'shadow_rejected' as const, flag_reason: 'shadow_banned' as const },
        // rule-based: visible
        { ...baseSubmission, id: '6', status: 'shadow_rejected' as const, flag_reason: 'pb95_outside_rack_band' as const },
      ];
      mockPrismaService.submission.findMany.mockResolvedValueOnce(subs);
      mockPrismaService.submission.count.mockResolvedValueOnce(6);

      const result = await service.getMySubmissions('user-uuid', 1, 20);
      const statuses = result.data.map((s) => s.status);

      expect(statuses).toEqual([
        'verified',
        'rejected',
        'pending',
        'shadow_rejected',
        'pending', // shadow_banned → laundered
        'shadow_rejected',
      ]);
      // user_flagged_wrong row exposes its flag_reason
      expect(result.data[3].flag_reason).toBe('user_flagged_wrong');
      // shadow_banned row hides its flag_reason
      expect(result.data[4].flag_reason).toBeNull();
      // rule-based row exposes its flag_reason
      expect(result.data[5].flag_reason).toBe('pb95_outside_rack_band');
    });

    it('should apply correct skip/take for page 2', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);
      mockPrismaService.submission.count.mockResolvedValueOnce(25);

      await service.getMySubmissions('user-uuid', 2, 10);

      expect(mockPrismaService.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should return empty price_data array when price_data is not an array', async () => {
      const malformedSub = { ...baseSubmission, price_data: null };
      mockPrismaService.submission.findMany.mockResolvedValueOnce([malformedSub]);
      mockPrismaService.submission.count.mockResolvedValueOnce(1);

      const result = await service.getMySubmissions('user-uuid', 1, 20);

      expect(result.data[0].price_data).toEqual([]);
    });

    it('should return empty data array when user has no submissions', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);
      mockPrismaService.submission.count.mockResolvedValueOnce(0);

      const result = await service.getMySubmissions('user-uuid', 1, 20);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should query only submissions belonging to the given userId', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);
      mockPrismaService.submission.count.mockResolvedValueOnce(0);

      await service.getMySubmissions('specific-user-id', 1, 20);

      expect(mockPrismaService.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'specific-user-id' } }),
      );
      expect(mockPrismaService.submission.count).toHaveBeenCalledWith({
        where: { user_id: 'specific-user-id' },
      });
    });

    it('should order submissions by created_at descending', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);
      mockPrismaService.submission.count.mockResolvedValueOnce(0);

      await service.getMySubmissions('user-uuid', 1, 20);

      expect(mockPrismaService.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { created_at: 'desc' } }),
      );
    });
  });

  // ── createSubmission ────────────────────────────────────────────────────────

  describe('createSubmission', () => {
    const photoBuffer = Buffer.from('fake-jpeg-bytes');
    const baseFields = {
      fuelType: 'PB_95',
      gpsLat: 52.2297,
      gpsLng: 21.0122,
      manualPrice: null,
      preselectedStationId: null,
    };

    beforeEach(() => {
      mockStorageService.uploadBuffer.mockResolvedValue(undefined);
      mockStorageService.deleteObject.mockResolvedValue(undefined);
      mockPrismaService.submission.create.mockResolvedValue({});
      mockPrismaService.submission.delete.mockResolvedValue({});
      mockPhotoPipelineWorker.enqueue.mockResolvedValue(undefined);
    });

    it('uploads photo to R2 with correct key and content type', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockStorageService.uploadBuffer).toHaveBeenCalledWith(
        'submissions/user-abc/fixed-uuid-1234.jpg',
        photoBuffer,
        'image/jpeg',
      );
    });

    it('creates Submission record with correct data', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'fixed-uuid-1234',
          user_id: 'user-abc',
          photo_r2_key: 'submissions/user-abc/fixed-uuid-1234.jpg',
          gps_lat: 52.2297,
          gps_lng: 21.0122,
          status: 'pending',
        }),
      });
    });

    it('stores fuel_type in price_data with null price when no manualPrice', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          price_data: [{ fuel_type: 'PB_95', price_per_litre: null }],
        }),
      });
    });

    it('stores manual_price in price_data when provided', async () => {
      await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        manualPrice: 6.54,
      });

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.54 }],
        }),
      });
    });

    it('sets station_id from preselectedStationId when provided', async () => {
      await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        preselectedStationId: 'station-xyz',
      });

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ station_id: 'station-xyz' }),
      });
    });

    it('sets station_id to null when preselectedStationId is null', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ station_id: null }),
      });
    });

    it('stores null gps_lat/gps_lng when GPS not available', async () => {
      await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        gpsLat: null,
        gpsLng: null,
      });

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gps_lat: null, gps_lng: null }),
      });
    });

    it('enqueues BullMQ job with the new submissionId', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockPhotoPipelineWorker.enqueue).toHaveBeenCalledWith('fixed-uuid-1234');
    });

    it('AC3: does not create Submission when R2 upload throws', async () => {
      mockStorageService.uploadBuffer.mockRejectedValueOnce(new Error('R2 unavailable'));

      await expect(service.createSubmission('user-abc', photoBuffer, baseFields)).rejects.toThrow(
        'R2 unavailable',
      );

      expect(mockPrismaService.submission.create).not.toHaveBeenCalled();
      expect(mockPhotoPipelineWorker.enqueue).not.toHaveBeenCalled();
    });

    it('returns void on success', async () => {
      const result = await service.createSubmission('user-abc', photoBuffer, baseFields);
      expect(result).toBeUndefined();
    });

    it('rolls back DB record and R2 object when BullMQ enqueue fails', async () => {
      mockPhotoPipelineWorker.enqueue.mockRejectedValueOnce(new Error('Redis unavailable'));

      await expect(service.createSubmission('user-abc', photoBuffer, baseFields)).rejects.toThrow(
        'Redis unavailable',
      );

      expect(mockPrismaService.submission.delete).toHaveBeenCalledWith({
        where: { id: 'fixed-uuid-1234' },
      });
      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        'submissions/user-abc/fixed-uuid-1234.jpg',
      );
    });

    it('deletes orphan R2 object when DB create fails', async () => {
      mockPrismaService.submission.create.mockRejectedValueOnce(new Error('DB constraint'));

      await expect(service.createSubmission('user-abc', photoBuffer, baseFields)).rejects.toThrow(
        'DB constraint',
      );

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        'submissions/user-abc/fixed-uuid-1234.jpg',
      );
      expect(mockPhotoPipelineWorker.enqueue).not.toHaveBeenCalled();
    });

    // ── Story 3.10: L1 station dedup ─────────────────────────────────────────

    it('L1 dedup hit: returns early without R2 upload when preselected station has fresh result', async () => {
      mockSubmissionDedupService.checkStationDedup.mockResolvedValueOnce(true);

      const result = await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        preselectedStationId: 'station-xyz',
      });

      expect(result).toBeUndefined();
      expect(mockStorageService.uploadBuffer).not.toHaveBeenCalled();
      expect(mockPrismaService.submission.create).not.toHaveBeenCalled();
      expect(mockPhotoPipelineWorker.enqueue).not.toHaveBeenCalled();
    });

    it('L1 dedup miss: proceeds normally when no fresh result for preselected station', async () => {
      mockSubmissionDedupService.checkStationDedup.mockResolvedValueOnce(false);

      await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        preselectedStationId: 'station-xyz',
      });

      expect(mockStorageService.uploadBuffer).toHaveBeenCalled();
      expect(mockPrismaService.submission.create).toHaveBeenCalled();
    });

    it('L1 dedup Redis error: proceeds normally (fail-open)', async () => {
      mockSubmissionDedupService.checkStationDedup.mockRejectedValueOnce(new Error('Redis down'));

      await service.createSubmission('user-abc', photoBuffer, {
        ...baseFields,
        preselectedStationId: 'station-xyz',
      });

      expect(mockStorageService.uploadBuffer).toHaveBeenCalled();
      expect(mockPrismaService.submission.create).toHaveBeenCalled();
    });

    it('L1 dedup skipped for GPS path (no preselectedStationId)', async () => {
      await service.createSubmission('user-abc', photoBuffer, baseFields); // preselectedStationId: null

      expect(mockSubmissionDedupService.checkStationDedup).not.toHaveBeenCalled();
      expect(mockStorageService.uploadBuffer).toHaveBeenCalled();
    });

    it('shadow-ban short-circuit creates shadow_rejected record and returns without uploading', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ shadow_banned: true });

      await service.createSubmission('user-abc', photoBuffer, baseFields);

      expect(mockPrismaService.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'user-abc',
          status: 'shadow_rejected',
          flag_reason: 'shadow_banned',
        }),
      });
      expect(mockStorageService.uploadBuffer).not.toHaveBeenCalled();
      expect(mockPhotoPipelineWorker.enqueue).not.toHaveBeenCalled();
    });
  });

  // ── flagWrong (Story 3.14) ──────────────────────────────────────────────────

  describe('flagWrong', () => {
    const subId = 'sub-flag-1';
    const userId = 'user-flag-1';
    const stationId = 'station-flag-1';
    const recentCreatedAt = new Date(Date.now() - 60_000); // 1 min ago

    const verifiedSub = {
      id: subId,
      user_id: userId,
      station_id: stationId,
      photo_r2_key: `submissions/${userId}/${subId}.jpg`,
      status: 'verified' as const,
      created_at: recentCreatedAt,
    };

    beforeEach(() => {
      // Outer beforeEach already ran jest.clearAllMocks(); just install defaults.
      mockPrismaService.submission.findUnique.mockResolvedValue(verifiedSub);
      mockPrismaService.submission.updateMany.mockResolvedValue({ count: 1 });
      mockStorageService.getObjectBuffer.mockResolvedValue(Buffer.from('fake-photo-bytes'));
      mockPriceService.setVerifiedPrice.mockResolvedValue(undefined);
      mockPriceCacheService.invalidate.mockResolvedValue(undefined);
      mockSubmissionDedupService.liftDedup.mockResolvedValue(undefined);
      mockPrismaService.adminAuditLog.create.mockResolvedValue({});
      // Default: no previous verified submission
      mockPrismaService.submission.findFirst.mockResolvedValue(null);
    });

    it('happy path: transitions verified → shadow_rejected, lifts dedup, writes audit log', async () => {
      // Make extra sure the buffer mock is in place for this test
      mockStorageService.getObjectBuffer.mockResolvedValueOnce(Buffer.from('photo-bytes-abc'));

      await service.flagWrong(subId, userId, UserRole.DRIVER);

      expect(mockPrismaService.submission.updateMany).toHaveBeenCalledWith({
        where: { id: subId, status: 'verified' },
        data: { status: 'shadow_rejected', flag_reason: 'user_flagged_wrong' },
      });
      expect(mockStorageService.getObjectBuffer).toHaveBeenCalledWith(verifiedSub.photo_r2_key);
      expect(mockSubmissionDedupService.liftDedup).toHaveBeenCalledWith(stationId, expect.any(String));
      expect(mockPrismaService.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: userId,
          action: 'USER_FLAGGED_WRONG',
          submission_id: subId,
        }),
      });
    });

    it('throws NotFoundException when submission does not exist', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce(null);
      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).rejects.toThrow(
        /not found/i,
      );
    });

    it('throws ForbiddenException when caller is not the owner', async () => {
      await expect(service.flagWrong(subId, 'other-user', UserRole.DRIVER)).rejects.toThrow(
        /does not belong to caller/i,
      );
    });

    it('throws ConflictException when submission is not verified', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce({
        ...verifiedSub,
        status: 'shadow_rejected',
      });
      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).rejects.toThrow(
        /only verified is supported/i,
      );
    });

    it('throws BadRequestException for non-admin when submission is older than 24h', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce({
        ...verifiedSub,
        created_at: new Date(Date.now() - 25 * 3600 * 1000),
      });
      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).rejects.toThrow(
        /older than 24h/i,
      );
    });

    it('admin can flag own submission outside the 24h window', async () => {
      mockPrismaService.submission.findUnique.mockResolvedValueOnce({
        ...verifiedSub,
        created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000), // 30 days old
      });
      await expect(service.flagWrong(subId, userId, 'ADMIN' as never)).resolves.toBeUndefined();
      expect(mockPrismaService.submission.updateMany).toHaveBeenCalled();
    });

    it('throws ConflictException on concurrent modification (updateMany count = 0)', async () => {
      mockPrismaService.submission.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).rejects.toThrow(
        /modified concurrently/i,
      );
    });

    it('restores previous verified submission prices when one exists', async () => {
      const prevSub = {
        id: 'sub-prev',
        price_data: [
          { fuel_type: 'PB_95', price_per_litre: 6.40 },
          { fuel_type: 'ON', price_per_litre: 6.90 },
        ],
        created_at: new Date('2026-05-04T10:00:00Z'),
      };
      mockPrismaService.submission.findFirst.mockResolvedValueOnce(prevSub);

      await service.flagWrong(subId, userId, UserRole.DRIVER);

      expect(mockPriceService.setVerifiedPrice).toHaveBeenCalledWith(
        stationId,
        expect.objectContaining({
          stationId,
          prices: { PB_95: 6.40, ON: 6.90 },
          sources: { PB_95: 'community', ON: 'community' },
        }),
      );
    });

    it('invalidates cache when no previous verified submission exists', async () => {
      mockPrismaService.submission.findFirst.mockResolvedValueOnce(null);

      await service.flagWrong(subId, userId, UserRole.DRIVER);

      expect(mockPriceCacheService.invalidate).toHaveBeenCalledWith(stationId);
      expect(mockPriceService.setVerifiedPrice).not.toHaveBeenCalled();
    });

    it('continues without throwing when photo R2 fetch fails (still lifts station dedup)', async () => {
      mockStorageService.getObjectBuffer.mockRejectedValueOnce(new Error('R2 down'));

      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).resolves.toBeUndefined();
      // station_id passed, but photoHash is null since hash compute failed
      expect(mockSubmissionDedupService.liftDedup).toHaveBeenCalledWith(stationId, null);
    });

    it('does not throw when audit log write fails (best-effort)', async () => {
      mockPrismaService.adminAuditLog.create.mockRejectedValueOnce(new Error('DB hiccup'));
      await expect(service.flagWrong(subId, userId, UserRole.DRIVER)).resolves.toBeUndefined();
    });
  });

  // ── autoResolveFlaggedAtStation (Story 3.14 AC6) ───────────────────────────

  describe('autoResolveFlaggedAtStation', () => {
    beforeEach(() => {
      mockPrismaService.submission.findMany.mockReset();
      mockPrismaService.submission.updateMany.mockReset();
      mockPrismaService.adminAuditLog.create.mockReset();
      mockPrismaService.adminAuditLog.create.mockResolvedValue({});
    });

    const triggeringCreatedAt = new Date('2026-05-03T12:00:00Z');

    it('is a no-op when no flagged submissions exist for this user+station', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);

      await service.autoResolveFlaggedAtStation('user-1', 'station-1', 'sub-trigger', triggeringCreatedAt);

      expect(mockPrismaService.submission.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects matching flagged submissions with auto_resolved_by_resubmit reason', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([
        { id: 'flagged-1' },
        { id: 'flagged-2' },
      ]);
      mockPrismaService.submission.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.autoResolveFlaggedAtStation('user-1', 'station-1', 'sub-trigger', triggeringCreatedAt);

      // P-5: updateMany guards on status + flag_reason to avoid clobbering
      // a row an admin moved between findMany and updateMany.
      expect(mockPrismaService.submission.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['flagged-1', 'flagged-2'] },
          status: 'shadow_rejected',
          flag_reason: 'user_flagged_wrong',
        },
        data: { status: 'rejected', flag_reason: 'auto_resolved_by_resubmit' },
      });
      // Audit log for each
      expect(mockPrismaService.adminAuditLog.create).toHaveBeenCalledTimes(2);
    });

    it('excludes the triggering submission from the lookup', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([]);

      await service.autoResolveFlaggedAtStation('user-1', 'station-1', 'sub-trigger', triggeringCreatedAt);

      expect(mockPrismaService.submission.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: { not: 'sub-trigger' },
          user_id: 'user-1',
          station_id: 'station-1',
          status: 'shadow_rejected',
          flag_reason: 'user_flagged_wrong',
          // P-6: only flags filed BEFORE the triggering submission was captured
          created_at: expect.objectContaining({ lt: triggeringCreatedAt }),
        }),
        select: { id: true },
      });
    });

    it('does not auto-resolve when admin moved the row between findMany and updateMany (P-5)', async () => {
      mockPrismaService.submission.findMany.mockResolvedValueOnce([{ id: 'flagged-1' }]);
      mockPrismaService.submission.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.autoResolveFlaggedAtStation('user-1', 'station-1', 'sub-trigger', triggeringCreatedAt);

      // No audit row written when nothing actually changed
      expect(mockPrismaService.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });
});
