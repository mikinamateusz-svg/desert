import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from './expo-push.token.js';
import { NotificationSendLogService } from './notification-send-log.service.js';
import type { CommunityRiseCheckJobData } from './price-drop-alert.constants.js';

// AC4 — one alert per voivodeship × fuel type per 48h window.
const COMMUNITY_RISE_DEDUP_TTL_SECONDS = 48 * 3600;
// Shorter dedup TTL when the threshold was met but no users were eligible.
// The full 48h block would shut out users who opt in (or whose latest
// fillup lands in this voivodeship) within the same rising cycle. 1h
// still suppresses tight-loop re-evaluation across submission bursts.
const COMMUNITY_RISE_NO_USERS_DEDUP_TTL_SECONDS = 60 * 60;

// AC1 — regional movement thresholds.
const MIN_RISE_PCT = 0.02;          // 2% per-station rise to count as "rising"
const RISING_RATIO_THRESHOLD = 0.30; // ≥30% of qualifying stations must be rising
const MIN_QUALIFYING_STATIONS = 3;   // floor against false positives in sparse voivodeships

// AC3 — community alert is suppressed when a predictive alert was sent in
// the last 6 hours; after 6h it switches to "as-expected" copy.
const PREDICTIVE_GRACE_MS = 6 * 60 * 60 * 1000;

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'PB95',
  PB_98: 'PB98',
  ON: 'Diesel',
  ON_PREMIUM: 'Diesel+',
  LPG: 'LPG',
};

interface EligibleUser {
  userId: string;
  pushToken: string;
}

type PredictiveTiming = 'none' | 'too-soon' | 'eligible';

@Injectable()
export class CommunityRiseAlertService {
  private readonly logger = new Logger(CommunityRiseAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
    private readonly sendLog: NotificationSendLogService,
  ) {}

