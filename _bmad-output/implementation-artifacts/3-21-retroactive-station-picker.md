# Story 3.21: Retroactive Station Picker for Unmatched Submissions

Status: ready-for-dev (deferrable — see below)

**Trigger:** 2026-05-08 — follow-up to 3.20 (capture shutter gate). Even with the 6-second GPS gate and override path, some submissions will land with `flag_reason = no_station_match` (GPS acquired but no station within radius — new station, badly-mapped area) or `no_gps_coordinates` (override used). Today, the only path forward for the driver is "retake at a station" via the 3.17 tap-to-explain CTA. That throws away the photo even when the driver could pick the correct station from memory.

This story gives the driver a "Pick a station" affordance on those activity rows so the photo can be rescued with a manual station selection.

**Phase:** 1 (pre-launch UX, but **deferrable**). See "When to build this" below — wait until 3.20 ships and we have telemetry on actual `no_station_match` / `no_gps_coordinates` rates. If they're rare in practice, this story doesn't carry weight.

**Coupled stories already shipped:**
- 3.6 — Logo recognition (provides the brand signal we use for filtering).
- 3.17 — Activity-row tap-to-explain modal (this story extends the CTA branch for these flag reasons).

**Coupled stories spec-only:**
- 3.20 — Capture shutter gate + telemetry. **Hard prerequisite** — this story uses the GPS captured-at-submission-time and the brand from logo recognition, both established by 3.20's payload.

---

## Story

As a **driver**,
I want to manually pick the correct station for a submission that wasn't matched automatically, even after the photo has been processed,
so that my photo isn't wasted just because the GPS was off or the station wasn't in the nearby list.

### Why

Drivers know where they were. The system sometimes doesn't. With the current flow, a `no_station_match` submission is a dead end — the driver gets *"retake at a station"* copy and the photo is discarded. But the driver remembers exactly which station they were at; if we let them pick, the data flows through.

Three signals let us narrow the picker list so the driver isn't scrolling through every station in Poland:

1. **GPS at submission time** (even imprecise — accuracy radius could be 500m): centre a 5km radius search.
2. **Logo recognition** (3.6 already runs): if a confident brand was detected, filter to that brand.
3. **User-typed search** (always available): name or street.

Combined, the typical case becomes "5-15 candidate stations sorted by distance, brand-filtered if confident". Driver finds the right one in seconds.

For the genuinely-no-GPS case (override used → null GPS), we have no centre point. Fall back to the driver's **home voivodeship** (computed from their submission history) as a soft regional filter, plus search.

---

## Acceptance Criteria

**AC1 — "Pick a station" CTA on eligible activity rows:**
Given an activity-screen row whose status is `shadow_rejected` or `rejected` AND whose `flag_reason` is `no_station_match` or `no_gps_coordinates`,
When the user taps the row,
Then the existing tap-to-explain modal (3.17) opens with the existing reason copy,
And the existing CTA (`retake`) is replaced by **two** CTAs: *"Wybierz stację"* (primary) and *"Zrób nowe zdjęcie"* (secondary, routes to capture as today),
And tapping *"Wybierz stację"* opens the picker sheet (AC2).

For all other flag reasons, the CTA set is unchanged from 3.17.

**AC2 — Picker sheet with narrowed list:**
Given the picker sheet opens for a `no_station_match` submission,
When the sheet renders,
Then it queries `GET /v1/submissions/:id/station-candidates` (new endpoint, AC5) and renders the response as a scrollable list,
And each row shows: station name, address (truncated), brand badge, distance from submission GPS (if applicable),
And rows are sorted by distance ascending (or by name when no GPS),
And a search input at the top filters the list by name OR address (case-insensitive substring match) — local filter, no network roundtrip.

For a `no_gps_coordinates` submission, the same picker is used but the list is filtered by voivodeship-from-user-history (AC5).

**AC3 — Confirm + submit station selection:**
Given the user has tapped a station in the picker,
When the row's tap fires,
Then a confirmation prompt asks *"Czy na pewno wybierasz <station_name>?"* (lightweight — toast or inline confirmation, not a full modal),
And on confirm, the client calls `POST /v1/submissions/:id/assign-station` with `{ stationId }`,
And on success, the picker closes, the activity row updates locally to reflect the new state (AC6), and a brief toast confirms *"Stacja przypisana — sprawdzimy zdjęcie ponownie"*.

