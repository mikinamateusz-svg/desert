# Story 5.7: Savings Summary Sharing

Status: review

## Story

As a **driver**,
I want to share my monthly savings summary as a card on social media,
So that I can show off how much I saved on fuel and bring other drivers into the community.

## Acceptance Criteria

**AC1 — Share button shown:**
Given a driver has at least one month with positive savings figures (`totalSavingsPln > 0`)
When they view their monthly summary screen for that month
Then a "Share" button is shown

**AC2 — Card contents:**
Given a driver taps Share
When the card is generated
Then it displays: total PLN saved that month, month label, number of fill-ups, and desert app branding
And the native OS share sheet opens so the driver can share to WhatsApp, Instagram Stories, or any installed app

**AC3 — Ranking optional:**
Given a driver has savings data but no regional ranking (Story 6.7 not yet released)
When the card is generated
Then it shows savings and fill-up count only — ranking section is omitted gracefully with no layout gap

**AC4 — Hidden for negative months:**
Given a month where the driver's total savings are zero or negative (consistently paid above average)
When the summary screen is viewed
Then the Share button is not shown — the driver is never prompted to share a bad outcome

**AC5 — Language-aware:**
Given a driver's selected language is Polish, English, or Ukrainian
When the card is generated
Then all card text is in that language

**AC6 — Monthly summary screen:**
Given a driver navigates to the savings summary screen (from log screen or notification deep link)
When the screen loads
Then it shows: month title, total saved PLN (prominent), total fill-ups, total litres, and the Share button (if AC1 conditions met)
And this screen is deep-linkable from Story 6.5 notifications via `/(app)/savings-summary?year=YYYY&month=M`

## Tasks / Subtasks

- [ ] T1: API — monthly savings summary endpoint (AC1, AC6)
  - [ ] T1a: Add `GET /v1/me/fillups/monthly-summary` to `FillupController` with query params `?year=` and `?month=`
  - [ ] T1b: Implement `getMonthlySummary(userId, year, month)` in `FillupService` — aggregates fill-ups for that calendar month; returns `MonthlySummaryDto`

- [ ] T2: Mobile — add dependencies (AC2)
  - [ ] T2a: Add `react-native-view-shot` to `apps/mobile/package.json` — for capturing the card view as a PNG
  - [ ] T2b: Add `expo-sharing` to `apps/mobile/package.json` — for native OS share sheet

- [ ] T3: Mobile — `ShareableCard` component (AC2–AC5)
  - [ ] T3a: Create `apps/mobile/src/components/ShareableCard.tsx` — pure presentational, renders the shareable card layout using React Native View + Text + SVG; sized 1080×1080 (scaled down for display, captured at 2× pixel ratio for quality)
  - [ ] T3b: Card layout: amber gradient background, large savings amount, month label, fill-up count, ranking section (conditionally rendered), desert wordmark at bottom
  - [ ] T3c: Accept `rankingPercentile: number | null` — renders ranking pill when non-null, omits when null (AC3)

- [ ] T4: Mobile — `savings-summary.tsx` screen (AC1, AC4, AC6)
  - [ ] T4a: Create `apps/mobile/app/(app)/savings-summary.tsx`
  - [ ] T4b: Read `year` and `month` from route params; default to current month if absent
  - [ ] T4c: Fetch `GET /v1/me/fillups/monthly-summary?year=&month=` on mount
  - [ ] T4d: Display summary stats (total saved, fill-ups, litres, spend)
  - [ ] T4e: Render `<ShareableCard />` (visible on screen as preview); Share button below it
  - [ ] T4f: On Share tap: use `react-native-view-shot` to capture card ref as PNG to temp file; open share sheet via `expo-sharing`; hide Share button while capture is in progress to prevent double-tap
  - [ ] T4g: Share button hidden when `totalSavingsPln <= 0` (AC4)

- [ ] T5: Mobile — entry point from log screen (AC6)
  - [ ] T5a: In `log.tsx`: add "Monthly summary" link/button visible when a specific month view is selected (below summary cards section); navigates to `/(app)/savings-summary?year=YYYY&month=M`

- [ ] T6: Mobile — API client (AC1)
  - [ ] T6a: Add `apiGetMonthlySummary(accessToken, year, month)` to `apps/mobile/src/api/fillups.ts`

- [ ] T7: i18n — all 3 locales (AC2, AC5)
  - [ ] T7a: Add `savingsCard` and `savingsSummary` sections to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes)

