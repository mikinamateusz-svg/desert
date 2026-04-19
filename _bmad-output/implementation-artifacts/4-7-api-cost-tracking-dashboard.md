# Story 4.7: API Cost Tracking Dashboard

Status: ready-for-dev

## Story

As an **ops admin**,
I want to see Claude Haiku API spend broken down by day, week, and month,
So that I can track costs against budget and spot anomalies before they become a surprise invoice.

## Acceptance Criteria

**AC1 — Cost dashboard tab:**
Given an ADMIN opens the Metrics section
When they view the API Cost tab
Then they see Claude Haiku spend for: today, current week, current month, and last 3 months as a bar chart
And cost is shown in USD alongside the image count processed in each period

**AC2 — Monthly alert:**
Given monthly spend exceeds a configurable threshold (default: $50)
When the threshold is crossed
Then an automated alert is sent to the ops team via the same Slack channel configured in Story 4.4 (`SLACK_WEBHOOK_URL`)

**AC3 — Consistent navigation:**
Given the admin views the API Cost tab
When viewed alongside other admin panel sections
Then it follows the same navigation shell, authentication, and visual language as existing metrics tabs

## Tasks / Subtasks

- [ ] T1: Prisma model + migration — `DailyApiCost` (AC1)
  - [ ] T1a: Add `DailyApiCost` model to `packages/db/prisma/schema.prisma`
  - [ ] T1b: Run `pnpm --filter @desert/db prisma migrate dev --name add-daily-api-cost`
  - [ ] T1c: Regenerate Prisma client

- [ ] T2: Extend `OcrSpendService` — DB persistence + monthly alert (AC1, AC2)
  - [ ] T2a: Inject `PrismaService` into `OcrSpendService`
  - [ ] T2b: Add `persistDailySpend(costUsd)` — upserts `DailyApiCost` for current UTC date (increment `spend_usd` + `image_count`)
  - [ ] T2c: Call `persistDailySpend` inside `recordSpend` (after Redis INCRBYFLOAT)
  - [ ] T2d: Add `getMonthlySpend(year, month)` — queries DB for sum of `spend_usd` for the given month
  - [ ] T2e: Add `checkMonthlyAlert()` — calls `getMonthlySpend` for current month; if > `COST_ALERT_THRESHOLD_USD` (ENV var, default $50) AND alert not yet sent this month (Redis flag `ocr:cost_alert:{YYYY-MM}`), POST to `SLACK_WEBHOOK_URL` and set flag with 32-day TTL
  - [ ] T2f: Call `checkMonthlyAlert()` at end of `recordSpend` (fire-and-forget, swallow errors)
  - [ ] T2g: Add `COST_ALERT_THRESHOLD_USD` to `.env.example`

- [ ] T3: `AdminMetricsService` — `getApiCostMetrics()` (AC1)
  - [ ] T3a: Add `ApiCostMetricsDto` interface to `admin-metrics.service.ts`
  - [ ] T3b: Implement `getApiCostMetrics()` — queries `DailyApiCost` table; computes today/week/month/last-3-months aggregates
  - [ ] T3c: For "today", also check Redis `OcrSpendService.getDailySpend()` as real-time fallback if DB row not yet created

- [ ] T4: API endpoint — `GET /v1/admin/metrics/cost` (AC1)
  - [ ] T4a: Add `@Get('cost')` to `AdminMetricsController`
  - [ ] T4b: Inject `OcrSpendService` into `AdminMetricsService` (or pass PrismaService directly for DB queries)

- [ ] T5: Admin UI — `ApiCostTab.tsx` component (AC1, AC3)
  - [ ] T5a: Create `apps/admin/app/(protected)/metrics/ApiCostTab.tsx`
  - [ ] T5b: Implement bar chart using CSS (no new charting library — see Dev Notes)
  - [ ] T5c: Add `fetchApiCostMetrics()` server action to `actions.ts`
  - [ ] T5d: Add `ApiCostMetricsDto` type to `metrics/types.ts`

