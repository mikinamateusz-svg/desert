# Story 6.7: Savings Leaderboard

Status: ready-for-dev

> **Pre-implementation note from Story 5.7 review (2026-05-03):**
> When this story populates `rankingPercentile` and `rankingVoivodeship`
> on the `MonthlySummaryDto` (consumed by the Story 5.7 ShareableCard),
> the captured PNG will leak the user's voivodeship + savings amount to
> every share recipient — currently rendered without any consent prompt.
> The card wiring (`ShareableCard.tsx` + `savings-summary.tsx`) is
> already in place; lighting up the ranking pill needs an opt-in or a
> "hide region from share image" toggle.
> Surfaces in: `apps/mobile/src/components/ShareableCard.tsx` (the
> conditional `rankingPercentile !== null && rankingVoivodeship` block).
> AC to add: explicit consent before the first ranking-bearing share,
> OR a per-share toggle to omit the region pill.

## Story

As a **driver**,
I want to see how my fuel savings compare to other drivers in my area,
So that saving money becomes a competition I actually want to win.

## Acceptance Criteria

**AC1 — Leaderboard display:**
Given a driver opens the leaderboard
When ≥10 drivers in their voivodeship have positive savings for the selected period
Then they see a ranked list: anonymised display name ("Driver #4721"), total PLN saved, fill-up count, and rank number
And their own entry shows "You" instead of an anonymised name
And their own entry is always visible — pinned at the bottom when not in the top 20 visible entries

**AC2 — Period filter:**
Given a driver views the leaderboard
When they select a time period
Then they can switch between: current month, last month, last 3 months
And the list and rank update to reflect the selected period

**AC3 — Minimum threshold:**
Given fewer than 10 drivers in the driver's voivodeship have savings data for the selected period
When the leaderboard would be shown
Then the list is replaced with a message explaining the leaderboard will appear as more drivers contribute
And the threshold must be ≥10 drivers with positive savings (negative savings months excluded)

**AC4 — Anonymisation:**
Given a driver views the leaderboard
When they see other drivers' entries
Then each is shown only as "Driver #XXXX" where XXXX is a stable 4-digit code derived from the user ID
And no real name, email, or account detail is shown for any other driver

**AC5 — Voivodeship scope:**
Given a driver's most recent fill-up station has a `voivodeship` value
When they open the leaderboard
Then the leaderboard shows only drivers whose fill-ups are in the same voivodeship
And if the driver has no fill-up history with a voivodeship set, the leaderboard cannot be shown (empty state with explanation)

**AC6 — Story 6.5 integration:**
Given the monthly summary notification job runs (Story 6.5)
When it computes each driver's savings for the previous month
Then it also calls `LeaderboardService.getUserRankForMonth(userId, voivodeship, year, month)` to get `rankingPercentile`
And includes the percentile in the notification copy if the threshold is met (≥10 drivers)

**AC7 — Story 5.7 integration:**
Given a driver views the savings summary screen (Story 5.7)
When Story 6.7 is deployed
Then `GET /v1/me/fillups/monthly-summary` returns non-null `rankingPercentile` and `rankingVoivodeship`
And the shareable card renders the ranking pill

**AC8 — Language-aware:**
Given a driver's selected language is Polish, English, or Ukrainian
When they view the leaderboard
Then all labels, month names, and rank descriptions are in that language

## Tasks / Subtasks

- [ ] T1: `LeaderboardService` (AC1–AC5)
  - [ ] T1a: Create `apps/api/src/leaderboard/leaderboard.service.ts`
  - [ ] T1b: Implement `getLeaderboard(userId, voivodeship, period)` — runs the ranking CTE (see Dev Notes); returns `LeaderboardResponse`
  - [ ] T1c: Implement `getUserRank(userId, voivodeship, periodStart, periodEnd)` — lightweight query returning `{ rank, totalDrivers, topPercent }` for a specific user; used by Story 6.5 and 5.7 integration
  - [ ] T1d: Implement `getUserVoivodeship(userId)` — returns voivodeship of user's most recent fill-up station (`FillUp.voivodeship`); returns null if none
  - [ ] T1e: Implement `anonymise(userId)` — stable 4-digit code: `String(parseInt(userId.replace(/-/g, '').slice(-6), 16) % 10000).padStart(4, '0')`

- [ ] T2: `LeaderboardModule` + app registration
  - [ ] T2a: Create `apps/api/src/leaderboard/leaderboard.module.ts`; export `LeaderboardService`
  - [ ] T2b: Import `LeaderboardModule` in `apps/api/src/app.module.ts`