- [ ] T8: Tests
  - [ ] T8a: `fillup.service.spec.ts` additions — `getMonthlySummary`: returns correct totals for specified month; `totalSavingsPln` is null when no `area_avg_at_fillup` data; `fillupCount` is 0 for empty month (not an error)
  - [ ] T8b: Full regression suite — all existing tests still pass

## Dev Notes

### MonthlySummaryDto

```ts
export interface MonthlySummaryDto {
  year: number;
  month: number;           // 1–12
  totalSavingsPln: number | null;  // null if no area_avg_at_fillup data at all
  fillupCount: number;
  totalSpendPln: number;
  totalLitres: number;
  avgPricePerLitrePln: number | null;
  // Ranking fields — null until Story 6.7 ships:
  rankingPercentile: number | null;  // e.g. 20 means "top 20%"
  rankingVoivodeship: string | null;
}
```

`rankingPercentile` and `rankingVoivodeship` are always `null` in this story — Story 6.7 will populate them. The card handles null gracefully (AC3).

### getMonthlySummary() implementation

```ts
async getMonthlySummary(userId: string, year: number, month: number): Promise<MonthlySummaryDto> {
  const start = new Date(year, month - 1, 1);      // first day of month
  const end = new Date(year, month, 1);            // first day of next month

  const [agg, savingsResult] = await Promise.all([
    this.prisma.fillUp.aggregate({
      where: { user_id: userId, filled_at: { gte: start, lt: end } },
      _sum: { total_cost_pln: true, litres: true },
      _avg: { price_per_litre_pln: true },
      _count: { id: true },
    }),
    this.prisma.$queryRaw<[{ total_savings: number | null }]>`
      SELECT SUM((area_avg_at_fillup - price_per_litre_pln) * litres)::float AS total_savings
      FROM "FillUp"
      WHERE user_id = ${userId}
        AND filled_at >= ${start} AND filled_at < ${end}
        AND area_avg_at_fillup IS NOT NULL
    `,
  ]);

  return {
    year,
    month,
    fillupCount: agg._count.id,
    totalSpendPln: agg._sum.total_cost_pln ?? 0,
    totalLitres: agg._sum.litres ?? 0,
    avgPricePerLitrePln: agg._avg.price_per_litre_pln ?? null,
    totalSavingsPln: savingsResult[0]?.total_savings ?? null,
    rankingPercentile: null,   // Story 6.7
    rankingVoivodeship: null,  // Story 6.7
  };
}
```

### ShareableCard design

The card is rendered as a React Native View at **display size 320×320** but captured at **2× pixel ratio** → 640×640px PNG. This balances visual quality vs file size for social sharing.

```tsx
// apps/mobile/src/components/ShareableCard.tsx
interface ShareableCardProps {
  monthLabel: string;       // e.g. "March 2026"
  totalSavingsPln: number;  // always > 0 when rendered
  fillupCount: number;
  rankingPercentile: number | null;
  rankingVoivodeship: string | null;
  lang: string;
  t: TFunction;
  cardRef?: React.RefObject<View>;
}
```

Card layout (320×320):
```
┌─────────────────────────────────┐  ← amber (#f59e0b) top stripe 80px
│          MARCH 2026             │
├─────────────────────────────────┤  ← white (#ffffff) body
│                                 │
│     🛢️  You saved               │
│         94 PLN                  │  ← 48px bold, brand.ink
│     on fuel this month          │
│                                 │
│     ── 6 fill-ups ──            │  ← neutral.n500
│                                 │
│  [top 20% in Warsaw] ← pill     │  ← only when rankingPercentile present
│                                 │
├─────────────────────────────────┤  ← amber bottom stripe 40px
│         ⛽ desert               │  ← brand wordmark, brand.ink
└─────────────────────────────────┘
```

Use `react-native-svg` (already installed) for the fuel/oil emoji substitute — emoji rendering in captured views can be inconsistent across Android devices.

### View capture and sharing

```ts
// In savings-summary.tsx
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

const cardRef = useRef<ViewShot>(null);

async function handleShare() {
  setIsCapturing(true);
  try {
    const uri = await cardRef.current?.capture?.();
    if (!uri) return;
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: t('savingsSummary.shareDialogTitle'),
    });
  } finally {
    setIsCapturing(false);
  }
}
```

Wrap `<ShareableCard>` in `<ViewShot ref={cardRef} format="png" quality={1}>`.

**Note on Android emoji rendering**: Avoid native emoji in the captured view — use text labels ("Fuel saved") or SVG icons instead. Emoji render inconsistently in `react-native-view-shot` captures on older Android versions.

### Route params

