# Story 6.8: Notification & Alert Engagement Analytics

Status: ready-for-dev

## Story

As an **ops admin**,
I want to see how drivers interact with notification permissions and alert settings,
So that I can identify where opt-in rates are low, measure re-prompting effectiveness, and decide where to invest product effort.

## Acceptance Criteria

**AC1 — Notifications tab in admin metrics panel:**
Given an admin opens the Metrics section of the admin panel
When they view it
Then a new "Notifications" tab is present alongside Pipeline Health, Contribution Funnel, and Product Metrics
And it follows the same tab-bar pattern, authentication, and visual language as existing tabs

**AC2 — Permission and opt-in metrics:**
Given an admin views the Notifications tab for a selected period
When the data loads
Then they see:
- **Push grant rate**: % of users with a valid `expo_push_token` of all registered users created in the period
- **Alert opt-in rates**: % of push-granted users with each alert type enabled: price drop, community rise, predictive rise, monthly summary
- **Config breakdown**: distribution of `alert_radius_km` choices (5km / 10km / 25km) and `price_drop_mode` split (cheaper-than-now / target-price) among price-drop-enabled users

**AC3 — Re-prompt conversion metrics:**
Given drivers interact with notification re-prompts (Story 6.6)
When the admin views the Notifications tab
Then they see per re-prompt trigger (photo-submission / monthly-summary):
- Show count (how many times the re-prompt was displayed)
- Dismiss count
- Grant count (how many drivers granted permission after the prompt)
- Conversion rate (grant / show)

**AC4 — Alert-to-engagement conversion:**
Given push notifications are sent by alert services (Stories 6.1–6.3, 6.5)
When the admin views the Notifications tab
Then they see per alert type: notifications sent (from `NotificationSendLog`) and app opens within 1 hour (from `NotificationEvent`), and the resulting engagement rate

**AC5 — Period filter:**
Given an admin views the Notifications tab
When they select a time period
Then they can filter between: last 7 days, last 30 days, last 90 days, all time
And all metrics update to reflect the selected period

**AC6 — Trend line:**
Given an admin inspects the Notifications tab
When data is available over multiple days
Then each section includes a daily breakdown (date + metric value) suitable for rendering a trend line on the frontend
And the trend granularity is: daily for 7d/30d, weekly for 90d/all

## Tasks / Subtasks

- [ ] T1: Schema — `NotificationEvent` + `NotificationSendLog` (AC3, AC4)
  - [ ] T1a: Add `NotificationEvent` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Add `NotificationSendLog` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1c: Create migration `packages/db/prisma/migrations/<timestamp>_add_notification_analytics/migration.sql`

- [ ] T2: Backend — event recording endpoint (AC3, AC4 mobile-side)
  - [ ] T2a: Add `POST /v1/me/notification-events` to `NotificationsController`
  - [ ] T2b: Accept body `{ eventType: string; trigger: string | null; alertType: string | null }` — store as `NotificationEvent` row; max string length 50 to prevent abuse; authenticated endpoint only
  - [ ] T2c: Validate `eventType` against allowlist: `'reprompt_shown' | 'reprompt_dismissed' | 'reprompt_granted' | 'notification_opened'`

- [ ] T3: Backend — server-side send logging (AC4)
  - [ ] T3a: Create `apps/api/src/alert/notification-send-log.service.ts` — `recordSend(alertType: string, recipientCount: number): Promise<void>` — inserts one `NotificationSendLog` row; fail-silently
  - [ ] T3b: Inject and call `notificationSendLogService.recordSend()` in:
    - `PriceDropAlertService.checkAndNotify()` after successful chunk send (alert_type: `'price_drop'`)
    - `CommunityRiseAlertService.sendAlerts()` (alert_type: `'community_rise'`)
    - `PredictiveRiseAlertService.sendAlerts()` (alert_type: `'predictive_rise'`)
    - `MonthlySummaryNotificationService.sendInChunks()` (alert_type: `'monthly_summary'`)
  - [ ] T3c: Export `NotificationSendLogService` from `AlertModule`; `MonthlySummaryModule` imports `AlertModule`

