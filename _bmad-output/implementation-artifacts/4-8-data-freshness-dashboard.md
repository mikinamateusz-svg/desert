# Story 4.8: Data Freshness Dashboard

Status: ready-for-dev

## Story

As an **ops admin**,
I want to see which stations have the most outdated prices, segmented by region,
So that I can identify coverage gaps and prioritise outreach or seeding efforts.

## Acceptance Criteria

**AC1 — Freshness table:**
Given an ADMIN opens the Data Freshness tab
When they view it
Then they see a paginated table of all stations sortable by: last verified submission date, region (voivodeship), and current price source (community / admin override / seeded estimate)
And stations with no verified submission in the last 30 days are highlighted

**AC2 — Voivodeship filter:**
Given the freshness table is displayed
When the ADMIN filters by voivodeship
Then the table updates to show only stations in that region with their freshness status

**AC3 — Consistent navigation:**
Given the admin views the Data Freshness tab
When viewed alongside other admin panel sections
Then it follows the same navigation shell, authentication, and visual language as existing metrics tabs

## Tasks / Subtasks

- [ ] T1: `AdminMetricsService` — `getFreshnessDashboard()` (AC1, AC2)
  - [ ] T1a: Add `FreshnessRowDto`, `FreshnessDashboardDto` interfaces to `admin-metrics.service.ts`
  - [ ] T1b: Implement `getFreshnessDashboard(voivodeship, sortBy, order, page, limit)` using LATERAL JOIN query
  - [ ] T1c: Stale flag: `isStale = lastPriceAt === null || lastPriceAt < NOW() - 30 days`
  - [ ] T1d: Include `staleBeyond30Days` total count in response (separate COUNT query)

- [ ] T2: API endpoint — `GET /v1/admin/metrics/freshness` (AC1, AC2)
  - [ ] T2a: Add `@Get('freshness')` to `AdminMetricsController` with query params: `voivodeship`, `sortBy`, `order`, `page`, `limit`
  - [ ] T2b: Validate + sanitise all query params (see Dev Notes)

- [ ] T3: Admin UI — `FreshnessTab.tsx` component (AC1, AC2, AC3)
  - [ ] T3a: Create `apps/admin/app/(protected)/metrics/FreshnessTab.tsx`
  - [ ] T3b: Implement filter bar: voivodeship dropdown (16 values + "All") and sort controls
  - [ ] T3c: Render table with stale row highlight (`bg-red-50` for stale rows)
  - [ ] T3d: Implement pagination (reuse simple prev/next pattern from existing admin pages)
  - [ ] T3e: Add `fetchFreshnessData()` server action to `actions.ts`
  - [ ] T3f: Add `FreshnessRowDto`, `FreshnessDashboardDto` types to `metrics/types.ts`

- [ ] T4: Wire tab into `MetricsDashboard.tsx` (AC3)
  - [ ] T4a: Add `'freshness'` to `TabId` union
  - [ ] T4b: Add tab button and `{activeTab === 'freshness' && <FreshnessTab t={t} />}` render

- [ ] T5: i18n — all 3 locales (pl, en, uk) (AC3)
  - [ ] T5a: Add `freshness` key to `metrics.tabs` in all 3 locales
  - [ ] T5b: Add `metrics.freshness` section with all labels in all 3 locales
  - [ ] T5c: Update `MetricsTranslations` interface to include `tabs.freshness` and `freshness` section

- [ ] T6: Tests
  - [ ] T6a: `admin-metrics.service.spec.ts` — `getFreshnessDashboard`: returns rows with correct stale flags; voivodeship filter restricts results; sort by `lastPriceAt ASC` returns oldest-first; station with no PriceHistory has `isStale: true`
  - [ ] T6b: Full regression suite — all existing tests still pass

## Dev Notes

### No migration needed

All data comes from existing `Station` and `PriceHistory` tables. No new Prisma model required.

- `Station.voivodeship` is `String?` with `@@index([voivodeship])` already in place
- `PriceHistory` has index `("station_id", "fuel_type", "recorded_at" DESC)` already in place

### Data source: PriceHistory, not Submission

The spec says "last verified submission date". Use `PriceHistory.recorded_at` (not `Submission.created_at`) as the source of truth because:
- `PriceHistory` is written when a submission is verified OR when an admin overrides — it represents the actual price state
- `PriceHistory.source` gives the current price source directly (`community` | `admin_override` | `seeded`)
- A station with only `admin_override` in `PriceHistory` has **no community submission** — show it as stale regardless of `recorded_at` (see stale logic below)

### Core query — LATERAL JOIN