```ts
// savings-summary.tsx
const params = useLocalSearchParams<{ year?: string; month?: string }>();
const year = params.year ? parseInt(params.year) : new Date().getFullYear();
const month = params.month ? parseInt(params.month) : new Date().getMonth() + 1;
```

Deep-link format from Story 6.5 notification: `desert://savings-summary?year=2026&month=3`

### Log screen "Monthly summary" entry point

Add to `log.tsx` below the summary cards, visible only when the period filter is "Last 30 days" (or a specific month selector — Story 5.5 uses period filters, not calendar month pickers). For Story 5.7, show the link when `period === '30d'` and `summary.totalSavingsPln > 0`:

```tsx
{period === '30d' && summary.totalSavingsPln > 0 && (
  <TouchableOpacity
    onPress={() => router.push({
      pathname: '/(app)/savings-summary',
      params: { year: currentYear, month: currentMonth },
    })}
  >
    <Text style={styles.monthlySummaryLink}>{t('history.viewMonthlySummary')}</Text>
  </TouchableOpacity>
)}
```

### i18n strings

Add to all 3 locales:

**`savingsSummary` section:**
```
title:            'Monthly Summary' | 'Miesięczne podsumowanie' | 'Щомісячне зведення'
savedAmount:      'You saved {{amount}} PLN' | 'Zaoszczędziłeś {{amount}} PLN' | 'Ви заощадили {{amount}} PLN'
fillupCount:      '{{count}} fill-ups' | '{{count}} tankowania' | '{{count}} заправок'
shareButton:      'Share my savings' | 'Udostępnij moje oszczędności' | 'Поділитися моїми заощадженнями'
sharing:          'Preparing card…' | 'Przygotowuję kartę…' | 'Готую картку…'
shareDialogTitle: 'Share your savings' | 'Udostępnij swoje oszczędności' | 'Поділіться своїми заощадженнями'
noSavings:        'No savings data for this month' | 'Brak danych o oszczędnościach za ten miesiąc' | 'Немає даних про заощадження за цей місяць'
```

**`savingsCard` section** (text that appears on the generated card image):
```
saved:           'You saved' | 'Zaoszczędziłeś' | 'Ви заощадили'
onFuelThisMonth: 'on fuel this month' | 'na paliwie w tym miesiącu' | 'на паливі цього місяця'
fillups:         'fill-ups' | 'tankowania' | 'заправок'
topPercent:      'top {{pct}}% in {{region}}' | 'top {{pct}}% w {{region}}' | 'топ {{pct}}% у {{region}}'
brandTagline:    'desert · fuel price tracker' | 'desert · tracker cen paliwa' | 'desert · відстеження цін на паливо'
```

**Add to `history` section:**
```
viewMonthlySummary: 'View monthly summary →' | 'Zobacz miesięczne podsumowanie →' | 'Переглянути щомісячне зведення →'
```

### Project Structure Notes

- `apps/api/src/fillup/fillup.service.ts` (modified — add `getMonthlySummary()`)
- `apps/api/src/fillup/fillup.controller.ts` (modified — add `GET /v1/me/fillups/monthly-summary`)
- `apps/mobile/package.json` (modified — add `react-native-view-shot`, `expo-sharing`)
- `apps/mobile/src/components/ShareableCard.tsx` (new)
- `apps/mobile/app/(app)/savings-summary.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified — add monthly summary entry link)
- `apps/mobile/src/api/fillups.ts` (modified — add `apiGetMonthlySummary`)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- FillupService + controller: [apps/api/src/fillup/](apps/api/src/fillup/) (Story 5.2)
- `SavingsDisplay` (savings formatting pattern): [apps/mobile/src/components/SavingsDisplay.tsx](apps/mobile/src/components/SavingsDisplay.tsx) (Story 5.3)
- Theme tokens (amber, brand.ink): [apps/mobile/src/theme/tokens.ts](apps/mobile/src/theme/tokens.ts)
- `react-native-svg` (already installed — for card icons)
- Log screen entry point: [apps/mobile/app/(app)/log.tsx](apps/mobile/app/(app)/log.tsx) (Story 5.5)
- Story 6.5 (Monthly Summary Notification — deep-links to this screen)
- Story 6.7 (Leaderboard — populates `rankingPercentile` in the card)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.7 (line ~2411)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.controller.ts` (modified)
- `apps/mobile/package.json` (modified — react-native-view-shot, expo-sharing)
- `apps/mobile/src/components/ShareableCard.tsx` (new)
- `apps/mobile/app/(app)/savings-summary.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified)
- `apps/mobile/src/api/fillups.ts` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-7-savings-summary-sharing.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