- [ ] T3: `LeaderboardController` — API endpoint (AC1–AC5)
  - [ ] T3a: Create `apps/api/src/leaderboard/leaderboard.controller.ts`
  - [ ] T3b: `GET /v1/me/leaderboard?period=month|last_month|3m` — calls `leaderboardService.getLeaderboard()`; returns `LeaderboardResponse`
  - [ ] T3c: Register controller in `LeaderboardModule`

- [ ] T4: Extend `FillupService.getMonthlySummary()` for Story 5.7 (AC7)
  - [ ] T4a: In `apps/api/src/fillup/fillup.service.ts`: inject `LeaderboardService` (via module import); call `getUserRank()` for the requested month; populate `rankingPercentile` and `rankingVoivodeship` in `MonthlySummaryDto`

- [ ] T5: Extend `MonthlySummaryNotificationService` for Story 6.5 (AC6)
  - [ ] T5a: In `apps/api/src/monthly-summary/monthly-summary-notification.service.ts`: after computing the bulk savings aggregate, for each user call `leaderboardService.getUserRank()` to get their percentile; include in `buildNotificationPayload()`
  - [ ] T5b: Batch-optimise: compute rankings for all users in a single SQL pass (see Dev Notes — bulk rank query) rather than N individual calls

- [ ] T6: Mobile — `leaderboard.tsx` screen (AC1–AC5, AC8)
  - [ ] T6a: Create `apps/mobile/app/(app)/leaderboard.tsx`
  - [ ] T6b: Period selector: segmented control with 3 options; default = current month
  - [ ] T6c: `FlatList` with `LeaderboardRow` inline component; viewer's entry pinned at bottom when not in visible list
  - [ ] T6d: Empty state: threshold not met → show message; no voivodeship → show "record fill-ups to join" message
  - [ ] T6e: Deep-linkable: `/(app)/leaderboard?period=last_month`

- [ ] T7: Mobile — entry point from savings summary (AC1)
  - [ ] T7a: In `apps/mobile/app/(app)/savings-summary.tsx` (Story 5.7): add "See leaderboard →" link below the shareable card; navigates to `/(app)/leaderboard?period=last_month` (showing last month's rankings to match the summary)

- [ ] T8: Mobile — API client (AC1)
  - [ ] T8a: Add `apiGetLeaderboard(accessToken, period)` to `apps/mobile/src/api/leaderboard.ts` (new file)

- [ ] T9: i18n — all 3 locales (AC8)
  - [ ] T9a: Add `leaderboard` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes); the `auth.onboarding.leaderboard` key already exists with basic strings — extend with full UI strings

- [ ] T10: Tests
  - [ ] T10a: `leaderboard.service.spec.ts` — `getLeaderboard`: returns ranked list when ≥10 drivers; returns `thresholdMet: false` when <10 drivers; viewer entry shows `isViewer: true` and `displayName: 'You'`; other entries anonymised; viewer pinned when outside top 20; `getUserRank`: returns null for voivodeship when user has no fill-up history; `anonymise`: produces stable 4-digit code for same userId
  - [ ] T10b: Full regression suite — all existing tests still pass

## Dev Notes

### Ranking CTE

```sql
-- Period parameterised: monthStart, monthEnd
WITH savings AS (
  SELECT
    f.user_id,
    SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln,
    COUNT(*)::int AS fillup_count
  FROM "FillUp" f
  WHERE f.area_avg_at_fillup IS NOT NULL
    AND f.filled_at >= ${periodStart}
    AND f.filled_at <  ${periodEnd}
    AND f.voivodeship = ${voivodeship}
  GROUP BY f.user_id
  HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
),
ranked AS (
  SELECT
    user_id,
    total_savings_pln,
    fillup_count,
    RANK() OVER (ORDER BY total_savings_pln DESC)::int      AS rank,
    COUNT(*) OVER ()::int                                    AS total_drivers,
    PERCENT_RANK() OVER (ORDER BY total_savings_pln DESC)    AS pct_rank
  FROM savings
)
SELECT * FROM ranked ORDER BY rank;
```

`PERCENT_RANK()` returns 0 for the top driver and 1 for the bottom. `topPercent` = the "top X%" figure shown to users:
```ts
const topPercent = Math.max(1, Math.round((row.rank / row.total_drivers) * 100));
// rank=1, total=100  → top 1%
// rank=20, total=100 → top 20%
// rank=50, total=100 → top 50%
```

Minimum: `Math.max(1, ...)` prevents "top 0%" for the rank-1 driver.

### LeaderboardResponse + LeaderboardEntry types

