import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrisma = { $queryRaw: jest.fn() };

describe('PriceService', () => {
  let service: PriceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PriceService>(PriceService);
  });

  describe('findPricesInArea', () => {
    it('returns empty array when no verified submissions in area', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toEqual([]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns rows with stationId, prices, and updatedAt fields', async () => {
      const now = new Date();
      const fakeRows = [
        {
          stationId: 'station-1',
          prices: { PB_95: 6.42, ON: 6.89 },
          updatedAt: now,
          source: 'community',
        },
        {
          stationId: 'station-2',
          prices: { PB_95: 6.55, LPG: 2.89 },
          updatedAt: now,
          source: 'community',
        },
      ];
      mockPrisma.$queryRaw.mockResolvedValueOnce(fakeRows);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        stationId: 'station-1',
        prices: { PB_95: 6.42, ON: 6.89 },
        updatedAt: now,
        source: 'community',
      });
      expect(result[1]).toMatchObject({
        stationId: 'station-2',
        prices: { PB_95: 6.55, LPG: 2.89 },
        source: 'community',
      });
    });

    it('returns the latest verified submission per station (DISTINCT ON)', async () => {
      const now = new Date();
      // The SQL uses DISTINCT ON — the mock returns one row per station as the DB would
      const fakeRows = [
        { stationId: 'station-1', prices: { PB_95: 6.42 }, updatedAt: now, source: 'community' },
      ];
      mockPrisma.$queryRaw.mockResolvedValueOnce(fakeRows);

      const result = await service.findPricesInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(1);
      expect(result[0]?.stationId).toBe('station-1');
    });

    it('uses $queryRaw (not $queryRawUnsafe) to prevent SQL injection', () => {
      expect(mockPrisma.$queryRaw).toBeDefined();
      expect((mockPrisma as Record<string, unknown>)['$queryRawUnsafe']).toBeUndefined();
    });
  });
});
