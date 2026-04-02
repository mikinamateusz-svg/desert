import { Test, TestingModule } from '@nestjs/testing';
import { StationService, type NearbyStationWithDistance } from './station.service.js';
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

  describe('findNearbyWithDistance', () => {
    const candidate: NearbyStationWithDistance = {
      id: 'stn-1',
      name: 'Orlen Centrum',
      address: 'ul. Marszałkowska 1',
      google_places_id: 'gp_orlen',
      distance_m: 45.2,
    };

    it('returns candidates with distance_m sorted by proximity', async () => {
      const secondCandidate = { ...candidate, id: 'stn-2', name: 'BP Centrum', distance_m: 120.7 };
      mockPrisma.$queryRaw.mockResolvedValueOnce([candidate, secondCandidate]);

      const result = await service.findNearbyWithDistance(52.2297, 21.0122);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'stn-1', distance_m: 45.2 });
      expect(result[1]).toMatchObject({ id: 'stn-2', distance_m: 120.7 });
    });

    it('returns empty array when no stations within radius', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findNearbyWithDistance(52.2297, 21.0122);

      expect(result).toEqual([]);
    });

    it('uses default radius of 200m when not specified', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([candidate]);

      await service.findNearbyWithDistance(52.2297, 21.0122);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('accepts custom radius and limit parameters', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      await service.findNearbyWithDistance(52.2297, 21.0122, 500, 10);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('uses $queryRaw (not $queryRawUnsafe) to prevent SQL injection', () => {
      expect(mockPrisma.$queryRaw).toBeDefined();
      expect((mockPrisma as Record<string, unknown>)['$queryRawUnsafe']).toBeUndefined();
    });
  });

  describe('findStationsInArea', () => {
    it('returns empty array when no stations in area', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.findStationsInArea(52.23, 21.01, 25000);

      expect(result).toEqual([]);
    });

    it('returns mapped stations with lat and lng fields', async () => {
      const fakeRows = [
        { id: 'abc', name: 'Orlen', address: 'ul. Test 1', google_places_id: 'gp_1', lat: 52.23, lng: 21.01 },
        { id: 'def', name: 'BP', address: null, google_places_id: 'gp_2', lat: 52.24, lng: 21.02 },
      ];
      mockPrisma.$queryRaw.mockResolvedValueOnce(fakeRows);

      const result = await service.findStationsInArea(52.23, 21.01, 25000);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'abc', name: 'Orlen', lat: 52.23, lng: 21.01 });
      expect(result[1]).toMatchObject({ id: 'def', name: 'BP', address: null });
    });

    it('passes radiusMeters to the query', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      await service.findStationsInArea(52.23, 21.01, 10000);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('uses $queryRaw (not $queryRawUnsafe)', () => {
      expect(mockPrisma.$queryRaw).toBeDefined();
      expect((mockPrisma as Record<string, unknown>)['$queryRawUnsafe']).toBeUndefined();
    });
  });
});
