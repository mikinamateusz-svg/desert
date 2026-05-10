# Story 5.9: Best-Saver Stat

Status: ready-for-dev

> **Depends on Story 5.8** for the cohort/threshold infrastructure
> (`SavingsRankingService` + ≥10-driver privacy floor + voivodeship
> scope). 5.8 must ship first.

## Story

As a **driver**,
I want to see how much the top saver in my area saved last month,
So that I get an aspirational target alongside my own percentile —
without learning anything about who that top saver actually is.

## Acceptance Criteria

**AC1 — Best-saver value populated when cohort ≥ 10:**
Given the cohort threshold is met for a user's voivodeship-scoped cohort in the requested month
When the savings-summary endpoint returns
Then `bestSaverSavingsPln` is set to the integer PLN value (rounded) of the highest single-user total savings in that cohort
And `bestSaverSavingsPln` is `null` when the cohort has <10 drivers OR when AC2's leak guard is triggered

**AC2 — Suppress when viewer IS the best saver (leak guard):**
Given the viewer's own total savings equals the cohort maximum
When the response is built
Then `bestSaverSavingsPln` is `null` even when the cohort threshold is met
And no rendered surface (card, screen, notification) ever shows a "best saver" amount equal to the viewer's own amount
*Why:* If the viewer is rank #1 and we show "best saver: 247 PLN" on the card, the recipient learns the viewer's exact savings. The leak guard breaks that direct equivalence.

**AC3 — In-app savings-summary screen segment:**
Given a non-null `bestSaverSavingsPln`
When the screen renders
Then a single-line segment "Best saver this month: X PLN" appears under the percentile line (Story 5.8)
And the segment is hidden when `bestSaverSavingsPln` is null

**AC4 — ShareableCard secondary line:**
Given a non-null `bestSaverSavingsPln`
When the captured PNG renders
Then a small "Best in your area: X PLN" line (translated, no voivodeship name) appears below the existing percentile pill
And the line is omitted with no layout gap when null

**AC5 — Story 6.5 notification UNCHANGED:**
Given the monthly summary cron computes notifications (Story 6.5)
When a user has a known best-saver value
Then the push notification body is **NOT** enriched with the best-saver figure (push body is already long; one extra clause hurts more than it helps)
*This AC documents an explicit non-change so a future review doesn't add it back without a discussion.*

**AC6 — Language-aware:**
Given a driver's selected language is Polish, English, or Ukrainian
When the best-saver value is rendered
Then the labels are in the user's language
And the rendered string contains an integer PLN value (rounded; no decimals — keeps the card clean)

**AC7 — No best-saver shown when 5.8 percentile is null:**
Given `rankingPercentile` is null (5.8 cohort threshold not met, no voivodeship, etc.)
When the response is built
Then `bestSaverSavingsPln` is also null
*Reasoning:* The two stats share the same cohort definition. If we don't have enough drivers to compute a percentile, we don't have enough to compute a meaningful "best."

## Tasks / Subtasks

- [ ] T1: Extend `SavingsRankingService` with best-saver lookup (AC1, AC2, AC7)
  - [ ] T1a: Change `getUserPercentile` return shape from `{ topPercent } | null` to `{ topPercent, bestSaverSavingsPln } | null`. Single SQL roundtrip — `MAX()` is a window-friendly aggregate, fold it into the existing CTE
  - [ ] T1b: Apply leak guard at the service boundary: when the requesting user's `total_savings_pln` equals the cohort max, return `bestSaverSavingsPln: null` (keep `topPercent` populated)
  - [ ] T1c: Round `bestSaverSavingsPln` to the nearest integer PLN before returning (avoid leaking grosz-precision)

- [ ] T2: Extend `MonthlySummaryDto` (AC1, AC7)
  - [ ] T2a: Add `bestSaverSavingsPln: number | null` to the api DTO interface (after `rankingPercentile`)
  - [ ] T2b: Same field in `apps/mobile/src/api/fillups.ts` `MonthlySummaryDto` interface
  - [ ] T2c: `fillup.service.ts:getMonthlySummary` populates from the (now richer) ranking service result

- [ ] T3: `ShareableCard` secondary line (AC4)
  - [ ] T3a: Add `bestSaverSavingsPln: number | null` to `ShareableCardProps`
  - [ ] T3b: Render a small line "Best in your area: X PLN" below the percentile pill when non-null. Uses the locale-correct number formatter already in the file (`formatAmountForLocale` — but for an integer, no decimals). Add a paired `formatIntegerForLocale` helper if needed
  - [ ] T3c: Style: 11px, neutral.n500, marginTop 8 — visually subordinate to the pill so it doesn't dominate the card
  - [ ] T3d: Pass-through from `savings-summary.tsx`

- [ ] T4: `savings-summary.tsx` screen segment (AC3)
  - [ ] T4a: Add a "Best saver this month: X PLN" line below the percentile segment (5.8); renders only when `summary.bestSaverSavingsPln !== null`
  - [ ] T4b: Same locale-aware integer formatting as the card

