# Story 3.12: Activity Screen Polish & Outcome Framing

**Status:** ready-for-dev
**Trigger:** 2026-04-22 field test observation — the Activity screen exposed raw pipeline jargon (`Przetwarzanie...`, `Nie opublikowano`) that confused the driver rather than informing them, and it surfaced no impact / value beyond a processing log.

---

## Story

As a **driver**,
I want my Activity screen to show me what I've contributed — not the pipeline's internal status —
So that I feel my submissions mattered and I have a useful record of stations I've covered.

## Why

The current screen is a raw submission list with backend-leaking copy:
- The fallback station label says "Przetwarzanie…" — identical to the processing status line — so an unmatched submission looks like a stuck one.
- Every row advertises its publishing status even when the driver can't act on it (`Nie opublikowano`, `Przetwarzanie`).
- No aggregate view, no sense of contribution history, no navigation back to the stations the driver visited.

This story is polish only — no API changes, no schema changes. **Scope is intentionally pared down to a v1** — we fix the jargon and add a minimal summary header, then measure pipeline success rate (`admin/metrics/pipeline successRate1h`) before investing in richer failure UX. See "Deferred — revisit once we know processing %" below.

---

## Acceptance Criteria

**AC1 — Minimal header summary card:**
Given a driver opens the Activity screen,
When it renders,
Then the top of the screen shows a compact summary card containing exactly:
- **verified-submission stat** — a large number (e.g. `22`) over a small lowercase label (`zgłoszeń` / `zgłoszenia` / `zgłoszenie` per Polish plural rules). Counts `verified` only, not pending/rejected.
- **unique stations stat** — same big-number/small-label layout (`stacji` / `stacje` / `stacja`). Unique `station_id` across `verified` rows.
- **first-contribution line** — small grey row below the two stats: `Aktywny od 12 kwi 2026`, using earliest `created_at` in the loaded submissions. Suffix with `+` (`Aktywny od 12 kwi 2026+`) when pagination hasn't reached the oldest page.

No fuel-type chips, no days-active count, no community-impact copy.

If a driver has submissions but zero verified (all pending/rejected), hide the summary card entirely — showing "0 zgłoszeń · 0 stacji" on the day of their first submission would misrepresent their contribution.

**AC2 — Honest station labels:**
Given a submission has no matched station,
When the row renders,
Then the primary line reads `Stacja nierozpoznana` (a distinct honest fallback),
And the primary line is **not** the same string as any processing / status copy elsewhere on the screen.

**AC3 — Outcome-framed verified rows:**
Given a submission is `verified`,
When the row renders,
Then the primary line shows the station name on the left and the date + time (`22 kwi, 14:32`) on the right,
And the secondary line shows the validated prices inline (e.g. `PB 95: 5.89  ON: 6.15  LPG: 3.09`),
And no status pill is rendered (presence of prices is the confirmation).

**AC4 — Minimal rejected rendering:**
Given a submission is `rejected` (any `flag_reason`),
When the row renders,
Then the secondary line is just a grey em-dash `—` — no copy, no amber hint, no call-to-action.
Rationale: we don't yet know how often rejection happens or which reasons dominate. Once the pipeline metrics show it's common enough to matter, a follow-up story will add actionable copy per reason.

**AC5 — Simple pending marker:**
Given a submission is `pending`,
When the row renders,
Then the secondary line shows a subtle italic "W trakcie" in neutral-grey type — no pill background, no border, no icon.
No >1h grace-window copy, no "taking longer than expected" variant — that's deferred until we have data on how long pending typically lasts.

**AC6 — Row tap:**
Given a submission has a matched `station_id` (verified rows),
When the driver taps the row,
Then the map tab opens centred on that station with its price sheet pre-opened.
For pending or rejected/unmatched rows, **tap is a no-op** (no navigation, no feedback) — revisit once AC4 gains actionable copy.

**AC7 — No streak, no leaderboard, no savings:**
This story does not introduce daily-streak pressure, leaderboards, community-impact numbers, or savings estimates. Those are deferred — see "Future enhancements" below.

---

## Implementation Notes

### Files to touch

- `apps/mobile/app/(app)/activity.tsx` — main component rewrite
- `apps/mobile/src/components/activity/SummaryHeader.tsx` — new
- `apps/mobile/src/components/activity/SubmissionRow.tsx` — extracted from activity.tsx for readability
- `apps/mobile/src/i18n/locales/pl.ts` / `en.ts` / `uk.ts` — new `activity.*` keys

### Derived fields on the client

