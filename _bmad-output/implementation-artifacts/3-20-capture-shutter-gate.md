# Story 3.20: Capture Shutter Gate + GPS-State UI + Capture Telemetry

Status: ready-for-dev

**Trigger:** 2026-05-08 — operator observation. The current capture flow ([apps/mobile/app/(app)/capture.tsx](apps/mobile/app/(app)/capture.tsx)) lets the user press the shutter at any time, including before GPS has acquired. Photos taken in that window arrive at the backend with `gpsLat/gpsLng = undefined`, the station-match step has nothing to match against, and the submission is rejected with `no_gps_coordinates` or `no_station_match`. From the driver's perspective the photo is "lost" — they don't know why, and (post 6.10) it doesn't extend their premium alerts. We want to close the most common cause of these losses without adding meaningful friction for healthy-GPS users.

**Phase:** 1 (pre-launch UX). Not gated by `flags.phase2` — this is a baseline capture-flow improvement, ships universally.

**Coupled stories already shipped:**
- 3.4 — GPS-to-station matching backend.
- 3.6 — Logo recognition (provides the brand signal that 3.21 will leverage).
- 3.17 — Activity-row tap-to-explain modal already includes copy for `no_gps_coordinates` and `no_station_match`.

**Coupled stories still spec-only (relevant adjacencies):**
- 3.21 — Retroactive station picker on activity screen for `no_station_match` rows. Builds on the telemetry fields added here.
- 6.10 — Thank-you modal copy already references the alerts-loop. AC8 of this story patches that copy to set the "only verified photos extend alerts" expectation.

---

## Story

As a **driver**,
I want the camera to wait briefly for GPS before letting me press the shutter, with a fast escape hatch if the lock is taking too long, and a clear signal in my activity log when a submission ended up unmatched,
so that the photos I take get matched to a station as often as possible — and when they don't, I know why and what to do.

### Why

The current shutter has no GPS gate. Anecdotally and from the alpha test, drivers tap the shutter as soon as the camera previews — typically faster than GPS first-fix on a cold open. Result:

- Many submissions arrive without GPS, hit the no-station-match path, and are rejected.
- Driver doesn't know why. They submitted in good faith.
- Post-6.10: the rejected submission doesn't extend their premium alerts. Doubly confusing.

The fix is a **soft 6-second gate** on the shutter: while GPS is still acquiring, the shutter is disabled with a clear "searching" state. Most modern phones acquire a first GPS fix within 2-4 seconds outdoors — the gate is invisible to the majority. After 6 seconds, the gate releases unconditionally with an "override" state and the photo goes through with whatever signals we have. Driver in a tunnel / parking garage / canopy gets through fast; driver with a clean sky barely notices.

Combined with the telemetry fields added here, we'll know post-launch:
- How often the gate actually fires (`gps_acquired_at_capture`).
- How long users wait on average (`gps_acquisition_ms`).
- How often the override path is hit (`override_used`).
- Whether disambiguation is rare or common (`nearby_stations_count` distribution).

That data tunes the timeout and informs whether 3.21 (retroactive picker) is worth building.

---

## Acceptance Criteria

**AC1 — Shutter disabled while GPS is acquiring:**
Given the user is on the capture screen and GPS has not yet been acquired (`location` from `useLocation` is null),
When the screen is rendered,
Then the shutter button is rendered in a `disabled` visual state (greyed, reduced opacity),
And tapping the shutter does nothing while in this state,
And the existing `gpsIndicator` text shows *"Locating..."* (PL: *"Szukam stacji w pobliżu..."*) so the disabled state is explained,
And a small spinner or pulse animation accompanies the indicator (visual signal that progress is happening, not stuck).

**AC2 — Shutter enabled as soon as GPS is acquired:**
Given GPS acquires (`location` becomes non-null),
When the next render runs,
Then the shutter is enabled,
And the `gpsIndicator` updates to one of:
- `📍 <station name> · <distance>m` (1 nearby station within `NEARBY_RADIUS_M`)
- `📍 Brak stacji w pobliżu` (0 nearby) — distinct copy that signals "GPS got, but no station nearby; you can still take a photo, it will be reviewed manually"
- (no indicator text for ≥2 nearby — existing behaviour, disambiguation handles it post-capture)

The GPS-locked-but-no-nearby case is a legitimate user path (new station, remote location). Shutter must be enabled.