- [ ] T4: Backend — `NotificationAnalyticsService` (AC2–AC6)
  - [ ] T4a: Create `apps/api/src/admin/admin-notification-analytics.service.ts`
  - [ ] T4b: Implement `getMetrics(period)` — returns `NotificationAnalyticsDto` (see Dev Notes)
  - [ ] T4c: Compute permission/opt-in metrics from `NotificationPreference` table
  - [ ] T4d: Compute reprompt conversion from `NotificationEvent` table
  - [ ] T4e: Compute send + engagement metrics from `NotificationSendLog` + `NotificationEvent` tables
  - [ ] T4f: Generate daily/weekly trend buckets per metric

- [ ] T5: Backend — extend `AdminMetricsController` (AC1, AC5)
  - [ ] T5a: Add `GET /v1/admin/metrics/notifications?period=7d|30d|90d|all` to `AdminMetricsController`
  - [ ] T5b: Register `NotificationAnalyticsService` in `AdminModule`

- [ ] T6: Mobile — fire events from `NotificationRepromptSheet` (AC3)
  - [ ] T6a: In `NotificationRepromptSheet.tsx` (Story 6.6): on mount call `apiRecordNotificationEvent('reprompt_shown', trigger)` where trigger is `'photo'` or `'monthly'`
  - [ ] T6b: On "No thanks" tap: call `apiRecordNotificationEvent('reprompt_dismissed', trigger)`
  - [ ] T6c: On permission granted after "Enable": call `apiRecordNotificationEvent('reprompt_granted', trigger)`

- [ ] T7: Mobile — fire notification open event (AC4)
  - [ ] T7a: In `apps/mobile/app/(app)/_layout.tsx`: add `Notifications.addNotificationResponseReceivedListener()` — on notification tap, extract `alertType` from `notification.request.content.data.alertType` and call `apiRecordNotificationEvent('notification_opened', null, alertType)`
  - [ ] T7b: Each alert service must include `alertType` in the notification data payload (see Dev Notes)

- [ ] T8: Mobile — `apiRecordNotificationEvent` client (AC3, AC4)
  - [ ] T8a: Add `apiRecordNotificationEvent(eventType, trigger?, alertType?)` to `apps/mobile/src/api/notifications.ts`; best-effort (fire-and-forget, `.catch(() => {})`)

- [ ] T9: Admin panel — `NotificationsTab` component (AC1–AC6)
  - [ ] T9a: Create `apps/admin/app/(protected)/metrics/NotificationsTab.tsx` — follows `ProductMetricsTab.tsx` pattern; period selector (7d / 30d / 90d / all); stat cards + trend table
  - [ ] T9b: Add `fetchNotificationsMetrics(period)` server action to `actions.ts`
  - [ ] T9c: Add `NotificationAnalyticsDto` to `types.ts`
  - [ ] T9d: Add `'notifications'` tab to `MetricsDashboard.tsx` tab bar
  - [ ] T9e: Update `MetricsTranslations` interface in `lib/i18n.ts` — add `notifications` tab label + new period labels (`'90d'`, `'all'`); update all 3 locale objects (pl, en, uk)

- [ ] T10: Tests
  - [ ] T10a: `admin-notification-analytics.service.spec.ts` — `getMetrics`: push grant rate computed correctly from NotificationPreference; reprompt conversion rate = grant / show; engagement rate = opens / sends; returns zero counts (not null/undefined) when no data; trend bucketing: daily for 7d/30d, weekly for 90d/all
  - [ ] T10b: Full regression suite — all existing tests still pass

## Dev Notes

### NotificationEvent schema

```prisma
model NotificationEvent {
  id         String   @id @default(uuid())
  user_id    String?  // null for guest events (future)
  event_type String   // 'reprompt_shown' | 'reprompt_dismissed' | 'reprompt_granted' | 'notification_opened'
  trigger    String?  // 'photo' | 'monthly' (for reprompt events)
  alert_type String?  // 'price_drop' | 'community_rise' | 'predictive_rise' | 'monthly_summary' (for notification_opened)
  created_at DateTime @default(now())

  @@index([event_type, created_at])
  @@index([user_id, created_at])
}
```

### NotificationSendLog schema

```prisma
model NotificationSendLog {
  id              String   @id @default(uuid())
  alert_type      String   // 'price_drop' | 'community_rise' | 'predictive_rise' | 'monthly_summary'
  recipient_count Int
  created_at      DateTime @default(now())

  @@index([alert_type, created_at])
}
```

