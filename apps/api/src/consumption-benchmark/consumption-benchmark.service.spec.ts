import { Test, TestingModule } from '@nestjs/testing';
import { ConsumptionBenchmarkService } from './consumption-benchmark.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockQueryRaw = jest.fn();
const mockCreateMany = jest.fn();
const mockBenchmarkFindFirst = jest.fn();
const mockVehicleFindUnique = jest.fn();
const mockFillupAggregate = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
  consumptionBenchmark: {
    createMany: mockCreateMany,
    findFirst: mockBenchmarkFindFirst,
  },
  vehicle: {
    findUnique: mockVehicleFindUnique,
  },
  fillUp: {
    aggregate: mockFillupAggregate,
  },
};

const USER_ID = 'user-A';
const VEHICLE_ID = 'veh-1';

// Helpers — the service issues TWO raw queries per calculateAndStore call:
//   (1) the eligible_drivers CTE → published groups
//   (2) the eligibility-only count → skipped count
// Tests that exercise calculateAndStore must mock BOTH in order.
function mockBenchmarkRows(rows: Array<{ make: string; model: string; engine_variant: string; fuel_type: string; median_l_per_100km: number; driver_count: number }>) {
  mockQueryRaw.mockResolvedValueOnce(rows);
}
function mockEligibleDriverTotal(total: number) {
  mockQueryRaw.mockResolvedValueOnce([{ total: BigInt(total) }]);
}

// Walks a Prisma.Sql tagged-template object (and any nested arrays) and
// returns every Date instance it finds. Resilient to version changes in
// how Prisma.sql exposes its values — works whether they're on `.values`,
// `.strings`, or anywhere reachable via JSON-like traversal.
function collectDates(value: unknown): Date[] {
  if (value instanceof Date) return [value];
  if (Array.isArray(value)) return value.flatMap(collectDates);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectDates);
  }
  return [];
}