**AC3 — Override unlocks the shutter at 6 seconds:**
Given GPS still hasn't acquired after 6 seconds since the capture screen mounted (or since the last camera remount),
When the timer fires,
Then the shutter is enabled regardless of GPS state,
And the `gpsIndicator` updates to *"Brak GPS — możesz zrobić zdjęcie, sprawdzimy ręcznie"* (PL canonical) signalling the override is active,
And the visual state of the shutter button changes subtly (e.g., a small warning indicator) so the user knows they're proceeding without GPS,
And subsequent successful GPS acquisition replaces the override state with the normal locked state.

The 6-second constant lives in a single mobile constant `GPS_GATE_TIMEOUT_MS = 6000` so post-launch tuning is one-line.

**AC4 — Capture goes through cleanly with whatever signals exist:**
Given the user presses the shutter (whether GPS-locked or override),
When `handleCapture` fires,
Then the existing flow proceeds unchanged: photo capture → quality check → 0/1/2+ nearby station branching,
And `gpsLat/gpsLng` are passed through as `undefined` if no GPS was acquired (existing behaviour, preserved),
And the submission is enqueued via `enqueueSubmission` exactly as today.

This story does **not** change capture-or-submission logic — only the UI gate and the telemetry payload.

**AC5 — Telemetry fields captured per submission:**
Given a submission is enqueued,
When the payload is constructed,
Then the following four fields are included alongside the existing payload:

| Field | Type | Computed at submission time |
|---|---|---|
| `gps_acquired_at_capture` | `boolean` | `location != null` at the moment the user tapped the shutter |
| `gps_acquisition_ms` | `int \| null` | Elapsed ms from camera-screen mount to first GPS lock; `null` if never acquired |
| `override_used` | `boolean` | `true` if the shutter was enabled by the 6s timeout rather than by GPS lock |
| `nearby_stations_count` | `int` | The count from `captureNearbyStations` at the moment of capture (0/1/2+ — clamp at 99 to prevent absurd values from defensive bugs) |

The mobile client tracks the camera-screen mount timestamp and the GPS-lock timestamp via refs. Override-used is true when the user hits shutter while in the 6s+-elapsed-no-gps state.

**AC6 — Telemetry fields persisted on `Submission`:**
Given the submission reaches the backend,
When the `Submission` row is created,
Then the four new columns hold the values from the request payload:

```sql
gps_acquired_at_capture  BOOLEAN
gps_acquisition_ms       INTEGER
override_used            BOOLEAN
nearby_stations_count    INTEGER
```

All four nullable (rows from before this story have null), no default. Migration is additive, no backfill.

**AC7 — Submission with null GPS routes to `no_gps_coordinates`, not `no_station_match`:**
Given a submission arrives with `gpsLat = null` AND `gpsLng = null`,
When the photo-pipeline processes it,
Then the `flag_reason` is set to `no_gps_coordinates`,
And not `no_station_match` (which is reserved for the case where GPS exists but no station was within range).

The two reasons are already distinct in the 3.17 taxonomy with distinct copy. AC7 just enforces the routing so users see the right copy when tapping the activity row.

**AC8 — Thank-you modal copy adds the verified-only disclaimer:**
Given the post-capture confirm modal renders (existing in `apps/mobile/app/(app)/confirm.tsx`),
When the alerts-loop line shows ("Po weryfikacji zdjęcia uruchomimy/przedłużymy alerty premium na 30 dni" — added by 6.10),
Then a small footnote-style line follows: *"Tylko zweryfikowane zdjęcia przedłużają alerty"* (PL canonical),
And the line is visually subordinate (smaller, italic or muted) — it's a clarifier, not a primary message,
And the line renders in EN/UK locales correctly (translated and present in `Translations` type).

This sets honest expectation: a rejected submission doesn't move the alerts-active date.

**AC9 — Capture-screen reset clears the GPS-lock timestamp:**
Given the camera screen is re-mounted (focus regained, app returns from background, manual remount via existing watchdog),
When the existing `useFocusEffect` reset logic runs,
Then the GPS-acquisition timer is reset to the new mount time,
And `override_used` is reset to false,
And the existing GPS-acquired timestamp from the previous session is **not** carried over — each fresh mount measures its own acquisition time.

This keeps telemetry honest: a user who switched apps for 30 minutes and came back doesn't have a 30-minute GPS acquisition time.