```sql
SELECT
  s.id           AS station_id,
  s.name         AS station_name,
  s.address,
  s.voivodeship,
  lph.source     AS price_source,
  lph.recorded_at AS last_price_at
FROM "Station" s
LEFT JOIN LATERAL (
  SELECT source, recorded_at
  FROM "PriceHistory"
  WHERE station_id = s.id
  ORDER BY recorded_at DESC
  LIMIT 1
) lph ON true
WHERE ($voivodeship::text IS NULL OR s.voivodeship = $voivodeship::text)
ORDER BY {sort_column} {sort_direction}
LIMIT $limit OFFSET $skip
```

LATERAL is well-supported in Postgres and uses the existing `(station_id, fuel_type, recorded_at DESC)` index efficiently. Do NOT use `DISTINCT ON` for paginated queries — it prevents clean `LIMIT/OFFSET`.

### Stale definition

A station is stale (`isStale: true`) if:
- `lastPriceAt` is `null` (no price ever recorded), OR
- `lastPriceAt < NOW() - INTERVAL '30 days'`

Note: admin overrides count as "price updates" for freshness purposes — the stale flag is about data currency, not community activity specifically.

### DTOs

```ts
export interface FreshnessRowDto {
  stationId: string;
  stationName: string;
  address: string | null;
  voivodeship: string | null;
  priceSource: 'community' | 'admin_override' | 'seeded' | null;
  lastPriceAt: string | null;  // ISO datetime or null
  isStale: boolean;
}

export interface FreshnessDashboardDto {
  data: FreshnessRowDto[];
  total: number;
  page: number;
  limit: number;
  staleCount: number;  // total stale stations matching current filter (for header summary)
}
```

### API endpoint query params

```ts
@Get('freshness')
async freshness(
  @Query('voivodeship') voivodeship?: string,
  @Query('sortBy') sortBy?: string,
  @Query('order') order?: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
)
```

Sanitise in service:
- `voivodeship`: if provided, must be one of the 16 known slugs (see list below); otherwise ignore (treat as null)
- `sortBy`: one of `'lastPriceAt' | 'voivodeship' | 'priceSource'`; default `'lastPriceAt'`
- `order`: `'asc' | 'desc'`; default `'asc'` (oldest-first = worst coverage at top)
- `page`: positive int, default 1
- `limit`: 1–100, default 50

Map `sortBy` to SQL column:
- `lastPriceAt` → `lph.recorded_at NULLS FIRST` (nulls always first — no price = worst)
- `voivodeship` → `s.voivodeship NULLS LAST`
- `priceSource` → `lph.source NULLS LAST`

### Valid voivodeship slugs (from `VOIVODESHIP_SLUGS` in `station-classification.service.ts`)

```ts
const VALID_VOIVODESHIPS = [
  'dolnoslaskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie',
  'lodzkie', 'malopolskie', 'mazowieckie', 'opolskie',
  'podkarpackie', 'podlaskie', 'pomorskie', 'slaskie',
  'swietokrzyskie', 'warminsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
];
```

**Do not hardcode this list in the admin controller** — import it (or define a shared constant in a shared location). The classification service is in `apps/api/src/station/station-classification.service.ts` — define the valid set as an exported constant in `apps/api/src/station/config/voivodeship-slugs.ts` (or similar) so both services share it.

### Admin UI — filter + table pattern

Follow the existing stations page pattern (`apps/admin/app/(protected)/stations/page.tsx`) for the filter bar. Key differences for freshness tab:
- No text search input — just voivodeship dropdown + sort controls
- Table columns: Name | Address | Voivodeship | Price Source | Last Updated | Status
- Stale rows: `className={row.isStale ? 'bg-red-50' : ''}`
- Status badge: stale rows show a pill "Przestarzałe / Stale / Застарілий" in red; fresh rows show nothing or a green dot

Since this is a tab inside MetricsDashboard (client component), `FreshnessTab.tsx` must be a **client component** (`'use client'`) that calls server actions on filter/sort/page changes — same pattern as `FunnelTab.tsx`.

### i18n additions

Add to all 3 locales in `apps/admin/lib/i18n.ts`:

