# Story 5.8: Savings Percentile

Status: ready-for-dev

> **Reformulation context (2026-05-10):**
> Replaces the cancelled Story 6.7 ("Savings Leaderboard"). The
> leaderboard framing was abandoned because the shared PNG would have
> leaked the user's voivodeship + savings amount to every recipient
> (5.7 review note). This story keeps the "where do I rank" value but
> drops the geographic qualifier from every rendered surface — so the
> shared card and notification reveal only the percentile, never the
> region. Voivodeship stays server-side as the cohort scope.

## Story

As a **driver**,
I want to see how my fuel savings rank against other drivers,
So that I get a sense of whether I'm doing well, without revealing
where I drive to anyone I share my summary with.

## Acceptance Criteria

**AC1 — Percentile populated when cohort ≥ 10:**
Given a driver has positive savings in the requested month
And ≥10 drivers in the same voivodeship-scoped cohort have positive savings for that month
When the savings-summary endpoint returns
Then `rankingPercentile` is set to the integer percentile (1–100), where 1 means top of the cohort
And `rankingPercentile` is `null` when the cohort has <10 drivers OR the driver has no positive savings OR the driver has no fillups with a known voivodeship in the month

**AC2 — Voivodeship never appears in any rendered surface:**
Given the percentile is populated
When the ShareableCard, savings-summary screen, or 6.5 monthly notification renders the percentile
Then the rendered text shows only "top X% of savers" (translated per locale)
And the voivodeship name does not appear in the card, the screen segment, the notification body, or anywhere on the share path
And the `MonthlySummaryDto.rankingVoivodeship` field is removed from the wire format entirely (no opportunity for a future caller to render it)

**AC3 — In-app savings-summary screen segment:**
Given a driver views `/savings-summary` and the response has a non-null `rankingPercentile`
When the screen renders
Then a single-line segment "You're in the top X% of savers" appears below the savings amount block
And the segment is hidden when `rankingPercentile` is null

**AC4 — ShareableCard pill reworded:**
Given the captured PNG renders for a month with a non-null `rankingPercentile`
When the pill is drawn
Then it shows "top X% of savers" (translated)
And the existing voivodeship-bearing pill copy is removed (no `{{region}}` interpolation slot remains in the i18n key)

**AC5 — Story 6.5 notification text enrichment:**
Given the monthly summary cron computes notifications (Story 6.5)
When a user has a known percentile (cohort threshold met)
Then their notification body reads "… — you're in the top X% of savers!" (drop the existing "in your area" qualifier)
And users without a known percentile keep the existing "Great month!" fallback

**AC6 — Language-aware:**
Given a driver's selected language is Polish, English, or Ukrainian
When the percentile is rendered (card, screen, notification)
Then the "top X% of savers" string is in the user's language
And the i18n key has a single `{{pct}}` interpolation slot — no `{{region}}` remains

## Tasks / Subtasks

- [ ] T1: `SavingsRankingService` (AC1)
  - [ ] T1a: Create `apps/api/src/fillup/savings-ranking.service.ts`. Lives inside `FillupModule` since it composes the same FillUp + voivodeship data the rest of the module owns
  - [ ] T1b: Implement `getUserPercentile(userId, monthStart, monthEnd)` — returns `{ topPercent: number } | null`. Internally: pick the user's voivodeship for the month (most-recent-fillup), build the cohort within that voivodeship, return null when cohort <10 or user not in it
  - [ ] T1c: Implement `getBulkPercentilesForMonth(monthStart, monthEnd)` — returns `Map<userId, { topPercent: number }>` for the 6.5 batch path; one SQL pass that emits all users from cohorts where `total_drivers >= 10`

- [ ] T2: Wire ranking into `getMonthlySummary` (AC1, AC3)
  - [ ] T2a: Inject `SavingsRankingService` into `FillupService`; in `getMonthlySummary` populate `rankingPercentile` via `getUserPercentile`. Compute it AFTER the savings aggregate (cheap re-read of cohort SQL is fine at MVP scale)
  - [ ] T2b: **Drop the `rankingVoivodeship` field from `MonthlySummaryDto`** (api side) — the comment "populated by Story 6.7" goes away with the field

