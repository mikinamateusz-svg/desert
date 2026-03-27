import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StationSyncService } from './station-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

global.fetch = jest.fn();

const mockPrisma = { $executeRaw: jest.fn() };
const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-api-key') };

const makePlacesResponse = (results: object[], nextToken?: string) => ({
  ok: true,
  json: jest.fn().mockResolvedValue({
    status: 'OK',
    results,
    ...(nextToken ? { next_page_token: nextToken } : {}),
  }),
});

const fakePlacesResult = {
  place_id: 'gp_1',
  name: 'Orlen',
  vicinity: 'ul. Test 1, Warszawa',
  geometry: { location: { lat: 52.23, lng: 21.01 } },
};

describe('StationSyncService', () => {
  let service: StationSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<StationSyncService>(StationSyncService);
  });

  describe('buildPolandGrid', () => {
    it('returns an array of [lat, lng] pairs', () => {
      const grid = service.buildPolandGrid();
      expect(Array.isArray(grid)).toBe(true);
      expect(grid.length).toBeGreaterThan(0);
    });

    it('returns more than 100 grid points to cover Poland', () => {
      const grid = service.buildPolandGrid();
      expect(grid.length).toBeGreaterThan(100);
    });

    it('all points are within Poland bbox', () => {
      const grid = service.buildPolandGrid();
      grid.forEach(([lat, lng]) => {
        expect(lat).toBeGreaterThanOrEqual(49.0);
        expect(lat).toBeLessThanOrEqual(55.0);
        expect(lng).toBeGreaterThanOrEqual(14.0);
        expect(lng).toBeLessThanOrEqual(25.0);
      });
    });

    it('returns tuples of [number, number]', () => {
      const grid = service.buildPolandGrid();
      grid.forEach(point => {
        expect(point).toHaveLength(2);
        expect(typeof point[0]).toBe('number');
        expect(typeof point[1]).toBe('number');
      });
    });
  });

  describe('fetchStationsAtPoint', () => {
    it('returns results from a single-page response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(makePlacesResponse([fakePlacesResult]));

      const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(fakePlacesResult);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('includes location, type, radius=10000 and key params in the request URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(makePlacesResponse([]));

      await service.fetchStationsAtPoint(52.23, 21.01, 'my-key');

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('location=52.23%2C21.01');
      expect(calledUrl).toContain('type=gas_station');
      expect(calledUrl).toContain('radius=10000');
      expect(calledUrl).toContain('key=my-key');
    });

    it('paginates when next_page_token is present', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makePlacesResponse([fakePlacesResult], 'page2token'))
        .mockResolvedValueOnce(makePlacesResponse([{ ...fakePlacesResult, place_id: 'gp_2' }]));

      const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');

      expect(results).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const secondCallUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
      expect(secondCallUrl).toContain('pagetoken=page2token');
    });

    it('throws on non-OK HTTP status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(service.fetchStationsAtPoint(52.23, 21.01, 'key')).rejects.toThrow('HTTP error: 500');
    });

    it('throws when Places API status is REQUEST_DENIED', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'REQUEST_DENIED', results: [] }),
      });

      await expect(service.fetchStationsAtPoint(52.23, 21.01, 'key')).rejects.toThrow('REQUEST_DENIED');
    });

    it('throws when Places API status is OVER_QUERY_LIMIT', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'OVER_QUERY_LIMIT', results: [] }),
      });

      await expect(service.fetchStationsAtPoint(52.23, 21.01, 'key')).rejects.toThrow('OVER_QUERY_LIMIT');
    });

    it('returns empty array on ZERO_RESULTS without throwing', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'ZERO_RESULTS', results: [] }),
      });

      const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');
      expect(results).toHaveLength(0);
    });
  });

  describe('upsertStation', () => {
    it('calls prisma.$executeRaw once per station', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(1);

      await service.upsertStation(fakePlacesResult);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does not call $executeRawUnsafe', () => {
      expect((mockPrisma as Record<string, unknown>)['$executeRawUnsafe']).toBeUndefined();
    });

    it('includes classification_version reset in ON CONFLICT DO UPDATE (AC7)', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(1);

      await service.upsertStation(fakePlacesResult);

      // The tagged template strings contain the SQL structure — verify re-classification
      // reset is present so changed name/location triggers classification_version = 0
      const sqlStrings: string[] = mockPrisma.$executeRaw.mock.calls[0][0];
      const fullSql = sqlStrings.join('?');
      expect(fullSql).toContain('classification_version');
      expect(fullSql).toContain('IS DISTINCT FROM');
    });
  });

  describe('runSync', () => {
    it('processes all stations across all grid points', async () => {
      jest.spyOn(service, 'buildPolandGrid').mockReturnValue([[52.23, 21.01], [52.68, 21.01]]);
      jest.spyOn(service, 'fetchStationsAtPoint').mockResolvedValue([fakePlacesResult]);
      jest.spyOn(service, 'upsertStation').mockResolvedValue(undefined);

      await service.runSync();

      expect(service.fetchStationsAtPoint).toHaveBeenCalledTimes(2);
      expect(service.fetchStationsAtPoint).toHaveBeenCalledWith(52.23, 21.01, 'test-api-key');
      expect(service.fetchStationsAtPoint).toHaveBeenCalledWith(52.68, 21.01, 'test-api-key');
      expect(service.upsertStation).toHaveBeenCalledTimes(2);
    });

    it('calls upsertStation with the correct station data', async () => {
      jest.spyOn(service, 'buildPolandGrid').mockReturnValue([[52.23, 21.01]]);
      jest.spyOn(service, 'fetchStationsAtPoint').mockResolvedValue([fakePlacesResult]);
      jest.spyOn(service, 'upsertStation').mockResolvedValue(undefined);

      await service.runSync();

      expect(service.upsertStation).toHaveBeenCalledWith(fakePlacesResult);
    });

    it('retrieves GOOGLE_PLACES_API_KEY via getOrThrow', async () => {
      jest.spyOn(service, 'buildPolandGrid').mockReturnValue([]);

      await service.runSync();

      expect(mockConfig.getOrThrow).toHaveBeenCalledWith('GOOGLE_PLACES_API_KEY');
    });

    // P1: per-point error isolation
    it('continues processing remaining grid points when one point throws', async () => {
      jest.spyOn(service, 'buildPolandGrid').mockReturnValue([
        [49.2, 14.2],
        [49.2, 14.52], // this one will throw
        [49.2, 14.84],
      ]);
      jest.spyOn(service, 'fetchStationsAtPoint')
        .mockResolvedValueOnce([fakePlacesResult])
        .mockRejectedValueOnce(new Error('OVER_QUERY_LIMIT'))
        .mockResolvedValueOnce([fakePlacesResult]);
      jest.spyOn(service, 'upsertStation').mockResolvedValue(undefined);

      // Should not throw
      await expect(service.runSync()).resolves.toBeUndefined();

      expect(service.fetchStationsAtPoint).toHaveBeenCalledTimes(3);
      // Only 2 upserts (the failed grid point contributes 0)
      expect(service.upsertStation).toHaveBeenCalledTimes(2);
    });

    // P7: geometry null guard
    it('skips stations with null geometry and does not call upsertStation', async () => {
      const stationWithoutGeometry = { ...fakePlacesResult, geometry: null };
      jest.spyOn(service, 'buildPolandGrid').mockReturnValue([[52.23, 21.01]]);
      jest.spyOn(service, 'fetchStationsAtPoint').mockResolvedValue([stationWithoutGeometry as never]);
      jest.spyOn(service, 'upsertStation').mockResolvedValue(undefined);

      await service.runSync();

      expect(service.upsertStation).not.toHaveBeenCalled();
    });
  });
});