**AC10 — Per-submission telemetry visible in admin firehose detail:**
Given an admin views a submission detail page (existing surface from 3.18),
When the submission has telemetry fields populated,
Then the four fields render as additional rows in the existing detail card, with copy:

```
GPS at capture:        Yes / No
GPS acquisition time:  N ms (or "—")
Override used:         Yes / No
Nearby stations:       N
```

For pre-3.20 submissions (all four null), the section is omitted entirely — no clutter for legacy data.

---

## Tasks

### Backend (T1–T3)

**T1 — Schema + migration:**
- Add the four columns to the `Submission` model in `packages/db/prisma/schema.prisma` per AC6.
- Migration `20260509000000_add_submission_capture_telemetry` (or next available timestamp). Single `ALTER TABLE` adding all four columns.
- No backfill, no defaults — null is the legitimate "we don't know" state for pre-existing rows.

**T2 — Submissions API accepts and persists the telemetry fields:**
- Locate the submissions create endpoint (mobile-side `enqueueSubmission` payload → backend route).
- Add the four optional fields to the request DTO (with class-validator: `@IsBoolean()` / `@IsInt() @IsOptional()`, `@Min(0)` / `@Max(...)` reasonable bounds for the int fields).
- Persist them on the created `Submission` row.
- Existing tests should continue to pass; add one test that asserts the fields are written when present in the request, and another that they default to null when absent.

**T3 — Photo-pipeline `flag_reason` routing for null-GPS:**
- Audit the photo-pipeline path that sets `flag_reason` for failed station matches.
- Ensure: if `submission.gps_lat === null AND submission.gps_lng === null` → `flag_reason = 'no_gps_coordinates'`. Else if station match fails for other reasons → `flag_reason = 'no_station_match'` (existing behaviour).
- Test: submit a row with null GPS, assert `flag_reason === 'no_gps_coordinates'`.

### Mobile UI (T4–T7)

**T4 — `useLocation` hook exposes acquisition timestamp:**
- Modify `apps/mobile/src/hooks/useLocation.ts` to expose the timestamp at which the first GPS fix was returned (or null if none yet).
- Use a ref + state pattern: when `location` first becomes non-null, capture `Date.now()` into a ref and surface as `gpsAcquiredAt`.
- Reset on hook re-mount or when an explicit reset is triggered (T6 will call this on focus).

**T5 — `GPS_GATE_TIMEOUT_MS` constant + override-state logic in capture screen:**
- Add `const GPS_GATE_TIMEOUT_MS = 6000` to `capture.tsx`.
- Add state: `gateMountedAt` (ref to `Date.now()` set on screen focus / remount), `overrideActive` (boolean, computed from `Date.now() - gateMountedAt >= GPS_GATE_TIMEOUT_MS && location == null`).
- A re-render trigger fires the override after 6s — `setTimeout(rerender, 6000)` on mount; clear on GPS lock or unmount.
- Shutter `disabled` prop: `!location && !overrideActive`.
- `gpsIndicator` text: existing logic + new override copy when in override state.
- Wire the timer reset into `useFocusEffect` (already present at line 175+).

**T6 — Telemetry payload at submission time:**
- In `handleCapture`, compute the four fields from screen state:
  - `gps_acquired_at_capture`: `location != null` at this moment
  - `gps_acquisition_ms`: from `useLocation`'s `gpsAcquiredAt` ref minus the screen-mount timestamp; null if not acquired
  - `override_used`: did the shutter fire while `overrideActive` was true? (track via a `wasOverride` boolean that flips when the user taps shutter under override)
  - `nearby_stations_count`: `captureNearbyStations.length` (clamped at 99)
- Pass these into `enqueueSubmission` payload alongside existing fields.

**T7 — Visual feedback for the GPS gate:**
- Disabled shutter button: visual difference (reduced opacity, no press feedback).
- GPS-acquiring indicator: existing `gpsIndicator` text plus a subtle 12-16px spinner OR a pulsing dot before the "Szukam..." text.
- Override-active indicator: a small ⚠ warning glyph next to the indicator text + slightly different shutter colour to telegraph "you're proceeding without GPS".
- Disambiguation sheet (existing) and quality-check screen (existing) need no change.

### Admin UI (T8)

