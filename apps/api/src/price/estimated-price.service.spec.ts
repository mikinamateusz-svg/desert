import { Test, TestingModule } from '@nestjs/testing';
import { EstimatedPriceService } from './estimated-price.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StationClassificationRow } from './estimated-price.service.js';
import {
  BAND_RADIUS_GR,
  VOIVODESHIP_MARGINS_GR,
  DEFAULT_MARGIN_GR,
  BORDER_ZONE_MODIFIER_GR,
  FALLBACK_BAND_PCT,
  NATIONAL_FALLBACK_PRICES_PLN,
} from './config/price-modifiers.js';

const mockQueryRaw = jest.fn();
const mockPrisma = { $queryRaw: mockQueryRaw };

const baseStation: StationClassificationRow = {
  id: 'station-1',
  name: 'Orlen Station',
  brand: 'orlen',
  station_type: 'standard',
  voivodeship: 'mazowieckie',
  settlement_tier: 'city',
  is_border_zone_de: false,
};

describe('EstimatedPriceService', () => {
  let service: EstimatedPriceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EstimatedPriceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<EstimatedPriceService>(EstimatedPriceService);
  });

  // ─── getLatestRackPrices ────────────────────────────────────────────────────

  describe('getLatestRackPrices', () => {
    it('returns rack prices mapped to fuel type keys', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
        { signal_type: 'orlen_rack_on',   value: 5.90 },
        { signal_type: 'orlen_rack_lpg',  value: 2.40 },
      ]);

      const result = await service.getLatestRackPrices();

      expect(result.get('PB_95')).toBe(5.80);
      expect(result.get('ON')).toBe(5.90);
      expect(result.get('LPG')).toBe(2.40);
    });

    it('returns empty map when no signals exist', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const result = await service.getLatestRackPrices();
      expect(result.size).toBe(0);
    });

    it('omits fuel types not in MarketSignal response', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
      ]);
      const result = await service.getLatestRackPrices();
      expect(result.has('PB_95')).toBe(true);
      expect(result.has('ON')).toBe(false);
      expect(result.has('LPG')).toBe(false);
    });
  });

  // ─── computeMidpoint ───────────────────────────────────────────────────────

  describe('computeMidpoint', () => {
    const rackPln = 5.80;

    it('adds voivodeship margin to rack price', () => {
      const margin = VOIVODESHIP_MARGINS_GR['mazowieckie']!; // 26
      const result = service.computeMidpoint(rackPln, baseStation);
      expect(result).toBe(Math.round((rackPln + margin / 100) * 100) / 100);
    });

    it('uses default margin when voivodeship is null', () => {
      const station = { ...baseStation, voivodeship: null };
      const result = service.computeMidpoint(rackPln, station);
      const expected = Math.round((rackPln + DEFAULT_MARGIN_GR / 100) * 100) / 100;
      expect(result).toBe(expected);
    });

    it('adds MOP premium (+45 gr) for MOP stations', () => {
      const station = { ...baseStation, station_type: 'mop' as const };
      const baseResult = service.computeMidpoint(rackPln, baseStation);
      const mopResult = service.computeMidpoint(rackPln, station);
      expect(mopResult).toBe(Math.round((baseResult + 0.45) * 100) / 100);
    });

    it('applies premium brand modifier (+7 gr for shell)', () => {
      const station = { ...baseStation, brand: 'shell' };
      const baseResult = service.computeMidpoint(rackPln, baseStation); // orlen = 0
      const shellResult = service.computeMidpoint(rackPln, station);
      expect(shellResult).toBe(Math.round((baseResult + 0.07) * 100) / 100);
    });

    it('applies hypermarket brand discount (-30 gr for auchan)', () => {
      const station = { ...baseStation, brand: 'auchan' };
      const baseResult = service.computeMidpoint(rackPln, baseStation);
      const auchanResult = service.computeMidpoint(rackPln, station);
      expect(auchanResult).toBe(Math.round((baseResult - 0.30) * 100) / 100);
    });

    it('applies German border zone discount (-15 gr)', () => {
      const station = { ...baseStation, is_border_zone_de: true };
      const baseResult = service.computeMidpoint(rackPln, baseStation);
      const borderResult = service.computeMidpoint(rackPln, station);
      expect(borderResult).toBe(Math.round((baseResult + BORDER_ZONE_MODIFIER_GR / 100) * 100) / 100);
    });

    it('applies rural settlement uplift (+10 gr)', () => {
      const station = { ...baseStation, settlement_tier: 'rural' as const };
      const baseResult = service.computeMidpoint(rackPln, baseStation);
      const ruralResult = service.computeMidpoint(rackPln, station);
      expect(ruralResult).toBe(Math.round((baseResult + 0.10) * 100) / 100);
    });

    it('applies no settlement modifier for metropolitan', () => {
      const station = { ...baseStation, settlement_tier: 'metropolitan' as const };
      const baseResult = service.computeMidpoint(rackPln, baseStation); // city = 0
      const metroResult = service.computeMidpoint(rackPln, station);
      expect(metroResult).toBe(baseResult);
    });

    it('applies zero modifier for null/unknown brand', () => {
      const station = { ...baseStation, brand: null };
      const baseResult = service.computeMidpoint(rackPln, baseStation); // orlen = 0
      const nullBrandResult = service.computeMidpoint(rackPln, station);
      expect(nullBrandResult).toBe(baseResult);
    });

    it('stacks all modifiers correctly (MOP + shell + rural + border)', () => {
      const station: StationClassificationRow = {
        id: 's',
        name: 'Shell MOP Station',
        brand: 'shell',           // +7 gr
        station_type: 'mop',      // +45 gr
        voivodeship: 'mazowieckie', // +26 gr margin
        settlement_tier: 'rural', // +10 gr
        is_border_zone_de: true,  // -15 gr
      };
      // 5.80 + (26 + 45 + 7 + 10 - 15) / 100 = 5.80 + 0.73 = 6.53
      const result = service.computeMidpoint(5.80, station);
      expect(result).toBe(6.53);
    });
  });

  // ─── computeRange ──────────────────────────────────────────────────────────

  describe('computeRange', () => {
    it('applies symmetric ±0.15 PLN band', () => {
      const { low, high } = service.computeRange(6.50);
      const band = BAND_RADIUS_GR / 100; // 0.15
      expect(high - low).toBeCloseTo(band * 2, 5);
      expect(low).toBe(Math.round((6.50 - band) * 100) / 100);
      expect(high).toBe(Math.round((6.50 + band) * 100) / 100);
    });

    it('rounds results to 2 decimal places', () => {
      const { low, high } = service.computeRange(6.857);
      expect(low.toString()).toMatch(/^\d+\.\d{1,2}$/);
      expect(high.toString()).toMatch(/^\d+\.\d{1,2}$/);
    });
  });

  // ─── computeFallback ───────────────────────────────────────────────────────

  describe('computeFallback', () => {
    it('returns fallback with ±2.5% band for PB_95', () => {
      const result = service.computeFallback('PB_95');
      const base = NATIONAL_FALLBACK_PRICES_PLN['PB_95']!;
      expect(result).not.toBeNull();
      expect(result!.midpoint).toBe(base);
      expect(result!.low).toBe(Math.round(base * (1 - FALLBACK_BAND_PCT) * 100) / 100);
      expect(result!.high).toBe(Math.round(base * (1 + FALLBACK_BAND_PCT) * 100) / 100);
    });

    it('returns null for unknown fuel type', () => {
      expect(service.computeFallback('PB_98')).toBeNull();
    });

    it('returns fallback for LPG', () => {
      const result = service.computeFallback('LPG');
      expect(result).not.toBeNull();
      expect(result!.midpoint).toBe(NATIONAL_FALLBACK_PRICES_PLN['LPG']!);
    });
  });

  // ─── computeEstimatesForStations ───────────────────────────────────────────

  describe('computeEstimatesForStations', () => {
    it('returns empty map for empty station list', async () => {
      const result = await service.computeEstimatesForStations([]);
      expect(result.size).toBe(0);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('returns market_estimate rows when rack prices available', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
        { signal_type: 'orlen_rack_on',   value: 5.90 },
        { signal_type: 'orlen_rack_lpg',  value: 2.40 },
      ]);

      const result = await service.computeEstimatesForStations([baseStation]);

      const row = result.get('station-1');
      expect(row).toBeDefined();
      expect(row!.sources?.PB_95).toBe('seeded');
      expect(row!.sources?.ON).toBe('seeded');
      expect(row!.sources?.LPG).toBe('seeded');
      expect(row!.estimateLabel?.PB_95).toBe('market_estimate');
      expect(row!.priceRanges).toBeDefined();
      expect(Object.keys(row!.priceRanges!)).toEqual(
        expect.arrayContaining(['PB_95', 'ON', 'LPG']),
      );
      // priceRanges[ft].high - low should equal 2 * BAND_RADIUS_GR / 100
      const bandPln = BAND_RADIUS_GR / 100;
      for (const range of Object.values(row!.priceRanges!)) {
        expect(range.high - range.low).toBeCloseTo(bandPln * 2, 5);
      }
    });

    it('returns estimated rows (fallback) when no rack prices available', async () => {
      mockQueryRaw.mockResolvedValueOnce([]); // no rack data

      const result = await service.computeEstimatesForStations([baseStation]);

      const row = result.get('station-1');
      expect(row).toBeDefined();
      expect(row!.estimateLabel?.PB_95).toBe('estimated');
      expect(row!.priceRanges).toBeDefined();
      expect(Object.keys(row!.priceRanges!)).toEqual(
        expect.arrayContaining(['PB_95', 'ON', 'LPG']),
      );
    });

    it('processes multiple stations in one rack price fetch', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
        { signal_type: 'orlen_rack_on',   value: 5.90 },
        { signal_type: 'orlen_rack_lpg',  value: 2.40 },
      ]);

      const station2 = { ...baseStation, id: 'station-2', brand: 'shell' };
      const result = await service.computeEstimatesForStations([baseStation, station2]);

      expect(result.size).toBe(2);
      // Only one DB call (rack prices fetched once)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('uses market_estimate for rack fuels and estimated for fallback fuels in same row', async () => {
      // Only PB_95 rack data available — ON and LPG must fall back to national average
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
      ]);

      const result = await service.computeEstimatesForStations([baseStation]);
      const row = result.get('station-1');

      expect(row).toBeDefined();
      expect(row!.estimateLabel?.PB_95).toBe('market_estimate');
      expect(row!.estimateLabel?.ON).toBe('estimated');
      expect(row!.estimateLabel?.LPG).toBe('estimated');
      expect(row!.sources?.PB_95).toBe('seeded');
      expect(row!.sources?.ON).toBe('seeded');
      expect(row!.sources?.LPG).toBe('seeded');
      // All three fuels have price ranges
      expect(row!.priceRanges?.PB_95).toBeDefined();
      expect(row!.priceRanges?.ON).toBeDefined();
      expect(row!.priceRanges?.LPG).toBeDefined();
    });

    it('prices and priceRanges midpoints match', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { signal_type: 'orlen_rack_pb95', value: 5.80 },
        { signal_type: 'orlen_rack_on',   value: 5.90 },
        { signal_type: 'orlen_rack_lpg',  value: 2.40 },
      ]);

      const result = await service.computeEstimatesForStations([baseStation]);
      const row = result.get('station-1')!;

      for (const [ft, midpoint] of Object.entries(row.prices)) {
        const range = row.priceRanges![ft]!;
        // midpoint should be exactly between low and high
        expect((range.low + range.high) / 2).toBeCloseTo(midpoint, 1);
      }
    });
  });
});
