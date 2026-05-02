import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FillupService } from './fillup.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationService } from '../station/station.service.js';
import { RegionalBenchmarkService } from '../regional-benchmark/regional-benchmark.service.js';
import { VoivodeshipLookupService } from './voivodeship-lookup.service.js';

const mockVehicleFindUnique = jest.fn();
const mockVehicleUpdateMany = jest.fn();
const mockUserFindUnique = jest.fn();
const mockStationFindUnique = jest.fn();
const mockFillupCreate = jest.fn();
const mockFillupFindMany = jest.fn();
const mockFillupCount = jest.fn();
const mockFillupAggregate = jest.fn();
const mockQueryRaw = jest.fn();
const mockPriceHistoryCreate = jest.fn();
const mockStalenessDeleteMany = jest.fn();

const mockPrisma = {
  vehicle: { findUnique: mockVehicleFindUnique, updateMany: mockVehicleUpdateMany },
  user: { findUnique: mockUserFindUnique },
  station: { findUnique: mockStationFindUnique },
  fillUp: {
    create: mockFillupCreate,
    findMany: mockFillupFindMany,
    count: mockFillupCount,
    aggregate: mockFillupAggregate,
  },
  priceHistory: { create: mockPriceHistoryCreate },
  stationFuelStaleness: { deleteMany: mockStalenessDeleteMany },
  $queryRaw: mockQueryRaw,
};

const mockFindNearestStation = jest.fn();
const mockGetLatestForStation = jest.fn();
const mockGetLatestForVoivodeship = jest.fn();
const mockLookupByGps = jest.fn();

const USER_ID = 'user-A';
const OTHER_USER_ID = 'user-B';
const VEHICLE_ID = 'veh-1';
const STATION_ID = 'sta-1';
const FILLUP_ID = 'fu-1';

function makeVehicle(overrides: Partial<{ id: string; user_id: string; is_locked: boolean }> = {}) {
  return {
    id: VEHICLE_ID,
    user_id: USER_ID,
    is_locked: false,
    ...overrides,
  };
}

function baseDto() {
  return {
    vehicleId: VEHICLE_ID,
    fuelType: 'PB_95' as const,
    litres: 47.3,
    totalCostPln: 314.5,
    pricePerLitrePln: 6.65,
    gpsLat: 51.7592,
    gpsLng: 19.456,
  };
}

