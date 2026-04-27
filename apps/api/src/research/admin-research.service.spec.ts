import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';
import { AdminResearchService } from './admin-research.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const mockResearchPhoto = {
  findMany: jest.fn(),
  count: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
};
const mockTransaction = jest.fn();
const mockPrisma = { researchPhoto: mockResearchPhoto, $transaction: mockTransaction };
const mockStorage = { getPresignedUrl: jest.fn() };

const photoRow = {
  id: 'r1',
  submission_id: 'sub-1',
  r2_key: 'research/sub-1.jpg',
  station_id: 'station-1',
  ocr_prices: [{ fuel_type: 'PB_95', price_per_litre: 6.29 }],
  final_prices: [{ fuel_type: 'PB_95', price_per_litre: 6.29 }],
  actual_prices: null,
  label_notes: null,
  final_status: SubmissionStatus.verified,
  flag_reason: null,
  captured_at: new Date('2026-04-23T10:00:00Z'),
  retained_until: new Date('2026-05-23T10:00:00Z'),
  submission: { station: { name: 'ORLEN Warszawa' } },
};

describe('AdminResearchService', () => {
  let service: AdminResearchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminResearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = module.get(AdminResearchService);
  });

  describe('list', () => {
    it('returns paginated rows with presigned URL per photo', async () => {
      mockResearchPhoto.findMany.mockResolvedValueOnce([photoRow]);
      mockResearchPhoto.count.mockResolvedValueOnce(1);
      mockStorage.getPresignedUrl.mockResolvedValueOnce('https://r2.example.com/sub-1.jpg?sig=abc');

      const result = await service.list(20, 0);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'r1',
        submission_id: 'sub-1',
        station_id: 'station-1',
        station_name: 'ORLEN Warszawa',
        photo_url: 'https://r2.example.com/sub-1.jpg?sig=abc',
      });
    });

    it('filters to only unlabeled rows (SQL NULL) when requested', async () => {
      mockResearchPhoto.findMany.mockResolvedValueOnce([]);
      mockResearchPhoto.count.mockResolvedValueOnce(0);

      await service.list(20, 0, true);

      // Must use Prisma.AnyNull, not JsonNull. Default-inserted rows have
      // actual_prices as SQL NULL, not JSON literal null; AnyNull covers both
      // so the filter actually catches unlabeled rows.
      const findManyArgs = mockResearchPhoto.findMany.mock.calls[0][0] as { where: unknown };
      expect(findManyArgs.where).toEqual({ actual_prices: { equals: Prisma.AnyNull } });
    });

    it('returns photo_url = null when presign throws (does not block the whole list)', async () => {
      mockResearchPhoto.findMany.mockResolvedValueOnce([photoRow]);
      mockResearchPhoto.count.mockResolvedValueOnce(1);
      mockStorage.getPresignedUrl.mockRejectedValueOnce(new Error('r2 sign error'));

      const result = await service.list(20, 0);

      expect(result.data[0].photo_url).toBeNull();
      // Other fields still present
      expect(result.data[0].submission_id).toBe('sub-1');
    });
  });

  describe('label', () => {
    it('throws NotFoundException when the id does not exist', async () => {
      mockResearchPhoto.findUnique.mockResolvedValueOnce(null);

      await expect(service.label('missing', { actual_prices: {} })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockResearchPhoto.update).not.toHaveBeenCalled();
    });

    it('writes actual_prices and label_notes when provided', async () => {
      mockResearchPhoto.findUnique.mockResolvedValueOnce({ id: 'r1' });
      mockResearchPhoto.update.mockResolvedValueOnce({});

      await service.label('r1', {
        actual_prices: { PB_95: 6.3, ON: 6.59 },
        label_notes: 'clean photo, no occlusion',
      });

      expect(mockResearchPhoto.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({
          actual_prices: { PB_95: 6.3, ON: 6.59 },
          label_notes: 'clean photo, no occlusion',
        }),
      });
    });

    it('does not overwrite fields the caller omitted', async () => {
      mockResearchPhoto.findUnique.mockResolvedValueOnce({ id: 'r1' });
      mockResearchPhoto.update.mockResolvedValueOnce({});

      await service.label('r1', { label_notes: 'blurry' });

      const updateArg = mockResearchPhoto.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateArg.data).toEqual({ label_notes: 'blurry' });
      expect('actual_prices' in updateArg.data).toBe(false);
    });

    it('clears actual_prices when explicitly null', async () => {
      mockResearchPhoto.findUnique.mockResolvedValueOnce({ id: 'r1' });
      mockResearchPhoto.update.mockResolvedValueOnce({});

      await service.label('r1', { actual_prices: null });

      const updateArg = mockResearchPhoto.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateArg.data.actual_prices).toBe(Prisma.JsonNull);
    });
  });
});