- [ ] T6: Wire tab into `MetricsDashboard.tsx` (AC3)
  - [ ] T6a: Add `'cost'` to `TabId` union
  - [ ] T6b: Add tab button and `{activeTab === 'cost' && <ApiCostTab t={t} />}` render

- [ ] T7: i18n — all 3 locales (pl, en, uk) (AC3)
  - [ ] T7a: Add `cost` key to `metrics.tabs` in all 3 locales
  - [ ] T7b: Add `metrics.cost` section with all display labels in all 3 locales
  - [ ] T7c: Update `MetricsTranslations` interface to include `tabs.cost` and `cost` section

- [ ] T8: Tests
  - [ ] T8a: `ocr-spend.service.spec.ts` — `persistDailySpend` upserts correctly; `getMonthlySpend` sums DB rows; `checkMonthlyAlert` fires Slack and sets Redis flag; alert not re-sent if flag exists
  - [ ] T8b: `admin-metrics.service.spec.ts` — `getApiCostMetrics` returns correct aggregates from mocked DB; today falls back to Redis when DB row missing
  - [ ] T8c: Full regression suite — all existing tests still pass

## Dev Notes

### Critical: Redis TTL means historical data isn't available without DB

`OcrSpendService` stores spend in Redis key `ocr:spend:{YYYY-MM-DD}` with **48h TTL** (see `apps/api/src/photo/ocr-spend.service.ts:34`). Keys older than 2 days are gone. To show "current week / current month / last 3 months", the story **must** persist daily totals to the `DailyApiCost` DB table. Do not attempt to scan Redis for historical keys — data won't be there.

### Prisma model

Add to `packages/db/prisma/schema.prisma`:

```prisma
model DailyApiCost {
  id          String   @id @default(cuid())
  date        DateTime @unique @db.Date
  spend_usd   Float    @default(0)
  image_count Int      @default(0)
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
}
```

`@unique` on `date` enables safe `upsert`. Use `@db.Date` so Prisma maps to PostgreSQL `DATE` (not `TIMESTAMP`) — avoids timezone edge cases when grouping by day.

### persistDailySpend upsert pattern

```ts
async persistDailySpend(costUsd: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  await this.prisma.dailyApiCost.upsert({
    where: { date: new Date(today) },
    create: { date: new Date(today), spend_usd: costUsd, image_count: 1 },
    update: {
      spend_usd: { increment: costUsd },
      image_count: { increment: 1 },
    },
  });
}
```

Call this inside `recordSpend()` after the Redis INCRBYFLOAT — fail-open (wrap in try/catch, log warn on error, do not throw).

### Monthly alert — Redis dedup flag

Do NOT re-use the same `SLACK_WEBHOOK_URL` posting logic from `SlackAlertService` in `admin-dlq.service.ts` — that service is tightly coupled to DLQ. Instead, post directly to `SLACK_WEBHOOK_URL` from `OcrSpendService` using `fetch` with `AbortSignal.timeout(5000)` (same pattern as Story 4.4 P-10).

Dedup flag: Redis key `ocr:cost_alert:{YYYY-MM}` (e.g. `ocr:cost_alert:2026-04`). Set after sending alert with TTL of `32 * 24 * 3600` (32 days). If key exists → skip alert.

```ts
async checkMonthlyAlert(): Promise<void> {
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7); // 'YYYY-MM'
  const flagKey = `ocr:cost_alert:${yearMonth}`;
  const alreadySent = await this.redis.get(flagKey);
  if (alreadySent) return;

  const threshold = this.getCostAlertThreshold();
  const monthlySpend = await this.getMonthlySpend(now.getUTCFullYear(), now.getUTCMonth() + 1);
  if (monthlySpend < threshold) return;

  const url = this.config.get<string>('SLACK_WEBHOOK_URL');
  if (!url || !url.startsWith('https://hooks.slack.com/')) return; // SSRF guard (same as Story 4.4 P-6)

  const dashboardUrl = this.config.get<string>('ADMIN_DASHBOARD_URL', '');
  const body = {
    text: `[COST-ALERT] Claude API monthly spend $${monthlySpend.toFixed(2)} exceeded threshold $${threshold.toFixed(2)}. ${dashboardUrl}/metrics`,
  };

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  await this.redis.set(flagKey, '1', 'EX', 32 * 24 * 3600);
}
```

