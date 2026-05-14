import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Story 6.8 — admin-side aggregation of notification + alert telemetry.
 *
 * Three families of metrics are blended into a single response so the
 * admin tab can render them as a unit:
 *   1. **Permission + opt-in** — snapshot from NotificationPreference. NOT
 *      time-filterable (the table is mutated in-place), so these always
 *      reflect today's preference state regardless of the chosen period.
 *   2. **Re-prompt conversion** — from NotificationEvent table; time-filtered.
 *   3. **Alert engagement** — sent counts from NotificationSendLog, opens
 *      from NotificationEvent (`event_type: 'notification_opened'`).
 *
 * Plus a daily/weekly trend bucket for push grant. Permission/opt-in
 * cardinality is small (one row per user, tiny per-row payload) so we
 * pull all matching rows once and group in JS rather than running N
 * grouping queries.
 */
export type NotifPeriod = '7d' | '30d' | '90d' | 'all';

const KNOWN_ALERT_TYPES = [
  'price_drop',
  'community_rise',
  'predictive_rise',
  'monthly_summary',
] as const;

const REPROMPT_TRIGGERS = ['photo', 'monthly'] as const;

export interface RepromptStats {
  trigger: 'photo' | 'monthly';
  shown: number;
  dismissed: number;
  granted: number;
  conversionRate: number;
}

export interface AlertEngagementStats {
  alertType: string;
  sent: number;
  opened: number;
  engagementRate: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface NotificationAnalyticsDto {
  period: NotifPeriod;
  totalUsers: number;
  pushGrantedUsers: number;
  pushGrantRate: number;
  optInRates: {
    priceDrop: number;
    communityRise: number;
    predictiveRise: number;
    monthlySummary: number;
  };
  configBreakdown: {
    radius: { km5: number; km10: number; km25: number };
    dropMode: { cheaperThanNow: number; targetPrice: number };
  };
  repromptStats: RepromptStats[];
  alertEngagement: AlertEngagementStats[];
  pushGrantTrend: TrendPoint[];
}

@Injectable()
export class AdminNotificationAnalyticsService {
  private readonly logger = new Logger(AdminNotificationAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(period: NotifPeriod): Promise<NotificationAnalyticsDto> {
    const { start } = periodBounds(period);

    // ── 1. Permission + opt-in (snapshot — not time-filtered) ─────────
    const [totalUsers, prefs] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.notificationPreference.findMany({
        select: {
          expo_push_token: true,
          price_drop_enabled: true,
          rise_community_enabled: true,
          rise_predictive_enabled: true,
          monthly_summary: true,
          alert_radius_km: true,
          price_drop_mode: true,
        },
      }),
    ]);

    const granted = prefs.filter((p) => p.expo_push_token != null);
    const grantedCount = granted.length;
    const pushGrantRate = pct(grantedCount, totalUsers);

    const optInRates = {
      priceDrop: pct(granted.filter((p) => p.price_drop_enabled).length, grantedCount),
      communityRise: pct(granted.filter((p) => p.rise_community_enabled).length, grantedCount),
      predictiveRise: pct(granted.filter((p) => p.rise_predictive_enabled).length, grantedCount),
      monthlySummary: pct(granted.filter((p) => p.monthly_summary).length, grantedCount),
    };

    // Config breakdown is computed over price-drop-enabled users only —
    // the radius / mode controls aren't meaningful for users with drops
    // turned off.
    const dropEnabled = granted.filter((p) => p.price_drop_enabled);
    const configBreakdown = {
      radius: {
        km5: dropEnabled.filter((p) => p.alert_radius_km === 5).length,
        km10: dropEnabled.filter((p) => p.alert_radius_km === 10).length,
        km25: dropEnabled.filter((p) => p.alert_radius_km === 25).length,
      },
      dropMode: {
        cheaperThanNow: dropEnabled.filter((p) => p.price_drop_mode === 'cheaper_than_now').length,
        targetPrice: dropEnabled.filter((p) => p.price_drop_mode === 'target_price').length,
      },
    };

    // ── 2. Re-prompt conversion (time-filtered) ──────────────────────
    const repromptEvents = await this.prisma.notificationEvent.findMany({
      where: {
        event_type: { in: ['reprompt_shown', 'reprompt_dismissed', 'reprompt_granted'] },
        created_at: { gte: start },
      },
      select: { event_type: true, trigger: true },
    });

