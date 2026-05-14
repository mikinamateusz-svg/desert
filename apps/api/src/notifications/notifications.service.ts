import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

// Phase 1 + Phase 2 fields surfaced to the client. Phase 1 columns
// retained for back-compat with the existing alert pipeline; UI consumes
// the Phase 2 columns post-Story 6.4. expo_push_token is intentionally
// excluded — it's a write-only secret from the client's POV.
const SELECT_WITHOUT_TOKEN = {
  id: true,
  user_id: true,
  // Phase 1 (legacy)
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
  // Phase 2 (Story 6.4)
  price_drop_enabled: true,
  price_drop_mode: true,
  price_drop_target_pln: true,
  price_drop_fuel_types: true,
  alert_radius_km: true,
  rise_community_enabled: true,
  rise_predictive_enabled: true,
  created_at: true,
  updated_at: true,
} as const;

/**
 * Story 6.6 — return shape for the smart-reprompt endpoint.
 * `pending` — true when the re-prompt sheet should surface (no token +
 * Story 6.5 has flagged this user). The mobile client uses this as the
 * sole gate for showing the monthly variant.
 * `savedPln` — rounded prior-month savings amount when ≥ 1 PLN; null
 * otherwise. The UI falls back to a generic "Your monthly summary is
 * ready" copy when null rather than risking a "You saved 0 PLN" line.
 */