describe('ConsumptionBenchmarkService', () => {
  let service: ConsumptionBenchmarkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);
    mockCreateMany.mockResolvedValue({ count: 0 });
    mockBenchmarkFindFirst.mockResolvedValue(null);
    mockVehicleFindUnique.mockResolvedValue(null);
    mockFillupAggregate.mockResolvedValue({ _avg: { consumption_l_per_100km: null } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumptionBenchmarkService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConsumptionBenchmarkService>(ConsumptionBenchmarkService);
  });

  // ── calculateAndStore (AC4 / AC5 / AC6) ─────────────────────────────────

  describe('calculateAndStore', () => {
    it('returns { inserted: 0, skipped: 0 } when no eligible drivers exist', async () => {
      mockBenchmarkRows([]);
      mockEligibleDriverTotal(0);

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 0, skipped: 0 });
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it('reports skipped > 0 when drivers are eligible but no group hits the 10-driver floor', async () => {
      // Step-1 CTE yields no published groups.
      mockBenchmarkRows([]);
      // But there ARE 7 eligible drivers (across various groups, none ≥10).
      mockEligibleDriverTotal(7);

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 0, skipped: 7 });
    });

    it('inserts one ConsumptionBenchmark row per qualifying group, with fuel_type included', async () => {
      mockBenchmarkRows([
        { make: 'Volkswagen', model: 'Golf', engine_variant: '1.6 TDI 115 HP', fuel_type: 'ON', median_l_per_100km: 5.4, driver_count: 23 },
        { make: 'Volkswagen', model: 'Golf', engine_variant: '1.5 TSI 150 HP', fuel_type: 'PB_95', median_l_per_100km: 6.1, driver_count: 14 },
        { make: 'Skoda', model: 'Octavia', engine_variant: '1.5 TSI 150 HP', fuel_type: 'PB_95', median_l_per_100km: 6.8, driver_count: 11 },
      ]);
      mockEligibleDriverTotal(48); // 23 + 14 + 11 → 0 skipped

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 3, skipped: 0 });
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          { make: 'Volkswagen', model: 'Golf', engine_variant: '1.6 TDI 115 HP', fuel_type: 'ON', median_l_per_100km: 5.4, driver_count: 23 },
          { make: 'Volkswagen', model: 'Golf', engine_variant: '1.5 TSI 150 HP', fuel_type: 'PB_95', median_l_per_100km: 6.1, driver_count: 14 },
          { make: 'Skoda', model: 'Octavia', engine_variant: '1.5 TSI 150 HP', fuel_type: 'PB_95', median_l_per_100km: 6.8, driver_count: 11 },
        ],
      });
    });

    it('skipped reflects eligible-but-not-published drivers (groups of <10)', async () => {
      // Two published groups (23 + 14 = 37 published drivers).
      // But the eligibility CTE actually has 50 eligible drivers — 13 were
      // in groups that didn't reach the 10-driver floor.
      mockBenchmarkRows([
        { make: 'Volkswagen', model: 'Golf', engine_variant: '1.6 TDI 115 HP', fuel_type: 'ON', median_l_per_100km: 5.4, driver_count: 23 },
        { make: 'Skoda', model: 'Octavia', engine_variant: '1.5 TSI 150 HP', fuel_type: 'PB_95', median_l_per_100km: 6.8, driver_count: 14 },
      ]);
      mockEligibleDriverTotal(50);

      const result = await service.calculateAndStore();

      expect(result).toEqual({ inserted: 2, skipped: 13 });
    });

    it('does NOT pass calculated_at to createMany — relies on schema @default(now())', async () => {
      mockBenchmarkRows([
        { make: 'Toyota', model: 'Corolla', engine_variant: '1.8 Hybrid 122 HP', fuel_type: 'PB_95', median_l_per_100km: 4.2, driver_count: 31 },
      ]);
      mockEligibleDriverTotal(31);

      await service.calculateAndStore();

      const dataArg = mockCreateMany.mock.calls[0][0].data[0];
      expect(dataArg).not.toHaveProperty('calculated_at');
    });

    it('append-only — never calls deleteMany or upsert (AC4)', async () => {
      mockBenchmarkRows([
        { make: 'Ford', model: 'Focus', engine_variant: '1.5 TDCi 120 HP', fuel_type: 'ON', median_l_per_100km: 5.7, driver_count: 12 },
      ]);
      mockEligibleDriverTotal(12);

      await service.calculateAndStore();

      expect(mockCreateMany).toHaveBeenCalled();
      expect(mockPrisma.consumptionBenchmark).not.toHaveProperty('deleteMany');
      expect(mockPrisma.consumptionBenchmark).not.toHaveProperty('upsert');
    });

    it('passes a fixed cutoff date into the SQL — retries see the same window (P8)', async () => {
      mockBenchmarkRows([]);
      mockEligibleDriverTotal(0);

      const fixedNow = new Date('2026-05-03T04:00:00.000Z');
      await service.calculateAndStore(fixedNow);

      // Both raw queries fire (CTE + skipped count); both should receive
      // the same Date instance for the 90-day cutoff. We can't easily
      // introspect Prisma.sql's parameter array shape (varies across
      // versions), so we extract any Date arguments anywhere in the call
      // and confirm they all match the expected cutoff.
      const expectedCutoffMs = new Date('2026-02-02T04:00:00.000Z').getTime();
      // Tagged-template invocation passes args as (strings, ...values).
      // Walk every arg of every call to find the Date.
      const allArgs = mockQueryRaw.mock.calls.flatMap((c) => collectDates(c));
      expect(allArgs.length).toBeGreaterThan(0);
      // Every Date in the parameter array must be the same pinned cutoff —
      // catches the "NOW() - INTERVAL evaluated per-query" regression.
      for (const d of allArgs) {
        expect(d.getTime()).toBe(expectedCutoffMs);
      }
    });
  });

  // ── getForVehicle (AC1 / AC2 / AC6 + P5/P6/P9) ─────────────────────────

  describe('getForVehicle', () => {
    it('returns null when the vehicle does not exist', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(null);

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result).toBeNull();
      expect(mockBenchmarkFindFirst).not.toHaveBeenCalled();
      expect(mockFillupAggregate).not.toHaveBeenCalled();
    });

    it('returns null when the vehicle has no engine_variant (AC6)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: null,
        fuel_type: 'ON',
      });

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result).toBeNull();
      expect(mockBenchmarkFindFirst).not.toHaveBeenCalled();
    });

    it('returns null when no benchmark snapshot exists yet (AC2 — early launch)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce(null);

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result).toBeNull();
      // Lookup must scope by all four cohort keys.
      const findCall = mockBenchmarkFindFirst.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(findCall.where).toMatchObject({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
    });

    it('returns null when the latest snapshot is older than the 7-day max-age (P6)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      // Verify the findFirst call carries a recent calculated_at lower bound.
      mockBenchmarkFindFirst.mockResolvedValueOnce(null);

      await service.getForVehicle(VEHICLE_ID, USER_ID);

      const findCall = mockBenchmarkFindFirst.mock.calls[0][0] as {
        where: { calculated_at?: { gte?: Date } };
      };
      const cutoff = findCall.where.calculated_at?.gte;
      expect(cutoff).toBeInstanceOf(Date);
      // Should be ~7 days ago (allow 50ms leeway for test latency).
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(Date.now() - cutoff!.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 50);
      expect(Date.now() - cutoff!.getTime()).toBeLessThanOrEqual(sevenDaysMs + 50);
    });

    it('clamps driverCount to 10 for cohorts of 10–19 drivers (P5 — privacy floor)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce({
        median_l_per_100km: 5.4,
        driver_count: 11, // raw cohort count
        calculated_at: new Date('2026-05-03T04:00:00.000Z'),
      });
      mockFillupAggregate.mockResolvedValueOnce({
        _avg: { consumption_l_per_100km: 5.7 },
      });

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      // Network sniffer / API-direct caller sees 10, NOT 11.
      expect(result?.driverCount).toBe(10);
    });

    it('returns the exact driverCount once the cohort reaches 20+ drivers', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce({
        median_l_per_100km: 5.4,
        driver_count: 47,
        calculated_at: new Date('2026-05-03T04:00:00.000Z'),
      });
      mockFillupAggregate.mockResolvedValueOnce({
        _avg: { consumption_l_per_100km: 5.7 },
      });

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result?.driverCount).toBe(47);
    });

    it('returns the latest benchmark with rounded values + fuel_type echoed', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce({
        median_l_per_100km: 5.4321,
        driver_count: 27,
        calculated_at: new Date('2026-05-03T04:00:00.000Z'),
      });
      mockFillupAggregate.mockResolvedValueOnce({
        _avg: { consumption_l_per_100km: 5.6789 },
      });

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result).toEqual({
        make: 'Volkswagen',
        model: 'Golf',
        engineVariant: '1.6 TDI 115 HP',
        fuelType: 'ON',
        medianL100km: 5.4,
        driverCount: 27,
        calculatedAt: '2026-05-03T04:00:00.000Z',
        yourAvgL100km: 5.7,
      });
    });

    it('returns yourAvgL100km: null when the driver has no consumption data yet', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce({
        median_l_per_100km: 5.4,
        driver_count: 27,
        calculated_at: new Date('2026-05-03T04:00:00.000Z'),
      });
      mockFillupAggregate.mockResolvedValueOnce({
        _avg: { consumption_l_per_100km: null },
      });

      const result = await service.getForVehicle(VEHICLE_ID, USER_ID);

      expect(result?.yourAvgL100km).toBeNull();
      expect(result?.medianL100km).toBe(5.4);
    });

    it('scopes own-avg by (user, make, model, engine, fuel) — not by single vehicle_id (P9)', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      mockBenchmarkFindFirst.mockResolvedValueOnce({
        median_l_per_100km: 5.4,
        driver_count: 27,
        calculated_at: new Date('2026-05-03T04:00:00.000Z'),
      });
      mockFillupAggregate.mockResolvedValueOnce({
        _avg: { consumption_l_per_100km: 5.7 },
      });

      await service.getForVehicle(VEHICLE_ID, USER_ID);

      const aggregateCall = mockFillupAggregate.mock.calls[0][0];
      expect(aggregateCall.where.user_id).toBe(USER_ID);
      // Filter is by vehicle relation (matching tuple), NOT by vehicle_id.
      // A user with two identical Golfs sees both contribute to "yours".
      expect(aggregateCall.where).not.toHaveProperty('vehicle_id');
      expect(aggregateCall.where.vehicle).toEqual({
        make: 'Volkswagen',
        model: 'Golf',
        engine_variant: '1.6 TDI 115 HP',
        fuel_type: 'ON',
      });
      // Sanity bounds applied — own-avg uses the same window the snapshot does.
      expect(aggregateCall.where.consumption_l_per_100km).toMatchObject({
        not: null,
        gte: 1.0,
        lte: 30.0,
      });
    });
  });
});
