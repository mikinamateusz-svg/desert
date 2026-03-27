import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  StationClassificationService,
  type StationForClassification,
} from './station-classification.service.js';

global.fetch = jest.fn();

const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-api-key') };

const makeNearbyResponse = (results: { name: string }[], status = 'OK') => ({
  ok: true,
  json: jest.fn().mockResolvedValue({ status, results }),
});

const makeGeocodeResponse = (voivodeship: string | null, locality: string | null, status = 'OK') => {
  const components: { long_name: string; types: string[] }[] = [];
  if (voivodeship) components.push({ long_name: voivodeship, types: ['administrative_area_level_1', 'political'] });
  if (locality) components.push({ long_name: locality, types: ['locality', 'political'] });
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      status,
      results: components.length > 0 ? [{ address_components: components }] : [],
    }),
  };
};

describe('StationClassificationService', () => {
  let service: StationClassificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationClassificationService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<StationClassificationService>(StationClassificationService);
  });

  // ─── extractBrand ──────────────────────────────────────────────────────────

  describe('extractBrand', () => {
    it('returns null for null name', () => {
      expect(service.extractBrand(null)).toBeNull();
    });

    it('matches orlen (case-insensitive)', () => {
      expect(service.extractBrand('ORLEN Warszawa')).toBe('orlen');
      expect(service.extractBrand('orlen stacja')).toBe('orlen');
    });

    it('matches shell', () => {
      expect(service.extractBrand('Shell ul. Krakowska')).toBe('shell');
    });

    it('matches bp', () => {
      expect(service.extractBrand('BP Gdańsk')).toBe('bp');
    });

    it('matches circle_k', () => {
      expect(service.extractBrand('Circle K Poznań')).toBe('circle_k');
      expect(service.extractBrand('CircleK')).toBe('circle_k');
    });

    it('matches auchan', () => {
      expect(service.extractBrand('Auchan Fuel')).toBe('auchan');
    });

    it('matches carrefour', () => {
      expect(service.extractBrand('Carrefour Paliwo')).toBe('carrefour');
    });

    it('matches huzar', () => {
      expect(service.extractBrand('Huzar Stacja')).toBe('huzar');
    });

    it('matches moya', () => {
      expect(service.extractBrand('Moya Lublin')).toBe('moya');
    });

    it('matches amic', () => {
      expect(service.extractBrand('AMIC Energy')).toBe('amic');
    });

    it('matches lotos', () => {
      expect(service.extractBrand('Lotos Stacja')).toBe('lotos');
    });

    it('returns independent for unrecognised name', () => {
      expect(service.extractBrand('Stacja u Kowalskiego')).toBe('independent');
    });

    it('returns null for empty string (falsy — same as null)', () => {
      expect(service.extractBrand('')).toBeNull();
    });
  });

  // ─── detectMop ─────────────────────────────────────────────────────────────

  describe('detectMop', () => {
    it('returns true when a result has MOP in name', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeNearbyResponse([{ name: 'MOP Pruszków A2' }, { name: 'BP' }]),
      );
      expect(await service.detectMop(52.1, 20.8, 'key')).toBe(true);
    });

    it('returns true for lowercase mop in name', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeNearbyResponse([{ name: 'Stacja mop Autostrada' }]),
      );
      expect(await service.detectMop(52.1, 20.8, 'key')).toBe(true);
    });

    it('returns false when no result has MOP in name', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeNearbyResponse([{ name: 'Orlen Warszawa' }, { name: 'Shell' }]),
      );
      expect(await service.detectMop(52.1, 20.8, 'key')).toBe(false);
    });

    it('returns false on ZERO_RESULTS', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeNearbyResponse([], 'ZERO_RESULTS'));
      expect(await service.detectMop(52.1, 20.8, 'key')).toBe(false);
    });

    it('throws on non-OK HTTP status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 429 });
      await expect(service.detectMop(52.1, 20.8, 'key')).rejects.toThrow('HTTP error: 429');
    });

    it('throws on REQUEST_DENIED API status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeNearbyResponse([], 'REQUEST_DENIED'),
      );
      await expect(service.detectMop(52.1, 20.8, 'key')).rejects.toThrow('REQUEST_DENIED');
    });

    it('sends correct query parameters', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeNearbyResponse([],'ZERO_RESULTS'));
      await service.detectMop(52.23, 21.01, 'test-key');
      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('radius=300');
      expect(calledUrl).toContain('keyword=MOP');
      expect(calledUrl).toContain('52.23');
      expect(calledUrl).toContain('21.01');
    });
  });

  // ─── resolveGeocode ────────────────────────────────────────────────────────

  describe('resolveGeocode', () => {
    it('extracts voivodeship slug and locality', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeGeocodeResponse('mazowieckie', 'Warszawa'),
      );
      const result = await service.resolveGeocode(52.23, 21.01, 'key');
      expect(result.voivodeship).toBe('mazowieckie');
      expect(result.locality).toBe('Warszawa');
    });

    it('normalises voivodeship with diacritics to slug', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeGeocodeResponse('małopolskie', 'Kraków'),
      );
      const result = await service.resolveGeocode(50.06, 19.94, 'key');
      expect(result.voivodeship).toBe('malopolskie');
    });

    it('returns nulls on ZERO_RESULTS', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeGeocodeResponse(null, null, 'ZERO_RESULTS'),
      );
      const result = await service.resolveGeocode(0, 0, 'key');
      expect(result.voivodeship).toBeNull();
      expect(result.locality).toBeNull();
    });

    it('returns voivodeship when no locality in response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeGeocodeResponse('pomorskie', null),
      );
      const result = await service.resolveGeocode(54.3, 18.6, 'key');
      expect(result.voivodeship).toBe('pomorskie');
      expect(result.locality).toBeNull();
    });

    it('throws on non-OK HTTP status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(service.resolveGeocode(52.23, 21.01, 'key')).rejects.toThrow('HTTP error: 500');
    });

    it('throws on OVER_DAILY_LIMIT API status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'OVER_DAILY_LIMIT', results: [] }),
      });
      await expect(service.resolveGeocode(52.23, 21.01, 'key')).rejects.toThrow('OVER_DAILY_LIMIT');
    });
  });

  // ─── isGermanBorderZone ────────────────────────────────────────────────────

  describe('isGermanBorderZone', () => {
    it('returns true for station near Świecko/Słubice crossing (~5km away)', () => {
      // Słubice is at 52.35, 14.55; test point ~5km east
      expect(service.isGermanBorderZone(52.35, 14.60)).toBe(true);
    });

    it('returns true for station near Zgorzelec crossing', () => {
      expect(service.isGermanBorderZone(51.15, 15.05)).toBe(true);
    });

    it('returns false for Warsaw (far from DE border)', () => {
      expect(service.isGermanBorderZone(52.23, 21.01)).toBe(false);
    });

    it('returns false for Kraków', () => {
      expect(service.isGermanBorderZone(50.06, 19.94)).toBe(false);
    });

    it('returns false for station >30km from any crossing', () => {
      // ~47km east of Słubice (52.35, 14.55): Δlng=0.68° ≈ 46km at this latitude
      expect(service.isGermanBorderZone(52.35, 15.23)).toBe(false);
    });
  });

  // ─── classifyStation ──────────────────────────────────────────────────────

  describe('classifyStation', () => {
    const station: StationForClassification = {
      id: 'station-1',
      name: 'Shell MOP Pruszków',
      lat: 52.17,
      lng: 20.79,
    };

    it('returns full classification for a MOP Shell station near Warsaw', async () => {
      // detectMop call
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeNearbyResponse([{ name: 'MOP Pruszków A2' }]))
        // resolveGeocode call
        .mockResolvedValueOnce(makeGeocodeResponse('mazowieckie', 'Pruszków'));

      const result = await service.classifyStation(station, 'key');

      expect(result.brand).toBe('shell');
      expect(result.station_type).toBe('mop');
      expect(result.voivodeship).toBe('mazowieckie');
      expect(result.settlement_tier).toBe('rural'); // Pruszków not in metropolitan list
      expect(result.is_border_zone_de).toBe(false);
    });

    it('classifies non-MOP Auchan station near DE border as standard + border zone', async () => {
      const borderStation: StationForClassification = {
        id: 'station-2',
        name: 'Auchan Słubice',
        lat: 52.35,
        lng: 14.60, // near Słubice
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeNearbyResponse([], 'ZERO_RESULTS'))
        .mockResolvedValueOnce(makeGeocodeResponse('lubuskie', 'Słubice'));

      const result = await service.classifyStation(borderStation, 'key');

      expect(result.brand).toBe('auchan');
      expect(result.station_type).toBe('standard');
      expect(result.voivodeship).toBe('lubuskie');
      expect(result.is_border_zone_de).toBe(true);
    });

    it('classifies multi-word city station as town, not rural (space→underscore normalisation)', async () => {
      const nowySaczStation: StationForClassification = {
        id: 'station-4',
        name: 'Orlen Nowy Sącz',
        lat: 49.62,
        lng: 20.69,
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeNearbyResponse([], 'ZERO_RESULTS'))
        .mockResolvedValueOnce(makeGeocodeResponse('małopolskie', 'Nowy Sącz'));

      const result = await service.classifyStation(nowySaczStation, 'key');

      expect(result.settlement_tier).toBe('city'); // 83k pop ≥ 50k → 'city', must not be 'rural'
    });

    it('classifies metropolitan Orlen station correctly', async () => {
      const warsawStation: StationForClassification = {
        id: 'station-3',
        name: 'Orlen Centrum',
        lat: 52.23,
        lng: 21.01,
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeNearbyResponse([], 'ZERO_RESULTS'))
        .mockResolvedValueOnce(makeGeocodeResponse('mazowieckie', 'Warszawa'));

      const result = await service.classifyStation(warsawStation, 'key');

      expect(result.brand).toBe('orlen');
      expect(result.station_type).toBe('standard');
      expect(result.settlement_tier).toBe('metropolitan');
    });

    it('fires detectMop and resolveGeocode in parallel (both fetch calls happen)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeNearbyResponse([], 'ZERO_RESULTS'))
        .mockResolvedValueOnce(makeGeocodeResponse('mazowieckie', 'Warszawa'));

      await service.classifyStation(station, 'key');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