One row per send batch (not per recipient). `recipient_count` is the number of Expo messages sent. This enables both volume metrics and per-type breakdowns without high write volume.

### NotificationAnalyticsDto types

```ts
// apps/admin/app/(protected)/metrics/types.ts — add:

export interface RepromptStats {
  trigger:        'photo' | 'monthly';
  shown:          number;
  dismissed:      number;
  granted:        number;
  conversionRate: number;  // granted / shown (0–1)
}

export interface AlertEngagementStats {
  alertType:       string;   // 'price_drop' | 'community_rise' | 'predictive_rise' | 'monthly_summary'
  sent:            number;
  opened:          number;
  engagementRate:  number;   // opened / sent (0–1)
}

export interface TrendPoint {
  date:  string;   // 'YYYY-MM-DD' for daily, 'YYYY-WW' for weekly
  value: number;
}

export interface NotificationAnalyticsDto {
  period: string;
  // Permission + opt-in (AC2)
  totalUsers:          number;
  pushGrantedUsers:    number;
  pushGrantRate:       number;   // 0–1
  optInRates: {
    priceDrop:       number;
    communityRise:   number;
    predictiveRise:  number;
    monthlySummary:  number;
  };
  configBreakdown: {
    radius: { km5: number; km10: number; km25: number };
    dropMode: { cheaperThanNow: number; targetPrice: number };
  };
  // Re-prompt conversion (AC3)
  repromptStats:       RepromptStats[];
  // Alert engagement (AC4)
  alertEngagement:     AlertEngagementStats[];
  // Trend (AC6)
  pushGrantTrend:      TrendPoint[];
}
```

### getMetrics() implementation sketch

```ts
async getMetrics(period: NotifPeriod): Promise<NotificationAnalyticsDto> {
  const { start, end } = periodBounds(period);

  // 1. Permission + opt-in — from NotificationPreference (not time-filtered — snapshot)
  const totalUsers = await this.prisma.user.count();
  const prefs = await this.prisma.notificationPreference.findMany({
    select: {
      expo_push_token: true,
      price_drop_enabled: true,
      rise_community_enabled: true,
      rise_predictive_enabled: true,
      monthly_summary: true,
      alert_radius_km: true,
      price_drop_mode: true,
    },
  });
  const granted = prefs.filter(p => p.expo_push_token != null);
  const pushGrantRate = totalUsers > 0 ? granted.length / totalUsers : 0;

  // Opt-in rates as % of push-granted users
  const optInRates = {
    priceDrop:      pct(granted.filter(p => p.price_drop_enabled).length,      granted.length),
    communityRise:  pct(granted.filter(p => p.rise_community_enabled).length,  granted.length),
    predictiveRise: pct(granted.filter(p => p.rise_predictive_enabled).length, granted.length),
    monthlySummary: pct(granted.filter(p => p.monthly_summary).length,         granted.length),
  };

  // Config breakdown — among price-drop-enabled users with push token
  const dropEnabled = granted.filter(p => p.price_drop_enabled);

  // 2. Reprompt conversion — from NotificationEvent (time-filtered)
  const repromptEvents = await this.prisma.notificationEvent.findMany({
    where: { event_type: { in: ['reprompt_shown', 'reprompt_dismissed', 'reprompt_granted'] }, created_at: { gte: start } },
    select: { event_type: true, trigger: true },
  });
  const repromptStats = (['photo', 'monthly'] as const).map((trigger) => {
    const forTrigger = repromptEvents.filter(e => e.trigger === trigger);
    const shown = forTrigger.filter(e => e.event_type === 'reprompt_shown').length;
    const dismissed = forTrigger.filter(e => e.event_type === 'reprompt_dismissed').length;
    const granted = forTrigger.filter(e => e.event_type === 'reprompt_granted').length;
    return { trigger, shown, dismissed, granted, conversionRate: pct(granted, shown) };
  });

  // 3. Alert engagement — send logs + open events (time-filtered)
  const sendLogs = await this.prisma.notificationSendLog.groupBy({
    by: ['alert_type'],
    where: { created_at: { gte: start } },
    _sum: { recipient_count: true },
  });
  const opens = await this.prisma.notificationEvent.groupBy({
    by: ['alert_type'],
    where: { event_type: 'notification_opened', created_at: { gte: start } },
    _count: { id: true },
  });
  const alertEngagement = sendLogs.map(log => {
    const sent = log._sum.recipient_count ?? 0;
    const opened = opens.find(o => o.alert_type === log.alert_type)?._count.id ?? 0;
    return { alertType: log.alert_type, sent, opened, engagementRate: pct(opened, sent) };
  });

  // 4. Push grant trend — daily new users + daily push grants (new users created in period)
  // ... daily bucket query

  return {
    period,
    totalUsers, pushGrantedUsers: granted.length, pushGrantRate,
    optInRates, configBreakdown: { ... }, repromptStats, alertEngagement,
    pushGrantTrend: [],   // filled by trend query
  };
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}
```

