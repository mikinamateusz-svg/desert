import { Test, TestingModule } from '@nestjs/testing';
import { RegionalBenchmarkService } from './regional-benchmark.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();
const mockCreateMany = jest.fn();
const mockFindFirst = jest.fn();
const mockStationFindUnique = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
  regionalBenchmark: {
    createMany: mockCreateMany,
    findFirst: mockFindFirst,
  },
  station: {
    findUnique: mockStationFindUnique,
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RegionalBenchmarkService', () => {
  let service: RegionalBenchmarkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);
    mockCreateMany.mockResolvedValue({ count: 0 });
    mockFindFirst.mockResolvedValue(null);
    mockStationFindUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionalBenchmarkService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RegionalBenchmarkService>(RegionalBenchmarkService);
  });

  // ── calculateAndStore ─────────────────────────────────────────────────────

  describe('calculateAndStore', () => {
    it('returns { inserted: 0 } and skips createMany when the aggregate query returns no rows', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 0 });
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it('inserts one RegionalBenchmark row per (voivodeship × fuel_type) combination returned by the query', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { voivodeship: 'mazowieckie', fuel_type: 'PB_95', median_price: 6.21, station_count: 12 },
        { voivodeship: 'mazowieckie', fuel_type: 'ON', median_price: 6.45, station_count: 11 },
        { voivodeship: 'lodzkie', fuel_type: 'PB_95', median_price: 6.18, station_count: 8 },
      ]);

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 3 });
      expect(mockCreateMany).toHaveBeenCalledTimes(1);
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          { voivodeship: 'mazowieckie', fuel_type: 'PB_95', median_price: 6.21, station_count: 12 },
          { voivodeship: 'mazowieckie', fuel_type: 'ON', median_price: 6.45, station_count: 11 },
          { voivodeship: 'lodzkie', fuel_type: 'PB_95', median_price: 6.18, station_count: 8 },
        ],
      });
    });

    it('does NOT pass calculated_at to createMany — relies on the schema @default(now())', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { voivodeship: 'pomorskie', fuel_type: 'PB_95', median_price: 6.30, station_count: 7 },
      ]);

      await service.calculateAndStore();

      const dataArr = (mockCreateMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
      expect(dataArr[0]).not.toHaveProperty('calculated_at');
    });

    it('passes the SQL query that excludes seeded prices and applies the 5-station HAVING threshold', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.calculateAndStore();

      // $queryRaw is called with template-literal strings array as the first arg
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      const sqlStrings = (mockQueryRaw.mock.calls[0][0] as { join?: (sep: string) => string }).join
        ? (mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
        : String(mockQueryRaw.mock.calls[0][0]);
      expect(sqlStrings).toContain("source != 'seeded'");
      expect(sqlStrings).toContain("INTERVAL '30 days'");
      expect(sqlStrings).toContain('HAVING COUNT(DISTINCT ph.station_id) >= 5');
      expect(sqlStrings).toContain('PERCENTILE_CONT(0.5)');
      // DISTINCT ON ensures one vote per station, not one per submission
      expect(sqlStrings).toContain('DISTINCT ON (ph2.station_id, ph2.fuel_type)');
    });

    it('appends new rows on each call (does NOT upsert / overwrite previous benchmarks)', async () => {
      // Two consecutive runs — each should insert independently
      mockQueryRaw.mockResolvedValueOnce([
        { voivodeship: 'mazowieckie', fuel_type: 'PB_95', median_price: 6.21, station_count: 12 },
      ]);
      mockQueryRaw.mockResolvedValueOnce([
        { voivodeship: 'mazowieckie', fuel_type: 'PB_95', median_price: 6.25, station_count: 12 },
      ]);

      await service.calculateAndStore();
      await service.calculateAndStore();

      // Two separate createMany calls, no upsert / updateMany
      expect(mockCreateMany).toHaveBeenCalledTimes(2);
      expect(
        (mockPrisma.regionalBenchmark as unknown as Record<string, jest.Mock>).update,
      ).toBeUndefined();
      expect(
        (mockPrisma.regionalBenchmark as unknown as Record<string, jest.Mock>).upsert,
      ).toBeUndefined();
    });
  });

  // ── getLatestForStation ───────────────────────────────────────────────────

  describe('getLatestForStation', () => {
    it('returns null when the station does not exist', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);

      const result = await service.getLatestForStation('missing-station-id', 'PB_95');

      expect(result).toBeNull();
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('returns null when the station exists but has no voivodeship (unclassified)', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: null });

      const result = await service.getLatestForStation('unclassified-id', 'PB_95');

      expect(result).toBeNull();
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('returns null when no benchmark exists for the station voivodeship × fuel_type', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'opolskie' });
      mockFindFirst.mockResolvedValueOnce(null);

      const result = await service.getLatestForStation('station-id', 'LPG');

      expect(result).toBeNull();
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { voivodeship: 'opolskie', fuel_type: 'LPG' },
        orderBy: { calculated_at: 'desc' },
        select: { median_price: true },
      });
    });

    it('returns { medianPrice } from the most recent benchmark', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'mazowieckie' });
      mockFindFirst.mockResolvedValueOnce({ median_price: 6.21 });

      const result = await service.getLatestForStation('station-id', 'PB_95');

      expect(result).toEqual({ medianPrice: 6.21 });
    });

    it('orders by calculated_at desc so the latest snapshot wins (never an older one)', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'mazowieckie' });
      mockFindFirst.mockResolvedValueOnce({ median_price: 6.30 });

      await service.getLatestForStation('station-id', 'PB_95');

      const findFirstCall = mockFindFirst.mock.calls[0][0] as {
        orderBy: { calculated_at: 'asc' | 'desc' };
      };
      expect(findFirstCall.orderBy).toEqual({ calculated_at: 'desc' });
    });
  });

  // ── getLatestForVoivodeship (Story 5.3) ──────────────────────────────────

  describe('getLatestForVoivodeship', () => {
    it('returns null when no benchmark exists for the voivodeship × fuel_type', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const result = await service.getLatestForVoivodeship('opolskie', 'LPG');

      expect(result).toBeNull();
      // Critical: skips the Station lookup entirely (caller already
      // resolved the voivodeship via Nominatim or station snapshot).
      expect(mockStationFindUnique).not.toHaveBeenCalled();
    });

    it('returns { medianPrice } from the most recent benchmark for the voivodeship', async () => {
      mockFindFirst.mockResolvedValueOnce({ median_price: 6.42 });

      const result = await service.getLatestForVoivodeship('lodzkie', 'PB_95');

      expect(result).toEqual({ medianPrice: 6.42 });
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { voivodeship: 'lodzkie', fuel_type: 'PB_95' },
        orderBy: { calculated_at: 'desc' },
        select: { median_price: true },
      });
    });

    it('orders by calculated_at desc so the most recent snapshot wins', async () => {
      mockFindFirst.mockResolvedValueOnce({ median_price: 5.99 });

      await service.getLatestForVoivodeship('mazowieckie', 'ON');

      const call = mockFindFirst.mock.calls[0][0] as {
        orderBy: { calculated_at: 'asc' | 'desc' };
      };
      expect(call.orderBy).toEqual({ calculated_at: 'desc' });
    });
  });
});
