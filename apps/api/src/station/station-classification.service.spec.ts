import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  StationClassificationService,
  type StationForClassification,
} from './station-classification.service.js';

global.fetch = jest.fn();

const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-api-key') };

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
    it('detects MOP via station name — skips Nearby Search', async () => {
      const station: StationForClassification = {
        id: 'station-1',
        name: 'Shell MOP Pruszków',
        address: null,
        lat: 52.17,
        lng: 20.79,
      };
      // Only resolveGeocode fetch — Nearby Search must NOT be called
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeGeocodeResponse('mazowieckie', 'Pruszków'));

      const result = await service.classifyStation(station, 'key');

      expect(result.brand).toBe('shell');
      expect(result.station_type).toBe('mop');
      expect(result.voivodeship).toBe('mazowieckie');
      expect(result.settlement_tier).toBe('rural');
      expect(result.is_border_zone_de).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('detects MOP via address when name has no MOP signal', async () => {
      const station: StationForClassification = {
        id: 'station-5',
        name: 'Orlen',
        address: 'MOP Wiśniowa Góra Wschód, A1',
        lat: 51.72,
        lng: 19.63,
      };
      // Only resolveGeocode fetch — Nearby Search must NOT be called
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeGeocodeResponse('lodzkie', null));

      const result = await service.classifyStation(station, 'key');

      expect(result.station_type).toBe('mop');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('classifies as standard when no MOP in name or address — makes exactly one API call', async () => {
      const station: StationForClassification = {
        id: 'station-6',
        name: 'Orlen',
        address: 'ul. Brzezińska 44, Wiśniowa Góra',
        lat: 51.72,
        lng: 19.63,
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeGeocodeResponse('lodzkie', null));

      const result = await service.classifyStation(station, 'key');

      expect(result.station_type).toBe('standard');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('classifies non-MOP Auchan station near DE border as standard + border zone', async () => {
      const borderStation: StationForClassification = {
        id: 'station-2',
        name: 'Auchan Słubice',
        address: null,
        lat: 52.35,
        lng: 14.60,
      };
      (global.fetch as jest.Mock)
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
        address: null,
        lat: 49.62,
        lng: 20.69,
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeGeocodeResponse('małopolskie', 'Nowy Sącz'));

      const result = await service.classifyStation(nowySaczStation, 'key');

      expect(result.settlement_tier).toBe('city');
    });

    it('classifies metropolitan Orlen station correctly', async () => {
      const warsawStation: StationForClassification = {
        id: 'station-3',
        name: 'Orlen Centrum',
        address: null,
        lat: 52.23,
        lng: 21.01,
      };
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(makeGeocodeResponse('mazowieckie', 'Warszawa'));

      const result = await service.classifyStation(warsawStation, 'key');

      expect(result.brand).toBe('orlen');
      expect(result.station_type).toBe('standard');
      expect(result.settlement_tier).toBe('metropolitan');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