### alertType in notification data payloads

Each alert service must include `alertType` in the Expo push message data so the mobile client can forward it in `notification_opened` events:

```ts
// In each alert service's message builder:
data: {
  route: '/map',
  alertType: 'predictive_rise',  // 'price_drop' | 'community_rise' | 'predictive_rise' | 'monthly_summary'
}
```

Add `alertType` field to the `data` object in:
- `PredictiveRiseAlertService.sendAlerts()` → `'predictive_rise'`
- `CommunityRiseAlertService.sendAlerts()` → `'community_rise'`
- `PriceDropAlertService.checkAndNotify()` → `'price_drop'`
- `MonthlySummaryNotificationService.sendInChunks()` → `'monthly_summary'`

### `Notifications.addNotificationResponseReceivedListener` in `_layout.tsx`

```ts
useEffect(() => {
  if (!accessToken) return;
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const alertType = response.notification.request.content.data?.alertType as string | undefined;
    if (alertType) {
      void apiRecordNotificationEvent(accessToken, 'notification_opened', undefined, alertType)
        .catch(() => {});
    }
  });
  return () => sub.remove();
}, [accessToken]);
```

### MetricsDashboard tab extension

```tsx
// apps/admin/app/(protected)/metrics/MetricsDashboard.tsx
type TabId = 'pipeline' | 'funnel' | 'product' | 'notifications';

// Add 'notifications' to the tab array and render <NotificationsTab t={t} /> when active
```

### MetricsTranslations extension

```ts
// lib/i18n.ts — MetricsTranslations interface update:
export interface MetricsTranslations {
  tabs: { pipeline: string; funnel: string; product: string; notifications: string };
  period: { today: string; '7d': string; '30d': string; '90d': string; all: string };
  // ... existing fields
}

// New 'notifications' tab label strings:
// en: 'Notifications'
// pl: 'Powiadomienia'
// uk: 'Сповіщення'

// New period labels:
// '90d': en 'Last 90 days' | pl 'Ostatnie 90 dni' | uk 'Останні 90 днів'
// 'all':  en 'All time'     | pl 'Cały czas'       | uk 'За весь час'
```

The existing `'today' | '7d' | '30d'` period labels remain — notifications tab uses `'7d' | '30d' | '90d' | 'all'` which are a superset (minus 'today').

### Period bounds for notifications

```ts
type NotifPeriod = '7d' | '30d' | '90d' | 'all';

function periodBounds(period: NotifPeriod): { start: Date } {
  const now = new Date();
  switch (period) {
    case '7d':  return { start: new Date(now.getTime() - 7 * 86400_000) };
    case '30d': return { start: new Date(now.getTime() - 30 * 86400_000) };
    case '90d': return { start: new Date(now.getTime() - 90 * 86400_000) };
    case 'all': return { start: new Date(0) }; // epoch
  }
}
```

### Note on opt-in metrics time filtering

`NotificationPreference` is a snapshot table (one row per user, updated in place). Opt-in rates and config breakdown are therefore current-state metrics — not filterable by historical period in a meaningful way. They always reflect today's preference state.

The period filter applies to: reprompt events, send logs, and open events (which are time-stamped). The admin UI should make this distinction clear — e.g., a footnote: "Permission and opt-in figures show current state; reprompt and engagement figures reflect the selected period."

### Note on Story 4.9 (deferred analytics)

