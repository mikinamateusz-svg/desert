import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FillUp, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationService } from '../station/station.service.js';
import { RegionalBenchmarkService } from '../regional-benchmark/regional-benchmark.service.js';
import { PRICE_BANDS } from '../ocr/ocr.service.js';
import { CreateFillupDto } from './dto/create-fillup.dto.js';
import { VoivodeshipLookupService } from './voivodeship-lookup.service.js';

export type FillupPeriod = '30d' | '3m' | '12m' | 'all';

export interface CreateFillupResult {
  fillUp: FillUp;
  stationMatched: boolean;
  /** Display name for the celebration screen — null when no station matched. */
  stationName: string | null;
  /** True only when we wrote a community PriceHistory entry. */
  communityUpdated: boolean;
  /**
   * Pre-computed savings vs area average for the celebration screen
   * (Story 5.3). null when area_avg_at_fillup couldn't be resolved
   * (no station match AND no GPS reverse-geocode hit, or no benchmark
   * exists for the resolved voivodeship × fuel_type). Positive values =
   * driver paid less than the regional median; negative = above.
   * Computed server-side so the float math doesn't drift between
   * platforms.
   */
  savingsPln: number | null;
}

/**
 * Per-fill-up payload returned to the mobile log screen (Story 5.5).
 * Includes vehicle + station joins so the FillUpCard can render labels
 * without a follow-up round-trip per row.
 */
export interface FillupListItem extends FillUp {
  vehicle: {
    id: string;
    nickname: string | null;
    make: string;
    model: string;
  };
  station: { id: string; name: string } | null;
}

/**
 * Aggregate summary for the selected period × vehicle filter (Story 5.5).
 * Computed against the FULL filtered set (not just the current page) so
 * page 2+ shows the same totals.
 *
 * Nulls vs zeros:
 *   - `avgPricePerLitrePln` / `avgConsumptionL100km` — null when no
 *     fill-ups (or no consumption data) exist in the period. Mobile
 *     omits the card entirely per AC3 / AC6, never renders zero.
 *   - `totalSavingsPln` — null when no fill-ups in the period have
 *     `area_avg_at_fillup` populated. Distinguishes "no comparable
 *     data" from "broke even".
 *   - `totalSpendPln` / `totalLitres` / `fillupCount` — always 0+.
 */
export interface FillupSummary {
  totalSpendPln: number;
  totalLitres: number;
  avgPricePerLitrePln: number | null;
  totalSavingsPln: number | null;
  avgConsumptionL100km: number | null;
  fillupCount: number;
}

export interface ListFillupsResult {
  data: FillupListItem[];
  total: number;
  page: number;
  limit: number;
  summary: FillupSummary;
}

/**
 * Calendar-month summary for the savings-summary screen (Story 5.7).
 * Identical aggregate shape as the period summary, but bounded by an
 * exact calendar month rather than a rolling window. Used as the data
 * source for the shareable monthly card.
 *
 * Ranking fields are placeholders for Story 6.7 (savings leaderboard) —
 * always null in this story; the mobile card omits the ranking pill
 * gracefully when null per AC3.
 */
export interface MonthlySummary {
  year: number;
  /** 1–12, calendar month. */
  month: number;
  /** null when no fill-ups in the month have area_avg_at_fillup. */
  totalSavingsPln: number | null;
  fillupCount: number;
  totalSpendPln: number;
  totalLitres: number;
  avgPricePerLitrePln: number | null;
  /** Story 6.7: e.g. 20 means "top 20% in your voivodeship". null until 6.7 ships. */
  rankingPercentile: number | null;
  /** Story 6.7: voivodeship slug for the ranking. null until 6.7 ships. */
  rankingVoivodeship: string | null;
}

const STATION_MATCH_RADIUS_METRES = 200;

