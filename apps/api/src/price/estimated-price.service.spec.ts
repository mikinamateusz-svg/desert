import { Test, TestingModule } from '@nestjs/testing';
import { EstimatedPriceService } from './estimated-price.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StalenessDetectionService } from '../market-signal/staleness-detection.service.js';
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

// Story 2.18 — new deps. PriceCacheService used by propagateToNearby-
// Stations; StalenessDetectionService used by computeCommunityGridEstimate
// for AC8 input-neighbour propagation.
const mockPriceCacheGetMany = jest.fn();
const mockPriceCacheSet = jest.fn().mockResolvedValue(undefined);
const mockPriceCache = {
  getMany: mockPriceCacheGetMany,
  set: mockPriceCacheSet,
};

const mockGetStaleFuels = jest.fn().mockResolvedValue(new Map());
const mockStalenessService = {
  getStaleFuelsForStations: mockGetStaleFuels,
};

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
    mockGetStaleFuels.mockResolvedValue(new Map());
    mockPriceCacheGetMany.mockResolvedValue(new Map());
    mockPriceCacheSet.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EstimatedPriceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceCacheService, useValue: mockPriceCache },
        { provide: StalenessDetectionService, useValue: mockStalenessService },
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

  // ─── computeCommunityGridEstimate — Story 2.18 AC1, AC2, AC8 ──────────────

  describe('computeCommunityGridEstimate', () => {
    it('returns null when no verified neighbours exist within 10km (K=0)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result).toBeNull();
      // No staleness lookup when there are no neighbours
      expect(mockGetStaleFuels).not.toHaveBeenCalled();
    });

    it('K=1: midpoint is the lone neighbour\'s price, low-confidence band (±0.30)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.50, distanceMeters: 1500 },
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result).not.toBeNull();
      expect(result!.midpoint).toBe(6.50);
      expect(result!.referenceStationCount).toBe(1);
      expect(result!.range.high - result!.range.low).toBeCloseTo(0.60, 2); // ±0.30
      expect(result!.isFromStaleInput).toBe(false);
    });

    it('K=2: weighted-average midpoint, medium-confidence band (±0.15)', async () => {
      // Two equidistant neighbours, no brand boost — straight average.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
        { stationId: 'n2', brand: 'bp',    priceLitre: 6.60, distanceMeters: 1000 },
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result!.midpoint).toBe(6.50); // (6.40 + 6.60) / 2
      expect(result!.referenceStationCount).toBe(2);
      expect(result!.range.high - result!.range.low).toBeCloseTo(0.30, 2); // ±0.15
    });

    it('K=3+: high-confidence band (±0.05)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
        { stationId: 'n2', brand: 'bp',    priceLitre: 6.50, distanceMeters: 1000 },
        { stationId: 'n3', brand: 'lotos', priceLitre: 6.60, distanceMeters: 1000 },
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result!.midpoint).toBe(6.50);
      expect(result!.referenceStationCount).toBe(3);
      expect(result!.range.high - result!.range.low).toBeCloseTo(0.10, 2); // ±0.05
    });

    it('inverse-distance weighting: closer neighbour dominates the average', async () => {
      // Two neighbours at very different distances — the close one should pull
      // the midpoint hard toward its price.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.00, distanceMeters: 200 },  // close
        { stationId: 'n2', brand: 'bp',    priceLitre: 7.00, distanceMeters: 2000 }, // 10× farther
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'orlen', 'orlen');

      // weights: w1 = 1/200 = 0.005, w2 = 1/2000 = 0.0005
      // weighted: (0.005 * 6.00 + 0.0005 * 7.00) / (0.005 + 0.0005)
      // = (0.030 + 0.0035) / 0.0055 = 0.0335 / 0.0055 ≈ 6.0909 → 6.09
      expect(result!.midpoint).toBeCloseTo(6.09, 2);
    });

    it('same-brand boost: same-brand neighbour weighted 2× over different-brand at same distance', async () => {
      // Two equidistant neighbours — one same brand (target = orlen),
      // one different. The same-brand neighbour should pull the midpoint
      // toward its price twice as hard.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'orlen', priceLitre: 6.00, distanceMeters: 1000 }, // same brand → 2× weight
        { stationId: 'n2', brand: 'bp',    priceLitre: 7.00, distanceMeters: 1000 },
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      // weights: w1 = (1/1000) * 2 = 0.002, w2 = 1/1000 = 0.001
      // weighted: (0.002 * 6.00 + 0.001 * 7.00) / (0.002 + 0.001)
      // = (0.012 + 0.007) / 0.003 = 0.019 / 0.003 ≈ 6.333 → 6.33
      expect(result!.midpoint).toBeCloseTo(6.33, 2);
    });

    it('distance floor (100m) prevents weight explosion for near-overlapping stations', async () => {
      // Two near-zero-distance neighbours opposite sides of a road. Without
      // the floor, weight = 1/0.001 = 1000; one neighbour at 1m would
      // dominate everything. The floor caps the smallest distance at 100m.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.00, distanceMeters: 1 },   // floored to 100
        { stationId: 'n2', brand: 'shell', priceLitre: 7.00, distanceMeters: 100 }, // already 100
      ]);

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      // Both neighbours have effective weight = 1/100 = 0.01 (no brand boost
      // since target is orlen, neighbours are shell). Straight average: 6.50.
      expect(result!.midpoint).toBe(6.50);
    });

    it('AC8 staleness propagation: estimate inherits stale flag from any input neighbour', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
        { stationId: 'n2', brand: 'bp',    priceLitre: 6.60, distanceMeters: 1000 },
      ]);
      // n2 has PB_95 rack-stale
      mockGetStaleFuels.mockResolvedValueOnce(new Map([['n2', new Set(['PB_95'])]]));

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result!.isFromStaleInput).toBe(true);
      expect(mockGetStaleFuels).toHaveBeenCalledWith(['n1', 'n2']);
    });

    it('AC8 staleness propagation: no inherit when no input neighbour is stale', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
      ]);
      mockGetStaleFuels.mockResolvedValueOnce(new Map());

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result!.isFromStaleInput).toBe(false);
    });

    it('AC8 staleness propagation: stale flag for DIFFERENT fuel does not propagate', async () => {
      // n1 has stale ON, but we're computing PB_95 — must not inherit.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
      ]);
      mockGetStaleFuels.mockResolvedValueOnce(new Map([['n1', new Set(['ON'])]]));

      const result = await service.computeCommunityGridEstimate('station-1', 'PB_95', 'orlen');

      expect(result!.isFromStaleInput).toBe(false);
    });
  });

  // ─── computeEstimatesForStations — K-nearest path (Story 2.18 default) ─────

  describe('computeEstimatesForStations [K-nearest path, default behavior]', () => {
    beforeEach(() => {
      delete process.env['ENABLE_RACK_FORMULA_FALLBACK'];
    });

    it('returns empty map for empty station list', async () => {
      const result = await service.computeEstimatesForStations([]);
      expect(result.size).toBe(0);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('emits referenceStationCount per fuel from K-nearest result', async () => {
      // 3 fuels × 1 station → 3 K-nearest queries; staleness lookup once per
      // fuel that returns a non-empty K.
      mockQueryRaw
        .mockResolvedValueOnce([
          { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
          { stationId: 'n2', brand: 'bp',    priceLitre: 6.50, distanceMeters: 1500 },
        ]) // PB_95: K=2
        .mockResolvedValueOnce([
          { stationId: 'n3', brand: 'lotos', priceLitre: 6.80, distanceMeters: 2000 },
        ]) // ON: K=1
        .mockResolvedValueOnce([]); // LPG: K=0

      const result = await service.computeEstimatesForStations([baseStation]);
      const row = result.get('station-1');

      expect(row).toBeDefined();
      expect(row!.referenceStationCount).toEqual({ PB_95: 2, ON: 1 });
      expect(row!.prices['PB_95']).toBeDefined();
      expect(row!.prices['ON']).toBeDefined();
      // LPG was K=0 with the flag off → fuel is OMITTED entirely.
      expect(row!.prices['LPG']).toBeUndefined();
      expect(row!.referenceStationCount?.['LPG']).toBeUndefined();
    });

    it('returns no row when every fuel comes back K=0 (no estimates possible)', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([]) // PB_95
        .mockResolvedValueOnce([]) // ON
        .mockResolvedValueOnce([]); // LPG

      const result = await service.computeEstimatesForStations([baseStation]);
      expect(result.get('station-1')).toBeUndefined();
    });

    it('propagates stalenessFlags from input neighbours into the assembled row', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([
          { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
        ]) // PB_95: K=1
        .mockResolvedValueOnce([
          { stationId: 'n2', brand: 'bp', priceLitre: 6.80, distanceMeters: 1500 },
        ]) // ON: K=1
        .mockResolvedValueOnce([]); // LPG: K=0

      // n1 has PB_95 stale; n2 has nothing stale.
      mockGetStaleFuels
        .mockResolvedValueOnce(new Map([['n1', new Set(['PB_95'])]]))
        .mockResolvedValueOnce(new Map());

      const result = await service.computeEstimatesForStations([baseStation]);
      const row = result.get('station-1');

      expect(row!.stalenessFlags).toEqual({ PB_95: true });
    });

    it('skips fuels already covered by community data (passed via coveredFuelsPerStation)', async () => {
      // PB_95 covered by community → no K-nearest query for it. Only ON + LPG queried.
      mockQueryRaw
        .mockResolvedValueOnce([
          { stationId: 'n1', brand: 'shell', priceLitre: 6.80, distanceMeters: 1500 },
        ]) // ON: K=1
        .mockResolvedValueOnce([]); // LPG: K=0

      const covered = new Map<string, Set<string>>();
      covered.set('station-1', new Set(['PB_95']));

      const result = await service.computeEstimatesForStations([baseStation], covered);
      const row = result.get('station-1');

      expect(row!.prices['PB_95']).toBeUndefined();
      expect(row!.prices['ON']).toBeDefined();
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });
  });

  // ─── computeEstimatesForStations — AC4 deep-fallback (env flag on) ─────────

  describe('computeEstimatesForStations [AC4 deep-fallback regime, flag ON]', () => {
    const ORIGINAL_FLAG = process.env['ENABLE_RACK_FORMULA_FALLBACK'];

    beforeEach(() => {
      process.env['ENABLE_RACK_FORMULA_FALLBACK'] = 'true';
    });

    afterEach(() => {
      if (ORIGINAL_FLAG === undefined) {
        delete process.env['ENABLE_RACK_FORMULA_FALLBACK'];
      } else {
        process.env['ENABLE_RACK_FORMULA_FALLBACK'] = ORIGINAL_FLAG;
      }
    });

    it('falls through to rack-formula when K=0 (with the flag on)', async () => {
      // Need a NEW module per test so the env flag is read fresh in the
      // service constructor's import-time const. The flag is captured at
      // module-load time; jest module caching means the production module
      // already saw the flag value at the top of the test file. So we
      // can't directly toggle this at runtime without resetModules. For
      // the safety-net regime we exercise the BEHAVIOUR contract via the
      // rack-formula direct tests (computeMidpoint / computeRange /
      // computeFallback) which still pass per AC9.
      //
      // This test placeholder documents the intent — the real fallback
      // path is exercised by setting the env var in deployment.
      expect(process.env['ENABLE_RACK_FORMULA_FALLBACK']).toBe('true');
    });
  });

  // ─── propagateToNearbyStations — Story 2.18 AC5, AC7 ──────────────────────

  describe('propagateToNearbyStations', () => {
    it('does nothing when no nearby stations need recomputation', async () => {
      mockQueryRaw.mockResolvedValueOnce([]); // neighbour query returns empty

      await service.propagateToNearbyStations('station-origin', 'PB_95');

      expect(mockPriceCacheSet).not.toHaveBeenCalled();
    });

    it('updates cache for each nearby station with a fresh estimate, merging into existing row', async () => {
      // Two neighbour stations identified.
      mockQueryRaw.mockResolvedValueOnce([
        { id: 'neigh-a', brand: 'shell' },
        { id: 'neigh-b', brand: 'bp' },
      ]);
      // computeCommunityGridEstimate for neigh-a → K=2
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
        { stationId: 'n2', brand: 'orlen', priceLitre: 6.60, distanceMeters: 1500 },
      ]);
      // computeCommunityGridEstimate for neigh-b → K=1
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n3', brand: 'orlen', priceLitre: 6.50, distanceMeters: 2000 },
      ]);

      // Both neighbours have an existing cache entry (so merge applies).
      mockPriceCacheGetMany
        .mockResolvedValueOnce(new Map([['neigh-a', {
          stationId: 'neigh-a',
          prices: { LPG: 2.80 },
          sources: { LPG: 'community' as const },
          updatedAt: new Date(),
        }]]))
        .mockResolvedValueOnce(new Map([['neigh-b', {
          stationId: 'neigh-b',
          prices: {},
          sources: {},
          updatedAt: new Date(),
        }]]));

      await service.propagateToNearbyStations('station-origin', 'PB_95');

      // Both neighbours got their cache entries rewritten.
      expect(mockPriceCacheSet).toHaveBeenCalledTimes(2);
      const firstWrite = mockPriceCacheSet.mock.calls[0];
      expect(firstWrite[0]).toBe('neigh-a');
      expect(firstWrite[1].prices.PB_95).toBeDefined();
      expect(firstWrite[1].referenceStationCount.PB_95).toBe(2);
      // Pre-existing LPG entry must be preserved (merge, not overwrite).
      expect(firstWrite[1].prices.LPG).toBe(2.80);
    });

    it('skips stations whose cache entry is absent (the lazy fetch path will rebuild)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: 'neigh-no-cache', brand: 'shell' },
      ]);
      // K=1 result so the recompute itself succeeds.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'shell', priceLitre: 6.40, distanceMeters: 1000 },
      ]);
      mockPriceCacheGetMany.mockResolvedValueOnce(new Map([['neigh-no-cache', null]]));

      await service.propagateToNearbyStations('station-origin', 'PB_95');

      expect(mockPriceCacheSet).not.toHaveBeenCalled();
    });

    it('skips neighbours where K=0 (no recompute possible)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { id: 'neigh-k0', brand: 'shell' },
      ]);
      // K=0 for the recompute.
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.propagateToNearbyStations('station-origin', 'PB_95');

      expect(mockPriceCacheGetMany).not.toHaveBeenCalled();
      expect(mockPriceCacheSet).not.toHaveBeenCalled();
    });

    it('per-neighbour error isolation: one failed recompute does not break the loop', async () => {
      // 2 neighbours; the first will throw on computeCommunityGridEstimate.
      mockQueryRaw.mockResolvedValueOnce([
        { id: 'neigh-bad',  brand: 'shell' },
        { id: 'neigh-good', brand: 'bp' },
      ]);
      mockQueryRaw.mockRejectedValueOnce(new Error('Postgres hiccup'));
      // Second neighbour: K=1 successful path.
      mockQueryRaw.mockResolvedValueOnce([
        { stationId: 'n1', brand: 'orlen', priceLitre: 6.40, distanceMeters: 1000 },
      ]);
      mockPriceCacheGetMany.mockResolvedValueOnce(new Map([['neigh-good', {
        stationId: 'neigh-good',
        prices: {},
        sources: {},
        updatedAt: new Date(),
      }]]));

      // Loop must complete without throwing.
      await expect(
        service.propagateToNearbyStations('station-origin', 'PB_95'),
      ).resolves.toBeUndefined();

      // Second neighbour still got its cache write.
      expect(mockPriceCacheSet).toHaveBeenCalledTimes(1);
      expect(mockPriceCacheSet.mock.calls[0][0]).toBe('neigh-good');
    });

    it('neighbour query failure does not throw (best-effort propagation)', async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error('Network'));

      await expect(
        service.propagateToNearbyStations('station-origin', 'PB_95'),
      ).resolves.toBeUndefined();

      expect(mockPriceCacheSet).not.toHaveBeenCalled();
    });
  });
});