describe('FillupService', () => {
  let service: FillupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFillupCreate.mockImplementation(({ data }) => Promise.resolve({ id: FILLUP_ID, ...data }));
    mockVehicleUpdateMany.mockResolvedValue({ count: 1 });
    mockPriceHistoryCreate.mockResolvedValue({});
    mockStalenessDeleteMany.mockResolvedValue({ count: 0 });
    // Default: user is not shadow-banned. Individual tests override when
    // exercising the shadow-ban path.
    mockUserFindUnique.mockResolvedValue({ shadow_banned: false });
    // Default: station has a voivodeship. Story 5.3 adds the station lookup
    // to populate FillUp.voivodeship from station.voivodeship when matched.
    mockStationFindUnique.mockResolvedValue({ voivodeship: 'lodzkie' });
    // Default: GPS reverse-geocode returns null (only consulted when no
    // station matched).
    mockLookupByGps.mockResolvedValue(null);
    mockGetLatestForVoivodeship.mockResolvedValue(null);
    // listFillups defaults — empty aggregate + zero raw savings so the
    // existing 3 tests that don't override these still get a clean
    // summary block back (instead of undefined-traversal errors).
    mockFillupAggregate.mockResolvedValue({
      _sum: { total_cost_pln: 0, litres: 0 },
      _avg: { price_per_litre_pln: null, consumption_l_per_100km: null },
      _count: { _all: 0 },
    });
    mockQueryRaw.mockResolvedValue([{ total_savings: 0, counted: BigInt(0) }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StationService, useValue: { findNearestStation: mockFindNearestStation } },
        {
          provide: RegionalBenchmarkService,
          useValue: {
            getLatestForStation: mockGetLatestForStation,
            getLatestForVoivodeship: mockGetLatestForVoivodeship,
          },
        },
        { provide: VoivodeshipLookupService, useValue: { lookupByGps: mockLookupByGps } },
      ],
    }).compile();

    service = module.get<FillupService>(FillupService);
  });

  // ── createFillup ─────────────────────────────────────────────────────────

  describe('createFillup', () => {
    it('throws NotFound when the vehicle id does not exist', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(null);

      await expect(service.createFillup(USER_ID, baseDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockFillupCreate).not.toHaveBeenCalled();
    });

    it('throws Forbidden when the vehicle belongs to another user', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle({ user_id: OTHER_USER_ID }));

      await expect(service.createFillup(USER_ID, baseDto())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockFillupCreate).not.toHaveBeenCalled();
    });

    it('matches station via GPS within 200m and writes PriceHistory + clears staleness', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });

      const result = await service.createFillup(USER_ID, baseDto());

      expect(mockFindNearestStation).toHaveBeenCalledWith(51.7592, 19.456, 200);
      expect(mockPriceHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            station_id: STATION_ID,
            fuel_type: 'PB_95',
            price: 6.65,
            source: 'community',
          }),
        }),
      );
      expect(mockStalenessDeleteMany).toHaveBeenCalledWith({
        where: { station_id: STATION_ID, fuel_type: 'PB_95' },
      });
      expect(result.stationMatched).toBe(true);
      expect(result.stationName).toBe('Orlen Łódź');
      expect(result.communityUpdated).toBe(true);
    });

    it('skips community PriceHistory write when the user is shadow-banned (P-3)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });
      mockUserFindUnique.mockResolvedValueOnce({ shadow_banned: true });

      const result = await service.createFillup(USER_ID, baseDto());

      // FillUp itself still saves — driver's own history is theirs.
      expect(mockFillupCreate).toHaveBeenCalled();
      // Community side-effects suppressed.
      expect(mockPriceHistoryCreate).not.toHaveBeenCalled();
      expect(mockStalenessDeleteMany).not.toHaveBeenCalled();
      // stationMatched still true — the station was matched, just no community write.
      expect(result.stationMatched).toBe(true);
      expect(result.communityUpdated).toBe(false);
    });

    it('skips community PriceHistory write when price is below the plausibility band (P-4)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });

      // PB_95 band is 4.0–12.0 PLN/L. 1.00 is a typo; community write must skip.
      const garbage = { ...baseDto(), pricePerLitrePln: 1.0 };
      const result = await service.createFillup(USER_ID, garbage);

      expect(mockFillupCreate).toHaveBeenCalled();
      expect(mockPriceHistoryCreate).not.toHaveBeenCalled();
      expect(mockStalenessDeleteMany).not.toHaveBeenCalled();
      expect(result.communityUpdated).toBe(false);
    });

    it('skips community PriceHistory write when price is above the plausibility band (P-4)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });

      // PB_95 max is 12.0 PLN/L. 50 is impossible; community write must skip.
      const garbage = { ...baseDto(), pricePerLitrePln: 50 };
      const result = await service.createFillup(USER_ID, garbage);

      expect(mockPriceHistoryCreate).not.toHaveBeenCalled();
      expect(result.communityUpdated).toBe(false);
    });

    it('still writes community PriceHistory at LPG band edges (band lookup is fuel-type-aware)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 3.5 });

      // LPG band is 2.0–6.0 PLN/L — 3.0 is fine, where 3.0 for PB_95 would be below band.
      const lpg = { ...baseDto(), fuelType: 'LPG' as const, pricePerLitrePln: 3.0 };
      const result = await service.createFillup(USER_ID, lpg);

      expect(mockPriceHistoryCreate).toHaveBeenCalled();
      expect(result.communityUpdated).toBe(true);
    });

    // ── Story 5.3: voivodeship resolution + savings ────────────────────

    it('snapshots voivodeship from station when matched (Story 5.3)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'lodzkie' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });

      await service.createFillup(USER_ID, baseDto());

      // FillUp row carries the station's voivodeship.
      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voivodeship: 'lodzkie' }),
        }),
      );
      // Should NOT call Nominatim when a station was matched — the station's
      // voivodeship is authoritative. Nominatim is the fallback only.
      expect(mockLookupByGps).not.toHaveBeenCalled();
    });

    it('reverse-geocodes voivodeship via Nominatim when no station matched (Story 5.3 AC3)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce(null);
      mockLookupByGps.mockResolvedValueOnce('mazowieckie');
      mockGetLatestForVoivodeship.mockResolvedValueOnce({ medianPrice: 6.4 });

      const result = await service.createFillup(USER_ID, baseDto());

      expect(mockLookupByGps).toHaveBeenCalledWith(51.7592, 19.456);
      // Voivodeship-keyed benchmark lookup (not station-keyed).
      expect(mockGetLatestForVoivodeship).toHaveBeenCalledWith('mazowieckie', 'PB_95');
      expect(mockGetLatestForStation).not.toHaveBeenCalled();
      // Result should still report stationMatched: false (no station link)
      // but the FillUp row carries the reverse-geocoded voivodeship and a
      // benchmark-derived areaAvg.
      expect(result.stationMatched).toBe(false);
      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            voivodeship: 'mazowieckie',
            area_avg_at_fillup: 6.4,
            station_id: null,
          }),
        }),
      );
    });

    it('saves voivodeship: null when GPS reverse-geocode returns null', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce(null);
      mockLookupByGps.mockResolvedValueOnce(null);

      await service.createFillup(USER_ID, baseDto());

      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            voivodeship: null,
            area_avg_at_fillup: null,
          }),
        }),
      );
      // No benchmark lookup on either path when voivodeship is null.
      expect(mockGetLatestForStation).not.toHaveBeenCalled();
      expect(mockGetLatestForVoivodeship).not.toHaveBeenCalled();
    });

    it('skips Nominatim entirely when GPS coords are missing (no fillback path)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());

      const dto = baseDto();
      delete (dto as { gpsLat?: number }).gpsLat;
      delete (dto as { gpsLng?: number }).gpsLng;

      await service.createFillup(USER_ID, dto);

      expect(mockLookupByGps).not.toHaveBeenCalled();
      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voivodeship: null }),
        }),
      );
    });

    it('returns positive savingsPln when paid below area average (Story 5.3 AC1)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'lodzkie' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 7.0 });

      // After P-3 grosz-integer math, the result is deterministic across
      // platforms. round(7.0×47.3×100) − round(6.65×47.3×100) = 33110 − 31455 = 1655 → 16.55.
      const result = await service.createFillup(USER_ID, baseDto());

      expect(result.savingsPln).toBe(16.55);
    });

    it('returns negative savingsPln when paid above area average', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockStationFindUnique.mockResolvedValueOnce({ voivodeship: 'lodzkie' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.0 });

      // P-3: deterministic via grosz-integer math.
      const result = await service.createFillup(USER_ID, baseDto());

      expect(result.savingsPln).toBe(-30.75);
    });

    it('returns savingsPln: null when areaAvgAtFillup is missing (Story 5.3 AC2)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce(null);
      mockLookupByGps.mockResolvedValueOnce('lodzkie');
      mockGetLatestForVoivodeship.mockResolvedValueOnce(null); // no benchmark

      const result = await service.createFillup(USER_ID, baseDto());

      expect(result.savingsPln).toBeNull();
    });

    it('snapshots area_avg_at_fillup from RegionalBenchmark when station matched', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.42 });

      await service.createFillup(USER_ID, baseDto());

      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ area_avg_at_fillup: 6.42 }),
        }),
      );
    });

    it('persists area_avg_at_fillup as null when no benchmark exists for the voivodeship', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce(null);

      await service.createFillup(USER_ID, baseDto());

      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ area_avg_at_fillup: null }),
        }),
      );
    });

    it('saves without station link when GPS match returns nothing within 200m (AC8)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce(null);

      const result = await service.createFillup(USER_ID, baseDto());

      expect(result.stationMatched).toBe(false);
      expect(result.stationName).toBeNull();
      expect(result.communityUpdated).toBe(false);
      // Critical: NO PriceHistory write, NO benchmark fetch, NO staleness clear.
      expect(mockPriceHistoryCreate).not.toHaveBeenCalled();
      expect(mockGetLatestForStation).not.toHaveBeenCalled();
      expect(mockStalenessDeleteMany).not.toHaveBeenCalled();
      // FillUp itself still saves with station_id: null and area_avg: null.
      expect(mockFillupCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ station_id: null, area_avg_at_fillup: null }),
        }),
      );
    });

    it('skips station matching entirely when GPS coords are missing', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());

      const dto = baseDto();
      delete (dto as { gpsLat?: number }).gpsLat;
      delete (dto as { gpsLng?: number }).gpsLng;

      const result = await service.createFillup(USER_ID, dto);

      expect(mockFindNearestStation).not.toHaveBeenCalled();
      expect(result.stationMatched).toBe(false);
    });

    it('locks the vehicle on first fill-up (atomic updateMany with is_locked: false predicate)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: false }));
      mockFindNearestStation.mockResolvedValueOnce(null);

      await service.createFillup(USER_ID, baseDto());

      expect(mockVehicleUpdateMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, is_locked: false },
        data: { is_locked: true },
      });
    });

    it('does NOT call updateMany when the vehicle is already locked (no-op fast path)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true }));
      mockFindNearestStation.mockResolvedValueOnce(null);

      await service.createFillup(USER_ID, baseDto());

      expect(mockVehicleUpdateMany).not.toHaveBeenCalled();
    });

    it('uses provided filledAt when present, otherwise defaults to now', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce(null);

      const explicitDate = '2026-04-15T09:30:00.000Z';
      await service.createFillup(USER_ID, { ...baseDto(), filledAt: explicitDate });

      const call = mockFillupCreate.mock.calls[0]![0];
      expect(call.data.filled_at).toEqual(new Date(explicitDate));
    });

    it('does not propagate PriceHistory write failures (best-effort side effect)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });
      mockPriceHistoryCreate.mockRejectedValueOnce(new Error('PriceHistory write failed'));

      const result = await service.createFillup(USER_ID, baseDto());

      // FillUp still returned successfully.
      expect(result.fillUp.id).toBe(FILLUP_ID);
      // communityUpdated stays false because the write failed.
      expect(result.communityUpdated).toBe(false);
    });

    it('does not propagate staleness clear failures', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockFindNearestStation.mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen Łódź' });
      mockGetLatestForStation.mockResolvedValueOnce({ medianPrice: 6.5 });
      mockStalenessDeleteMany.mockRejectedValueOnce(new Error('staleness clear failed'));

      await expect(service.createFillup(USER_ID, baseDto())).resolves.toEqual(
        expect.objectContaining({ stationMatched: true, communityUpdated: true }),
      );
    });
  });

  // ── listFillups (Story 5.5: period + summary + vehicleId='all') ─────────

  describe('listFillups', () => {
    it('paginates newest-first scoped to the user (no vehicle filter)', async () => {
      mockFillupFindMany.mockResolvedValueOnce([{ id: 'fu-2' }, { id: 'fu-1' }]);
      mockFillupCount.mockResolvedValueOnce(2);

      const result = await service.listFillups(USER_ID, undefined, 'all', 1, 20);

      expect(mockFillupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID },
          orderBy: { filled_at: 'desc' },
          skip: 0,
          take: 20,
          // Vehicle + station joins are needed by the mobile FillUpCard.
          include: {
            vehicle: { select: { id: true, nickname: true, make: true, model: true } },
            station: { select: { id: true, name: true } },
          },
        }),
      );
      expect(result.data).toEqual([{ id: 'fu-2' }, { id: 'fu-1' }]);
      expect(result.total).toBe(2);
    });

    it("treats vehicleId='all' as no vehicle filter (AC4)", async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      await service.listFillups(USER_ID, 'all', 'all', 1, 20);

      expect(mockFillupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID }, // no vehicle_id predicate
        }),
      );
    });

    it('filters by vehicleId when a UUID is provided (still scoped to user)', async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      await service.listFillups(USER_ID, VEHICLE_ID, 'all', 1, 20);

      expect(mockFillupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID, vehicle_id: VEHICLE_ID },
        }),
      );
    });

    it('applies a filled_at >= cutoff predicate for period=30d', async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      const before = Date.now();
      await service.listFillups(USER_ID, undefined, '30d', 1, 20);
      const after = Date.now();

      const findCall = mockFillupFindMany.mock.calls[0][0] as {
        where: { filled_at: { gte: Date } };
      };
      const cutoff = findCall.where.filled_at.gte.getTime();
      // Expect the cutoff to land within [before-30d, after-30d].
      expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 24 * 60 * 60 * 1000 - 50);
      expect(cutoff).toBeLessThanOrEqual(after - 30 * 24 * 60 * 60 * 1000 + 50);
    });

    it("omits the date predicate entirely for period='all'", async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      await service.listFillups(USER_ID, undefined, 'all', 1, 20);

      const findCall = mockFillupFindMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(findCall.where).toEqual({ user_id: USER_ID });
    });

    it('clamps page below 1 and limit above 100', async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      await service.listFillups(USER_ID, undefined, 'all', -3, 9999);

      expect(mockFillupFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    // ── Summary aggregation (AC3 / AC6) ─────────────────────────────────

    it('returns a populated summary when fill-ups exist in the period', async () => {
      mockFillupFindMany.mockResolvedValueOnce([{ id: 'fu-1' }]);
      mockFillupCount.mockResolvedValueOnce(3);
      mockFillupAggregate.mockResolvedValueOnce({
        _sum: { total_cost_pln: 942.5, litres: 140.3 },
        _avg: { price_per_litre_pln: 6.7184, consumption_l_per_100km: 7.234 },
        _count: { _all: 3 },
      });
      mockQueryRaw.mockResolvedValueOnce([{ total_savings: 12.34567, counted: BigInt(2) }]);

      const result = await service.listFillups(USER_ID, undefined, '3m', 1, 20);

      expect(result.summary).toEqual({
        totalSpendPln: 942.5,
        totalLitres: 140.3,
        avgPricePerLitrePln: 6.718, // 3dp rounding
        totalSavingsPln: 12.35,     // 2dp grosz rounding
        avgConsumptionL100km: 7.2,  // 1dp rounding
        fillupCount: 3,
      });
    });

    it('returns null totalSavingsPln when no fill-ups have area_avg (AC2 distinction)', async () => {
      mockFillupFindMany.mockResolvedValueOnce([{ id: 'fu-1' }]);
      mockFillupCount.mockResolvedValueOnce(1);
      mockFillupAggregate.mockResolvedValueOnce({
        _sum: { total_cost_pln: 100, litres: 15 },
        _avg: { price_per_litre_pln: 6.66, consumption_l_per_100km: null },
        _count: { _all: 1 },
      });
      mockQueryRaw.mockResolvedValueOnce([{ total_savings: 0, counted: BigInt(0) }]);

      const result = await service.listFillups(USER_ID, undefined, '3m', 1, 20);

      // counted=0 → null, NOT 0. Mobile uses null to hide the card entirely
      // ("no comparable area data") rather than render "0 PLN saved".
      expect(result.summary.totalSavingsPln).toBeNull();
    });

    it('returns null avgConsumptionL100km when no fill-ups have a consumption value (AC6)', async () => {
      mockFillupFindMany.mockResolvedValueOnce([{ id: 'fu-1' }]);
      mockFillupCount.mockResolvedValueOnce(1);
      mockFillupAggregate.mockResolvedValueOnce({
        _sum: { total_cost_pln: 100, litres: 15 },
        _avg: { price_per_litre_pln: 6.66, consumption_l_per_100km: null },
        _count: { _all: 1 },
      });

      const result = await service.listFillups(USER_ID, undefined, '3m', 1, 20);

      expect(result.summary.avgConsumptionL100km).toBeNull();
    });

    it('returns zeroed summary when no fill-ups exist in the period (empty state)', async () => {
      // Defaults from beforeEach already cover this — empty aggregate +
      // zero counted savings → summary with 0 spend / 0 litres / nulls
      // for averages + null savings / 0 fill-up count.
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      const result = await service.listFillups(USER_ID, undefined, '30d', 1, 20);

      expect(result.summary).toEqual({
        totalSpendPln: 0,
        totalLitres: 0,
        avgPricePerLitrePln: null,
        totalSavingsPln: null,
        avgConsumptionL100km: null,
        fillupCount: 0,
      });
    });

    // P13: the $queryRaw branch for savings is structural — built up from
    // Prisma.sql fragments based on whether scopedVehicleId / startDate
    // are set. Easy to invert a condition by accident. Asserting that
    // both filters reach the raw query when both are provided guards
    // that path.
    it('passes both vehicle scope and period cutoff to the savings raw query', async () => {
      mockFillupFindMany.mockResolvedValueOnce([]);
      mockFillupCount.mockResolvedValueOnce(0);

      await service.listFillups(USER_ID, VEHICLE_ID, '30d', 1, 20);

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      // Prisma.sql produces a tagged template object — values are exposed
      // on the first arg as `.values`. Assert both the user, the vehicle,
      // and a Date cutoff are present in the parameter set.
      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ values: unknown[] }];
      expect(sqlArg.values).toEqual(
        expect.arrayContaining([USER_ID, VEHICLE_ID, expect.any(Date)]),
      );
    });
  });
});