/**
 * Period → start-of-window. `all` returns null = no date predicate.
 * Implemented as `Date.now() - delta` rather than the `setMonth(...)`
 * pattern in the spec — `setMonth` mutates the source and on edge dates
 * (e.g. May 31 → Feb 31 collapses to March 3) gives off-by-days.
 * `Date.now() - 30 days * msPerDay` is exact.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function periodStart(period: FillupPeriod): Date | null {
  const now = Date.now();
  switch (period) {
    case '30d': return new Date(now - 30 * MS_PER_DAY);
    case '3m':  return new Date(now - 90 * MS_PER_DAY);
    case '12m': return new Date(now - 365 * MS_PER_DAY);
    case 'all': return null;
  }
}

/**
 * Per-driver fill-up CRUD.
 *
 * Fill-ups are pre-confirmed by the driver — the OCR-extracted (or
 * manually-entered) values are reviewed on a confirmation screen before
 * createFillup is called. This means we can:
 *   - Bypass the photo pipeline (no BullMQ, no logo match, no trust score)
 *   - Write directly to PriceHistory when GPS matches a station
 *   - Clear the StationFuelStaleness flag for that station × fuel
 *   - Lock the vehicle so its identity (make/model/year/fuel/displacement)
 *     can no longer change — preserves history consistency
 *
 * GPS coordinates are passed in for station matching and then NOT stored on
 * the FillUp row (privacy — same convention as Submission).
 */
@Injectable()
export class FillupService {
  private readonly logger = new Logger(FillupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stations: StationService,
    private readonly benchmarks: RegionalBenchmarkService,
    private readonly voivodeshipLookup: VoivodeshipLookupService,
  ) {}

