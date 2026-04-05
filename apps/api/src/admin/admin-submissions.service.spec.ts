import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { StorageService } from '../storage/storage.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSubmissionFindMany = jest.fn();
const mockSubmissionCount = jest.fn();
const mockSubmissionFindUnique = jest.fn();
const mockSubmissionUpdateMany = jest.fn();
const mockStalenessDeleteMany = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  submission: {
    findMany: mockSubmissionFindMany,
    count: mockSubmissionCount,
    findUnique: mockSubmissionFindUnique,
    updateMany: mockSubmissionUpdateMany,
  },
  stationFuelStaleness: { deleteMany: mockStalenessDeleteMany },
  adminAuditLog: { create: mockAuditLogCreate },
  $transaction: mockTransaction,
};

const mockSetVerifiedPrice = jest.fn();
const mockPriceService = { setVerifiedPrice: mockSetVerifiedPrice };

const mockDeleteObject = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockStorage = { deleteObject: mockDeleteObject, getPresignedUrl: mockGetPresignedUrl };

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_ID = 'admin-uuid-1';
const SUB_ID = 'sub-uuid-1';
const STATION_ID = 'station-uuid-1';

const makeShadowRejected = (overrides = {}) => ({
  id: SUB_ID,
  station_id: STATION_ID,
  price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
  photo_r2_key: 'submissions/user/sub.jpg',
  flag_reason: 'logo_mismatch',
  status: SubmissionStatus.shadow_rejected,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminSubmissionsService', () => {
  let service: AdminSubmissionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockTransaction.mockImplementation((fns: unknown[]) =>
      Promise.all((fns as Array<Promise<unknown>>).map((f) => f)),
    );
    mockAuditLogCreate.mockResolvedValue({});
    mockStalenessDeleteMany.mockResolvedValue({ count: 0 });
    mockSetVerifiedPrice.mockResolvedValue(undefined);
    mockDeleteObject.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://r2.example.com/presigned');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSubmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceService, useValue: mockPriceService },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(AdminSubmissionsService);
  });

  // ── listFlagged ─────────────────────────────────────────────────────────────

  describe('listFlagged', () => {
    it('returns paginated shadow_rejected submissions', async () => {
      const sub = {
        id: SUB_ID,
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-04-01'),
        user_id: 'user-1',
        flag_reason: 'logo_mismatch',
        station: { name: 'ORLEN Warszawa' },
      };
      mockTransaction.mockResolvedValue([[sub], 1]);

      const result = await service.listFlagged(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].station_name).toBe('ORLEN Warszawa');
      expect(result.data[0].flag_reason).toBe('logo_mismatch');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('falls back to logo_mismatch when flag_reason is null (legacy rows)', async () => {
      mockTransaction.mockResolvedValue([
        [{ id: SUB_ID, station_id: STATION_ID, price_data: [], ocr_confidence_score: null, created_at: new Date(), user_id: 'u1', flag_reason: null, station: null }],
        1,
      ]);
      const result = await service.listFlagged(1, 20);
      expect(result.data[0].flag_reason).toBe('logo_mismatch');
    });

    it('maps null station to null station_name', async () => {
      mockTransaction.mockResolvedValue([
        [{ id: SUB_ID, station_id: null, price_data: [], ocr_confidence_score: null, created_at: new Date(), user_id: 'u1', flag_reason: null, station: null }],
        1,
      ]);

      const result = await service.listFlagged(1, 20);
      expect(result.data[0].station_name).toBeNull();
    });
  });

  // ── getDetail ───────────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.getDetail('unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for non-shadow_rejected submission', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        status: SubmissionStatus.verified,
        station: null,
      });
      await expect(service.getDetail(SUB_ID)).rejects.toThrow(ConflictException);
    });

    it('returns detail for shadow_rejected submission with presigned photo_url', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        station: { name: 'BP Kraków', brand: 'BP' },
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.station_brand).toBe('BP');
      expect(detail.flag_reason).toBe('logo_mismatch');
      expect(detail.photo_url).toBe('https://r2.example.com/presigned');
      expect(mockGetPresignedUrl).toHaveBeenCalledWith('submissions/user/sub.jpg', 3600);
    });

    it('returns null photo_url when photo_r2_key is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ photo_r2_key: null }),
        station: { name: 'BP Kraków', brand: 'BP' },
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.photo_url).toBeNull();
      expect(mockGetPresignedUrl).not.toHaveBeenCalled();
    });

    it('returns null photo_url and logs warn when presigned URL generation fails', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        station: { name: 'BP Kraków', brand: 'BP' },
      });
      mockGetPresignedUrl.mockRejectedValue(new Error('R2 error'));

      const detail = await service.getDetail(SUB_ID);
      expect(detail.photo_url).toBeNull();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('throws NotFoundException when submission does not exist', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already reviewed', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        status: SubmissionStatus.verified,
      });
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when station_id is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected({ station_id: null }));
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when concurrent admin acts first (updateMany returns 0)', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
    });

    it('happy path: updates status, publishes price, clears staleness, writes audit, deletes photo', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.approve(SUB_ID, ADMIN_ID);

      expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: SubmissionStatus.shadow_rejected },
        data: { status: SubmissionStatus.verified, photo_r2_key: null, gps_lat: null, gps_lng: null },
      });
      expect(mockSetVerifiedPrice).toHaveBeenCalledWith(
        STATION_ID,
        expect.objectContaining({
          stationId: STATION_ID,
          prices: { PB_95: 6.5 },
          sources: { PB_95: 'community' },
        }),
      );
      expect(mockStalenessDeleteMany).toHaveBeenCalledWith({
        where: { station_id: STATION_ID, fuel_type: { in: ['PB_95'] } },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: { admin_user_id: ADMIN_ID, action: 'APPROVE', submission_id: SUB_ID, notes: null },
      });
      expect(mockDeleteObject).toHaveBeenCalledWith('submissions/user/sub.jpg');
    });

    it('continues if price service fails (cache self-heals from DB)', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
      mockSetVerifiedPrice.mockRejectedValue(new Error('Redis down'));

      await expect(service.approve(SUB_ID, ADMIN_ID)).resolves.not.toThrow();
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });

    it('logs OPS-ALERT but does not throw if audit log write fails', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
      mockAuditLogCreate.mockRejectedValue(new Error('DB write failed'));

      await expect(service.approve(SUB_ID, ADMIN_ID)).resolves.not.toThrow();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('[OPS-ALERT]'),
      );
    });

    it('skips R2 delete when photo_r2_key is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected({ photo_r2_key: null }));
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.approve(SUB_ID, ADMIN_ID);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  // ── reject ──────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('throws NotFoundException when submission does not exist', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.reject(SUB_ID, ADMIN_ID, null)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when concurrent admin acts first', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.reject(SUB_ID, ADMIN_ID, null)).rejects.toThrow(ConflictException);
    });

    it('happy path: updates status, writes audit with notes, deletes photo', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.reject(SUB_ID, ADMIN_ID, 'Wrong station');

      expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: SubmissionStatus.shadow_rejected },
        data: { status: SubmissionStatus.rejected, gps_lat: null, gps_lng: null },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          admin_user_id: ADMIN_ID,
          action: 'REJECT',
          submission_id: SUB_ID,
          notes: 'Wrong station',
        },
      });
      expect(mockDeleteObject).toHaveBeenCalled();
    });

    it('does not call setVerifiedPrice on reject', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.reject(SUB_ID, ADMIN_ID, null);
      expect(mockSetVerifiedPrice).not.toHaveBeenCalled();
    });
  });
});
