import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { EstimatedPriceService } from './estimated-price.service.js';

const mockPrisma = { $queryRaw: jest.fn() };

const mockPriceCache = {
  getMany: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  setAtomic: jest.fn(),
};

const mockEstimatedPriceService = {
  computeEstimatesForStations: jest.fn(),
};

const now = new Date('2026-01-15T12:00:00.000Z');

const makeStation = (id: string) => ({
  id,
  brand: 'orlen',
  station_type: 'standard' as const,
  voivodeship: 'mazowieckie',
  settlement_tier: 'city' as const,
  is_border_zone_de: false,
});

// StationPriceRow shape (post-conversion, used for cache results and assertions)
const makeRow = (stationId: string) => ({
  stationId,
  prices: { PB_95: 6.42, ON: 6.89, LPG: 2.89 },
  sources: { PB_95: 'community' as const, ON: 'community' as const, LPG: 'community' as const },
  updatedAt: now,
});

// DB row shape (scalar source, as returned by findPricesByStationIds raw query)
const makeDbRow = (stationId: string) => ({
  stationId,
  prices: { PB_95: 6.42, ON: 6.89, LPG: 2.89 },
  source: 'community' as const,
  updatedAt: now,
});

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no estimated prices (empty map)
    mockEstimatedPriceService.computeEstimatesForStations.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceCacheService, useValue: mockPriceCache },
        { provide: EstimatedPriceService, useValue: mockEstimatedPriceService },
      ],
    }).compile();

    service = module.get<PriceService>(PriceService);
  });

  describe('findPricesInArea', () => {
    it('returns empty array when no stations in area', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toEqual([]);
      expect(mockPriceCache.getMany).not.toHaveBeenCalled();
    });

    it('returns cached results without hitting DB for prices (all cache hits)', async () => {
      const row1 = makeRow('station-1');
      const row2 = makeRow('station-2');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1'), makeStation('station-2')]);
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', row2]]),
      );

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPriceCache.set).not.toHaveBeenCalled();
    });

    it('fetches misses from DB and writes to cache (cache miss)', async () => {
      const row1 = makeRow('station-1');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1'), makeStation('station-2')]);
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', null]]),
      );
      const dbRow2 = makeDbRow('station-2');
      mockPrisma.$queryRaw.mockResolvedValueOnce([dbRow2]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      // cache.set receives the converted StationPriceRow (sources map, no scalar source)
      expect(mockPriceCache.set).toHaveBeenCalledWith('station-2', expect.objectContaining({
        stationId: 'station-2',
        sources: { PB_95: 'community', ON: 'community', LPG: 'community' },
      }));
    });

    it('appends estimated prices for stations with no community price', async () => {
      const row1 = makeRow('station-1');
      const estimatedRow = {
        stationId: 'station-2',
        prices: { PB_95: 6.06 },
        priceRanges: { PB_95: { low: 5.91, high: 6.21 } },
        estimateLabel: { PB_95: 'market_estimate' as const },
        sources: { PB_95: 'seeded' as const },
        updatedAt: now,
      };

      // station discovery returns 2 stations
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1'), makeStation('station-2')]);
      // station-1 cache hit, station-2 miss
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([['station-1', row1], ['station-2', null]]),
      );
      // DB only has verified price for station-1
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      // estimated service returns price for station-2
      mockEstimatedPriceService.computeEstimatesForStations.mockResolvedValueOnce(
        new Map([['station-2', estimatedRow]]),
      );

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      const estimated = result.find(r => r.stationId === 'station-2');
      expect(estimated?.sources?.PB_95).toBe('seeded');
      expect(estimated?.estimateLabel?.PB_95).toBe('market_estimate');
      expect(estimated?.priceRanges).toBeDefined();
    });

    it('does not call estimatedPriceService when all stations have community prices', async () => {
      const row1 = makeRow('station-1');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', row1]]));

      await service.findPricesInArea(52.23, 21.01, 25000);

      expect(mockEstimatedPriceService.computeEstimatesForStations).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis throws, then computes estimated for uncovered', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1'), makeStation('station-2')]);
      mockPriceCache.getMany.mockRejectedValueOnce(new Error('Redis down'));
      // DB only returns price for station-1
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-1')]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1); // station-2 has no community price, estimated returns empty by default
      expect(mockPriceCache.set).not.toHaveBeenCalled();
    });

    it('does not fail when cache set throws after a miss (error is swallowed)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-1')]);
      mockPriceCache.set.mockRejectedValueOnce(new Error('Redis write failed'));

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
    });

    it('returns all cache hits in original station order', async () => {
      const row1 = makeRow('station-1');
      const row2 = makeRow('station-2');
      const row3 = makeRow('station-3');

      mockPrisma.$queryRaw.mockResolvedValueOnce([
        makeStation('station-1'),
        makeStation('station-2'),
        makeStation('station-3'),
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
