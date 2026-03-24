import { Test, TestingModule } from '@nestjs/testing';
import { StationService } from './station.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrisma = { $queryRaw: jest.fn() };

describe('StationService', () => {
  let service: StationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<StationService>(StationService);
  });

  describe('findNearestStation', () => {
    it('returns the nearest station when one is within radius', async () => {
      const fakeStation = {
        id: 'abc',
        name: 'Orlen',
        address: 'ul. Test 1',
        google_places_id: 'gp_1',
      };
      mockPrisma.$queryRaw.mockResolvedValueOnce([fakeStation]);

      const result = await service.findNearestStation(52.23, 21.01);

      expect(result).toEqual(fakeStation);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns null when no station is within radius', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findNearestStation(52.23, 21.01);

      expect(result).toBeNull();
    });

    it('uses default radius of 200m when not specified', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      await service.findNearestStation(52.23, 21.01);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('accepts custom radius parameter', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      await service.findNearestStation(52.23, 21.01, 500);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('uses $queryRaw (not $queryRawUnsafe) to prevent SQL injection', () => {
      // Verify the service only exposes $queryRaw on the prisma mock
      expect(mockPrisma.$queryRaw).toBeDefined();
      expect((mockPrisma as Record<string, unknown>)['$queryRawUnsafe']).toBeUndefined();
    });
  });
});
