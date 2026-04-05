import { Test, TestingModule } from '@nestjs/testing';
import { TrustScoreService } from './trust-score.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockExecuteRaw = jest.fn();

const mockPrisma = {
  $executeRaw: mockExecuteRaw,
};

describe('TrustScoreService', () => {
  let service: TrustScoreService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockExecuteRaw.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustScoreService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(TrustScoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constants', () => {
    it('has correct delta values', () => {
      expect(TrustScoreService.DELTA_AUTO_VERIFIED).toBe(5);
      expect(TrustScoreService.DELTA_ADMIN_APPROVED).toBe(10);
      expect(TrustScoreService.DELTA_ADMIN_REJECTED).toBe(-10);
      expect(TrustScoreService.DELTA_SHADOW_REJECTED).toBe(-25);
      expect(TrustScoreService.MIN).toBe(0);
      expect(TrustScoreService.MAX).toBe(500);
    });
  });

  describe('updateScore', () => {
    it('calls $executeRaw with the userId and delta', async () => {
      await service.updateScore('user-1', 5);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('calls $executeRaw for negative delta', async () => {
      await service.updateScore('user-2', -25);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves without throwing when $executeRaw succeeds', async () => {
      await expect(service.updateScore('user-1', TrustScoreService.DELTA_AUTO_VERIFIED)).resolves.toBeUndefined();
    });

    it('propagates errors from $executeRaw', async () => {
      mockExecuteRaw.mockRejectedValue(new Error('DB error'));
      await expect(service.updateScore('user-1', 5)).rejects.toThrow('DB error');
    });
  });
});