Story 4.9 (Product Analytics Integration) is blocked pending vendor selection. Story 6.8 intentionally avoids dependency on 4.9 by using a lightweight in-house `NotificationEvent` table rather than a third-party analytics SDK. If 4.9 ships later, these events can be dual-written to the external analytics platform — the `NotificationEvent` table remains the source of truth for the admin panel regardless.

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — `NotificationEvent` + `NotificationSendLog` models)
- `packages/db/prisma/migrations/<timestamp>_add_notification_analytics/migration.sql` (new)
- `apps/api/src/alert/notification-send-log.service.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified — provide + export `NotificationSendLogService`)
- `apps/api/src/alert/price-drop-alert.service.ts` (modified — record send + alertType in data)
- `apps/api/src/alert/community-rise-alert.service.ts` (modified — record send + alertType)
- `apps/api/src/alert/predictive-rise-alert.service.ts` (modified — record send + alertType)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified — record send + alertType)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified — import AlertModule)
- `apps/api/src/notifications/notifications.controller.ts` (modified — add event endpoint)
- `apps/api/src/notifications/notifications.service.ts` (modified — record NotificationEvent)
- `apps/api/src/admin/admin-notification-analytics.service.ts` (new)
- `apps/api/src/admin/admin-metrics.controller.ts` (modified — add `/notifications` route)
- `apps/api/src/admin/admin.module.ts` (modified — register service)
- `apps/admin/app/(protected)/metrics/NotificationsTab.tsx` (new)
- `apps/admin/app/(protected)/metrics/MetricsDashboard.tsx` (modified — add notifications tab)
- `apps/admin/app/(protected)/metrics/actions.ts` (modified — add `fetchNotificationsMetrics`)
- `apps/admin/app/(protected)/metrics/types.ts` (modified — add `NotificationAnalyticsDto` + related)
- `apps/admin/lib/i18n.ts` (modified — extend `MetricsTranslations` + all 3 locale objects)
- `apps/mobile/src/api/notifications.ts` (modified — add `apiRecordNotificationEvent`)
- `apps/mobile/src/components/NotificationRepromptSheet.tsx` (modified — fire events)
- `apps/mobile/app/(app)/_layout.tsx` (modified — notification response listener)

### References

- Existing metrics tab pattern: [apps/admin/app/(protected)/metrics/ProductMetricsTab.tsx](apps/admin/app/(protected)/metrics/ProductMetricsTab.tsx)
- Existing MetricsDashboard: [apps/admin/app/(protected)/metrics/MetricsDashboard.tsx](apps/admin/app/(protected)/metrics/MetricsDashboard.tsx)
- AdminMetricsController: [apps/api/src/admin/admin-metrics.controller.ts](apps/api/src/admin/admin-metrics.controller.ts)
- `NotificationRepromptSheet` (fires events): Story 6.6
- Alert services (record sends): Stories 6.1, 6.2, 6.3, 6.5
- Story 4.9 (deferred — future event platform integration)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.8 (line ~2762)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/<timestamp>_add_notification_analytics/migration.sql` (new)
- `apps/api/src/alert/notification-send-log.service.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified)
- `apps/api/src/alert/price-drop-alert.service.ts` (modified)
- `apps/api/src/alert/community-rise-alert.service.ts` (modified)
- `apps/api/src/alert/predictive-rise-alert.service.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified)
- `apps/api/src/notifications/notifications.controller.ts` (modified)
- `apps/api/src/notifications/notifications.service.ts` (modified)
- `apps/api/src/admin/admin-notification-analytics.service.ts` (new)
- `apps/api/src/admin/admin-metrics.controller.ts` (modified)
- `apps/api/src/admin/admin.module.ts` (modified)
- `apps/admin/app/(protected)/metrics/NotificationsTab.tsx` (new)
- `apps/admin/app/(protected)/metrics/MetricsDashboard.tsx` (modified)
- `apps/admin/app/(protected)/metrics/actions.ts` (modified)
- `apps/admin/app/(protected)/metrics/types.ts` (modified)
- `apps/admin/lib/i18n.ts` (modified)
- `apps/mobile/src/api/notifications.ts` (modified)
- `apps/mobile/src/components/NotificationRepromptSheet.tsx` (modified)
- `apps/mobile/app/(app)/_layout.tsx` (modified)
- `apps/api/src/admin/admin-notification-analytics.service.spec.ts` (new)
- `_bmad-output/implementation-artifacts/6-8-notification-alert-engagement-analytics.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