- [ ] T3: Wire ranking into 6.5 monthly notification (AC5)
  - [ ] T3a: Inject `SavingsRankingService` into `MonthlySummaryNotificationService`; call `getBulkPercentilesForMonth(monthStart, monthEnd)` once at the top of `runForMonth`
  - [ ] T3b: Look up each user's percentile from the map; pass it as the third argument to `buildNotificationPayload`
  - [ ] T3c: Update `buildNotificationPayload` body string: `${headline} — you're in the top ${rankingPercentile}% of savers!` (drop "in your area")

- [ ] T4: `MonthlySummaryDto` shape change (AC2)
  - [ ] T4a: Remove `rankingVoivodeship` from the api DTO interface
  - [ ] T4b: Remove `rankingVoivodeship` from `apps/mobile/src/api/fillups.ts` `MonthlySummaryDto` interface
  - [ ] T4c: Update `fillup.service.ts` return shape — drop the line that sets `rankingVoivodeship: null`

- [ ] T5: `ShareableCard` rework (AC2, AC4)
  - [ ] T5a: Remove `rankingVoivodeship` from `ShareableCardProps`; drop the prop from the call site in `savings-summary.tsx`
  - [ ] T5b: Update conditional render: `{rankingPercentile !== null && (<View style={styles.rankingPill}>...</View>)}`
  - [ ] T5c: Update i18n key `savingsCard.topPercent` from "top {{pct}}% in {{region}}" to "top {{pct}}% of savers" (all 3 locales)

- [ ] T6: `savings-summary.tsx` screen segment (AC3)
  - [ ] T6a: Add a percentile line in the on-screen `statsBlock` (renders only when `summary.rankingPercentile !== null`); copy from new i18n key `savingsSummary.percentileLine`
  - [ ] T6b: Position above the divider so it reads as a positive headline alongside the savings amount

- [ ] T7: i18n — all 3 locales (AC4, AC6)
  - [ ] T7a: Update `savingsCard.topPercent` (rewording — drop region slot)
  - [ ] T7b: Add `savingsSummary.percentileLine: "You're in the top {{pct}}% of savers"` (en) + pl + uk equivalents

- [ ] T8: Tests
  - [ ] T8a: `savings-ranking.service.spec.ts` — `getUserPercentile`: returns null when cohort <10; returns null when user has no fillups with voivodeship in month; returns null when user has zero/negative savings; returns expected `topPercent` for known fixtures (rank 1 of 10 → 10, rank 5 of 10 → 50, etc.); soft-deleted users excluded from cohort
  - [ ] T8b: `getBulkPercentilesForMonth` — returns map of all eligible users; users in cohorts <10 absent from map; users with no positive savings absent
  - [ ] T8c: `fillup.service.spec.ts` — `getMonthlySummary` populates `rankingPercentile` when ranking service returns one; `rankingVoivodeship` absent from response shape
  - [ ] T8d: `monthly-summary-notification.service.spec.ts` — body text includes "top X% of savers" when percentile known; "Great month!" fallback otherwise; bulk lookup called once per run
  - [ ] T8e: Mobile: `ShareableCard` snapshot/structural test renders pill text without region slot when `rankingPercentile` provided
  - [ ] T8f: Full regression: all existing tests still pass

## Dev Notes

### Why "most recent voivodeship" for cohort assignment

A user can have fillups in multiple voivodeships in a month (commuters, road trips). Three options were considered:

1. Group savings per (user, voivodeship) — user appears in multiple cohorts. Confusing UX (which percentile do we surface?) and inflates cohort counts.
2. Pick voivodeship by highest savings within the month. Gameable; also surprising to the user ("why am I ranked in Wielkopolskie when I live in Warsaw?").
3. **Pick voivodeship of most recent fillup in the month.** Predictable, intuitive, easy to compute via `DISTINCT ON (user_id) ... ORDER BY filled_at DESC`.