export interface SummaryRepromptStatus {
  pending: boolean;
  savedPln: number | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { user_id: userId },
      create: { user_id: userId },
      update: {},
      select: SELECT_WITHOUT_TOKEN,
    });
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    return this.prisma.notificationPreference.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        // Phase 1 — Story 1.7 created these as default-true. New rows
        // born here keep the legacy default unless the DTO overrides.
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        price_drops: dto.price_drops ?? true,
        sharp_rise: dto.sharp_rise ?? true,
        monthly_summary: dto.monthly_summary ?? true,
        // Phase 2 — schema defaults handle the false / 'cheaper_than_now'
        // / [] / 10 baseline; DTO overrides only when explicit.
        ...(dto.price_drop_enabled !== undefined && { price_drop_enabled: dto.price_drop_enabled }),
        ...(dto.price_drop_mode !== undefined && { price_drop_mode: dto.price_drop_mode }),
        ...(dto.price_drop_target_pln !== undefined && { price_drop_target_pln: dto.price_drop_target_pln }),
        ...(dto.price_drop_fuel_types !== undefined && { price_drop_fuel_types: dto.price_drop_fuel_types }),
        ...(dto.alert_radius_km !== undefined && { alert_radius_km: dto.alert_radius_km }),
        ...(dto.rise_community_enabled !== undefined && { rise_community_enabled: dto.rise_community_enabled }),
        ...(dto.rise_predictive_enabled !== undefined && { rise_predictive_enabled: dto.rise_predictive_enabled }),
      },
      update: {
        ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
        // Phase 1
        ...(dto.price_drops !== undefined && { price_drops: dto.price_drops }),
        ...(dto.sharp_rise !== undefined && { sharp_rise: dto.sharp_rise }),
        ...(dto.monthly_summary !== undefined && { monthly_summary: dto.monthly_summary }),
        // Phase 2
        ...(dto.price_drop_enabled !== undefined && { price_drop_enabled: dto.price_drop_enabled }),
        ...(dto.price_drop_mode !== undefined && { price_drop_mode: dto.price_drop_mode }),
        ...(dto.price_drop_target_pln !== undefined && { price_drop_target_pln: dto.price_drop_target_pln }),
        ...(dto.price_drop_fuel_types !== undefined && { price_drop_fuel_types: dto.price_drop_fuel_types }),
        ...(dto.alert_radius_km !== undefined && { alert_radius_km: dto.alert_radius_km }),
        ...(dto.rise_community_enabled !== undefined && { rise_community_enabled: dto.rise_community_enabled }),
        ...(dto.rise_predictive_enabled !== undefined && { rise_predictive_enabled: dto.rise_predictive_enabled }),
      },
      select: SELECT_WITHOUT_TOKEN,
    });
  }

  /**
   * Story 6.6 — drives the monthly-summary smart re-prompt sheet on the
   * mobile client. Returns `{ pending: true, savedPln }` only when:
   *   - user has no push token (re-prompt is meaningful), AND
   *   - Story 6.5 has already calculated their previous month's summary
   *     (Redis key `monthly:summary:calculated:{userId}` exists).
   *
   * The savings amount is computed via the same aggregate Story 6.5 uses,
   * scoped to the previous calendar month and the requesting user only.
   * Returns null `savedPln` when net savings are not positive — the UI
   * falls back to a generic "Enable notifications" copy without the
   * personalised amount.
   */
  async getSummaryReprompt(userId: string): Promise<SummaryRepromptStatus> {
    // 1. Skip if user already has a usable token — re-prompt is moot.
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { user_id: userId },
      select: { expo_push_token: true },
    });
    if (pref?.expo_push_token) return { pending: false, savedPln: null };

    // 2. Story 6.5 sets this key on the no-token branch. Absence means
    //    either (a) the monthly cron hasn't run for this user yet, or
    //    (b) the 45-day TTL expired. Both → no re-prompt.
    //    Fail-CLOSED on Redis errors: better to suppress one re-prompt
    //    than to surface a stale "you saved X" claim with no backing.
    let hasPendingKey = false;
    try {
      // Strict equality on the literal '1' written by Story 6.5 — guards
      // against future stories overloading the same key with sentinels
      // ('0' for "calculated but skipped", etc.) being interpreted as
      // "yes, show the reprompt".
      const raw = await this.redis.get(`monthly:summary:calculated:${userId}`);
      hasPendingKey = raw === '1';
    } catch (e) {
      this.logger.warn(
        `Redis read failed for monthly:summary:calculated:${userId} — fail-closed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { pending: false, savedPln: null };
    }
    if (!hasPendingKey) return { pending: false, savedPln: null };

    // 3. Compute previous month savings for personalised copy. UTC bounds
    //    match Story 6.5's aggregateSavings — Railway is UTC, FillUp.filled_at
    //    is stored UTC.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const result = await this.prisma.$queryRaw<Array<{ total_savings: number | null }>>`
      SELECT SUM((area_avg_at_fillup - price_per_litre_pln) * litres)::float AS total_savings
      FROM "FillUp"
      WHERE user_id = ${userId}::uuid
        AND filled_at >= ${monthStart}
        AND filled_at <  ${monthEnd}
        AND area_avg_at_fillup IS NOT NULL
        AND price_per_litre_pln IS NOT NULL
        AND litres IS NOT NULL
    `;

    const total = result[0]?.total_savings ?? null;
    // Match Story 6.5's < 1 PLN skip: don't surface "You saved 0 PLN".
    // pending stays true (Story 6.5 ran for this user) — the UI falls
    // back to a generic "Your monthly summary is ready" copy when
    // savedPln is null.
    const rounded = total !== null ? Math.round(total) : null;
    const savedPln = rounded !== null && rounded >= 1 ? rounded : null;
    return { pending: true, savedPln };
  }

  /**
   * Story 6.8 — persist a notification analytics event. Controller has
   * already sanitised + allowlisted the `eventType`; this method just
   * writes the row. Best-effort: swallow DB failures so an outage of
   * the analytics table never blocks the rest of the request flow.
   */
  async recordEvent(
    userId: string,
    payload: { eventType: string; trigger: string | null; alertType: string | null },
  ): Promise<void> {
    try {
      await this.prisma.notificationEvent.create({
        data: {
          user_id: userId,
          event_type: payload.eventType,
          trigger: payload.trigger,
          alert_type: payload.alertType,
        },
      });
    } catch (e: unknown) {
      this.logger.warn(
        `Failed to record NotificationEvent (user=${userId} type=${payload.eventType}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