**AC4 — Backend reassignment + reprocessing:**
Given the assign-station endpoint receives a valid request,
When the service handles it,
Then the submission's `station_id` is set to the chosen station,
And `flag_reason` is cleared (set to null),
And `status` transitions back to `pending` so the photo-pipeline reprocesses with the new station (validation rules still apply — bad prices still get flagged for the right reasons),
And an `AdminAuditLog` row is written with action `USER_ASSIGNED_STATION` and notes JSON `{ submissionId, oldStationId: null, newStationId, oldFlagReason }`,
And re-enqueueing into the photo-pipeline happens transactionally with the status flip (or as a follow-up step in the same async sequence — same pattern as Story 3.20 T2).

**AC5 — Station candidates endpoint:**
Given a driver calls `GET /v1/submissions/:id/station-candidates`,
When the endpoint handler runs,
Then it returns `{ candidates: StationCandidate[], strategy: 'gps' | 'voivodeship' | 'logo' | 'fallback' }`,
And the strategy reflects which signals were available:

| Strategy | Trigger | List composition |
|---|---|---|
| `gps+logo` | submission has GPS AND confident brand from logo recognition | stations within 5km, filtered by brand, sorted by distance |
| `gps` | submission has GPS, no confident brand | stations within 5km, all brands, sorted by distance |
| `voivodeship+logo` | no GPS, confident brand | stations in user's home voivodeship, filtered by brand |
| `voivodeship` | no GPS, no brand | stations in user's home voivodeship |
| `fallback` | no GPS, no voivodeship history | top 50 stations by submission count nationally — driver will likely use search |

`StationCandidate { id, name, address, brand, distance_meters?: number, voivodeship?: string }`.

Cap the response at 200 candidates max — drivers searching beyond that should use the search input.

**AC6 — Activity row reflects post-assignment state:**
Given the user just assigned a station via the picker,
When the activity screen re-renders (e.g., after picker dismissal triggers a re-fetch),
Then the row shows the new station name + status `pending` (since reprocessing is now in flight),
And the inline italic copy reflects pending status (existing 3.17 copy: "Pending review" or similar — generic pending),
And the user can tap the row to see this updated state (no longer surfaces the `no_station_match` modal).

**AC7 — Permission scoping on assign-station:**
Given a driver attempts to call `POST /v1/submissions/:id/assign-station` for a submission they don't own,
When the request reaches the controller,
Then it returns `404 Not Found` (don't leak the existence of other users' submissions),
And only submissions in `shadow_rejected` or `rejected` status with the eligible flag reasons (`no_station_match` / `no_gps_coordinates`) accept the assignment — others return `409 Conflict`.

**AC8 — Search input across the picker list:**
Given the picker is rendered with N candidates,
When the user types into the search input,
Then the visible list filters live to candidates whose name OR address contains the query (case-insensitive),
And the strategy / sort order is preserved within the filtered subset,
And clearing the search restores the full list.

If the filtered list is empty, show inline copy *"Nie znaleziono stacji. Spróbuj innej nazwy lub ulicy."*

**AC9 — i18n coverage in PL/EN/UK + Translations type:**
All new copy strings (CTA labels, confirmation prompt, toast text, empty-search state, picker title, strategy-specific subtitles) are localised in PL canonical / EN / UK with type-checked keys.

---

## Tasks

### Backend (T1–T3)

**T1 — `GET /v1/submissions/:id/station-candidates` endpoint:**
- New route on the user-facing submissions controller (`apps/api/src/submissions/submissions.controller.ts`).
- Service method `getStationCandidatesForSubmission(submissionId, userId)`:
  1. Load submission. NotFound if missing or not owned by user. Conflict if status not eligible.
  2. Determine strategy:
     - `gps+logo` if `gps_lat/gps_lng` non-null AND submission has `detected_brand` non-null (logo recognition output)
     - `gps` if GPS only
     - `voivodeship+logo` if no GPS but brand
     - `voivodeship` if no GPS, no brand, but user has prior submissions to derive voivodeship
     - `fallback` otherwise
  3. Build query per strategy. For GPS-based: PostGIS `ST_DWithin` query (5km radius). For voivodeship: filter by `Station.voivodeship`. For brand filter: `Station.brand = ?`. Add `LIMIT 200` cap.
  4. Compute distance for GPS strategies via PostGIS `ST_Distance`.