Option 3 selected. Documented here so a future "fairness" rewrite knows what assumption is in play.

### Single-user query (`getUserPercentile`)

```sql
WITH user_voivodeship AS (
  -- Most recent fillup with a voivodeship for the requesting user
  SELECT voivodeship
  FROM "FillUp"
  WHERE user_id = ${userId}
    AND filled_at >= ${monthStart} AND filled_at < ${monthEnd}
    AND voivodeship IS NOT NULL
  ORDER BY filled_at DESC
  LIMIT 1
),
cohort_users AS (
  -- All users whose most-recent fillup in the month is in the SAME voivodeship
  SELECT DISTINCT ON (user_id) user_id
  FROM "FillUp"
  WHERE filled_at >= ${monthStart} AND filled_at < ${monthEnd}
    AND voivodeship = (SELECT voivodeship FROM user_voivodeship)
    AND voivodeship IS NOT NULL
  ORDER BY user_id, filled_at DESC
),
savings AS (
  SELECT
    f.user_id,
    SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln
  FROM "FillUp" f
  JOIN "User" u ON u.id = f.user_id
  WHERE f.filled_at >= ${monthStart} AND f.filled_at < ${monthEnd}
    AND f.area_avg_at_fillup IS NOT NULL
    AND f.price_per_litre_pln IS NOT NULL
    AND f.litres IS NOT NULL
    AND f.user_id IN (SELECT user_id FROM cohort_users)
    AND u.deleted_at IS NULL
  GROUP BY f.user_id
  HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
),
ranked AS (
  SELECT
    user_id,
    total_savings_pln,
    RANK() OVER (ORDER BY total_savings_pln DESC)::int AS rank,
    COUNT(*) OVER ()::int AS total_drivers
  FROM savings
)
SELECT rank, total_drivers
FROM ranked
WHERE user_id = ${userId};
```

If 0 rows returned (user not in cohort, no positive savings, no voivodeship), `getUserPercentile` returns null.
If returned row has `total_drivers < 10` (privacy floor), returns null.
Else: `topPercent = Math.max(1, Math.round((rank / total_drivers) * 100))` — `Math.max(1, …)` guarantees the rank-1 driver sees "top 1%" not "top 0%".

### Bulk query (`getBulkPercentilesForMonth`)

For Story 6.5's monthly cron — one SQL pass for all eligible users:

```sql
WITH most_recent_voivodeship AS (
  SELECT DISTINCT ON (user_id) user_id, voivodeship
  FROM "FillUp"
  WHERE filled_at >= ${monthStart} AND filled_at < ${monthEnd}
    AND voivodeship IS NOT NULL
  ORDER BY user_id, filled_at DESC
),
savings AS (
  SELECT
    f.user_id,
    SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln
  FROM "FillUp" f
  JOIN "User" u ON u.id = f.user_id
  WHERE f.filled_at >= ${monthStart} AND f.filled_at < ${monthEnd}
    AND f.area_avg_at_fillup IS NOT NULL
    AND f.price_per_litre_pln IS NOT NULL
    AND f.litres IS NOT NULL
    AND u.deleted_at IS NULL
  GROUP BY f.user_id
  HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
),
combined AS (
  SELECT s.user_id, s.total_savings_pln, mrv.voivodeship
  FROM savings s
  JOIN most_recent_voivodeship mrv ON mrv.user_id = s.user_id
),
ranked AS (
  SELECT
    user_id,
    total_savings_pln,
    voivodeship,
    RANK() OVER (PARTITION BY voivodeship ORDER BY total_savings_pln DESC)::int AS rank,
    COUNT(*) OVER (PARTITION BY voivodeship)::int AS total_drivers
  FROM combined
)
SELECT user_id, rank, total_drivers
FROM ranked
WHERE total_drivers >= 10;
```

Returns one row per eligible user. Build a `Map<userId, topPercent>` and look up each user during the notification fanout.

### `MonthlySummaryDto` shape change (breaking)

Old (Story 5.7):
```ts
interface MonthlySummaryDto {
  // ...
  rankingPercentile: number | null;
  rankingVoivodeship: string | null;  // ← REMOVE
}
```