- `verifiedCount` = number of submissions with `status === 'verified'`
- `stationsCovered` = unique `station_id` count across verified submissions only
- `firstContributionDate` = earliest `created_at` across loaded submissions (paginate-aware — if the oldest page isn't loaded, label it as "Aktywny od X+", where X is the earliest loaded)

### i18n keys (PL / EN / UK — full set in implementation)

Plural forms follow CLDR rules (`_one` / `_few` / `_many` for PL + UK; `_one` / `_other` for EN). Labels carry only the noun — the count is rendered separately as the big stat value.

```
activity.summary.submissions_one / _few / _many   # "zgłoszenie" / "zgłoszenia" / "zgłoszeń"
activity.summary.stations_one / _few / _many      # "stacja" / "stacje" / "stacji"
activity.summary.activeSince:         "Aktywny od {{date}}"
activity.summary.activeSinceApprox:   "Aktywny od {{date}}+"
activity.stationUnrecognised:         "Stacja nierozpoznana"
activity.pendingShort:                "W trakcie"
```

No rejection-copy keys in v1 — rejected rows just render an em-dash.

### Testing

- Mobile has no test runner configured; manual smoke-test per AC in the device.
- One unit-testable bit worth extracting: a pure `deriveSummary(submissions)` helper that returns `{ verifiedCount, stationsCovered, activeSince }`. Add a `.spec.ts` for that if we stand up Jest for mobile.

### Definition of Done

- Activity screen no longer shows pipeline jargon for verified submissions
- Station fallback is `Stacja nierozpoznana`, never identical to a status string
- Summary header renders exactly three signals (verified count, stations, since)
- Verified rows show prices inline without a status pill
- Pending rows show a tiny italic "W trakcie"
- Rejected rows show a grey em-dash `—` only (no hints, no copy)
- Tap on a verified row opens the station on the map; tap on pending/rejected is a no-op
- Manual smoke on PL locale at minimum; EN / UK keys present even if not manually tested

---

## Deferred — revisit once we know processing %

Explicitly cut from v1 to keep scope tight. We'll earn each of these back with data from `admin/metrics/pipeline successRate1h` and rejection-reason breakdown. Gate each on **a concrete signal**, not a calendar date:

- **Fuel-coverage chips** (PB 95 / PB 98 / ON / ON+ / LPG row on the summary card). Defer until we have ≥2 weeks of real submissions to know whether the completionist nudge is motivating or just visual clutter.
- **Actionable rejection hints** ("Nie dopasowano stacji — zgłoś ponownie przy stacji", "Brak GPS — włącz lokalizację"). Defer until pipeline metrics show rejection rate is high enough that it's worth sending drivers to the capture flow. If rejections are rare we don't want to amplify them visually.
- **Pending grace copy** ("W trakcie dłużej niż zwykle — sprawdź za chwilę" after >1h). Defer until we have data on p95 pending duration — otherwise the threshold is a guess.
- **Tap-to-retry on rejected/unmatched rows** — coupled to the actionable hints above.
- **Collapse / summarise repeated failures** (e.g. "4 nieudanych zgłoszeń ze Stacji nierozpoznanej") — only worth building if rejection rate is high.

## Future Enhancements (Phase 2 stories that already exist)

These came up in the 2026-04-22 brainstorm and are explicitly out of scope here. Each belongs to a story that already exists:

- **Community impact copy** ("twoje zgłoszenia pomogły X kierowcom") — requires impression tracking from the map / station detail surfaces. Fold into **Epic 4 analytics (Story 4.7–4.8 family)** or **Story 6.8 (Notification & engagement analytics)** once Phase 2 analytics land. Honest numbers only — no fabricated counters.
- **Personal savings estimate** ("zaoszczędziłeś ~X zł") — requires fill-up tracking and per-vehicle consumption data. Natural fit for **Story 5.5 (Personal History & Summaries)** and **Story 5.3 (Savings vs Area Average Calculation)**. The Activity screen can surface a small "Savings this month" badge once 5.3 data is flowing.
- **Leaderboard / ranking** ("Top 10% kontrybutorów w Łodzi") — requires the aggregation + privacy UX in **Story 6.7 (Savings Leaderboard)**. Activity screen can then show a compact "Twoja pozycja: #N w Łodzi" pill.
- **Streak / habit loops** — intentionally skipped. Fuel purchases aren't daily; forcing a daily-streak mental model would produce unhealthy pressure and incentivise low-quality contributions.

---

## References

- 3-2 offline queue: `_bmad-output/implementation-artifacts/3-2-immediate-confirmation-offline-queue.md`
- 5-5 personal history: `_bmad-output/implementation-artifacts/5-5-personal-history-summaries.md` — related but about **fill-ups**, not **submissions**. Both screens may converge later.
- 6-7 leaderboard: `_bmad-output/implementation-artifacts/6-7-savings-leaderboard.md`
- Field-test context: `project_alpha_field_test_2026_04_21.md` memory
