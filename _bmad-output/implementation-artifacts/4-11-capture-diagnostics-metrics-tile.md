# Story 4.11: Capture Diagnostics Metrics Tile

Status: ready-for-dev (deferrable — see "When to build this")

**Trigger:** 2026-05-08 — follow-up to Story 3.20 (capture shutter gate + telemetry). Story 3.20 added four telemetry columns on `Submission` (`gps_acquired_at_capture`, `gps_acquisition_ms`, `override_used`, `nearby_stations_count`) and surfaced them per-row on the firehose detail page. Per-submission view answers "what happened on THIS submission"; an aggregate dashboard answers "are the gate timeout and override path actually doing the right thing across all our users?" — which the per-row view can't.

This story adds an aggregate tile to the existing admin `/metrics` page so we can:
- Confirm the 6-second `GPS_GATE_TIMEOUT_MS` is well-tuned (most users don't hit override).
- See whether `no_station_match` rates are high enough to justify building Story 3.21.
- Catch regressions if a future change degrades GPS acquisition time.

**Phase:** 1 (operability). Not gated by `flags.phase2` — admin-only diagnostic surface.

**Coupled stories already shipped:**
- 3.20 — provides the four telemetry columns this tile aggregates.

**Coupled stories spec-only:**
- 4.6 — broader Pipeline Health / Contribution Funnel dashboard. Could absorb this tile; we're shipping standalone so it's not blocked by the larger 4.6 build.
- 3.21 — retroactive station picker. The metrics this tile surfaces are exactly what determines whether 3.21 is worth building.

---

## Story

As an **ops admin**,
I want an aggregate view of how the capture screen's GPS gate is performing across all submissions,
so that I can tune the timeout, decide whether to build the retroactive station picker (Story 3.21), and catch regressions in GPS acquisition behaviour.

### Why

The 3.20 telemetry is high-value but only useful in aggregate. Per-submission views show one driver's experience; the operator needs distributions:

- p50 / p95 of `gps_acquisition_ms` — is 6s the right gate timeout, or should we tighten/loosen?
- % of submissions where `override_used = true` — is the escape hatch actually getting used (signalling bad-GPS environments), or is it dormant (signalling the gate is too short)?
- % of submissions where `gps_acquired_at_capture = false` — even after the 6s gate, this is the "we lost GPS at the critical moment" rate.
- Distribution of `nearby_stations_count` (0 / 1 / 2-5 / 6+) — validates how often disambiguation actually matters.

Combined with the existing `flag_reason` distribution (which the firehose page exposes via filtering), the operator can decide:
- "Override-used is 0.5% — gate is fine, no action."
- "Override-used is 30% — gate is too short, drivers are bypassing it; consider loosening to 8s."
- "no_station_match is 8% — build Story 3.21 (retroactive picker)."

Without this aggregate view, those decisions are guesswork or require ad-hoc SQL queries from the dev side.

---

## Acceptance Criteria

**AC1 — Tile appears on `/metrics` admin page:**
Given an admin opens `/metrics`,
When the page renders,
Then a new "Capture diagnostics" tile is visible alongside the existing tiles,
And the tile is scoped to admin-only (existing layout-level role guard).

**AC2 — Tile shows 4 aggregate panels for a configurable time window:**
Given the tile renders,
When the admin selects a time-window (default: last 7 days; options: today, last 7 days, last 30 days),
Then the tile shows four panels computed across submissions in that window:

**Panel 1 — GPS acquisition time distribution:**
- p50, p95, p99 of `gps_acquisition_ms` (rendered as e.g. *"p50: 2,400 ms · p95: 5,800 ms · p99: 8,100 ms"*).
- Sample count and % of submissions with non-null `gps_acquisition_ms` (i.e., GPS was acquired during the capture session — null cases are users who hit override before any fix).

**Panel 2 — Override-used rate:**
- `% of submissions where override_used = true`, with absolute count.
- For context: *"X out of Y submissions in the window pressed the shutter without GPS lock."*

**Panel 3 — GPS-at-capture rate:**
- `% of submissions where gps_acquired_at_capture = true`, with absolute count.
- This is a slightly different metric from override (override = gate timed out; gps_acquired_at_capture = GPS was non-null at the moment of shutter, regardless of how the gate behaved). They co-exist: a user could override AND then GPS arrives BEFORE shutter press.

**Panel 4 — Nearby-stations distribution:**
- Histogram bucket counts for `nearby_stations_count`: `0`, `1`, `2-5`, `6+`. Total sums to total submissions in window with non-null count.

**AC3 — Pre-3.20 submissions excluded from aggregates:**
Given some submissions in the window are pre-3.20 (all four telemetry fields null),
When the aggregates compute,
Then those submissions are **excluded from numerators and denominators** (they have no signal — including them would distort percentages),
And the tile shows a small footer count: *"Based on N of M submissions in this window with telemetry data"* — operator sees the data scope clearly.

**AC4 — Empty-window handling:**
Given the time window contains zero submissions with telemetry (e.g., admin selects "today" before any 3.20-instrumented submission has landed),
When the tile renders,
Then it shows an empty-state message *"No capture diagnostics data for this window yet"* — no broken percentages or NaN values.

**AC5 — Backend endpoint:**
Given an admin client calls `GET /v1/admin/metrics/capture-diagnostics?window=7d`,
When the endpoint handler runs,
Then it returns:

```ts
{
  window: '1d' | '7d' | '30d',
  total_submissions_in_window: number,           // all submissions, telemetry or not
  submissions_with_telemetry: number,            // denominator for percentages
  gps_acquisition_ms: {
    p50: number | null,
    p95: number | null,
    p99: number | null,
    sample_count: number,                        // count where gps_acquisition_ms IS NOT NULL
  },
  override_used_pct: number | null,              // null when sample_count = 0
  override_used_count: number,
  gps_acquired_at_capture_pct: number | null,
  gps_acquired_at_capture_count: number,
  nearby_stations_distribution: {
    bucket_0: number,
    bucket_1: number,
    bucket_2_to_5: number,
    bucket_6_plus: number,
  },
}
```

Implementation: single SQL query using PostgreSQL percentile_cont for p50/p95/p99 + COUNT FILTER (WHERE …) for the boolean rates + CASE-bucketed counts for the distribution. Single round-trip; no N+1.

**AC6 — Endpoint scoped to admin role:**
Given a non-admin user calls the endpoint,
Then the request returns `403 Forbidden`,
And the existing `@Roles(UserRole.ADMIN)` class-level guard pattern is reused.

**AC7 — i18n on PL/EN/UK + Translations type:**
Given the new tile copy (panel titles, time-window selector labels, empty-state, footer count),
When admin renders,
Then PL canonical, EN/UK translated and present in `Translations` type, type-check fails on missing keys.

---

## Tasks

### Backend (T1–T2)

**T1 — `getCaptureDiagnostics(window)` service method:**
- New method on whichever service owns `/metrics` endpoints — likely `AdminMetricsService` or similar (audit existing structure; if no metrics service exists yet, create one).
- Single SQL query via `prisma.$queryRaw`. Sketch:

```sql
WITH bounds AS (
  SELECT
    NOW() - $1::interval AS window_start
)
SELECT
  COUNT(*) AS total_submissions_in_window,
  COUNT(*) FILTER (
    WHERE gps_acquired_at_capture IS NOT NULL
       OR override_used IS NOT NULL
       OR gps_acquisition_ms IS NOT NULL
       OR nearby_stations_count IS NOT NULL
  ) AS submissions_with_telemetry,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gps_acquisition_ms)
    FILTER (WHERE gps_acquisition_ms IS NOT NULL) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY gps_acquisition_ms)
    FILTER (WHERE gps_acquisition_ms IS NOT NULL) AS p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY gps_acquisition_ms)
    FILTER (WHERE gps_acquisition_ms IS NOT NULL) AS p99_ms,
  COUNT(*) FILTER (WHERE gps_acquisition_ms IS NOT NULL) AS gps_ms_sample_count,
  COUNT(*) FILTER (WHERE override_used = true) AS override_used_count,
  COUNT(*) FILTER (WHERE gps_acquired_at_capture = true) AS gps_acquired_at_capture_count,
  COUNT(*) FILTER (WHERE nearby_stations_count = 0) AS bucket_0,
  COUNT(*) FILTER (WHERE nearby_stations_count = 1) AS bucket_1,
  COUNT(*) FILTER (WHERE nearby_stations_count BETWEEN 2 AND 5) AS bucket_2_to_5,
  COUNT(*) FILTER (WHERE nearby_stations_count >= 6) AS bucket_6_plus
FROM "Submission", bounds
WHERE created_at >= bounds.window_start
```

- Map the result into the response shape per AC5. Compute pct fields client-side (or in service): `override_used_pct = override_used_count / submissions_with_telemetry`. Return `null` when denominator is 0 (AC4).
- Window param: accept `'1d'`, `'7d'`, `'30d'` strings; map to `INTERVAL '1 day'` etc. Default to `'7d'` if absent.

**T2 — `GET /v1/admin/metrics/capture-diagnostics` controller endpoint:**
- New endpoint on whichever metrics controller exists (or a new one if none).
- Query param `window` validated against allowed values; reject others with 400.
- `@Roles(UserRole.ADMIN)` class-level.
- Tests: window default is `'7d'`; invalid window rejected; admin role enforced; empty-window returns the structured zero-state.

### Admin UI (T3–T4)

**T3 — `CaptureDiagnosticsTile.tsx` component:**
- New component in `apps/admin/app/(protected)/metrics/` (or wherever `/metrics` page lives).
- Time-window dropdown / segmented control (today / 7d / 30d).
- Four-panel layout: GPS acquisition stats / override rate / GPS-at-capture rate / nearby stations distribution.
- Fetches via `adminFetch<CaptureDiagnosticsResult>('/v1/admin/metrics/capture-diagnostics?window=' + window)`.
- Loading state, error state, empty state per AC4.
- Re-fetches on window change.

**T4 — Wire into the metrics page:**
- Find the existing `/metrics` page route and its tile layout.
- Add the new tile alongside existing ones (no specific position requirement — alphabetical / by-section is fine).
- If no `/metrics` page exists yet, this story has a hidden dependency on Story 4.6 — flag and stop. Audit before starting T3.

### i18n (T5)

**T5 — Translations + Translations type:**
- New keys for: tile title, four panel titles, window labels (today / last 7 days / last 30 days), empty-state, footer scope-count copy.
- PL canonical, EN + UK translated.
- `Translations` type updated.

### Code review (T6)

**T6 — Run `bmad-code-review` after dev complete.** Focus areas:
- T1 SQL: PostgreSQL window-function syntax verified; PERCENTILE_CONT requires an ordered-set aggregate, syntax can be subtle. Test against a real DB before claiming it works.
- T1 SQL: index on `Submission.created_at`? Likely already exists for the existing user-submission queries; verify the metrics window range query is indexed.
- T1 zero-row case: PERCENTILE_CONT returns null on empty input; handle on the JS side rather than letting it propagate as a SQL "no rows" error.
- T2 admin role: tests cover 403 for non-admin?
- T3 empty-state: when `submissions_with_telemetry = 0`, the four panels should ALL show empty (not just one).
- T3 percentages rounded to 1 decimal place (e.g. "12.4%", not "12.387654%") — sanity check.
- AC4 / T3: a window with zero submissions overall vs zero telemetry-bearing submissions — both should show empty-state, not a misleading "100% of 0".

---

## Out of Scope

- **Time-series charts** (sparkline of p95 over the last 30 days) — single time-window snapshots only. Add later if operators want to track regressions over time.
- **Per-fuel / per-region breakdown** of these metrics — single global view. Could add filters in a follow-up if Łódź-vs-Warsaw GPS performance becomes a real concern.
- **Real-time updates / websockets** — page refresh is fine.
- **Alerting on diagnostic regressions** — manual review only. If we want "p95 jumped 50%" alerts, that's a separate observability story.
- **Admin-tunable `GPS_GATE_TIMEOUT_MS` from this UI** — the constant is mobile-side; no remote config. Tuning means a code change + app store rollout regardless.
- **Heatmap of GPS-failure locations on a map** — interesting but tied to gps_lat/gps_lng which are nulled on station-match per GDPR, so we can only see this for unmatched submissions (where we keep them). Defer.

---

## When to build this

This story is **deferrable**. Build only after 3.20 has been in production for at least 7-14 days, by which point:
- Telemetry rows have accumulated to make percentile computations meaningful (rule of thumb: ≥ 200 submissions with non-null `gps_acquisition_ms` for the p99 to be stable).
- The per-submission firehose view will have already surfaced any obvious issues; the aggregate tile answers the questions that can't be answered one-row-at-a-time.

Worth noting: Story 4.6 (Pipeline Health dashboard) covers similar territory at a much broader scope. If 4.6 is on the near-term roadmap, this story can be folded into it as one of its Pipeline Health panels rather than shipped standalone. **Defer this decision until we know whether 4.6 ships first or this tile ships first.**

---

## Notes for the implementer

- **No new schema changes.** All four telemetry columns already exist from 3.20.
- **Time-window enum**: keep it small (today / 7d / 30d). More options invite scope creep ("custom range", "this month", etc.). Add only when a real need surfaces.
- **Percentile null-handling**: PostgreSQL `PERCENTILE_CONT` with no rows returns `null`, not `0`. The JS layer must handle `p50_ms === null` gracefully.
- **Sample count vs total**: be explicit in the UI which denominator each percentage uses. `override_used_pct` is over `submissions_with_telemetry`; `p95` is over `gps_ms_sample_count` (the subset where GPS actually acquired). Mixing these in copy without labels is misleading.
- **Index check**: verify there's a `Submission(created_at)` index — the metrics window query is a range scan and benefits from one. If missing, this story needs a small migration to add it.
- **No migration needed in this story** if the index already exists — the schema is unchanged otherwise.
- **Polish-only is fine for v1** — admins who need this are operating internally. EN/UK translations follow the existing per-key pattern but lower-priority.
