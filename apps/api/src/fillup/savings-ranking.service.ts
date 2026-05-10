import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Cohort privacy floor — fewer than this many users with positive savings
 * in a voivodeship for a given month and we don't surface a percentile
 * (or a best-saver stat in 5.9). Note this counts SAVERS (HAVING > 0),
 * not all drivers in the region — at the boundary (e.g. exactly 10
 * savers in a region of 200 drivers) the cohort-size signal itself
 * weakly correlates with savings status. Documented as a known
 * trade-off; can be raised if production data shows it matters.
 */
const COHORT_THRESHOLD = 10;

/**
 * Discouraging copy guard for Story 6.5 push notification: only enrich
 * the body with the percentile clause when the user is at-or-above
 * median. "you're in the top 100% of savers!" reads as sarcasm; below-
 * median users fall through to the generic "Great month!" copy. The
 * service always returns the raw percentile — the gating happens in
 * the caller (monthly-summary-notification.service.ts).
 */
const NOTIFICATION_PERCENT_CEILING = 50;

export interface UserPercentile {
  /** 1–100. Lower = better (1 = top of cohort). Capped at 100 even
   *  when ties push RANK() above total_drivers. */
  topPercent: number;
  /**
   * Story 5.9: integer PLN of the cohort's max savings — surfaced on
   * the ShareableCard + savings-summary screen as an aspirational
   * "best in your area: X PLN" stat.
   *
   * Leak guard: `null` when the requesting viewer IS the max (or tied
   * for it). Otherwise the share recipient could trivially infer the
   * viewer's own savings from the displayed amount. Also `null` when
   * the cohort threshold isn't met (this is implied by the parent
   * being `UserPercentile | null` but documented for clarity).
   */
  bestSaverSavingsPln: number | null;
}

/**
 * Pre-computed percentile threshold below which the 6.5 notification
 * builder should swap "you're in the top X% of savers!" for the
 * generic "Great month!" copy. Exported so the caller can stay in
 * sync without duplicating the constant.
 */
export const PERCENTILE_NOTIFICATION_CEILING = NOTIFICATION_PERCENT_CEILING;

/** `RANK()::int` and `COUNT()::int` casts in the SQL guarantee `int4`
 *  marshalling, but defensive `Number()` coercion at the call site
 *  protects against a future driver returning bigint (which would
 *  throw `TypeError: Cannot mix BigInt and other types` on division). */
interface RankedRow {
  user_id: string;
  rank: number;
  total_drivers: number;
  /** Story 5.9: viewer's own raw float savings — compared against
   *  best_saver_pln server-side for the leak guard. Not exposed to
   *  the caller. */
  total_savings_pln: number;
  /** Story 5.9: cohort max from `MAX() OVER ()` (single-user) or
   *  `MAX() OVER (PARTITION BY voivodeship)` (bulk). Float because
   *  the underlying grosz-integer math divides by 100 inside the
   *  CTE. Rounded to integer PLN at the service boundary. */
  best_saver_pln: number;
}

/**
 * Story 5.8: voivodeship-scoped savings ranking. Computes a single
 * percentile (1 = top, 100 = bottom) for the requesting user against
 * the cohort of drivers whose **most-recent** fill-up in the same
 * calendar month was in the same voivodeship.
 *
 * Design choices documented in 5-8-savings-percentile.md (§Why "most
 * recent voivodeship"). The voivodeship label NEVER leaves this service
 * — the caller receives only the integer percentile, so a future
 * regression can't accidentally render the region in shareable
 * artifacts.
 *
 * Both query paths use **identical cohort-membership semantics** —
 * single-user and bulk both compute each user's MRV first, then keep
 * users whose MRV equals the target voivodeship. Without this, the
 * same user would get a different percentile from the in-app summary
 * vs the next-morning push notification. Multi-voivodeship commuters
 * are the obvious failure mode.
 *
 * Both query paths use **grosz-integer math** for the savings sum —
 * matches `FillupService.getMonthlySummary` so a user near zero
 * savings can't be in/out of the cohort by float drift.
 */