**T8 — Surface telemetry on firehose detail page:**
- Modify `apps/admin/app/(protected)/submissions/[id]/page.tsx` (the detail page from 3.18).
- Add a conditional block (only renders if at least one of the four fields is non-null on the submission) showing the four rows per AC10.
- Update `FlaggedSubmissionDetail` in `apps/admin/lib/types.ts` to include the four fields as optional.
- Update `getStationDetail` (no — this is the *submission* detail, not station). The submission `getDetail` in `apps/api/src/admin/admin-submissions.service.ts` needs to select the four new columns.
- i18n keys for the four labels in PL/EN/UK.

### i18n (T9)

**T9 — Mobile + admin translations:**
- Mobile (`apps/mobile/src/i18n/locales/{pl,en,uk}.ts`):
  - `contribution.gpsLocating` (already exists; verify spinner-friendly copy)
  - `contribution.gpsNoNearby` ("Brak stacji w pobliżu")
  - `contribution.gpsOverride` ("Brak GPS — możesz zrobić zdjęcie, sprawdzimy ręcznie")
  - `contribution.alertsVerifiedOnlyDisclaimer` ("Tylko zweryfikowane zdjęcia przedłużają alerty") — used in confirm modal AC8
- Admin (`apps/admin/lib/i18n.ts`): four new label keys for the firehose detail rows.
- Type definitions updated.

### Code review (T10)

**T10 — Run `bmad-code-review`.** Focus areas:
- T5 timer cleanup — does the override-firing `setTimeout` get cleared on every dependency change? Memory leak risk on rapid focus/blur.
- T4 `useLocation` change — backwards-compatible? Does any existing consumer break on the new shape?
- T6 `wasOverride` flag — race condition between override timer firing and user tapping shutter at the same time? (Should be fine since both happen on the JS thread, but worth a defensive check.)
- AC9 reset logic — does the activity-screen banner from 6.10 get re-triggered if the screen-mount-reset logic accidentally bumps something it shouldn't?
- T2 DTO validation — what does the backend do if a malicious client sends `nearby_stations_count: 999999`? The clamp on the mobile side is one defence; backend `@Max()` should be the second.
- T3 flag_reason routing — verify all the paths that lead to a station-match failure get the right reason. Are there any internal-error paths that wrongly attribute a system bug to "no_gps_coordinates"?

---

## Out of Scope

- **Retroactive station picker** — Story 3.21.
- **Aggregate metrics dashboard** — deferred, see "Optional follow-up" below.
- **Improving the station-match accuracy itself** — this story doesn't touch the matching algorithm. We're closing one cause of failure (no GPS at all), not making the algorithm smarter.
- **Push notification tied to capture failure** — drivers see the failure on activity screen via 3.17's tap-to-explain. Adding a push for it would be noisy.
- **Pre-emptive GPS warm-up before camera screen** — a "tap to take photo" home-screen FAB that starts location acquisition early would shave 1-2s. Cute but introduces complexity (location prompt timing, battery). Defer.
- **Different timeout per platform / device class** — single 6s for everyone. Tune from telemetry post-launch.

---

## Optional follow-up (not part of this story)

**Aggregate metrics tile on admin /metrics**: surface p50/p95 GPS acquisition time, % override-used rate, nearby-stations-count distribution. ~1-2h. Build only if the per-submission view doesn't answer operational questions post-launch.

---

## Notes for the implementer

- **The current `gpsIndicator` already does most of the descriptive work** — it shows "Locating..." when `location == null`. Adding the override state means tracking elapsed time since mount and surfacing different copy when timeout has fired.
- **The shutter button itself is at line 484 of capture.tsx** (per the grep). Disabled state is just a prop the existing button needs to respect.
- **Test data for the disambiguation case** — the existing `StationDisambiguationSheet` handles ≥2 nearby. This story doesn't touch that path; the gate releases as soon as any GPS is acquired regardless of nearby station count.
- **Telemetry privacy** — the four fields are diagnostic, not personal. They reveal nothing more than already-known submission timing. Privacy policy doesn't strictly need an update for these, but consider mentioning "submission diagnostics" in the next legal-doc refresh.
- **Migration applied manually per `project_staging_predeploy_broken`** — run `prisma migrate deploy` against staging then prod after merging.
- **6.10's spec file gets a small AC8 update** (adding the disclaimer line). Either patch 6.10 in this story's PR for coherence, or leave 6.10 as-is and let the Phase 2 chat absorb the disclaimer when they implement 6.10. Small enough to do here — recommend patching 6.10 in this PR with a one-line copy addition.