- Return shape per AC5.

**T2 — `POST /v1/submissions/:id/assign-station`:**
- New route on the same controller.
- Service method `assignStationToSubmission(submissionId, userId, stationId)`:
  1. Verify submission ownership + eligibility (status in `shadow_rejected/rejected`, flag_reason in `no_station_match/no_gps_coordinates`). NotFound / Conflict per AC7.
  2. Verify `stationId` exists in DB (don't accept arbitrary UUIDs).
  3. Transaction: update Submission `{ station_id, flag_reason: null, status: 'pending' }` + create AdminAuditLog row + re-enqueue to photo-pipeline.
  4. Return updated submission shape (matches existing `GET /v1/submissions/:id` if there is one — or the activity-list row shape).

**T3 — Photo-pipeline tolerates re-enqueued submissions:**
- Audit the photo-pipeline for behaviour when a submission with existing `station_id` and `status: pending` is enqueued.
- The existing flow should handle this: the pipeline runs OCR + validation + station-match (which is now trivial since station_id is preset). Verify no assertion or state-check blocks reprocessing.
- Tests: enqueue an already-processed submission, assert it lands in `verified` (or appropriate flag_reason if validation fails) without errors.

### Mobile UI (T4–T6)

**T4 — Activity-row CTA branching for the eligible flag reasons:**
- In the existing 3.17 tap-to-explain modal logic (`apps/mobile/src/components/activity/`), branch on `flag_reason`:
  - `no_station_match` / `no_gps_coordinates` → show **two CTAs**: primary *"Wybierz stację"* opens picker; secondary *"Zrób nowe zdjęcie"* keeps existing retake behaviour.
  - All other reasons → unchanged.
- Modal close behaviour and existing copy unchanged.

**T5 — Station picker sheet component:**
- New component `apps/mobile/src/components/activity/StationPickerSheet.tsx`.
- Modal slide-up sheet (matches existing FlagWrongConfirmSheet pattern from 3.14 / 3.17).
- On open: fetch candidates via new API helper `apiGetStationCandidates(token, submissionId)`.
- Render: title with strategy-specific subtitle ("Stacje w pobliżu" / "Stacje w Twoim województwie" / "Najpopularniejsze stacje"), search input, scrollable list, empty-search-result inline copy.
- Tap a row → confirmation toast + `apiAssignStation(token, submissionId, stationId)` → on success, close sheet + trigger parent activity-list refetch.
- Loading + error states matched to existing app patterns.

**T6 — API helpers + auth-store integration:**
- New helpers in `apps/mobile/src/api/submissions.ts`:
  - `apiGetStationCandidates(token, submissionId): Promise<StationCandidatesResult>`
  - `apiAssignStation(token, submissionId, stationId): Promise<Submission>`
- Type definitions for `StationCandidate`, `StationCandidatesResult`, `Strategy`.
- Activity row's parent (the activity screen list) accepts an optional refresh callback that the picker sheet can fire on success.

### i18n (T7)

**T7 — Translations + Translations type:**
- New keys in `apps/mobile/src/i18n/locales/{pl,en,uk}.ts`:
  - `activity.pickStationCta` ("Wybierz stację")
  - `activity.retakePhotoCta` (already exists; verify)
  - `activity.pickerTitle.gps` / `voivodeship` / `fallback` (strategy-aware subtitles)
  - `activity.pickerSearch.placeholder` ("Szukaj nazwy lub ulicy...")
  - `activity.pickerSearch.empty` ("Nie znaleziono stacji. Spróbuj innej nazwy lub ulicy.")
  - `activity.pickerConfirm.prompt` ("Czy na pewno wybierasz {{station}}?")
  - `activity.pickerSuccessToast` ("Stacja przypisana — sprawdzimy zdjęcie ponownie")
- Type definitions updated.

### Code review (T8)

**T8 — Run `bmad-code-review`.** Focus areas:
- T1 query plan: PostGIS `ST_DWithin` performance on `Submission`-scale queries — is there an index on `Station.location` (gist)? The existing schema uses `Unsupported("geography(Point,4326)")` which usually has a gist index from station-sync setup. Verify.
- T1 brand filter: `detected_brand` field — does it exist in the schema today? If not, this story has a hidden dependency. (Story 3.6 produces brand recognition; check if it persists to a column or just to logs.)
- T2 ownership check + status transition: does the Photo-pipeline respect the new `status: pending` state without trying to apply a duplicate logic check? Audit the pipeline workers for "already-processed" guards.
- T2 audit log entry: `USER_ASSIGNED_STATION` — new action; ensure admin queue / audit-log views (if any exist) handle it gracefully.
- T5 large candidate list (200+ items): is the React Native list virtualised? Use FlatList, not ScrollView with `.map`, for the picker.
- AC8 search filter: case-insensitive substring is fine for Polish for ASCII names; for Polish-diacritics-aware match (e.g., user types "lodz" expecting "Łódź"), do we need fold? Defer — lowercase comparison handles the common case; revisit if drivers complain.
- AC4 transactional re-enqueue: if the photo-pipeline enqueue fails after the DB transaction commits, the submission is in `pending` but never reprocesses. Add a retry hook or move the enqueue inside the transaction (BullMQ supports this via Prisma extensions in some setups; verify what we use).

---

## Out of Scope

- **Changing the auto-match algorithm itself** — this story is purely a manual-recovery affordance.
- **Allowing the driver to override an already-verified submission's station** — the picker only fires for `no_station_match` / `no_gps_coordinates`. A verified-but-wrong-station submission goes through the existing flag-wrong flow.
- **"Add a new station" affordance from the picker** — if the right station genuinely isn't in our DB, the driver still has to retake at a known station OR the admin adds the station via station-sync. Not building inline station-creation here.
- **Showing recently-used stations as a quick-pick at the top** — could be useful but adds state. Defer until v2.
- **Photo replay / re-confirm prices on retroactive station assignment** — the photo is the same; only the station label changes. OCR re-runs as part of pipeline reprocess. No separate confirm step.
- **Bulk recovery** ("rescue all my unmatched submissions in one tap") — single-row only.

---

## When to build this

This story is **deferrable**. Build only after 3.20 ships and we observe:

- `no_station_match` rate ≥ 5% of submissions, AND/OR
- `no_gps_coordinates` rate ≥ 2% of submissions

(Thresholds picked from gut; refine once we have data.)

If the rates are vanishingly small in practice, the rescue UI carries a maintenance cost without proportional benefit. If they're significant, this story closes the loop.

The 3.20 telemetry fields (`gps_acquired_at_capture`, `override_used`) plus the existing `flag_reason` distribution surface this directly via the firehose page (3.18) or aggregate metrics.

---

## Notes for the implementer

- **Logo recognition `detected_brand` field** — verify it exists in `Submission` (or wherever 3.6 persists). If it lives only in pipeline logs, this story needs a small migration to surface it. Worth a 5-minute audit before T1.
- **Voivodeship-from-user-history derivation** — query: `SELECT voivodeship FROM Station JOIN Submission ON ... WHERE Submission.user_id = ? AND Submission.status = 'verified' GROUP BY voivodeship ORDER BY COUNT(*) DESC LIMIT 1`. Most-frequent voivodeship in their verified submissions. If they have zero verified submissions, fall through to `fallback` strategy.
- **PostGIS query** for `ST_DWithin`: existing station-sync uses `geography(Point,4326)` with `ST_Point(...).` Check existing indexes via `\d+ "Station"` in psql before assuming gist index — add one if missing.
- **Existing FlagWrongConfirmSheet pattern** is the visual reference for the picker sheet (Modal + slide-up + tap-overlay-to-dismiss + handle bar).
- **The existing tap-to-explain modal from 3.17** has its CTAs pulled from `flagReasonCopy` helper — extending the CTA set means modifying that helper to support a `cta: 'pick_station' | 'retake'` per reason. Could also be a static branch in the modal component itself; pick whichever reads cleaner.
- **Migration applied manually per `project_staging_predeploy_broken`**.