```ts
// metrics.tabs (extend existing):
tabs: { pipeline: '...', funnel: '...', product: '...', cost: '...', freshness: string }
// pl: 'Świeżość danych'  en: 'Data Freshness'  uk: 'Актуальність даних'

// metrics.freshness (new section):
freshness: {
  allRegions: string;   // pl: 'Wszystkie regiony'  en: 'All regions'  uk: 'Всі регіони'
  sortBy: string;       // pl: 'Sortuj po'  en: 'Sort by'  uk: 'Сортувати за'
  colName: string;      // pl: 'Stacja'  en: 'Station'  uk: 'Станція'
  colAddress: string;   // pl: 'Adres'  en: 'Address'  uk: 'Адреса'
  colVoivodeship: string; // pl: 'Województwo'  en: 'Voivodeship'  uk: 'Воєводство'
  colSource: string;    // pl: 'Źródło ceny'  en: 'Price source'  uk: 'Джерело ціни'
  colLastUpdated: string; // pl: 'Ostatnia aktualizacja'  en: 'Last updated'  uk: 'Остання оновлення'
  colStatus: string;    // pl: 'Status'  en: 'Status'  uk: 'Статус'
  stale: string;        // pl: 'Przestarzałe'  en: 'Stale'  uk: 'Застарілий'
  noData: string;       // pl: 'Brak danych'  en: 'No data'  uk: 'Немає даних'
  staleCount: string;   // pl: 'Stacji bez aktualizacji (30 dni)'  en: 'Stations without update (30 days)'  uk: 'Станцій без оновлення (30 днів)'
  sources: {
    community: string;  // pl: 'Społeczność'  en: 'Community'  uk: 'Спільнота'
    admin_override: string; // pl: 'Nadpisanie admina'  en: 'Admin override'  uk: 'Перевизначення адміна'
    seeded: string;     // pl: 'Zainicjowane'  en: 'Seeded'  uk: 'Ініціалізовано'
  };
  noResults: string;    // pl: 'Brak stacji.'  en: 'No stations found.'  uk: 'Станцій не знайдено.'
}
```

Update `MetricsTranslations` interface to add `tabs.freshness: string` and `freshness: { ... }`.

**Re-use existing translations where they exist** — `sources.community/admin_override/seeded` already exist in `stations` section of i18n; copy the same strings (don't reference them — duplicate is fine for i18n).

### staleCount query

Run a separate COUNT query alongside the main data query:

```sql
SELECT COUNT(*) FROM "Station" s
LEFT JOIN LATERAL (
  SELECT recorded_at FROM "PriceHistory"
  WHERE station_id = s.id ORDER BY recorded_at DESC LIMIT 1
) lph ON true
WHERE ($voivodeship::text IS NULL OR s.voivodeship = $voivodeship::text)
  AND (lph.recorded_at IS NULL OR lph.recorded_at < NOW() - INTERVAL '30 days')
```

Run both queries in `Promise.all` for efficiency.

### Project Structure Notes

- `AdminMetricsService`: `apps/api/src/admin/admin-metrics.service.ts` — add `getFreshnessDashboard()`
- `AdminMetricsController`: `apps/api/src/admin/admin-metrics.controller.ts` — add `freshness` endpoint
- New shared constant: `apps/api/src/station/config/voivodeship-slugs.ts` (export `VALID_VOIVODESHIPS`)
- Admin metrics page: `apps/admin/app/(protected)/metrics/`
  - New: `FreshnessTab.tsx`
  - Modified: `MetricsDashboard.tsx`, `actions.ts`, `types.ts`
- i18n: `apps/admin/lib/i18n.ts` — update translations + interface
- **No migration needed** — existing tables have all required fields and indexes

### References

- `Station` model with `voivodeship` field: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L74)
- `PriceHistory` model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L194)
- Voivodeship slugs source: [apps/api/src/station/station-classification.service.ts](apps/api/src/station/station-classification.service.ts#L18)
- `AdminMetricsService` patterns: [apps/api/src/admin/admin-metrics.service.ts](apps/api/src/admin/admin-metrics.service.ts)
- `MetricsDashboard` tab structure: [apps/admin/app/(protected)/metrics/MetricsDashboard.tsx](apps/admin/app/(protected)/metrics/MetricsDashboard.tsx)
- Existing source translations: `stations.sources` in [apps/admin/lib/i18n.ts](apps/admin/lib/i18n.ts#L116)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 4.8 (line ~1964)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/station/config/voivodeship-slugs.ts` (new — shared VALID_VOIVODESHIPS constant)
- `apps/api/src/admin/admin-metrics.service.ts` (modified — add `getFreshnessDashboard`)
- `apps/api/src/admin/admin-metrics.service.spec.ts` (modified — new tests)
- `apps/api/src/admin/admin-metrics.controller.ts` (modified — add freshness endpoint)
- `apps/admin/app/(protected)/metrics/FreshnessTab.tsx` (new)
- `apps/admin/app/(protected)/metrics/MetricsDashboard.tsx` (modified — add freshness tab)
- `apps/admin/app/(protected)/metrics/actions.ts` (modified — add fetchFreshnessData)
- `apps/admin/app/(protected)/metrics/types.ts` (modified — add FreshnessRowDto, FreshnessDashboardDto)
- `apps/admin/lib/i18n.ts` (modified — add freshness translations + update interface)
- `_bmad-output/implementation-artifacts/4-8-data-freshness-dashboard.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