### ApiCostMetricsDto

```ts
export interface ApiCostPeriodDto {
  spendUsd: number;
  imageCount: number;
}

export interface ApiCostMonthDto {
  month: string; // 'YYYY-MM'
  spendUsd: number;
  imageCount: number;
}

export interface ApiCostMetricsDto {
  today: ApiCostPeriodDto;
  currentWeek: ApiCostPeriodDto;
  currentMonth: ApiCostPeriodDto;
  last3Months: ApiCostMonthDto[]; // array of 3 months, oldest first
}
```

### getApiCostMetrics() implementation notes

- Query DB once: `WHERE date >= firstDayOf3MonthsAgo AND date <= today`
- Aggregate in-memory for today / week / month / 3-month buckets
- For "today": if DB row for today is missing (first OCR of day hasn't happened yet), fall back to `OcrSpendService.getDailySpend()` for spend, image_count = 0
- Use `prisma.dailyApiCost.findMany({ where: { date: { gte: ..., lte: ... } }, orderBy: { date: 'asc' } })`

### Admin API endpoint

Add to `AdminMetricsController`:
```ts
@Get('cost')
async cost() {
  return this.service.getApiCostMetrics();
}
```

Inject `OcrSpendService` into `AdminMetricsService` (add to constructor and `AdminModule` providers).

### Admin UI — bar chart without extra dependency

Do **not** add recharts or any charting library — none exists in the project. Build a simple CSS bar chart:

```tsx
// Example: each bar is a div with percentage-height relative to max value
const maxSpend = Math.max(...data.map(d => d.spendUsd), 0.01);
<div className="flex items-end gap-2 h-24">
  {data.map(d => (
    <div key={d.month} className="flex flex-col items-center gap-1 flex-1">
      <div
        className="bg-gray-900 w-full rounded-t"
        style={{ height: `${Math.round((d.spendUsd / maxSpend) * 100)}%` }}
      />
      <span className="text-xs text-gray-500">{d.month.slice(5)}</span>
    </div>
  ))}
</div>
```

### i18n additions

Follow the exact structure of existing `metrics.tabs` and add `cost` tab to all 3 locales. New `metrics.cost` section needs labels for: today, currentWeek, currentMonth, last3Months, spendLabel, imagesLabel, thresholdNote. Also update the `MetricsTranslations` interface in `i18n.ts`:

```ts
export interface MetricsTranslations {
  tabs: { pipeline: string; funnel: string; product: string; cost: string }; // add cost
  // ...
  cost: {
    today: string;
    currentWeek: string;
    currentMonth: string;
    last3Months: string;
    spendLabel: string;
    imagesLabel: string;
    noData: string;
  };
}
```

Update all 3 locales:
- **pl**: `cost: 'Koszty API'`, `today: 'Dziś'`, `currentWeek: 'Bieżący tydzień'`, `currentMonth: 'Bieżący miesiąc'`, `last3Months: 'Ostatnie 3 miesiące'`, `spendLabel: 'Koszt (USD)'`, `imagesLabel: 'Zdjęcia'`, `noData: 'Brak danych.'`
- **en**: `cost: 'API Cost'`, `today: 'Today'`, `currentWeek: 'This week'`, `currentMonth: 'This month'`, `last3Months: 'Last 3 months'`, `spendLabel: 'Spend (USD)'`, `imagesLabel: 'Images'`, `noData: 'No data.'`
- **uk**: `cost: 'Витрати API'`, `today: 'Сьогодні'`, `currentWeek: 'Поточний тиждень'`, `currentMonth: 'Поточний місяць'`, `last3Months: 'Останні 3 місяці'`, `spendLabel: 'Витрати (USD)'`, `imagesLabel: 'Зображення'`, `noData: 'Немає даних.'`

### Module wiring

`OcrSpendService` lives in `PhotoModule`. `AdminMetricsService` is in `AdminModule`. To call `OcrSpendService.getDailySpend()` from `AdminMetricsService`:

Option A (recommended): Export `OcrSpendService` from `PhotoModule` and import `PhotoModule` into `AdminModule`.
Option B: Duplicate the Redis read in `AdminMetricsService` for today's fallback (`redis.get('ocr:spend:{today}')`) without injecting OcrSpendService.

Use Option A — it's cleaner and avoids duplicating the Redis key format.

### ENV vars

New ENV var: `COST_ALERT_THRESHOLD_USD` (default: `50`). Add to `.env.example`.

### Pricing reference (for tests)

Claude Haiku 4.5 pricing (from `OcrSpendService`): `$0.80/MTok input`, `$4.00/MTok output`. At ~500 input + ~100 output tokens/call: `cost ≈ $0.0008/image`.

### Project Structure Notes

- `OcrSpendService`: `apps/api/src/photo/ocr-spend.service.ts` — **extend, do not recreate**
- `AdminMetricsService`: `apps/api/src/admin/admin-metrics.service.ts` — add method
- `AdminMetricsController`: `apps/api/src/admin/admin-metrics.controller.ts` — add endpoint
- `AdminModule`: `apps/api/src/admin/admin.module.ts` — import `PhotoModule`
- `PhotoModule`: `apps/api/src/photo/photo.module.ts` — export `OcrSpendService`
- Prisma schema: `packages/db/prisma/schema.prisma`
- Admin metrics page: `apps/admin/app/(protected)/metrics/`
  - New: `ApiCostTab.tsx`
  - Modified: `MetricsDashboard.tsx`, `actions.ts`, `types.ts`
- i18n: `apps/admin/lib/i18n.ts` — update translations + interface

### References

- `OcrSpendService` implementation: [apps/api/src/photo/ocr-spend.service.ts](apps/api/src/photo/ocr-spend.service.ts)
- `AdminMetricsService` patterns: [apps/api/src/admin/admin-metrics.service.ts](apps/api/src/admin/admin-metrics.service.ts)
- `AdminMetricsController` patterns: [apps/api/src/admin/admin-metrics.controller.ts](apps/api/src/admin/admin-metrics.controller.ts)
- `MetricsDashboard` tab structure: [apps/admin/app/(protected)/metrics/MetricsDashboard.tsx](apps/admin/app/(protected)/metrics/MetricsDashboard.tsx)
- `MetricsTranslations` interface: [apps/admin/lib/i18n.ts](apps/admin/lib/i18n.ts)
- `adminFetch` pattern: [apps/admin/lib/admin-api.ts](apps/admin/lib/admin-api.ts)
- Slack alert SSRF guard + AbortSignal pattern: Story 4.4 review (P-6, P-10 in sprint-status.yaml)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 4.7 (line ~1943)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — add `DailyApiCost` model)
- `apps/api/src/photo/ocr-spend.service.ts` (modified — DB persistence + monthly alert)
- `apps/api/src/photo/ocr-spend.service.spec.ts` (modified — new tests)
- `apps/api/src/photo/photo.module.ts` (modified — export OcrSpendService)
- `apps/api/src/admin/admin-metrics.service.ts` (modified — add `getApiCostMetrics`)
- `apps/api/src/admin/admin-metrics.service.spec.ts` (modified — new tests)
- `apps/api/src/admin/admin-metrics.controller.ts` (modified — add cost endpoint)
- `apps/api/src/admin/admin.module.ts` (modified — import PhotoModule)
- `apps/admin/app/(protected)/metrics/ApiCostTab.tsx` (new)
- `apps/admin/app/(protected)/metrics/MetricsDashboard.tsx` (modified — add cost tab)
- `apps/admin/app/(protected)/metrics/actions.ts` (modified — add fetchApiCostMetrics)
- `apps/admin/app/(protected)/metrics/types.ts` (modified — add ApiCostMetricsDto)
- `apps/admin/lib/i18n.ts` (modified — add cost translations + update interface)
- `apps/api/.env.example` (modified — add COST_ALERT_THRESHOLD_USD)
- `_bmad-output/implementation-artifacts/4-7-api-cost-tracking-dashboard.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
