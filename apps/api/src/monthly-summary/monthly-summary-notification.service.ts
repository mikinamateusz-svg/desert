import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from '../alert/expo-push.token.js';
import {
  SavingsRankingService,
  PERCENTILE_NOTIFICATION_CEILING,
} from '../fillup/savings-ranking.service.js';

// AC7 — Story 6.6 reads this Redis key to decide whether to surface a
// notification re-prompt on app open. 45 days survives the gap between
// monthly cron runs (~30 days) plus a generous user-engagement buffer.
const NO_TOKEN_REDIS_TTL_SECONDS = 45 * 24 * 3600;

// Per-month idempotency lock. 25h TTL covers the 1h window during which
// a process restart, BullMQ retry, or accidental re-trigger could fire
// runForMonth a second time for the same calendar month — without
// re-pushing every user. Auto-expires before next month's cron fires
// so each month gets its own fresh lock.
const RUN_LOCK_TTL_SECONDS = 25 * 3600;

interface SavingsRow {
  user_id: string;
  fillup_count: number;
  total_savings_pln: number;
}

interface OutboundMessage {
  userId: string;
  token: string;
  title: string;
  body: string;
  deepLink: string;
}

export interface MonthlySummaryRunResult {
  sent: number;
  skipped: number; // monthly_summary preference is false
  noToken: number; // no/invalid token — re-prompt key set
}

@Injectable()
export class MonthlySummaryNotificationService {
  private readonly logger = new Logger(MonthlySummaryNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
    private readonly savingsRanking: SavingsRankingService,
  ) {}

  /**
   * AC1 — calculate the previous calendar month's savings per user with
   * `area_avg_at_fillup` data and positive total savings, then push a
   * personalised summary. Cron-driven via MonthlySummaryNotificationWorker.
   *
   * `month` is 1-indexed (1 = January … 12 = December).
   */
  async runForMonth(year: number, month: number): Promise<MonthlySummaryRunResult> {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const monthLabel = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthStart);

    // 0. Idempotency lock — atomic SET NX claims this calendar month so
    //    a process restart, BullMQ retry, or accidental re-trigger within
    //    the same 25h window doesn't re-push every eligible user.
    //    Fail-OPEN on Redis errors: if we can't claim the lock we'd
    //    rather risk a rare duplicate than skip an entire month's
    //    summaries — but we log the fail-open so ops can investigate.
    const lockKey = `monthly:summary:run:${year}-${String(month).padStart(2, '0')}`;
    if (!(await this.claimRunLock(lockKey))) {
      this.logger.warn(
        `Monthly summary ${monthLabel} skipped — another run already claimed the lock (${lockKey})`,
      );
      return { sent: 0, skipped: 0, noToken: 0 };
    }

    // 1. Bulk savings aggregate. Filters at SQL: positive savings only,
    //    soft-deleted users excluded, `area_avg_at_fillup` not null.
    const savings = await this.aggregateSavings(monthStart, monthEnd);
    if (savings.length === 0) {
      this.logger.log(`Monthly summary ${monthLabel}: no eligible users with positive savings`);
      return { sent: 0, skipped: 0, noToken: 0 };
    }

