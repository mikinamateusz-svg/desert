import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionsService } from './submissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrismaService = {
  submission: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

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
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
  });

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
});
