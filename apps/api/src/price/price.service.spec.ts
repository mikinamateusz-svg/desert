import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { EstimatedPriceService } from './estimated-price.service.js';
import { PriceHistoryService } from './price-history.service.js';
import { StalenessDetectionService } from '../market-signal/staleness-detection.service.js';

const mockPrisma = { $queryRaw: jest.fn() };

const mockPriceCache = {
  getMany: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  setAtomic: jest.fn(),
};

const mockEstimatedPriceService = {
  computeEstimatesForStations: jest.fn(),
};

const mockPriceHistory = {
  recordPrices: jest.fn().mockResolvedValue(undefined),
};

// Story 2.17 — default: no stale flags for anything. Per-test mocks can
// override to assert the per-fuel fold is correct.
const mockStalenessService = {
  getStaleFuelsForStations: jest.fn().mockResolvedValue(new Map()),
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

// DB row shape (scalar source, JSON array as returned by findPricesByStationIds
// raw query — Submission.price_data is an array of {fuel_type, price_per_litre}).
const makeDbRow = (stationId: string) => ({
  stationId,
  priceData: [
    { fuel_type: 'PB_95', price_per_litre: 6.42 },
    { fuel_type: 'ON',    price_per_litre: 6.89 },
    { fuel_type: 'LPG',   price_per_litre: 2.89 },
  ],
  source: 'community' as const,
  updatedAt: now,
});

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no estimated prices (empty map)
    mockEstimatedPriceService.computeEstimatesForStations.mockResolvedValue(new Map());

    // Story 2.17 — reset the staleness mock default to "no flags" so
    // tests that don't set it explicitly get the existing pre-2.17
    // behaviour.
    mockStalenessService.getStaleFuelsForStations.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceCacheService, useValue: mockPriceCache },
        { provide: EstimatedPriceService, useValue: mockEstimatedPriceService },
        { provide: PriceHistoryService, useValue: mockPriceHistory },
        { provide: StalenessDetectionService, useValue: mockStalenessService },
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
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // admin_override query

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3); // station discovery + submission query + admin_override query
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
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // admin_override query
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
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // admin_override query

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1); // station-2 has no community price, estimated returns empty by default
      expect(mockPriceCache.set).not.toHaveBeenCalled();
    });

    it('does not fail when cache set throws after a miss (error is swallowed)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-1')]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // admin_override query
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

  describe('admin_override merge in findPricesByStationIds', () => {
    it('overlays admin_override price when override is newer than submission', async () => {
      const submissionDate = new Date('2026-04-01T10:00:00Z');
      const overrideDate  = new Date('2026-04-06T09:00:00Z');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      // Submission: PB_95=6.20, ON=5.80
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          stationId: 'station-1',
          priceData: [
            { fuel_type: 'PB_95', price_per_litre: 6.20 },
            { fuel_type: 'ON',    price_per_litre: 5.80 },
          ],
          updatedAt: submissionDate,
          source: 'community',
        },
      ]);
      // Admin override: PB_95=6.50, newer
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { stationId: 'station-1', fuelType: 'PB_95', price: 6.50, recordedAt: overrideDate },
      ]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0]?.prices['PB_95']).toBe(6.50);
      expect(result[0]?.sources['PB_95']).toBe('admin_override');
      expect(result[0]?.prices['ON']).toBe(5.80);
      expect(result[0]?.sources['ON']).toBe('community');
    });

    it('ignores admin_override when it is older than the submission', async () => {
      const overrideDate  = new Date('2026-04-01T08:00:00Z');
      const submissionDate = new Date('2026-04-01T10:00:00Z');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          stationId: 'station-1',
          priceData: [{ fuel_type: 'PB_95', price_per_litre: 6.35 }],
          updatedAt: submissionDate,
          source: 'community',
        },
      ]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { stationId: 'station-1', fuelType: 'PB_95', price: 6.50, recordedAt: overrideDate },
      ]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result[0]?.prices['PB_95']).toBe(6.35);
      expect(result[0]?.sources['PB_95']).toBe('community');
    });

    it('serves admin_override-only station when no verified submission exists', async () => {
      const overrideDate = new Date('2026-04-06T09:00:00Z');

      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // no verified submission
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { stationId: 'station-1', fuelType: 'PB_95', price: 6.50, recordedAt: overrideDate },
      ]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0]?.prices['PB_95']).toBe(6.50);
      expect(result[0]?.sources['PB_95']).toBe('admin_override');
    });
  });

  describe('setVerifiedPrice', () => {
    it('records price history before writing to cache (AC1)', async () => {
      mockPriceCache.setAtomic.mockResolvedValueOnce(undefined);
      const row = makeRow('station-1');

      await service.setVerifiedPrice('station-1', row);

      expect(mockPriceHistory.recordPrices).toHaveBeenCalledWith('station-1', row);
    });

    it('delegates to priceCache.setAtomic (AC3)', async () => {
      mockPriceCache.setAtomic.mockResolvedValueOnce(undefined);
      const row = makeRow('station-1');

      await service.setVerifiedPrice('station-1', row);

      expect(mockPriceCache.setAtomic).toHaveBeenCalledWith('station-1', row);
    });

    it('calls recordPrices before setAtomic (history first)', async () => {
      const callOrder: string[] = [];
      mockPriceHistory.recordPrices.mockImplementationOnce(async () => { callOrder.push('history'); });
      mockPriceCache.setAtomic.mockImplementationOnce(async () => { callOrder.push('cache'); });
      const row = makeRow('station-1');

      await service.setVerifiedPrice('station-1', row);

      expect(callOrder).toEqual(['history', 'cache']);
    });

    it('still updates cache if history write fails (P3 — best-effort history)', async () => {
      mockPriceHistory.recordPrices.mockRejectedValueOnce(new Error('DB down'));
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

  // ── Story 2.17: stalenessFlags fold (AC1, AC6) ──────────────────────────

  describe('findPricesInArea — stalenessFlags fold (2.17)', () => {
    it('folds per-fuel staleness flags into DB-fetched (cache-miss) rows', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-1')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-1', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-1')]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // admin_override query

      // PB_95 + ON flagged stale; LPG is not
      mockStalenessService.getStaleFuelsForStations.mockResolvedValueOnce(
        new Map([['station-1', new Set(['PB_95', 'ON'])]]),
      );

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0].stalenessFlags).toEqual({
        PB_95: true,
        ON: true,
        LPG: false,
      });
    });

    it('writes stalenessFlags into cache (so subsequent hits include them)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-2')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-2', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-2')]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      mockStalenessService.getStaleFuelsForStations.mockResolvedValueOnce(
        new Map([['station-2', new Set(['LPG'])]]),
      );

      await service.findPricesInArea(52.23, 21.01, 25000);

      expect(mockPriceCache.set).toHaveBeenCalledWith(
        'station-2',
        expect.objectContaining({
          stalenessFlags: { PB_95: false, ON: false, LPG: true },
        }),
      );
    });

    it('omits stalenessFlags entirely when no fuel is stale for that station', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeStation('station-3')]);
      mockPriceCache.getMany.mockResolvedValueOnce(new Map([['station-3', null]]));
      mockPrisma.$queryRaw.mockResolvedValueOnce([makeDbRow('station-3')]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      mockStalenessService.getStaleFuelsForStations.mockResolvedValueOnce(new Map());

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      // No flags for this station → field is omitted (keeps payload small)
      expect(result[0].stalenessFlags).toBeUndefined();
    });

    it('issues a single batched staleness lookup for all stations in the result set', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        makeStation('station-1'),
        makeStation('station-2'),
        makeStation('station-3'),
      ]);
      mockPriceCache.getMany.mockResolvedValueOnce(
        new Map([
          ['station-1', makeRow('station-1')], // cache hit
          ['station-2', null], // cache miss
          ['station-3', null], // cache miss
        ]),
      );
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        makeDbRow('station-2'),
        makeDbRow('station-3'),
      ]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      await service.findPricesInArea(52.23, 21.01, 25000);

      // Single call, all 3 station IDs in one batch — N+1 guard
      expect(mockStalenessService.getStaleFuelsForStations).toHaveBeenCalledTimes(1);
      expect(mockStalenessService.getStaleFuelsForStations).toHaveBeenCalledWith([
        'station-1',
        'station-2',
        'station-3',
      ]);
    });

    it('does not invoke staleness lookup when no stations are in the area', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      await service.findPricesInArea(52.23, 21.01, 25000);
      expect(mockStalenessService.getStaleFuelsForStations).not.toHaveBeenCalled();
    });
  });
});