```ts
// apps/api/src/leaderboard/leaderboard.service.ts
export interface LeaderboardEntry {
  rank: number;
  displayName: string;   // 'You' | 'Driver #4721'
  totalSavingsPln: number;
  fillupCount: number;
  isViewer: boolean;
  topPercent: number;    // e.g. 15 = "top 15%"
}

export interface LeaderboardResponse {
  voivodeship: string;
  period: 'month' | 'last_month' | '3m';
  thresholdMet: boolean;
  totalDrivers: number;
  entries: LeaderboardEntry[];  // top 20 entries (or all if ≤20)
  viewerEntry: LeaderboardEntry | null; // viewer's entry — null when not in period (no savings)
  viewerInTopList: boolean;     // false when viewer entry is pinned below the list
}
```

Top 20 entries are returned in the API response. If the viewer is not in the top 20, `viewerEntry` is still populated and `viewerInTopList: false` so the mobile client can pin it at the bottom.

### Anonymisation function

```ts
private anonymise(userId: string): string {
  // Stable 4-digit code from the user ID — consistent across sessions
  const hex = userId.replace(/-/g, '').slice(-6); // last 6 hex chars of UUID
  const code = parseInt(hex, 16) % 10000;
  return `Driver #${String(code).padStart(4, '0')}`;
}
```

For the viewing user: return `'You'` instead. The `userId` parameter is known server-side from the authenticated request.

### Period mapping

```ts
function periodBounds(period: 'month' | 'last_month' | '3m'): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case 'month':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end:   new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    case 'last_month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end:   new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case '3m':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 3, 1),
        end:   new Date(now.getFullYear(), now.getMonth() + 1, 1), // up to end of current month
      };
  }
}
```

### getUserVoivodeship()

```ts
async getUserVoivodeship(userId: string): Promise<string | null> {
  const result = await this.prisma.fillUp.findFirst({
    where: { user_id: userId, voivodeship: { not: null } },
    orderBy: { filled_at: 'desc' },
    select: { voivodeship: true },
  });
  return result?.voivodeship ?? null;
}
```

### Bulk rank query for Story 6.5 integration

When `MonthlySummaryNotificationService.runForMonth()` runs for all users, compute rankings in a single SQL pass rather than N individual calls:

```ts
// Returns map: userId → { rank, totalDrivers, topPercent, voivodeship }
async getBulkRanksForMonth(
  year: number,
  month: number,
): Promise<Map<string, { topPercent: number; voivodeship: string }>> {
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd   = new Date(year, month, 1);

  const rows = await this.prisma.$queryRaw<Array<{
    user_id: string;
    rank: number;
    total_drivers: number;
    voivodeship: string;
  }>>`
    WITH savings AS (
      SELECT
        f.user_id,
        f.voivodeship,
        SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln
      FROM "FillUp" f
      WHERE f.area_avg_at_fillup IS NOT NULL
        AND f.filled_at >= ${periodStart}
        AND f.filled_at <  ${periodEnd}
        AND f.voivodeship IS NOT NULL
      GROUP BY f.user_id, f.voivodeship
      HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
    ),
    ranked AS (
      SELECT
        user_id,
        voivodeship,
        total_savings_pln,
        RANK() OVER (PARTITION BY voivodeship ORDER BY total_savings_pln DESC)::int AS rank,
        COUNT(*) OVER (PARTITION BY voivodeship)::int AS total_drivers
      FROM savings
    )
    SELECT user_id, voivodeship, rank, total_drivers
    FROM ranked
    WHERE total_drivers >= 10  -- only include when threshold met
  `;

  return new Map(rows.map((r) => [
    r.user_id,
    {
      voivodeship: r.voivodeship,
      topPercent: Math.max(1, Math.round((r.rank / r.total_drivers) * 100)),
    },
  ]));
}
```

`MonthlySummaryNotificationService.runForMonth()` calls this once and looks up each user from the resulting map. If a user is not in the map (threshold not met or no data), `rankingPercentile` remains null.

### MonthlySummaryDto extension for Story 5.7

`FillupService.getMonthlySummary()` (Story 5.7) currently returns `rankingPercentile: null`. With Story 6.7 deployed:

```ts
// In fillup.service.ts — inject LeaderboardService
const voivodeship = await this.leaderboardService.getUserVoivodeship(userId);
const rank = voivodeship
  ? await this.leaderboardService.getUserRank(userId, voivodeship, monthStart, monthEnd)
  : null;