New:
```ts
interface MonthlySummaryDto {
  // ...
  rankingPercentile: number | null;
}
```

This is a breaking shape change but the only consumers are first-party (mobile app + 6.5 notification builder). Mobile clients on older versions reading the field will see `undefined` instead of `null` — both fall through the existing `&& rankingVoivodeship` truthy check identically, so no crash. Documented here so it's not a surprise during the next mobile build review.

### `savingsCard.topPercent` i18n change

```
en: 'top {{pct}}% in {{region}}'  →  'top {{pct}}% of savers'
pl: 'top {{pct}}% w {{region}}'    →  'top {{pct}}% kierowców'
uk: 'топ {{pct}}% у {{region}}'    →  'топ {{pct}}% водіїв'
```

`{{region}}` slot is dropped — translators / future devs can't accidentally re-introduce a region label.

### New `savingsSummary.percentileLine` i18n key

```
en: "You're in the top {{pct}}% of savers"
pl: 'Jesteś w top {{pct}}% kierowców pod względem oszczędności'
uk: 'Ви в топ {{pct}}% водіїв за заощадженнями'
```

### `buildNotificationPayload` body update

Old (Story 6.5):
```ts
? `${headline} — you're in the top ${rankingPercentile}% of savers in your area!`
```

New (this story):
```ts
? `${headline} — you're in the top ${rankingPercentile}% of savers!`
```

Drop "in your area" — the user's locality is the cohort scoping detail, not a fact we need to broadcast in a push notification.

### Phase 2 gate

Backend changes ship unconditionally — they only populate a previously-null field. Mobile changes (in-app percentile segment + ShareableCard pill rework) ride the existing `flags.phase2` gate around the savings-summary screen. No new entry points to gate.

### Project Structure Notes

- `apps/api/src/fillup/savings-ranking.service.ts` (new)
- `apps/api/src/fillup/savings-ranking.service.spec.ts` (new)
- `apps/api/src/fillup/fillup.module.ts` (modified — provides `SavingsRankingService`, exports it for monthly-summary module)
- `apps/api/src/fillup/fillup.service.ts` (modified — inject ranking service, populate `rankingPercentile`, drop `rankingVoivodeship` from return + DTO)
- `apps/api/src/fillup/fillup.service.spec.ts` (modified — assertions updated)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified — import `FillupModule` so `SavingsRankingService` is injectable)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified — bulk lookup + body string update)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.spec.ts` (modified — assertions updated)
- `apps/mobile/src/api/fillups.ts` (modified — drop `rankingVoivodeship` from interface)
- `apps/mobile/src/components/ShareableCard.tsx` (modified — drop prop, conditional render simplified)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified — add percentile segment, drop voivodeship prop pass-through)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- `MonthlySummaryDto` (Story 5.7): [apps/api/src/fillup/fillup.service.ts](apps/api/src/fillup/fillup.service.ts)
- `ShareableCard` (Story 5.7): [apps/mobile/src/components/ShareableCard.tsx](apps/mobile/src/components/ShareableCard.tsx)
- `MonthlySummaryNotificationService` (Story 6.5): [apps/api/src/monthly-summary/monthly-summary-notification.service.ts](apps/api/src/monthly-summary/monthly-summary-notification.service.ts)
- Cancelled Story 6.7: [_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md](_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md)
- Successor Story 5.9 (Best-Saver Stat): [_bmad-output/implementation-artifacts/5-9-best-saver-stat.md](_bmad-output/implementation-artifacts/5-9-best-saver-stat.md)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/fillup/savings-ranking.service.ts` (new)
- `apps/api/src/fillup/savings-ranking.service.spec.ts` (new)
- `apps/api/src/fillup/fillup.module.ts` (modified)
- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.service.spec.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.spec.ts` (modified)
- `apps/mobile/src/api/fillups.ts` (modified)
- `apps/mobile/src/components/ShareableCard.tsx` (modified)
- `apps/mobile/app/(app)/savings-summary.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-8-savings-percentile.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
