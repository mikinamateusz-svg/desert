import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface BenchmarkRow {
  make: string;
  model: string;
  engine_variant: string;
  fuel_type: string;
  median_l_per_100km: number;
  driver_count: number;
}

export interface ConsumptionBenchmarkDto {
  make: string;
  model: string;
  engineVariant: string;
  /** Same fuel_type the user's vehicle has — diesel and PHEV variants of
   *  the same model never pool. */
  fuelType: string;
  medianL100km: number;
  /**
   * Privacy-clamped: returns 10 (the floor) when the actual cohort is
   * 10–19 drivers, exact count otherwise. Mobile renders "10+ drivers"
   * for the clamped value. Server-side clamp matters because anyone with
   * a network sniffer could otherwise see the exact small-cohort count.
   */
  driverCount: number;
  calculatedAt: string;
  /** Driver's avg over the same window AND the same (make, model, engine,
   *  fuel) tuple — apples-to-apples with the community comparator. Null
   *  when the driver has no consumption data yet. */
  yourAvgL100km: number | null;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
// Snapshots older than this are treated as stale and omitted by
// getForVehicle. Without this filter, a cohort that briefly hit the
// ≥10-driver threshold one day and then dropped below would leak the
// stale snapshot indefinitely — undoing the privacy floor (Edge #5).
// 7 days lets a single missed daily run still publish, but not 6 months
// of inertia.
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Privacy floor — must match the mobile UI's BENCHMARK_PRIVACY_FLOOR.
// Counts below this are clamped to MIN_DRIVERS_TO_QUALIFY in the DTO.
const PRIVACY_FLOOR = 20;
const MIN_DRIVERS_TO_QUALIFY = 10;
// Sanity bounds on per-segment consumption. Below 1 L/100km is
// physically impossible for ICE; above 30 L/100km is essentially only
// achievable by typo'd odometer readings (small-km segments dividing
// large fuel volumes). Values outside drag the median wildly with very
// few outliers.
const MIN_PLAUSIBLE_L_PER_100KM = 1.0;
const MAX_PLAUSIBLE_L_PER_100KM = 30.0;

function round1dp(value: number): number {
  // FP-stable 1dp rounding. The naive `Math.round(x * 10) / 10` returns
  // 5.4 for 5.45 because 5.45*10 = 54.49999... due to IEEE 754. Adding
  // Number.EPSILON nudges values that should round up across the .5
  // boundary correctly.
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/**
 * Per-vehicle real-world consumption benchmarks (Story 5.6).
 *
 * Two callers:
 *   - ConsumptionBenchmarkWorker (daily 04:00 UTC) → calculateAndStore()
 *   - VehiclesController GET /v1/me/vehicles/:id/benchmark → getForVehicle()
 *
 * The aggregation is gated on TWO independent thresholds:
 *   1. Per-driver minimum: a driver must have ≥3 consumption segments for
 *      a given (make × model × engine_variant) to contribute. Filters out
 *      single-data-point noise from new users / one-off rentals (AC5).
 *   2. Per-group minimum: a (make × model × engine_variant) group must
 *      have ≥10 distinct contributing drivers to publish a benchmark.
 *      Privacy + signal floor (AC1, AC2).
 *
 * Vehicles missing engine_variant (Story 5.1 free-text fallback) are
 * excluded entirely — a benchmark spanning multiple unspecified engines
 * would be misleading (AC6).
 */
@Injectable()
export class ConsumptionBenchmarkService {
  private readonly logger = new Logger(ConsumptionBenchmarkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily snapshot. For every (make × model × engine_variant × fuel_type)
   * that meets both thresholds, computes the median l/100km **across
   * eligible drivers** (each driver represented by their per-cohort
   * average) in the last 90 days and inserts a fresh ConsumptionBenchmark
   * row. Append-only — never overwrites.
   *
   * Statistical correctness notes (CR P1 / P2 / P3 / P4 / P7):
   *   - Per-driver AVG before per-cohort MEDIAN: prevents heavy users
   *     (taxi: 90 fill-ups vs casual: 3) from dominating the median.
   *     The natural one-row-per-driver shape also collapses the prior
   *     CTE's double-counting bug for users who own multiple vehicles
   *     of the same model.
   *   - fuel_type in the GROUP BY: stops PHEV / EV / diesel variants of
   *     the same nameplate from pooling silently.
   *   - consumption sanity bounds: filters out odometer-typo segments
   *     that produce 6000 L/100km values poisoning the median.
   *   - user_entered = false: only catalog vehicles contribute. Free-text
   *     entries fragment cohorts ("Volkswagen" vs "VOLKSWAGEN"), defeating
   *     the privacy floor.
   *   - User.deleted_at IS NULL: GDPR — soft-deleted users' data exits
   *     aggregates the day they delete.
   *
   * Returns insert + skip counts. `skipped` is the number of (driver, group)
   * pairs that were filtered by the per-driver ≥3-segment rule but didn't
   * make it into the published benchmarks (either group failed the ≥10
   * threshold OR all eligible drivers were in such a group). Useful for
   * ops visibility into "how close are we to publishing this group?".
   */
  async calculateAndStore(now: Date = new Date()): Promise<{ inserted: number; skipped: number }> {
    // P8: pin the 90-day cutoff once. Prior code used `NOW() - INTERVAL`
    // inside the SQL, which is evaluated at query-execution time — retries
    // (1h/6h/24h later) saw a different window than the original attempt,
    // making the "snapshot" non-reproducible across retry attempts.
    const cutoff = new Date(now.getTime() - NINETY_DAYS_MS);

    // Single CTE chain:
    //   eligible_drivers  → 1 row per (driver × group) with their AVG
    //                       consumption, gated by ≥3 segments.
    //   benchmarks        → 1 row per group with median over the per-driver
    //                       averages, gated by ≥10 distinct drivers.
    // Counted-but-not-published rows are computed by counting eligible
    // drivers minus those that made it into a published group.
    const rows = await this.prisma.$queryRaw<BenchmarkRow[]>`
      WITH eligible_drivers AS (
        SELECT
          f.user_id,
          v.make,
          v.model,
          v.engine_variant,
          v.fuel_type,
          AVG(f.consumption_l_per_100km)::float8 AS driver_avg
        FROM "FillUp" f
        JOIN "Vehicle" v ON v.id = f.vehicle_id
        JOIN "User" u ON u.id = f.user_id
        WHERE f.consumption_l_per_100km IS NOT NULL
          AND f.consumption_l_per_100km BETWEEN ${MIN_PLAUSIBLE_L_PER_100KM} AND ${MAX_PLAUSIBLE_L_PER_100KM}
          AND f.filled_at >= ${cutoff}
          AND v.engine_variant IS NOT NULL
          AND TRIM(v.engine_variant) != ''
          AND v.user_entered = false
          AND u.deleted_at IS NULL
        GROUP BY f.user_id, v.make, v.model, v.engine_variant, v.fuel_type
        HAVING COUNT(*) >= 3
      )
      SELECT
        ed.make,
        ed.model,
        ed.engine_variant,
        ed.fuel_type,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY ed.driver_avg
        )::float8 AS median_l_per_100km,
        COUNT(*)::int AS driver_count
      FROM eligible_drivers ed
      GROUP BY ed.make, ed.model, ed.engine_variant, ed.fuel_type
      HAVING COUNT(*) >= ${MIN_DRIVERS_TO_QUALIFY}
    `;

    // skipped = eligible drivers that didn't land in a published group.
    // Same eligibility CTE filters; we just count the leftover. Cheaper
    // than rerunning the full CTE — the planner can reuse the cached
    // result via the same expressions, though with raw SQL we just
    // re-issue it. Kept simple: small additional query, ops-only signal.
    const eligibleTotal = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total FROM (
        SELECT 1
        FROM "FillUp" f
        JOIN "Vehicle" v ON v.id = f.vehicle_id
        JOIN "User" u ON u.id = f.user_id
        WHERE f.consumption_l_per_100km IS NOT NULL
          AND f.consumption_l_per_100km BETWEEN ${MIN_PLAUSIBLE_L_PER_100KM} AND ${MAX_PLAUSIBLE_L_PER_100KM}
          AND f.filled_at >= ${cutoff}
          AND v.engine_variant IS NOT NULL
          AND TRIM(v.engine_variant) != ''
          AND v.user_entered = false
          AND u.deleted_at IS NULL
        GROUP BY f.user_id, v.make, v.model, v.engine_variant, v.fuel_type
        HAVING COUNT(*) >= 3
      ) AS eligible
    `;
    const totalEligibleDrivers = eligibleTotal[0]
      ? Number(eligibleTotal[0].total)
      : 0;
    const publishedDrivers = rows.reduce((acc, r) => acc + r.driver_count, 0);
    const skipped = Math.max(0, totalEligibleDrivers - publishedDrivers);

    if (rows.length === 0) {
      this.logger.log(
        `[ConsumptionBenchmark] no (make × model × engine × fuel) groups met the ≥10-driver threshold — nothing inserted (${skipped} eligible drivers skipped).`,
      );
      return { inserted: 0, skipped };
    }

    await this.prisma.consumptionBenchmark.createMany({
      data: rows.map((r) => ({
        make: r.make,
        model: r.model,
        engine_variant: r.engine_variant,
        fuel_type: r.fuel_type,
        median_l_per_100km: r.median_l_per_100km,
        driver_count: r.driver_count,
        // calculated_at defaults to now() in schema
      })),
    });

    return { inserted: rows.length, skipped };
  }

  /**
   * Look up the most recent benchmark for the given vehicle's make ×
   * model × engine_variant, plus the driver's own avg consumption over
   * the same 90-day window for inline comparison.
   *
   * Returns null when:
   *   - The vehicle has no engine_variant (AC6)
   *   - No benchmark snapshot exists for that combination (early launch /
   *     <10 contributing drivers — AC2)
   *
   * Mobile treats null as "omit the benchmark section entirely" — no
   * placeholder, no "not enough data yet" copy.
   */
  async getForVehicle(
    vehicleId: string,
    userId: string,
  ): Promise<ConsumptionBenchmarkDto | null> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        make: true,
        model: true,
        engine_variant: true,
        fuel_type: true,
      },
    });
    // AC6: no engine variant → no benchmark possible. Also covers the
    // (impossible-via-DTO) empty-string case for defence-in-depth.
    if (!vehicle?.engine_variant) return null;

    // P6: only consider snapshots from the recent past — stale snapshots
    // would otherwise pin a long-departed cohort's data forever (a group
    // that briefly hit ≥10 drivers and then lost members would still
    // serve from the historical row, undoing the privacy floor).
    const minSnapshotDate = new Date(Date.now() - MAX_SNAPSHOT_AGE_MS);
    const benchmark = await this.prisma.consumptionBenchmark.findFirst({
      where: {
        make: vehicle.make,
        model: vehicle.model,
        engine_variant: vehicle.engine_variant,
        fuel_type: vehicle.fuel_type,
        calculated_at: { gte: minSnapshotDate },
      },
      orderBy: { calculated_at: 'desc' },
    });
    if (!benchmark) return null;

    // P9: own-avg is computed against the same (make, model, engine, fuel)
    // tuple ACROSS all the user's vehicles — not just the vehicle they're
    // viewing. Apples-to-apples with the community comparator: a driver
    // who owns two identical Golfs sees their full experience of that
    // engine variant, not half of it.
    const ownAvg = await this.prisma.fillUp.aggregate({
      where: {
        user_id: userId,
        consumption_l_per_100km: {
          not: null,
          // Same sanity bounds the snapshot CTE applies — keeps the
          // own-vs-community comparison from being skewed by a single
          // typo'd odometer segment of the user's own.
          gte: MIN_PLAUSIBLE_L_PER_100KM,
          lte: MAX_PLAUSIBLE_L_PER_100KM,
        },
        filled_at: { gte: new Date(Date.now() - NINETY_DAYS_MS) },
        vehicle: {
          make: vehicle.make,
          model: vehicle.model,
          engine_variant: vehicle.engine_variant,
          fuel_type: vehicle.fuel_type,
        },
      },
      _avg: { consumption_l_per_100km: true },
    });

    // P5: privacy clamp. Server caps the count to MIN_DRIVERS_TO_QUALIFY
    // when below PRIVACY_FLOOR so a network sniffer can't see "11 drivers"
    // and infer "I plus 10 others" for a niche vehicle. Mobile renders
    // the clamped value as "10+ drivers".
    const clampedDriverCount =
      benchmark.driver_count < PRIVACY_FLOOR
        ? MIN_DRIVERS_TO_QUALIFY
        : benchmark.driver_count;

    return {
      make: vehicle.make,
      model: vehicle.model,
      engineVariant: vehicle.engine_variant,
      fuelType: vehicle.fuel_type,
      medianL100km: round1dp(benchmark.median_l_per_100km),
      driverCount: clampedDriverCount,
      calculatedAt: benchmark.calculated_at.toISOString(),
      yourAvgL100km:
        ownAvg._avg.consumption_l_per_100km !== null
          ? round1dp(ownAvg._avg.consumption_l_per_100km)
          : null,
    };
  }
}