return {
  // ... existing fields ...
  rankingPercentile: rank?.topPercent ?? null,
  rankingVoivodeship: voivodeship,
};
```

### LeaderboardRow mobile component

```tsx
function LeaderboardRow({
  entry,
  t,
}: {
  entry: LeaderboardEntry;
  t: TFunction;
}) {
  return (
    <View style={[styles.row, entry.isViewer && styles.viewerRow]}>
      <Text style={styles.rank}>#{entry.rank}</Text>
      <View style={styles.info}>
        <Text style={[styles.name, entry.isViewer && styles.viewerName]}>
          {entry.displayName}
        </Text>
        <Text style={styles.detail}>
          {entry.fillupCount} {t('leaderboard.fillups')}
        </Text>
      </View>
      <View style={styles.savings}>
        <Text style={styles.savingsAmount}>{Math.round(entry.totalSavingsPln)} PLN</Text>
        <Text style={styles.topPercent}>{t('leaderboard.topPercent', { pct: entry.topPercent })}</Text>
      </View>
    </View>
  );
}
```

Viewer row has a distinct background (e.g. amber tint) so it stands out. When pinned at bottom, a horizontal rule separates it from the ranked list.

### i18n strings

Extend `leaderboard` section (the `auth.onboarding.leaderboard` key already exists with onboarding copy; add a separate top-level `leaderboard` section):

```
title:              'Fuel Savings Leaderboard' | 'Ranking oszczędzania' | 'Рейтинг заощаджень'
subtitle:           'How do your savings compare in your area?' | 'Jak Twoje oszczędności wypadają w regionie?' | 'Як ваша економія виглядає у вашому регіоні?'
periodMonth:        'This month' | 'Ten miesiąc' | 'Цей місяць'
periodLastMonth:    'Last month' | 'Poprzedni miesiąc' | 'Минулий місяць'
period3m:           'Last 3 months' | 'Ostatnie 3 miesiące' | 'Останні 3 місяці'
rank:               'Rank' | 'Miejsce' | 'Місце'
fillups:            'fill-ups' | 'tankowania' | 'заправок'
topPercent:         'top {{pct}}%' | 'top {{pct}}%' | 'топ {{pct}}%'
youLabel:           'You' | 'Ty' | 'Ви'
thresholdNotMet:    'The leaderboard will appear when more drivers in your area contribute savings data.' | 'Ranking pojawi się, gdy więcej kierowców z Twojego regionu doda dane.' | 'Рейтинг з\'явиться, коли більше водіїв у вашому регіоні додадуть дані.'
noVoivodeship:      'Record fill-ups to join the leaderboard.' | 'Zarejestruj tankowania, aby dołączyć do rankingu.' | 'Записуйте заправки, щоб приєднатися до рейтингу.'
viewLeaderboard:    'See leaderboard →' | 'Zobacz ranking →' | 'Переглянути рейтинг →'
```

### No caching in this story

Leaderboard queries run on demand. At MVP scale (hundreds of drivers per voivodeship) the CTE completes in <100ms. Redis caching with 1h TTL is a future optimisation — not in this story's scope.

### Project Structure Notes

- New directory: `apps/api/src/leaderboard/`
  - `leaderboard.service.ts` (new)
  - `leaderboard.controller.ts` (new)
  - `leaderboard.module.ts` (new)
  - `leaderboard.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import `LeaderboardModule`)
- `apps/api/src/fillup/fillup.service.ts` (modified — inject `LeaderboardService`, populate `rankingPercentile`)
- `apps/api/src/fillup/fillup.module.ts` (modified — import `LeaderboardModule`)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified — call `getBulkRanksForMonth()`)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified — import `LeaderboardModule`)
- `apps/mobile/app/(app)/leaderboard.tsx` (new)
- `apps/mobile/src/api/leaderboard.ts` (new)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified — add "See leaderboard" link)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- **No schema changes** — computed from `FillUp.voivodeship` + `area_avg_at_fillup` (both added in Story 5.3)

### References

- `FillUp.voivodeship` (Story 5.3): [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)
- `FillupService.getMonthlySummary()` (Story 5.7): returns `MonthlySummaryDto` with `rankingPercentile: null` until this story
- `MonthlySummaryNotificationService.runForMonth()` (Story 6.5): extended here with bulk rank query
- Story 5.7: `ShareableCard` renders ranking pill when `rankingPercentile` non-null
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.7 (line ~2730)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/leaderboard/leaderboard.service.ts` (new)
- `apps/api/src/leaderboard/leaderboard.controller.ts` (new)
- `apps/api/src/leaderboard/leaderboard.module.ts` (new)
- `apps/api/src/leaderboard/leaderboard.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified)
- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.module.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified)
- `apps/mobile/app/(app)/leaderboard.tsx` (new)
- `apps/mobile/src/api/leaderboard.ts` (new)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