    // 2. Fetch notification prefs for the eligible cohort in one query.
    const userIds = savings.map((s) => s.user_id);
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, expo_push_token: true, monthly_summary: true },
    });
    const prefMap = new Map(prefs.map((p) => [p.user_id, p]));

    // Story 5.8 — bulk percentile lookup. One SQL pass for every
    // eligible user across every cohort (≥10 savers per voivodeship).
    // Users below the privacy floor are absent from the map; their
    // notifications fall back to the "Great month!" copy.
    //
    // Run this AFTER the prefs filter would have narrowed `userIds`,
    // but BEFORE the per-user loop to keep it a single roundtrip.
    // Skip entirely when there are no opted-in users (any prefs row
    // with monthly_summary !== false counts; lazy-create users count
    // too since the schema default is true) — saves a cohort scan
    // on a quiet month.
    const hasOptedInUsers = userIds.some((id) => {
      const pref = prefMap.get(id);
      return !pref || pref.monthly_summary !== false;
    });
    const percentileMap = hasOptedInUsers
      ? await this.savingsRanking.getBulkPercentilesForMonth(monthStart, monthEnd)
      : new Map();

    let sent = 0;
    let skipped = 0;
    let noToken = 0;
    const outbound: OutboundMessage[] = [];

    for (const row of savings) {
      const pref = prefMap.get(row.user_id);
      // AC6 — only skip when the column is EXPLICITLY false. The schema
      // default is true, and NotificationPreference rows are created
      // lazily by getPreferences/updatePreferences in notifications.service
      // — so a user who never opened notification settings has no row at
      // all. Treating that as opted-out would shrink the eligible cohort
      // every month for users who never visited /notifications.
      if (pref && pref.monthly_summary === false) {
        skipped++;
        continue;
      }

      // AC7 — silent calculation when no usable token; set re-prompt key.
      // pref may be undefined (lazy-create row not yet existing) — that's
      // also a no-token case for our purposes.
      const token = pref?.expo_push_token;
      if (!token || !this.expoPush.isValidToken(token)) {
        await this.recordReprompt(row.user_id);
        noToken++;
        continue;
      }

      // Math.round can land on 0 for sub-1 PLN savings (HAVING > 0 in
      // the SQL still passes 0.40). "You saved 0 PLN" is user-hostile;
      // skip silently so we don't deliver a zero-value notification.
      if (Math.round(row.total_savings_pln) < 1) {
        skipped++;
        continue;
      }

      // Story 5.8 — percentile lookup is a Map; absent entries (below
      // the privacy floor) fall through the null branch in the payload
      // builder and the user gets the generic "Great month!" copy.
      //
      // Discouraging-copy guard: only enrich the body when the user is
      // at-or-above median (topPercent <= ceiling). "you're in the top
      // 100% of savers!" reads as sarcasm — better to fall through to
      // the generic copy for the bottom half.
      const rawPercentile = percentileMap.get(row.user_id)?.topPercent ?? null;
      const percentile =
        rawPercentile !== null && rawPercentile <= PERCENTILE_NOTIFICATION_CEILING
          ? rawPercentile
          : null;
      const { title, body } = this.buildNotificationPayload(
        row.total_savings_pln,
        monthLabel,
        percentile,
      );
      outbound.push({
        userId: row.user_id,
        token,
        title,
        body,
        deepLink: `/(app)/savings-summary?year=${year}&month=${month}`,
      });
      sent++;
    }

    // 3. Send in chunks (Expo limit = 100 per request). Partial-delivery
    //    failures are logged + tolerated — the job does not fail on a bad
    //    chunk. AC8.
    if (outbound.length > 0) {
      await this.sendInChunks(outbound);
    }

    this.logger.log(
      `Monthly summary ${monthLabel}: sent=${sent}, skipped=${skipped}, noToken=${noToken}`,
    );
    return { sent, skipped, noToken };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async aggregateSavings(monthStart: Date, monthEnd: Date): Promise<SavingsRow[]> {
    // Single bulk SUM groups all eligible savings in one round-trip.
    // - HAVING SUM(...) > 0 enforces AC4 implicitly: users with only
    //   negative-savings months are excluded (no notification sent).
    // - JOIN to "User" with deleted_at IS NULL excludes soft-deleted
    //   accounts so we never push to abandoned users (mirrors the
    //   filter in alert pipelines from 6.1/6.2/6.10).
    return this.prisma.$queryRaw<SavingsRow[]>`
      SELECT
        f.user_id,
        COUNT(*)::int AS fillup_count,
        SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln
      FROM "FillUp" f
      JOIN "User" u ON u.id = f.user_id
      WHERE f.filled_at >= ${monthStart}
        AND f.filled_at <  ${monthEnd}
        AND f.area_avg_at_fillup IS NOT NULL
        AND f.price_per_litre_pln IS NOT NULL
        AND f.litres IS NOT NULL
        AND u.deleted_at IS NULL
      GROUP BY f.user_id
      HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
    `;
  }

  buildNotificationPayload(
    totalSavingsPln: number,
    monthLabel: string,
    rankingPercentile: number | null,
  ): { title: string; body: string } {
    const savingsRounded = Math.round(totalSavingsPln);
    const headline = `You saved ${savingsRounded} PLN on fuel in ${monthLabel}`;
    // Story 5.8 — drop "in your area" qualifier. The cohort scoping
    // (voivodeship) stays server-side and never appears in shared text.
    const body =
      rankingPercentile !== null
        ? `${headline} — you're in the top ${rankingPercentile}% of savers!`
        : `${headline}. Great month!`;
    // Title is the OS-shade headline; specific savings live in body so
    // the OS can truncate gracefully on small screens.
    return { title: 'Your monthly fuel summary is ready', body };
  }

  private async sendInChunks(outbound: OutboundMessage[]): Promise<void> {
    const messages: ExpoPushMessage[] = outbound.map((m) => ({
      to: m.token,
      title: m.title,
      body: m.body,
      data: { route: m.deepLink },
      sound: 'default' as const,
    }));

    const chunks = this.expoPush.chunkMessages(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expoPush.sendChunk(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === 'ok') continue;
          const userId = outbound[cursor + i]?.userId;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const rawTo = chunk[i].to;
            const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
            if (staleToken && userId) {
              try {
                // user_id-scoped clear so a token shared via device handoff
                // / restore-from-backup only nulls the entry for the user
                // who actually got the DeviceNotRegistered ticket.
                await this.prisma.notificationPreference.updateMany({
                  where: { user_id: userId, expo_push_token: staleToken },
                  data: { expo_push_token: null },
                });
                this.logger.warn(
                  `DeviceNotRegistered on monthly summary for user ${userId} — cleared stale token (${staleToken.slice(0, 20)}...)`,
                );
              } catch (e) {
                this.logger.error(
                  `Failed to clear stale token for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          } else {
            this.logger.warn(`Push ticket error for ${userId ?? '?'}: ${ticket.message}`);
          }
        }
      } catch (e) {
        // AC8 — partial delivery is acceptable. Log + continue next chunk.
        this.logger.error(
          `Monthly summary chunk failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      cursor += chunk.length;
    }
  }

  /**
   * Atomic SET NX run-lock claim. Returns true if THIS call won the lock;
   * false if the key already existed (another run already claimed this
   * month). Fail-OPEN on Redis errors so a Redis outage doesn't suppress
   * an entire month of summaries.
   */
  private async claimRunLock(key: string): Promise<boolean> {
    try {
      const reply = await this.redis.set(key, '1', 'EX', RUN_LOCK_TTL_SECONDS, 'NX');
      return reply !== null;
    } catch (e) {
      this.logger.warn(
        `Run-lock claim failed for ${key} — fail-open: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }

  private async recordReprompt(userId: string): Promise<void> {
    try {
      await this.redis.set(
        `monthly:summary:calculated:${userId}`,
        '1',
        'EX',
        NO_TOKEN_REDIS_TTL_SECONDS,
      );
    } catch (e) {
      // Best-effort. Story 6.6 re-prompt is a UX polish; a Redis hiccup
      // here at worst means one user doesn't see the next-month prompt.
      this.logger.warn(
        `Failed to record monthly-summary re-prompt key for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