  async createFillup(userId: string, dto: CreateFillupDto): Promise<CreateFillupResult> {
    // Vehicle ownership check — refuse to log a fill-up against a vehicle that
    // doesn't belong to the caller. Cross-user reads / writes are treated as
    // 403 here (rather than the 404 used in vehicles.service.ts) because the
    // payload explicitly references the resource: a 403 surfaces "you don't
    // own this" more clearly than 404, and there's no existence-leak concern
    // (the caller is also providing GPS / cost data — they know the vehicle
    // exists in some sense).
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { id: true, user_id: true, is_locked: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.user_id !== userId) {
      throw new ForbiddenException('Vehicle does not belong to the authenticated user');
    }

    // P-3: shadow-ban check. The community PriceHistory write below is the
    // exact thing the photo pipeline gates on trust score / shadow ban. A
    // shadow-banned user submitting via the fill-up path would otherwise
    // pollute community price data unfiltered — explicitly skip the
    // community write for them. The fill-up itself still saves (driver's
    // own history is theirs to keep regardless of trust state).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { shadow_banned: true },
    });
    const isShadowBanned = user?.shadow_banned === true;

    // GPS station match — only when both coordinates were supplied. Either
    // missing means we save the fill-up without a station link (AC8).
    const gpsAvailable = dto.gpsLat !== undefined && dto.gpsLng !== undefined;
    const matched = gpsAvailable
      ? await this.stations.findNearestStation(dto.gpsLat!, dto.gpsLng!, STATION_MATCH_RADIUS_METRES)
      : null;
    const stationId = matched?.id ?? null;

    // Story 5.3: voivodeship resolution — two paths.
    //   (1) If the station matched, look up its voivodeship in the DB. The
    //       station search above doesn't return it, so we re-fetch the
    //       station's voivodeship column here.
    //   (2) If no station match but GPS was provided, reverse-geocode via
    //       Nominatim. Privacy: GPS coords leave our infra → 3rd party
    //       (rounded to 2dp at cache-key time). Pre-launch follow-up to
    //       update privacy policy.
    // The voivodeship snapshot lets us compute savings vs area average even
    // for fill-ups at unmapped pumps.
    let voivodeship: string | null = null;
    if (stationId) {
      const station = await this.prisma.station.findUnique({
        where: { id: stationId },
        select: { voivodeship: true },
      });
      voivodeship = station?.voivodeship ?? null;
    } else if (gpsAvailable) {
      voivodeship = await this.voivodeshipLookup.lookupByGps(dto.gpsLat!, dto.gpsLng!);
    }

    // RegionalBenchmark snapshot. Two paths matching the voivodeship
    // resolution above:
    //   - Station matched → station-keyed lookup (existing 5.2 path)
    //   - GPS-only with resolved voivodeship → voivodeship-keyed lookup (5.3)
    // null is a first-class value — savings calc on both server + mobile
    // treats it as "no comparable area data" rather than 0.
    let areaAvgAtFillup: number | null = null;
    if (stationId) {
      const benchmark = await this.benchmarks.getLatestForStation(stationId, dto.fuelType);
      areaAvgAtFillup = benchmark?.medianPrice ?? null;
    } else if (voivodeship) {
      const benchmark = await this.benchmarks.getLatestForVoivodeship(voivodeship, dto.fuelType);
      areaAvgAtFillup = benchmark?.medianPrice ?? null;
    }

    const filledAt = dto.filledAt ? new Date(dto.filledAt) : new Date();

    const fillUp = await this.prisma.fillUp.create({
      data: {
        user_id: userId,
        vehicle_id: dto.vehicleId,
        station_id: stationId,
        fuel_type: dto.fuelType,
        litres: dto.litres,
        total_cost_pln: dto.totalCostPln,
        price_per_litre_pln: dto.pricePerLitrePln,
        area_avg_at_fillup: areaAvgAtFillup,
        odometer_km: dto.odometerKm ?? null,
        voivodeship,
        filled_at: filledAt,
      },
    });

    // P-4: price-plausibility check. The community PriceHistory write
    // depends on driver-supplied price; without a band check, a typo'd
    // 1.00 PLN/L value would clear the staleness flag with garbage data
    // and skew the community map. Reuse the OCR-side `PRICE_BANDS` table
    // so the two contribution paths apply the same plausibility window.
    // Out-of-band → save the fill-up, skip the community side-effects.
    const band = PRICE_BANDS[dto.fuelType];
    const priceWithinBand =
      !!band &&
      dto.pricePerLitrePln >= band.min &&
      dto.pricePerLitrePln <= band.max;

    // Eligibility gates collapsed: station matched + user not shadow-banned +
    // price plausible. All three must hold to write the community price.
    const eligibleForCommunityWrite = !!stationId && !isShadowBanned && priceWithinBand;

    if (stationId && !eligibleForCommunityWrite) {
      this.logger.log(
        `FillUp ${fillUp.id} matched station ${stationId} but skipped community write — ` +
        `${isShadowBanned ? 'user shadow-banned' : ''}` +
        `${!priceWithinBand ? `${isShadowBanned ? '; ' : ''}price ${dto.pricePerLitrePln} out of band for ${dto.fuelType}` : ''}`,
      );
    }

    // Side-effects only when eligible. Failures here are logged but not
    // re-thrown — the FillUp itself is the primary resource and a failed
    // staleness clear or PriceHistory write shouldn't 500 the user.
    let communityUpdated = false;
    if (eligibleForCommunityWrite) {
      try {
        await this.prisma.priceHistory.create({
          data: {
            station_id: stationId,
            fuel_type: dto.fuelType,
            price: dto.pricePerLitrePln,
            source: 'community',
            recorded_at: filledAt,
          },
        });
        communityUpdated = true;
      } catch (e) {
        this.logger.warn(
          `PriceHistory write failed for fill-up ${fillUp.id} → station ${stationId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      try {
        // Clear staleness flag for this fuel: the driver just confirmed a
        // current price by physically refuelling. Mirrors the same write
        // the price-board pipeline does on a verified submission.
        await this.prisma.stationFuelStaleness.deleteMany({
          where: { station_id: stationId, fuel_type: dto.fuelType },
        });
      } catch (e) {
        this.logger.warn(
          `Staleness clear failed for fill-up ${fillUp.id} → station ${stationId}/${dto.fuelType}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Lock the vehicle identity if not already locked. updateMany with
    // `is_locked: false` predicate is atomic — concurrent fill-ups race-
    // safely no-op when the vehicle is already locked.
    if (!vehicle.is_locked) {
      await this.prisma.vehicle.updateMany({
        where: { id: vehicle.id, is_locked: false },
        data: { is_locked: true },
      });
    }

    // Story 5.3: pre-compute savings server-side so the float math is
    // canonical. Use grosz-integer arithmetic (round each side to grosz
    // before subtracting) so the result is platform-stable — the prior
    // pattern `Math.round((a-p)*l*100)/100` was vulnerable to FP drift
    // around .5 boundaries (~16.55 vs 16.56 across Node versions). null
    // when areaAvgAtFillup is missing — mobile SavingsDisplay renders
    // nothing in that case (AC2).
    const savingsPln =
      areaAvgAtFillup !== null
        ? (Math.round(areaAvgAtFillup * dto.litres * 100) -
           Math.round(dto.pricePerLitrePln * dto.litres * 100)) / 100
        : null;

    return {
      fillUp,
      stationMatched: stationId !== null,
      stationName: matched?.name ?? null,
      communityUpdated,
      savingsPln,
    };
  }

  /**
   * Paginated history + summary, newest first.
   *
   * Filters:
   *   - `vehicleId` — undefined OR `'all'` returns fill-ups across all
   *     of the caller's vehicles. Any other value scopes to that vehicle
   *     (cross-user vehicles silently return zero rows because user_id
   *     is the outer predicate).
   *   - `period` — `30d | 3m | 12m | all`. `all` skips the date filter.
   *
   * The `summary` is computed against the full filtered set (not just
   * the current page) so totals stay stable across pagination.
   */
  async listFillups(
    userId: string,
    vehicleId: string | undefined,
    period: FillupPeriod,
    page: number,
    limit: number,
  ): Promise<ListFillupsResult> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const skip = (safePage - 1) * safeLimit;

    // Treat the literal 'all' as "no vehicle filter" — mirrors the mobile
    // chip selector's "All vehicles" option (AC4).
    const scopedVehicleId = vehicleId && vehicleId !== 'all' ? vehicleId : undefined;

    const startDate = periodStart(period);
    const where: Prisma.FillUpWhereInput = {
      user_id: userId,
      ...(scopedVehicleId ? { vehicle_id: scopedVehicleId } : {}),
      ...(startDate ? { filled_at: { gte: startDate } } : {}),
    };

    const [data, total, aggregate, savingsRow] = await Promise.all([
      this.prisma.fillUp.findMany({
        where,
        orderBy: { filled_at: 'desc' },
        skip,
        take: safeLimit,
        include: {
          vehicle: { select: { id: true, nickname: true, make: true, model: true } },
          station: { select: { id: true, name: true } },
        },
      }),
      this.prisma.fillUp.count({ where }),
      this.prisma.fillUp.aggregate({
        where,
        _sum: { total_cost_pln: true, litres: true },
        _avg: { price_per_litre_pln: true, consumption_l_per_100km: true },
        _count: { _all: true },
      }),
      // Savings — SUM over fill-ups with an area_avg snapshot. Prisma's
      // aggregate _sum can't compute a multi-column expression, so we drop
      // to $queryRaw. The where clause is parameterised (no string
      // interpolation of caller input); optional vehicle / period predicates
      // are Prisma.sql fragments to preserve parameterisation.
      //
      // P11: per-row grosz-integer arithmetic mirrors the client-side
      // `calculateSavings` (apps/mobile/src/utils/savings.ts) — round each
      // side to grosz BEFORE subtracting BEFORE summing. Prevents the
      // summary-card total from drifting by grosz vs the sum of visible
      // rows on the screen, which detail-oriented users would notice.
      // Final divide by 100.0 returns the value to PLN.
      this.prisma.$queryRaw<Array<{ total_savings: number | null; counted: bigint }>>(
        Prisma.sql`
          SELECT
            COALESCE(SUM(
              ROUND((area_avg_at_fillup * litres * 100)::numeric)
              - ROUND((price_per_litre_pln * litres * 100)::numeric)
            ), 0)::float / 100.0 AS total_savings,
            COUNT(*) AS counted
          FROM "FillUp"
          WHERE user_id = ${userId}
            AND area_avg_at_fillup IS NOT NULL
            ${scopedVehicleId ? Prisma.sql`AND vehicle_id = ${scopedVehicleId}` : Prisma.empty}
            ${startDate ? Prisma.sql`AND filled_at >= ${startDate}` : Prisma.empty}
        `,
      ),
    ]);

    const fillupCount = aggregate._count._all;
    // `counted` from the raw query = number of rows that actually had an
    // area_avg_at_fillup. When zero, the sum is meaningless — surface null
    // so the mobile UI can hide the "Total saved" card per AC2 / AC3
    // (no comparable area data, not "broke even").
    const savingsRowFirst = savingsRow[0];
    const savingsCounted = savingsRowFirst ? Number(savingsRowFirst.counted) : 0;
    const totalSavingsPln =
      savingsCounted > 0 && savingsRowFirst
        ? // Round to grosz (2dp) to match the per-row savings rendering on
          // the celebration screen — keeps the summary number stable across
          // page reloads even with FP drift in the SQL sum.
          Math.round((savingsRowFirst.total_savings ?? 0) * 100) / 100
        : null;

    const summary: FillupSummary = {
      totalSpendPln: aggregate._sum.total_cost_pln ?? 0,
      totalLitres: aggregate._sum.litres ?? 0,
      avgPricePerLitrePln:
        aggregate._avg.price_per_litre_pln !== null && fillupCount > 0
          ? Math.round(aggregate._avg.price_per_litre_pln * 1000) / 1000
          : null,
      totalSavingsPln,
      avgConsumptionL100km:
        aggregate._avg.consumption_l_per_100km !== null
          ? Math.round(aggregate._avg.consumption_l_per_100km * 10) / 10
          : null,
      fillupCount,
    };

    return { data: data as FillupListItem[], total, page: safePage, limit: safeLimit, summary };
  }

  /**
   * Story 5.7: month-bounded summary for the savings-summary screen.
   *
   * Window: `[year-month-01 00:00:00 UTC, next-month-01 00:00:00 UTC)`.
   * Half-open so a fill-up logged at exactly midnight on the 1st of the
   * next month belongs to the next month, never both. UTC-based — the
   * mobile UI labels the month from the same year/month integers it
   * passed in, so the user's local timezone shouldn't shift bucketing
   * (a fill-up at 23:59 local on the last day of the month stays in
   * that month, even if it was already 01:xx UTC).
   *
   * Empty months are not an error — `fillupCount: 0` + nullable totals
   * is a valid, expected response (e.g. user opens the share screen
   * for a month with no logging activity).
   *
   * Savings sum mirrors the per-row grosz-integer math used by the
   * client SavingsDisplay (see fillup.service.ts list summary, P11
   * fix in Story 5.5) — keeps the monthly total byte-equal to the sum
   * of individual savings rows the user can see.
   */
  async getMonthlySummary(
    userId: string,
    year: number,
    month: number,
  ): Promise<MonthlySummary> {
    // Date.UTC bypasses local-tz inference: passing (2026, 2, 1) builds
    // 2026-03-01 00:00 UTC regardless of where the server is. The month
    // index is 0-based for Date.UTC but our DTO/spec uses 1-based.
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const where = { user_id: userId, filled_at: { gte: start, lt: end } };

    const [aggregate, savingsRow] = await Promise.all([
      this.prisma.fillUp.aggregate({
        where,
        _sum: { total_cost_pln: true, litres: true },
        _avg: { price_per_litre_pln: true },
        _count: { _all: true },
      }),
      // counted is needed to distinguish "broke even" (sum = 0 with rows)
      // from "no comparable data" (no rows with area_avg_at_fillup) —
      // mobile uses null to hide the savings line entirely vs render 0.
      this.prisma.$queryRaw<Array<{ total_savings: number | null; counted: bigint }>>(
        Prisma.sql`
          SELECT
            COALESCE(SUM(
              ROUND((area_avg_at_fillup * litres * 100)::numeric)
              - ROUND((price_per_litre_pln * litres * 100)::numeric)
            ), 0)::float / 100.0 AS total_savings,
            COUNT(*) AS counted
          FROM "FillUp"
          WHERE user_id = ${userId}
            AND filled_at >= ${start}
            AND filled_at < ${end}
            AND area_avg_at_fillup IS NOT NULL
        `,
      ),
    ]);

    const fillupCount = aggregate._count._all;
    const savingsRowFirst = savingsRow[0];
    const savingsCounted = savingsRowFirst ? Number(savingsRowFirst.counted) : 0;
    const totalSavingsPln =
      savingsCounted > 0 && savingsRowFirst
        ? Math.round((savingsRowFirst.total_savings ?? 0) * 100) / 100
        : null;

    return {
      year,
      month,
      fillupCount,
      totalSpendPln: aggregate._sum.total_cost_pln ?? 0,
      totalLitres: aggregate._sum.litres ?? 0,
      avgPricePerLitrePln:
        aggregate._avg.price_per_litre_pln !== null && fillupCount > 0
          ? Math.round(aggregate._avg.price_per_litre_pln * 1000) / 1000
          : null,
      totalSavingsPln,
      rankingPercentile: null,   // populated by Story 6.7
      rankingVoivodeship: null,  // populated by Story 6.7
    };
  }
}