    const repromptStats: RepromptStats[] = REPROMPT_TRIGGERS.map((trigger) => {
      const forTrigger = repromptEvents.filter((e) => e.trigger === trigger);
      const shown = forTrigger.filter((e) => e.event_type === 'reprompt_shown').length;
      const dismissed = forTrigger.filter((e) => e.event_type === 'reprompt_dismissed').length;
      const grantedEv = forTrigger.filter((e) => e.event_type === 'reprompt_granted').length;
      return { trigger, shown, dismissed, granted: grantedEv, conversionRate: pct(grantedEv, shown) };
    });

    // ── 3. Alert engagement: sends + opens ──────────────────────────
    const [sendLogs, opens] = await Promise.all([
      this.prisma.notificationSendLog.groupBy({
        by: ['alert_type'],
        where: { created_at: { gte: start } },
        _sum: { recipient_count: true },
      }),
      this.prisma.notificationEvent.groupBy({
        by: ['alert_type'],
        where: { event_type: 'notification_opened', created_at: { gte: start } },
        _count: { id: true },
      }),
    ]);

    // Build per-alert-type lookup so we can guarantee every known type
    // appears in the response (zero counts → 0 row, not missing).
    const sentByType = new Map<string, number>(
      sendLogs.map((row) => [row.alert_type, row._sum.recipient_count ?? 0]),
    );
    const openedByType = new Map<string, number>(
      opens.map((row) => [row.alert_type ?? '', row._count.id]),
    );

    const alertEngagement: AlertEngagementStats[] = KNOWN_ALERT_TYPES.map((alertType) => {
      const sent = sentByType.get(alertType) ?? 0;
      const opened = openedByType.get(alertType) ?? 0;
      return { alertType, sent, opened, engagementRate: pct(opened, sent) };
    });

    // ── 4. Push-grant trend ────────────────────────────────────────
    // Daily for 7d/30d, weekly for 90d/all. The trend counts NEW
    // grants per bucket (users whose pref-row was created with a token,
    // OR who updated their pref-row to add a token). At MVP scale we
    // approximate by counting NotificationPreference rows with a token
    // whose `updated_at` falls in each bucket — the row is touched on
    // every PATCH so this captures both create+update transitions.
    const pushGrantTrend = await this.computeGrantTrend(period, start);

    return {
      period,
      totalUsers,
      pushGrantedUsers: grantedCount,
      pushGrantRate,
      optInRates,
      configBreakdown,
      repromptStats,
      alertEngagement,
      pushGrantTrend,
    };
  }

  /**
   * Build a per-day (or per-week for the longer windows) trend of the
   * number of NotificationPreference rows that have a push token AND
   * were last updated in the bucket. Approximates "new grants" cheaply
   * without an event log of permission grants — sufficient for the trend
   * line UX at MVP scale.
   */
  private async computeGrantTrend(period: NotifPeriod, start: Date): Promise<TrendPoint[]> {
    // For 'all' we don't want to compute trend back to epoch — cap at
    // 90 days for a sensible chart even when period is 'all'.
    const granularity: 'day' | 'week' = period === '7d' || period === '30d' ? 'day' : 'week';
    const trendStart =
      period === 'all'
        ? new Date(Date.now() - 90 * 86_400_000)
        : start;

    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        expo_push_token: { not: null },
        updated_at: { gte: trendStart },
      },
      select: { updated_at: true },
    });

    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = bucketKey(r.updated_at, granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    // Sort by bucket key ascending so the chart renders left-to-right
    // chronologically.
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, value]) => ({ date, value }));
  }
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function periodBounds(period: NotifPeriod): { start: Date } {
  const now = Date.now();
  switch (period) {
    case '7d':
      return { start: new Date(now - 7 * 86_400_000) };
    case '30d':
      return { start: new Date(now - 30 * 86_400_000) };
    case '90d':
      return { start: new Date(now - 90 * 86_400_000) };
    case 'all':
      return { start: new Date(0) };
  }
}

function bucketKey(d: Date, granularity: 'day' | 'week'): string {
  if (granularity === 'day') {
    // YYYY-MM-DD (UTC)
    return d.toISOString().slice(0, 10);
  }
  // ISO-week-ish: YYYY-WW using UTC. Compute the ISO week number cheaply
  // for an approximate weekly bucket label.
  const year = d.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const day = Math.floor((d.getTime() - startOfYear) / 86_400_000);
  const week = Math.floor(day / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
