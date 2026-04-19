# Story 5.5: Personal History & Summaries

Status: ready-for-dev

## Story

As a **driver**,
I want to view my fill-up history, fuel costs, and consumption trends — per vehicle and across all my cars —
So that I have a complete picture of my fuel spending and efficiency without keeping a manual logbook.

## Acceptance Criteria

**AC1 — Vehicle selector:**
Given a driver opens their personal history (log screen)
When they view it
Then they see a vehicle selector at the top: each vehicle by nickname (or make + model), plus an "All vehicles" option
And the view defaults to the most recently used vehicle

**AC2 — Per-vehicle fill-up list:**
Given a driver selects a specific vehicle
When the history loads
Then they see a chronological list of fill-up records (newest first) showing: date, station name (or "Unknown station"), fuel type badge, litres, total PLN, price per litre, and savings vs area average (if available from `area_avg_at_fillup`)
And each fill-up row that has `consumption_l_per_100km` shows that figure inline

**AC3 — Per-vehicle summary:**
Given a driver selects a specific vehicle
When they view the summary section
Then they see: total spend (PLN), total litres, average price per litre, and total savings (PLN) for the selected period
And average l/100km is shown only when at least one fill-up in the period has a consumption value — omitted entirely otherwise

**AC4 — All-vehicles view:**
Given a driver selects "All vehicles"
When the history loads
Then fill-ups from all vehicles appear in a single chronological list, each labelled with the vehicle nickname
And the summary shows total spend and total savings across all vehicles for the selected period

**AC5 — Period filter:**
Given a driver views any history screen
When they filter by time period
Then they can select: last 30 days, last 3 months, last 12 months, all time
And all summary figures and the fill-up list update to reflect the selected period

**AC6 — No consumption data:**
Given a driver has fill-up records but no odometer readings for a vehicle
When they view that vehicle's history
Then cost and savings data is shown but l/100km column and average l/100km summary are omitted entirely — no placeholder, no zero

**AC7 — Empty state:**
Given a driver has no fill-up records for a vehicle
When they view that vehicle's history
Then a clear empty state is shown with a prompt to record their first fill-up

**AC8 — Benchmark placeholder:**
Given Story 5.6 is not yet implemented
When the vehicle history screen renders
Then a `{/* TODO(Story 5.6): benchmark section here */}` placeholder exists below the summary cards — no visible gap or broken UI

## Tasks / Subtasks

- [ ] T1: API — extend `GET /v1/me/fillups` with period + summary (AC2–AC5)
  - [ ] T1a: Add `?period=30d|3m|12m|all` query param to `FillupController.listFillups()`
  - [ ] T1b: Add `?vehicleId=all` support (no vehicle filter when `vehicleId = 'all'` or omitted)
  - [ ] T1c: Extend response to include `summary` object computed server-side over the full period (not just current page) — see Dev Notes

- [ ] T2: Mobile — complete `log.tsx` rebuild (AC1–AC8)
  - [ ] T2a: Replace Story 5.1's partial vehicle section with full log screen (preserves vehicle list from 5.1; adds history tab below)
  - [ ] T2b: Implement vehicle selector — horizontal scrollable tab row: each vehicle chip + "All" chip; persist selection in component state
  - [ ] T2c: Implement period filter — segmented control (30d | 3m | 12m | All); default 3m
  - [ ] T2d: Implement `SummaryCards` inline component — 4-card grid: total spend, total litres, avg price, total saved; avg consumption card shown only when data available
  - [ ] T2e: Implement `FillUpCard` inline component — reuses `SavingsDisplay` from Story 5.3; shows l/100km badge when `consumption_l_per_100km` is set
  - [ ] T2f: Implement `FlatList` with `onEndReached` pagination (load next page when 80% scrolled)
  - [ ] T2g: Implement empty state view (AC7)
  - [ ] T2h: Add benchmark placeholder comment (AC8)

- [ ] T3: Mobile — API client extension (AC1–AC5)
  - [ ] T3a: Extend `apps/mobile/src/api/fillups.ts` — update `apiListFillups(accessToken, { vehicleId?, period?, page?, limit? })` to support new params; update response interface to include `summary`

- [ ] T4: i18n — all 3 locales
  - [ ] T4a: Add `history` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes)

- [ ] T5: Tests
  - [ ] T5a: `fillup.service.spec.ts` additions — `listFillups` with `period='30d'`: returns only fill-ups in last 30 days; `period='all'`: returns all; `vehicleId='all'`: returns all vehicles for user; summary totals match fill-up list data
  - [ ] T5b: Full regression suite — all existing tests still pass

