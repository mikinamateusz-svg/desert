import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

const mockPrismaService = {
  submission: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
};

const mockStorageService = {
  uploadBuffer: jest.fn(),
  deleteObject: jest.fn(),
};

const mockPhotoPipelineWorker = {
  enqueue: jest.fn(),
};

// Stable UUID for assertions
jest.mock('node:crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fixed-uuid-1234'),
}));

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PhotoPipelineWorker, useValue: mockPhotoPipelineWorker },
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

    it('should map shadow_rejected status to pending', async () => {
      const shadowBannedSub = { ...baseSubmission, status: 'shadow_rejected' as const };
      mockPrismaService.submission.findMany.mockResolvedValueOnce([shadowBannedSub]);
      mockPrismaService.submission.count.mockResolvedValueOnce(1);

      const result = await service.getMySubmissions('user-uuid', 1, 20);

      expect(result.data[0].status).toBe('pending');
    });

    it('should not expose shadow_rejected — only pending/verified/rejected in response', async () => {
      const subs = [
        { ...baseSubmission, id: '1', status: 'verified' as const },
        { ...baseSubmission, id: '2', status: 'rejected' as const },
        { ...baseSubmission, id: '3', status: 'pending' as const },
        { ...baseSubmission, id: '4', status: 'shadow_rejected' as const },
      ];
      mockPrismaService.submission.findMany.mockResolvedValueOnce(subs);
      mockPrismaService.submission.count.mockResolvedValueOnce(4);

      const result = await service.getMySubmissions('user-uuid', 1, 20);
      const statuses = result.data.map((s) => s.status);

      expect(statuses).toEqual(['verified', 'rejected', 'pending', 'pending']);
      expect(statuses).not.toContain('shadow_rejected');
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
  });
});
