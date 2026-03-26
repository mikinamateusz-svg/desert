import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService } from './price-cache.service.js';

const mockPrisma = { $queryRaw: jest.fn() };

const mockPriceCache = {
  getMany: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  setAtomic: jest.fn(),
};

const now = new Date('2026-01-15T12:00:00.000Z');

const makeRow = (stationId: string) => ({
  stationId,
  prices: { PB_95: 6.42, ON: 6.89 },
  updatedAt: now,
  source: 'community' as const,
});

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceCacheService, useValue: mockPriceCache },
      ],
    }).compile();

    service = module.get<PriceService>(PriceService);
  });

  describe('findPricesInArea', () => {
    it('returns empty array when no stations in area', async () => {
      // Station discovery returns empty
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toEqual([]);
      expect(mockPriceCache.getMany).not.toHaveBeenCalled();
    });

    it('returns cached results without hitting DB for prices (AC1 — all cache hits)', async () => {
      const row1 = makeRow('station-1');
      const row2 = makeRow('station-2');

      // Station discovery
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'station-1' }, { id: 'station-2' }]);
      // All cache hits
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', row2]]),
      );

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      // Only one DB call (station discovery), no price DB query
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPriceCache.set).not.toHaveBeenCalled();
    });

    it('fetches misses from DB and writes to cache (AC2 — cache miss)', async () => {
      const row1 = makeRow('station-1');

      // Station discovery
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'station-1' }, { id: 'station-2' }]);
      // station-1 is a hit, station-2 is a miss
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', null]]),
      );
      // DB fetch for miss
      const row2 = makeRow('station-2');
      mockPrisma.$queryRaw.mockResolvedValueOnce([row2]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      // DB called twice: station discovery + price fetch for miss
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      // Miss written to cache
      expect(mockPriceCache.set).toHaveBeenCalledWith('station-2', row2);
    });

    it('returns only stations with verified prices (station in area but no price is excluded)', async () => {
      const row1 = makeRow('station-1');

      // Station discovery: 2 stations in area
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'station-1' }, { id: 'station-2' }]);
      // Both are cache misses
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', null], ['station-2', null]]),
      );
      // DB only returns price for station-1 (station-2 has no verified submission)
      mockPrisma.$queryRaw.mockResolvedValueOnce([row1]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0]?.stationId).toBe('station-1');
    });

    it('falls back to DB when Redis throws (AC5)', async () => {
      const row1 = makeRow('station-1');

      // Station discovery
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'station-1' }]);
      // Redis MGET throws
      mockPriceCache.getMany.mockRejectedValueOnce(new Error('Redis down'));
      // Fallback DB query
      mockPrisma.$queryRaw.mockResolvedValueOnce([row1]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0]?.stationId).toBe('station-1');
      expect(mockPriceCache.set).not.toHaveBeenCalled();
    });

    it('does not fail when cache set throws after a miss (error is swallowed)', async () => {
      const row1 = makeRow('station-1');

      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'station-1' }]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([row1]);
      // set throws — swallowed inside PriceCacheService.set, result still returned
      mockPriceCache.set.mockRejectedValueOnce(new Error('Redis write failed'));

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
    });

    it('returns all cache hits in original station order', async () => {
      const row1 = makeRow('station-1');
      const row2 = makeRow('station-2');
      const row3 = makeRow('station-3');

      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'station-1' },
        { id: 'station-2' },
        { id: 'station-3' },
      ]);
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', row2], ['station-3', row3]]),
      );

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result[0]?.stationId).toBe('station-1');
      expect(result[1]?.stationId).toBe('station-2');
      expect(result[2]?.stationId).toBe('station-3');
    });
  });

  describe('setVerifiedPrice', () => {
    it('delegates to priceCache.setAtomic (AC3)', async () => {
      mockPriceCache.setAtomic.mockResolvedValueOnce(undefined);
      const row = makeRow('station-1');

      await service.setVerifiedPrice('station-1', row);

      expect(mockPriceCache.setAtomic).toHaveBeenCalledWith('station-1', row);
    });

    it('propagates errors from setAtomic', async () => {
      mockPriceCache.setAtomic.mockRejectedValueOnce(new Error('EXEC failed'));
      const row = makeRow('station-1');

      await expect(service.setVerifiedPrice('station-1', row)).rejects.toThrow('EXEC failed');
    });
  });
});