- [ ] T5: i18n — all 3 locales (AC4, AC6)
  - [ ] T5a: Add `savingsCard.bestSaverLine: "Best in your area: {{amount}} PLN"` (en) + pl + uk equivalents
  - [ ] T5b: Add `savingsSummary.bestSaverLine: "Best saver this month: {{amount}} PLN"` (en) + pl + uk equivalents

- [ ] T6: Tests
  - [ ] T6a: `savings-ranking.service.spec.ts` additions — `getUserPercentile` returns expected `bestSaverSavingsPln` for known fixtures; viewer-is-max → `bestSaverSavingsPln: null`, `topPercent` still populated; cohort <10 → both null; integer rounding (e.g. 247.6 → 248)
  - [ ] T6b: `fillup.service.spec.ts` — `getMonthlySummary` returns `bestSaverSavingsPln` field; null in expected scenarios
  - [ ] T6c: Mobile: `ShareableCard` structural test renders best-saver line when prop provided; absent when null
  - [ ] T6d: Full regression: all existing tests still pass

## Dev Notes

### SQL — extend single-user query

The CTE from 5.8 already groups savings per user within the cohort. Add `MAX() OVER ()` to surface the cohort max in the same row:

```sql
-- (5.8 CTEs unchanged: user_voivodeship, cohort_users, savings)
ranked AS (
  SELECT
    user_id,
    total_savings_pln,
    RANK() OVER (ORDER BY total_savings_pln DESC)::int AS rank,
    COUNT(*) OVER ()::int AS total_drivers,
    MAX(total_savings_pln) OVER () AS best_saver_pln
  FROM savings
)
SELECT rank, total_drivers, total_savings_pln, best_saver_pln
FROM ranked
WHERE user_id = ${userId};
```

Service-side leak guard:
```ts
const isViewerTheMax = row.total_savings_pln >= row.best_saver_pln;
return {
  topPercent: Math.max(1, Math.round((row.rank / row.total_drivers) * 100)),
  bestSaverSavingsPln: isViewerTheMax ? null : Math.round(row.best_saver_pln),
};
```

Use `>=` (not `==`) for the comparison: if two users tie at the top, both are "the max" and both have their leak guard fire (otherwise the loser of the tiebreak would see the same value as their own — which is the leak we're guarding against).

### Bulk query (`getBulkPercentilesForMonth`)

Add `MAX(total_savings_pln) OVER (PARTITION BY voivodeship)` to the bulk CTE. Result map shape becomes:

```ts
Map<userId, { topPercent: number; bestSaverSavingsPln: number | null }>
```

Same leak guard applied per-row before insertion into the map. (For 6.5, we don't surface `bestSaverSavingsPln` in the notification per AC5 — but having it on the map keeps the API symmetric for any future caller.)

### Why suppress instead of always-show-someone-else's

Alternative considered: when the viewer is #1, show the **second**-place value instead of nulling out. Rejected because:

1. It's information-leaking under a fig leaf — the viewer (who is also the recipient of their own share) trivially knows the gap between their PLN and what the card claims is "best."
2. Cohort-of-10 means second place is one specific person whose individual savings figure is now broadcast, even if not by name.
3. Null + no rendered line is the cleanest fail-safe.

### Why no notification enrichment (AC5)

Push notifications are length-sensitive — Android lock-screen truncates around 100 chars and iOS expanded view caps useful clauses around 3. Story 6.5's body already carries the headline + percentile clause from 5.8. Stuffing a third clause ("…and the best saver got 312 PLN") shifts attention to someone else's number at the moment we're trying to celebrate the user's own. Hold for now; revisit if engagement data suggests it'd help.

### Project Structure Notes

- `apps/api/src/fillup/savings-ranking.service.ts` (modified — extend return shape + leak guard)
- `apps/api/src/fillup/savings-ranking.service.spec.ts` (modified — new assertions)
- `apps/api/src/fillup/fillup.service.ts` (modified — populate new field)
- `apps/api/src/fillup/fillup.service.spec.ts` (modified — new assertions)
- `apps/mobile/src/api/fillups.ts` (modified — add `bestSaverSavingsPln` to DTO)
- `apps/mobile/src/components/ShareableCard.tsx` (modified — new prop + line render)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified — new on-screen line)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- **No backend module/import changes** — `SavingsRankingService` already wired by 5.8.
- **No 6.5 changes** — AC5 is an explicit non-change.

### References

- Story 5.8 (predecessor): [_bmad-output/implementation-artifacts/5-8-savings-percentile.md](_bmad-output/implementation-artifacts/5-8-savings-percentile.md)
- `SavingsRankingService` (created in 5.8): [apps/api/src/fillup/savings-ranking.service.ts](apps/api/src/fillup/savings-ranking.service.ts)
- Cancelled Story 6.7: [_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md](_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/fillup/savings-ranking.service.ts` (modified)
- `apps/api/src/fillup/savings-ranking.service.spec.ts` (modified)
- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.service.spec.ts` (modified)
- `apps/mobile/src/api/fillups.ts` (modified)
- `apps/mobile/src/components/ShareableCard.tsx` (modified)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-9-best-saver-stat.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