## Dev Notes

### API response extension

```ts
// Extended GET /v1/me/fillups response
interface ListFillupsResponse {
  data: FillUpDto[];
  total: number;
  page: number;
  limit: number;
  summary: FillupSummaryDto;
}

interface FillupSummaryDto {
  totalSpendPln: number;
  totalLitres: number;
  avgPricePerLitrePln: number | null;  // null if no fill-ups in period
  totalSavingsPln: number | null;      // null if no area_avg_at_fillup data
  avgConsumptionL100km: number | null; // null if no consumption data
  fillupCount: number;
}
```

Compute `summary` with a separate aggregate query (not from the paginated `data` array), so it reflects the full period even on page 2+:

```ts
// In FillupService.listFillups():
const [data, total, summary] = await Promise.all([
  this.prisma.fillUp.findMany({ where, skip, take, orderBy }),
  this.prisma.fillUp.count({ where }),
  this.prisma.fillUp.aggregate({
    where,
    _sum: { total_cost_pln: true, litres: true },
    _avg: { price_per_litre_pln: true, consumption_l_per_100km: true },
    _count: { id: true },
  }),
]);
```

For `totalSavingsPln`: sum `(area_avg_at_fillup - price_per_litre_pln) * litres` for fill-ups where `area_avg_at_fillup IS NOT NULL`. Prisma aggregate doesn't support this expression — use a raw SQL aggregation or compute it in the service from the aggregate query + a separate sum.

Simplest approach: use `$queryRaw` for savings only:
```ts
const savingsResult = await this.prisma.$queryRaw<[{ total_savings: number }]>`
  SELECT COALESCE(SUM((area_avg_at_fillup - price_per_litre_pln) * litres), 0)::float AS total_savings
  FROM "FillUp"
  WHERE user_id = ${userId}
    ${vehicleCondition}
    ${periodCondition}
    AND area_avg_at_fillup IS NOT NULL
`;
```

### Period filter SQL mapping

```ts
function periodStart(period: '30d' | '3m' | '12m' | 'all'): Date | null {
  const now = new Date();
  if (period === '30d') return new Date(now.setDate(now.getDate() - 30));
  if (period === '3m') return new Date(now.setMonth(now.getMonth() - 3));
  if (period === '12m') return new Date(now.setFullYear(now.getFullYear() - 1));
  return null; // 'all' — no date filter
}
```

### Mobile screen layout

```
SafeAreaView
  ScrollView (stickyHeaderIndices={[0,1]} for selector + filter)
    ┌─────────────────────────────────────────┐
    │ [My Golf] [Work Passat] [All vehicles]  │  ← horizontal chip row (sticky)
    └─────────────────────────────────────────┘
    ┌─────────────────────────────────────────┐
    │ [30d] [3m] [12m] [All time]             │  ← segmented control (sticky)
    └─────────────────────────────────────────┘
    ┌──────────┐ ┌──────────┐
    │1,247 PLN │ │ 185 L    │  ← summary card grid (2 columns)
    │Total     │ │ Total    │
    └──────────┘ └──────────┘
    ┌──────────┐ ┌──────────┐
    │6.74 PLN/L│ │ 47 PLN   │
    │Avg price │ │ Saved    │
    └──────────┘ └──────────┘
    ┌──────────────────────────────────────────┐  ← consumption card (full width, conditional)
    │ 7.2 L/100km — average consumption        │
    └──────────────────────────────────────────┘

    {/* TODO(Story 5.6): benchmark section here */}

    ── Fill-ups ──────────────────────────────
    [FillUpCard]
    [FillUpCard]
    ...
    [Load more]
```

Use `FlatList` with a `ListHeaderComponent` for the summary section. Keep vehicle selector and period filter as sticky headers using `stickyHeaderIndices`.

### FillUpCard layout