  async evaluateAndNotify(job: CommunityRiseCheckJobData): Promise<void> {
    const { voivodeship, fuelType, triggeredByStationId } = job;
    const dedupKey = `alert:rise:community:${voivodeship}:${fuelType}`;

    // 1. 48h dedup — already alerted? Don't re-evaluate.
    if (await this.checkDedup(dedupKey)) {
      this.logger.debug(`Community rise already sent for ${voivodeship}:${fuelType} — skipping`);
      return;
    }

    // 2. Threshold evaluation — regional movement check.
    const { thresholdMet, risingCount, totalCount } = await this.evaluateThreshold(
      voivodeship,
      fuelType,
    );
    if (!thresholdMet) {
      this.logger.debug(
        `Community rise threshold not met for ${voivodeship}:${fuelType} — ${risingCount}/${totalCount} stations rising`,
      );
      return;
    }

    this.logger.log(
      `Community rise threshold met for ${voivodeship}:${fuelType} — ${risingCount}/${totalCount} stations rising (triggered by station ${triggeredByStationId})`,
    );

    // 3. Predictive-alert timing. If <6h since predictive, suppress entirely
    //    (the predictive alert was the user-facing event for this cycle —
    //    sending a community alert immediately afterwards would feel
    //    duplicative). After 6h, switch to "as-expected" copy.
    const predictiveTiming = await this.checkPredictiveTiming(voivodeship, fuelType);
    if (predictiveTiming === 'too-soon') {
      this.logger.log(
        `Community rise skipped — predictive alert sent <6h ago for ${voivodeship}:${fuelType}`,
      );
      return;
    }
    const copyVariant: 'normal' | 'as-expected' =
      predictiveTiming === 'eligible' ? 'as-expected' : 'normal';

    // 4. Eligible users — opted-in + valid token + most-recent fillup
    //    voivodeship matches.
    const users = await this.getEligibleUsers(voivodeship);
    if (users.length === 0) {
      this.logger.log(`No eligible users in ${voivodeship} for community rise alert`);
      // Record a SHORT dedup so we don't re-evaluate every verification
      // for an empty user pool, but still revisit within the rising
      // cycle in case a user opts in or has a fresh fillup in this
      // voivodeship. Full 48h block would silently consume the event.
      await this.recordDedup(dedupKey, COMMUNITY_RISE_NO_USERS_DEDUP_TTL_SECONDS);
      return;
    }

    // 5. Send.
    const fuelLabel = FUEL_LABELS[fuelType] ?? fuelType;
    const { title, body } = this.buildCopy(fuelLabel, copyVariant);
    const deepLink = `/map?fuelType=${fuelType}`;
    await this.sendAlerts(users, title, body, deepLink);

    // 6. Record 48h dedup. Per voivodeship+fuel, NOT per-user — one regional
    //    alert per cycle, not per recipient.
    await this.recordDedup(dedupKey);
    this.logger.log(
      `Community rise alert sent to ${users.length} user(s) for ${voivodeship}:${fuelType} (${copyVariant})`,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Two-step CTE: pick the most-recent price per station in the last 24h
   * (recent), match against the most-recent price 24-48h prior (previous),
   * then count how many show ≥ MIN_RISE_PCT growth. Threshold met when at
   * least RISING_RATIO_THRESHOLD of the qualifying stations rose, with
   * MIN_QUALIFYING_STATIONS as a floor against sparse-data false positives.
   */
  async evaluateThreshold(
    voivodeship: string,
    fuelType: string,
  ): Promise<{ thresholdMet: boolean; risingCount: number; totalCount: number }> {
    const result = await this.prisma.$queryRaw<
      Array<{ total_stations: number; rising_stations: number }>
    >`
      WITH recent AS (
        SELECT DISTINCT ON (ph.station_id)
          ph.station_id,
          ph.price AS current_price
        FROM "PriceHistory" ph
        JOIN "Station" s ON s.id = ph.station_id
        WHERE s.voivodeship = ${voivodeship}
          AND ph.fuel_type = ${fuelType}
          AND ph.recorded_at >= NOW() - INTERVAL '24 hours'
        ORDER BY ph.station_id, ph.recorded_at DESC
      ),
      previous AS (
        SELECT DISTINCT ON (ph.station_id)
          ph.station_id,
          ph.price AS prev_price
        FROM "PriceHistory" ph
        JOIN recent r ON r.station_id = ph.station_id
        WHERE ph.fuel_type = ${fuelType}
          AND ph.recorded_at < NOW() - INTERVAL '24 hours'
          AND ph.recorded_at >= NOW() - INTERVAL '48 hours'
        ORDER BY ph.station_id, ph.recorded_at DESC
      )
      SELECT
        COUNT(*)::int AS total_stations,
        COUNT(*) FILTER (
          WHERE (r.current_price - p.prev_price) / NULLIF(p.prev_price, 0) >= ${MIN_RISE_PCT}
        )::int AS rising_stations
      FROM recent r
      JOIN previous p ON p.station_id = r.station_id
      -- Exclude prev_price <= 0 from BOTH numerator and denominator so the
      -- ratio reflects "rising / valid stations" rather than "rising /
      -- (valid + zero-priced anomalies)". Also NULLIF in the FILTER
      -- guards against division-by-zero in case the planner reorders
      -- the AND clause (Postgres doesn't guarantee short-circuit).
      WHERE p.prev_price > 0
    `;

    const row = result[0];
    const totalCount = row?.total_stations ?? 0;
    const risingCount = row?.rising_stations ?? 0;
    const thresholdMet =
      totalCount >= MIN_QUALIFYING_STATIONS &&
      risingCount / totalCount >= RISING_RATIO_THRESHOLD;
    return { thresholdMet, risingCount, totalCount };
  }

  /**
   * Reads the predictive-alert timestamp Redis key (Story 6.3 contract):
   *   key:   alert:rise:predictive:{fuelType}
   *   value: Date.now() as string (Unix ms)
   *   ttl:   72h (Story 6.3's dedup window)
   *
   * Returns:
   *   'none'      — no predictive alert cached (Story 6.3 hasn't fired or
   *                 6.3 isn't shipped yet)
   *   'too-soon'  — predictive alert <6h ago, suppress community alert
   *   'eligible'  — predictive alert ≥6h ago, send "as-expected" copy
   *
   * Fail-open on Redis errors: treat as 'none' so a Redis outage doesn't
   * block the community alert pipeline.
   *
   * NOTE: Story 6.2's original spec had the key per-voivodeship; Story
   * 6.3's spec correction (line 196) clarified that predictive alerts are
   * NATIONAL — a single 72h dedup per fuel type, no voivodeship in the
   * key. The voivodeship parameter is retained for log-line context only.
   */
  async checkPredictiveTiming(voivodeship: string, fuelType: string): Promise<PredictiveTiming> {
    try {
      // Voivodeship intentionally omitted from the Redis key — predictive
      // alerts are national. The parameter is retained on the signature
      // so call sites stay readable (community alerts ARE per-voivodeship,
      // even though the predictive timing read is national); included in
      // the warn log below for incident-debugging context.
      const raw = await this.redis.get(`alert:rise:predictive:${fuelType}`);
      if (!raw) return 'none';
      // Strict numeric parse: parseInt('2026-05-09T...') would return 2026
      // and silently treat it as a 1970 epoch, switching every alert to
      // "as-expected" copy. Story 6.3's contract is "Date.now() as
      // string"; reject anything that doesn't pass as a finite integer.
      if (!/^\d+$/.test(raw)) return 'none';
      const sentAt = Number(raw);
      if (!Number.isFinite(sentAt)) return 'none';
      const ageMs = Date.now() - sentAt;
      return ageMs >= PREDICTIVE_GRACE_MS ? 'eligible' : 'too-soon';
    } catch (e) {
      this.logger.warn(
        `Predictive timing read failed for ${voivodeship}:${fuelType} — fail-open: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 'none';
    }
  }

  /**
   * Two-stage lookup so we can pre-filter by token validity in app memory
   * before issuing the (potentially large) IN-clause voivodeship match.
   * Returns users whose most-recent fillup station is in the affected
   * voivodeship. No radius computation — voivodeship IS the geographic unit
   * for community alerts (see Dev Notes in spec).
   */
  async getEligibleUsers(voivodeship: string): Promise<EligibleUser[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        rise_community_enabled: true,
        expo_push_token: { not: null },
        // Mirror price-drop service: skip soft-deleted users so we never
        // push to abandoned accounts that retained their token.
        user: { deleted_at: null },
      },
      select: { user_id: true, expo_push_token: true },
    });

    const validPrefs = prefs
      .filter((p) => p.expo_push_token !== null && this.expoPush.isValidToken(p.expo_push_token))
      .map((p) => ({ user_id: p.user_id, expo_push_token: p.expo_push_token as string }));
    if (validPrefs.length === 0) return [];

    const userIds = validPrefs.map((p) => p.user_id);
    // Inner DISTINCT ON (f.user_id) returns each user's MOST RECENT
    // fillup overall; the outer WHERE keeps only those whose latest
    // fillup is in the target voivodeship. AC2 wording: "most recent
    // fill-up voivodeship matches the affected voivodeship" — i.e. a
    // user who recently moved to a different voivodeship is correctly
    // excluded even if they have older fillups in the affected region.
    const matches = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT ON (latest.user_id) latest.user_id
      FROM (
        SELECT DISTINCT ON (f.user_id) f.user_id, s.voivodeship
        FROM "FillUp" f
        JOIN "Station" s ON s.id = f.station_id
        WHERE f.user_id = ANY(${userIds}::uuid[])
        ORDER BY f.user_id, f.filled_at DESC
      ) latest
      WHERE latest.voivodeship = ${voivodeship}
    `;

    const matchedIds = new Set(matches.map((m) => m.user_id));
    return validPrefs
      .filter((p) => matchedIds.has(p.user_id))
      .map((p) => ({ userId: p.user_id, pushToken: p.expo_push_token }));
  }

  buildCopy(
    fuelLabel: string,
    variant: 'normal' | 'as-expected',
  ): { title: string; body: string } {
    if (variant === 'as-expected') {
      return {
        title: `${fuelLabel} prices have risen near you`,
        body: `As expected, ${fuelLabel} prices have now risen at stations near you.`,
      };
    }
    return {
      title: `${fuelLabel} prices rising near you`,
      body: `${fuelLabel} prices are rising across stations near you — consider filling up soon.`,
    };
  }

  private async sendAlerts(
    users: EligibleUser[],
    title: string,
    body: string,
    deepLink: string,
  ): Promise<void> {
    const messages: ExpoPushMessage[] = users.map((u) => ({
      to: u.pushToken,
      title,
      body,
      // Story 6.8 — alertType labels notification_opened events.
      data: { route: deepLink, alertType: 'community_rise' },
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
          const userId = users[cursor + i].userId;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const rawTo = chunk[i].to;
            const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
            if (staleToken) {
              try {
                // user_id-scoped clear so a token shared via device handoff
                // / restore-from-backup only nulls the entry for the user
                // who actually got the DeviceNotRegistered ticket.
                await this.prisma.notificationPreference.updateMany({
                  where: { user_id: userId, expo_push_token: staleToken },
                  data: { expo_push_token: null },
                });
                this.logger.warn(
                  `DeviceNotRegistered — cleared stale token for user ${userId} (${staleToken.slice(0, 20)}...)`,
                );
              } catch (e) {
                this.logger.error(
                  `Failed to clear stale token for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          } else {
            this.logger.warn(`Push ticket error for ${userId}: ${ticket.message}`);
          }
        }
      } catch (e) {
        this.logger.error(
          `Failed to send community-rise push chunk: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      cursor += chunk.length;
    }

    // Story 6.8 — one send-log row per batch for admin analytics.
    await this.sendLog.recordSend('community_rise', messages.length);
  }

  private async checkDedup(key: string): Promise<boolean> {
    try {
      return (await this.redis.get(key)) !== null;
    } catch (e) {
      // Fail-open: send if Redis unavailable. Better a rare duplicate alert
      // than silent suppression during an outage. Per-voivodeship dedup
      // collisions are rare — only one job per voivodeship+fuel runs
      // concurrently thanks to the BullMQ jobId dedup.
      this.logger.warn(
        `Redis dedup check failed for ${key} — fail-open: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  private async recordDedup(
    key: string,
    ttlSeconds: number = COMMUNITY_RISE_DEDUP_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', ttlSeconds);
    } catch (e) {
      this.logger.warn(
        `Failed to record community-rise dedup key ${key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
