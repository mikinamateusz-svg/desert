import { Test, TestingModule } from '@nestjs/testing';
import { PriceHistoryService } from './price-history.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationPriceRow } from './price-cache.service.js';

const mockPrisma = {
  priceHistory: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const makeRow = (overrides: Partial<StationPriceRow> = {}): StationPriceRow => ({
  stationId: 'station-1',
  prices: { PB_95: 6.42, ON: 6.89 },
  sources: { PB_95: 'community', ON: 'seeded' },
  updatedAt: new Date('2026-03-01T10:00:00.000Z'),
  ...overrides,
});

describe('PriceHistoryService', () => {
  let service: PriceHistoryService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceHistoryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PriceHistoryService>(PriceHistoryService);
  });

  describe('recordPrices', () => {
    it('calls createMany with one row per fuel type', async () => {
      mockPrisma.priceHistory.createMany.mockResolvedValueOnce({ count: 2 });

      await service.recordPrices('station-1', makeRow());

      expect(mockPrisma.priceHistory.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ station_id: 'station-1', fuel_type: 'PB_95', price: 6.42, source: 'community' }),
          expect.objectContaining({ station_id: 'station-1', fuel_type: 'ON', price: 6.89, source: 'seeded' }),
        ]),
      });
      expect(mockPrisma.priceHistory.createMany.mock.calls[0][0].data).toHaveLength(2);
    });

    it('defaults missing source to community', async () => {
      mockPrisma.priceHistory.createMany.mockResolvedValueOnce({ count: 1 });
      const row = makeRow({ prices: { PB_95: 6.42 }, sources: {} });

      await service.recordPrices('station-1', row);

      expect(mockPrisma.priceHistory.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ source: 'community' })],
      });
    });

    it('skips createMany when prices map is empty', async () => {
      const row = makeRow({ prices: {}, sources: {} });

      await service.recordPrices('station-1', row);

      expect(mockPrisma.priceHistory.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('returns history entries ordered newest first', async () => {
      mockPrisma.priceHistory.findMany.mockResolvedValueOnce([
        { price: 6.50, source: 'community', recorded_at: new Date('2026-03-02T00:00:00.000Z') },
        { price: 6.42, source: 'community', recorded_at: new Date('2026-03-01T00:00:00.000Z') },
      ]);

      const result = await service.getHistory('station-1', 'PB_95');

      expect(mockPrisma.priceHistory.findMany).toHaveBeenCalledWith({
        where: { station_id: 'station-1', fuel_type: 'PB_95' },
        orderBy: { recorded_at: 'desc' },
        select: { price: true, source: true, recorded_at: true },
        take: 500,
      });
      expect(result).toHaveLength(2);
      expect(result[0].price).toBe(6.50);
      expect(result[1].price).toBe(6.42);
    });

    it('uses caller-supplied limit when provided', async () => {
      mockPrisma.priceHistory.findMany.mockResolvedValueOnce([]);

      await service.getHistory('station-1', 'PB_95', 30);

      expect(mockPrisma.priceHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 }),
      );
    });

    it('maps recorded_at to recordedAt', async () => {
      const date = new Date('2026-03-01T10:00:00.000Z');
      mockPrisma.priceHistory.findMany.mockResolvedValueOnce([
        { price: 6.42, source: 'community', recorded_at: date },
      ]);

      const result = await service.getHistory('station-1', 'PB_95');

      expect(result[0].recordedAt).toBe(date);
    });

    it('returns empty array when no history exists', async () => {
      mockPrisma.priceHistory.findMany.mockResolvedValueOnce([]);

      const result = await service.getHistory('station-1', 'PB_95');

      expect(result).toEqual([]);
    });
  });

  describe('getRegionalAverage', () => {
    it('returns averagePrice and stationCount from query', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg_price: 6.55, station_count: 12 }]);

      const result = await service.getRegionalAverage('mazowieckie', 'PB_95');

      expect(result).toEqual({
        voivodeship: 'mazowieckie',
        fuelType: 'PB_95',
        averagePrice: 6.55,
        stationCount: 12,
      });
    });

    it('returns averagePrice null when no stations have data', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg_price: null, station_count: 0 }]);

      const result = await service.getRegionalAverage('podlaskie', 'PB_98');

      expect(result.averagePrice).toBeNull();
      expect(result.stationCount).toBe(0);
    });

    it('does not double-count stations with multiple history records', async () => {
      // The SQL uses DISTINCT ON station_id before AVG — verify stationCount is 2, not 4
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg_price: 6.60, station_count: 2 }]);

      const result = await service.getRegionalAverage('mazowieckie', 'PB_95');

      expect(result.stationCount).toBe(2);
    });

    it('includes voivodeship and fuelType in result', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ avg_price: 6.70, station_count: 5 }]);

      const result = await service.getRegionalAverage('małopolskie', 'ON');

      expect(result.voivodeship).toBe('małopolskie');
      expect(result.fuelType).toBe('ON');
    });
  });
});