```tsx
// Inline component within log.tsx
function FillUpCard({ fillUp, t }: { fillUp: FillUpDto; t: TFunction }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(fillUp.filled_at)}</Text>
        <FuelTypeBadge type={fillUp.fuel_type} />
      </View>
      <Text style={styles.stationName}>
        {fillUp.station?.name ?? t('history.unknownStation')}
      </Text>
      <View style={styles.cardRow}>
        <Text style={styles.litres}>{fillUp.litres.toFixed(1)} L</Text>
        <Text style={styles.cost}>{fillUp.total_cost_pln.toFixed(2)} PLN</Text>
        <Text style={styles.pricePerL}>{fillUp.price_per_litre_pln.toFixed(3)} PLN/L</Text>
      </View>
      {fillUp.consumption_l_per_100km !== null && (
        <Text style={styles.consumption}>
          {fillUp.consumption_l_per_100km.toFixed(1)} L/100km
        </Text>
      )}
      <SavingsDisplay
        savingsPln={calculateSavings(
          fillUp.area_avg_at_fillup,
          fillUp.price_per_litre_pln,
          fillUp.litres,
        )}
        t={t}
      />
    </View>
  );
}
```

### FillUpDto (API response shape)

Extend the existing fill-up response to include station name (denormalized for efficiency):

```ts
interface FillUpDto {
  id: string;
  vehicle_id: string;
  vehicle?: { id: string; nickname: string | null; make: string; model: string };
  station?: { id: string; name: string } | null;
  fuel_type: string;
  litres: number;
  total_cost_pln: number;
  price_per_litre_pln: number;
  area_avg_at_fillup: number | null;
  consumption_l_per_100km: number | null;
  odometer_km: number | null;
  voivodeship: string | null;
  filled_at: string;
}
```

Include `vehicle` in the response when `vehicleId = 'all'` (needed to label each card with vehicle nickname).

### i18n strings

Add `history` section to all 3 locales:

```
vehicleSelectorAll:   'All vehicles' | 'Wszystkie pojazdy' | 'Всі транспортні засоби'
period30d:            'Last 30 days' | 'Ostatnie 30 dni' | 'Останні 30 днів'
period3m:             'Last 3 months' | 'Ostatnie 3 miesiące' | 'Останні 3 місяці'
period12m:            'Last 12 months' | 'Ostatnie 12 miesięcy' | 'Останні 12 місяців'
periodAll:            'All time' | 'Cały czas' | 'За весь час'
totalSpend:           'Total spend' | 'Łączne wydatki' | 'Загальні витрати'
totalLitres:          'Total litres' | 'Łączna ilość' | 'Загальна кількість'
avgPrice:             'Avg price' | 'Śr. cena' | 'Сер. ціна'
totalSaved:           'Total saved' | 'Łączne oszczędności' | 'Загальна економія'
avgConsumption:       'Avg consumption' | 'Śr. zużycie' | 'Сер. витрата'
unknownStation:       'Unknown station' | 'Nieznana stacja' | 'Невідома станція'
noFillups:            'No fill-ups recorded yet' | 'Brak zarejestrowanych tankowań' | 'Заправок ще не записано'
noFillupsAction:      'Record your first fill-up' | 'Zarejestruj pierwsze tankowanie' | 'Записати першу заправку'
fillups:              'Fill-ups' | 'Tankowania' | 'Заправки'
loadMore:             'Load more' | 'Załaduj więcej' | 'Завантажити більше'
```

### Project Structure Notes

- `apps/api/src/fillup/fillup.service.ts` (modified — period filter, all-vehicles, summary)
- `apps/api/src/fillup/fillup.controller.ts` (modified — new query params)
- `apps/mobile/src/api/fillups.ts` (modified — updated params + response interface)
- `apps/mobile/app/(app)/log.tsx` (modified — full rebuild; supersedes Story 5.1's partial update)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- **No new API endpoints** — extends Story 5.2's `GET /v1/me/fillups`
- **No schema changes** — all data already exists from Stories 5.2–5.4

### References

- `FillupService.listFillups()`: [apps/api/src/fillup/fillup.service.ts](apps/api/src/fillup/fillup.service.ts) (Story 5.2)
- `SavingsDisplay` component: [apps/mobile/src/components/SavingsDisplay.tsx](apps/mobile/src/components/SavingsDisplay.tsx) (Story 5.3)
- `calculateSavings` utility: [apps/mobile/src/utils/savings.ts](apps/mobile/src/utils/savings.ts) (Story 5.3)
- Vehicle section in log.tsx: [apps/mobile/app/(app)/log.tsx](apps/mobile/app/(app)/log.tsx) (Story 5.1)
- Story 5.6 (benchmark section — slots into TODO placeholder in this story)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.5 (line ~2322)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.controller.ts` (modified)
- `apps/mobile/src/api/fillups.ts` (modified)
- `apps/mobile/app/(app)/log.tsx` (modified — full rebuild)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-5-personal-history-summaries.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