@Injectable()
export class SavingsRankingService {
  private readonly logger = new Logger(SavingsRankingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single-user lookup used by `FillupService.getMonthlySummary`.
   * Returns null when:
   *   - user has no fill-ups with a known voivodeship in the month,
   *   - cohort has fewer than COHORT_THRESHOLD savers (privacy floor),
   *   - user has zero or negative savings (excluded by HAVING).
   * `monthEnd` is exclusive (first instant of the next month).
   *
   * Note on row-level filter: `area_avg_at_fillup IS NOT NULL` is a
   * row-level filter; users with partial benchmark coverage are ranked
   * on the covered subset only. Matches `getMonthlySummary` semantics.
   */
  async getUserPercentile(
    userId: string,
    monthStart: Date,
    monthEnd: Date,
  ): Promise<UserPercentile | null> {
    const rows = await this.prisma.$queryRaw<RankedRow[]>(
      Prisma.sql`
        WITH user_voivodeship AS (
          SELECT f.voivodeship
          FROM "FillUp" f
          JOIN "User" u ON u.id = f.user_id
          WHERE f.user_id = ${userId}
            AND f.filled_at >= ${monthStart}
            AND f.filled_at < ${monthEnd}
            AND f.voivodeship IS NOT NULL
            AND u.deleted_at IS NULL
          ORDER BY f.filled_at DESC
          LIMIT 1
        ),
        cohort_users AS (
          -- Users whose MOST-RECENT fillup in the month is in the same
          -- voivodeship as the requesting user. Mirrors the bulk path's
          -- semantics so both endpoints return the same percentile for
          -- the same user.
          SELECT user_id FROM (
            SELECT DISTINCT ON (f.user_id) f.user_id, f.voivodeship
            FROM "FillUp" f
            JOIN "User" u ON u.id = f.user_id
            WHERE f.filled_at >= ${monthStart}
              AND f.filled_at < ${monthEnd}
              AND f.voivodeship IS NOT NULL
              AND u.deleted_at IS NULL
            ORDER BY f.user_id, f.filled_at DESC
          ) mrv
          WHERE mrv.voivodeship = (SELECT voivodeship FROM user_voivodeship)
        ),
        savings AS (
          SELECT
            f.user_id,
            -- Grosz-integer math matches FillupService.getMonthlySummary.
            -- Without this, a user with raw-float-positive but
            -- rounded-zero savings could be inconsistently in/out of
            -- the cohort vs their visible totalSavingsPln.
            COALESCE(SUM(
              ROUND((f.area_avg_at_fillup * f.litres * 100)::numeric)
              - ROUND((f.price_per_litre_pln * f.litres * 100)::numeric)
            ), 0)::float / 100.0 AS total_savings_pln
          FROM "FillUp" f
          JOIN "User" u ON u.id = f.user_id
          WHERE f.filled_at >= ${monthStart}
            AND f.filled_at < ${monthEnd}
            AND f.area_avg_at_fillup IS NOT NULL
            AND f.price_per_litre_pln IS NOT NULL
            AND f.litres IS NOT NULL
            AND f.user_id IN (SELECT user_id FROM cohort_users)
            AND u.deleted_at IS NULL
          GROUP BY f.user_id
          HAVING COALESCE(SUM(
            ROUND((f.area_avg_at_fillup * f.litres * 100)::numeric)
            - ROUND((f.price_per_litre_pln * f.litres * 100)::numeric)
          ), 0) > 0
        ),
        ranked AS (
          -- Tiebreaker by user_id: deterministic ordering between
          -- otherwise-tied savings, so two users with identical totals
          -- get adjacent ranks rather than both rank-N + a gap.
          -- Story 5.9: MAX OVER () exposes the cohort top so the
          -- service can apply the leak guard (suppress when viewer
          -- IS the max).
          SELECT
            user_id,
            total_savings_pln,
            RANK() OVER (ORDER BY total_savings_pln DESC, user_id)::int AS rank,
            COUNT(*) OVER ()::int AS total_drivers,
            MAX(total_savings_pln) OVER () AS best_saver_pln
          FROM savings
        )
        SELECT user_id, rank, total_drivers, total_savings_pln, best_saver_pln
        FROM ranked
        WHERE user_id = ${userId}
      `,
    );

    const row = rows[0];
    if (!row) {
      this.logger.debug(`getUserPercentile(${userId}): no row — not in cohort or no savings`);
      return null;
    }
    // Defensive Number() coercion guards against a future Prisma/Neon
    // driver returning bigint despite the ::int cast.
    const totalDrivers = Number(row.total_drivers);
    const rank = Number(row.rank);
    if (totalDrivers < COHORT_THRESHOLD) {
      this.logger.debug(
        `getUserPercentile(${userId}): cohort size ${totalDrivers} below floor (${COHORT_THRESHOLD})`,
      );
      return null;
    }

    return {
      topPercent: percentRank(rank, totalDrivers),
      bestSaverSavingsPln: bestSaverWithLeakGuard(
        Number(row.total_savings_pln),
        Number(row.best_saver_pln),
      ),
    };
  }

  /**
   * Bulk lookup used by Story 6.5's monthly notification cron — one SQL
   * pass for every eligible user in every cohort. Returns a map of
   * userId → percentile; users in cohorts below the threshold or with
   * zero/negative savings are absent.
   */
  async getBulkPercentilesForMonth(
    monthStart: Date,
    monthEnd: Date,
  ): Promise<Map<string, UserPercentile>> {
    const rows = await this.prisma.$queryRaw<RankedRow[]>(
      Prisma.sql`
        WITH most_recent_voivodeship AS (
          SELECT DISTINCT ON (f.user_id) f.user_id, f.voivodeship
          FROM "FillUp" f
          JOIN "User" u ON u.id = f.user_id
          WHERE f.filled_at >= ${monthStart}
            AND f.filled_at < ${monthEnd}
            AND f.voivodeship IS NOT NULL
            AND u.deleted_at IS NULL
          ORDER BY f.user_id, f.filled_at DESC
        ),
        savings AS (
          SELECT
            f.user_id,
            -- Grosz-integer math (see single-user path comment).
            COALESCE(SUM(
              ROUND((f.area_avg_at_fillup * f.litres * 100)::numeric)
              - ROUND((f.price_per_litre_pln * f.litres * 100)::numeric)
            ), 0)::float / 100.0 AS total_savings_pln
          FROM "FillUp" f
          JOIN "User" u ON u.id = f.user_id
          WHERE f.filled_at >= ${monthStart}
            AND f.filled_at < ${monthEnd}
            AND f.area_avg_at_fillup IS NOT NULL
            AND f.price_per_litre_pln IS NOT NULL
            AND f.litres IS NOT NULL
            AND u.deleted_at IS NULL
          GROUP BY f.user_id
          HAVING COALESCE(SUM(
            ROUND((f.area_avg_at_fillup * f.litres * 100)::numeric)
            - ROUND((f.price_per_litre_pln * f.litres * 100)::numeric)
          ), 0) > 0
        ),
        combined AS (
          SELECT s.user_id, s.total_savings_pln, mrv.voivodeship
          FROM savings s
          JOIN most_recent_voivodeship mrv ON mrv.user_id = s.user_id
        ),
        ranked AS (
          SELECT
            user_id,
            total_savings_pln,
            -- Tiebreaker by user_id (matches single-user path).
            RANK() OVER (PARTITION BY voivodeship ORDER BY total_savings_pln DESC, user_id)::int AS rank,
            COUNT(*) OVER (PARTITION BY voivodeship)::int AS total_drivers,
            -- Story 5.9: per-cohort max for the best-saver stat.
            -- Same leak guard fires per row inside the service loop.
            MAX(total_savings_pln) OVER (PARTITION BY voivodeship) AS best_saver_pln
          FROM combined
        )
        SELECT user_id, rank, total_drivers, total_savings_pln, best_saver_pln
        FROM ranked
        WHERE total_drivers >= ${COHORT_THRESHOLD}
      `,
    );

    const map = new Map<string, UserPercentile>();
    for (const row of rows) {
      const rank = Number(row.rank);
      const totalDrivers = Number(row.total_drivers);
      map.set(row.user_id, {
        topPercent: percentRank(rank, totalDrivers),
        bestSaverSavingsPln: bestSaverWithLeakGuard(
          Number(row.total_savings_pln),
          Number(row.best_saver_pln),
        ),
      });
    }
    return map;
  }
}

/**
 * Buffer (in grosz) around the cohort max within which the leak guard
 * fires. The displayed best-saver value is rounded to integer PLN; the
 * viewer's own savings are rendered at 2dp grosz precision on the same
 * card. If the viewer is within 0.5 PLN of the max, the recipient
 * could narrow the max via their displayed grosz savings (e.g., viewer
 * shows 247.49, card says "best 248" → recipient infers viewer is
 * rank 1 or near-tied). Suppressing within ±0.5 PLN of max breaks
 * that inference at the rounding boundary.
 */
const LEAK_GUARD_BUFFER_GROSZ = 50;

/**
 * Story 5.9 leak guard: suppress the best-saver figure when the
 * requesting viewer IS the cohort max — or close enough that the
 * displayed integer max trivially identifies them. Without this, a
 * recipient of the viewer's shared card could infer the viewer's
 * standing (and exact savings) from the gap between the two displayed
 * numbers.
 *
 * Returned value is rounded to integer PLN — grosz precision in a
 * publicly-visible aggregate is leaky on its own (uniqueness signal
 * across cohorts).
 *
 * Compares grosz integers rather than PLN floats so the threshold is
 * bit-exact — `247.5 - 0.5 === 247` always, no IEEE-754 drift.
 *
 * Fail-CLOSED on non-finite inputs (NaN/Infinity from corrupt rows or
 * a future SQL refactor that drops a column). A privacy guard should
 * default to suppression, never to leakage.
 */
function bestSaverWithLeakGuard(
  viewerSavingsPln: number,
  cohortMaxPln: number,
): number | null {
  if (!Number.isFinite(viewerSavingsPln) || !Number.isFinite(cohortMaxPln)) return null;
  const viewerGrosz = Math.round(viewerSavingsPln * 100);
  const maxGrosz = Math.round(cohortMaxPln * 100);
  if (viewerGrosz >= maxGrosz - LEAK_GUARD_BUFFER_GROSZ) return null;
  return Math.round(cohortMaxPln);
}

/**
 * `Math.max(1, …)` floors to top-1% (no "top 0%" for the rank-1 driver).
 * `Math.min(100, …)` caps at 100% — defends against a future RANK()
 * tie producing rank > total_drivers (with the user_id tiebreaker this
 * shouldn't happen, but the guard is cheap).
 */
function percentRank(rank: number, totalDrivers: number): number {
  const raw = Math.round((rank / totalDrivers) * 100);
  return Math.min(100, Math.max(1, raw));
}
