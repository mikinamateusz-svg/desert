# Story 3.19: Admin Station Rename with Sync-Overwrite Protection

Status: ready-for-dev

**Trigger:** 2026-05-08 — operator observation. Two stations of the same chain on opposite sides of the same road are visually indistinguishable to drivers and admin alike, both arriving from Google Places with the same name (e.g. "Orlen — ul. Generalska"). Admin needs to be able to manually disambiguate one or both ("Orlen — ul. Generalska (north)") so that drivers can pick the right one in the app and so reviewing submissions doesn't degenerate into guesswork.

**Phase:** 1 (post-launch operability). Adjacent to 3.18 (admin firehose); not blocking.

---

## Story

As an **admin**,
I want to rename a station from its detail page and have the rename persist across station-sync runs,
so that I can disambiguate two same-chain stations on opposite sides of a road (or any other case where Google Places' name is wrong / ambiguous) without the next sync wiping my edit.

### Why

`station-sync.service.ts:114-141` upserts each Google Places result with `ON CONFLICT (google_places_id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, …`. Manual edits to `name` get silently undone every sync run (currently weekly via `/v1/admin/station-sync` admin trigger; cadence may change post-launch).

A "manual override flag" pattern lets us mark a row as having had `name` set manually, so the sync's `DO UPDATE` skips overwriting that field for that row but continues updating everything else (address, location, last_synced_at, classification_version reset). Per-field flag (rather than a global "manual_override" boolean) keeps the protection narrow — admin shouldn't have to refresh every Google-managed field on a renamed station.

`name` is the only field this story protects. Address, brand, GPS, etc. continue to follow Google Places.

---

## Acceptance Criteria

**AC1 — Rename endpoint:**
Given an authenticated admin,
When they `PATCH /v1/admin/stations/:id/rename` with body `{ "name": "<new name>" }`,
Then the response is `200 OK` with the updated station shape,
And `Station.name` is updated in the DB,
And `Station.name_manually_set_at` is set to the current UTC timestamp,
And an `AdminAuditLog` row is written with `action: 'STATION_RENAME'` and `notes: { old_name, new_name }`.

**AC2 — Validation:**
Given an admin submits a rename,
When the new name is empty / whitespace-only / longer than 200 chars / identical to the current name (after trim),
Then the endpoint returns `400 Bad Request` with a clear error message,
And no DB write occurs.

**AC3 — Sync-overwrite protection:**
Given a station has `name_manually_set_at IS NOT NULL`,
When the station-sync worker runs and would otherwise overwrite this row's `name`,
Then `name` is preserved and address / location / last_synced_at / classification_version reset behaviour is unchanged.

**AC4 — Resetting the override:**
Given a station has been renamed manually,
When the admin renames it again,
Then `name_manually_set_at` is **refreshed** to the new rename time (override stays in place — every rename is a "manual" rename).

(*Out of scope this story:* admin-driven "clear override" affordance to let Google Places re-take ownership. If we need that, it's a one-line follow-up: `null` out `name_manually_set_at`. Defer until a real case appears.)

**AC5 — Detail page UI:**
Given the admin station detail page (`apps/admin/app/(protected)/stations/[id]/page.tsx`),
When an admin clicks an "Edit name" affordance next to the station name in the header card,
Then an inline form replaces the static name with: a text input pre-filled with the current name, a "Save" button, and a "Cancel" button,
And submitting the form calls the rename endpoint and re-renders the page with the new name on success,
And cancelling restores the static view without changes,
And a visible indicator (small badge / icon) appears next to the name when `name_manually_set_at` is set, signalling "manual override active".

**AC6 — Audit visibility:**
Given an admin renames a station,
When the AdminAuditLog row is written,
Then it includes `admin_user_id` (the admin), `action: 'STATION_RENAME'`, `submission_id: null`, and `notes` (JSON-serialised string) carrying `{ stationId, old_name, new_name, name_manually_set_at: ISO string }`.

(*Spec correction post-dev: an earlier draft of this AC referenced `actor_user_id` / `target_kind` / `target_id` columns, but the actual `AdminAuditLog` schema uses `admin_user_id` / `submission_id` / `notes` as the existing convention — see `STATION_HIDE` / `STATION_UNHIDE` / `PRICE_OVERRIDE`. The implementation follows the existing schema; the AC is restated above to match.*)

**AC7 — Permission:**
Given a non-admin user calls `PATCH /v1/admin/stations/:id/rename`,
Then the request is rejected with `403 Forbidden`.

**AC8 — i18n:**
The detail page rename UI (button label, input placeholder, save/cancel labels, validation error, "manual override active" badge tooltip) is localised in PL / EN / UK and present in the `Translations` type.

---

## Tasks

### Backend (T1–T4)

**T1 — Migration: add `name_manually_set_at` column to `Station`:**
New nullable `TIMESTAMP(3)` column. Default `NULL`. No backfill needed (every existing row will be `NULL` until a manual rename touches it).

```sql
ALTER TABLE "Station" ADD COLUMN "name_manually_set_at" TIMESTAMP(3) NULL;
```

Add to Prisma schema with `@map` if needed; run `prisma migrate dev` and commit the generated migration.

**T2 — Update station-sync `upsertStation` SQL to respect the flag:**
Modify the `ON CONFLICT … DO UPDATE` clause so `name = EXCLUDED.name` becomes:

```sql
name = CASE WHEN "Station".name_manually_set_at IS NULL THEN EXCLUDED.name ELSE "Station".name END
```

Keep `address`, `location`, `last_synced_at` behaviour unchanged. **Update the `classification_version` reset clause as well** to gate the name-change branch on the same override flag:

```sql
classification_version = CASE
  WHEN ("Station".name_manually_set_at IS NULL
        AND "Station".name IS DISTINCT FROM EXCLUDED.name)
    OR "Station".location IS DISTINCT FROM EXCLUDED.location
    OR "Station".address IS DISTINCT FROM EXCLUDED.address
  THEN 0
  ELSE "Station".classification_version
END
```

(*Spec correction post-dev: an earlier draft claimed the existing condition would "naturally evaluate to false" when the override blocks a name change. That reasoning was wrong — within an `ON CONFLICT ... DO UPDATE SET` clause Postgres references the **pre-update** Station.name, so a Google Places-supplied different name would still flip `IS DISTINCT FROM EXCLUDED.name` to true even when our SET branch keeps the old name. Without the explicit `name_manually_set_at IS NULL` gate, every sync run on an overridden station would needlessly reset classification_version. The CASE clause shown above is required.*)

**T3 — `renameStation` service method + `PATCH /:id/rename` controller:**
- `apps/api/src/admin/admin-stations.service.ts` — new method `async renameStation(adminId: string, stationId: string, newName: string)`. Steps:
  1. Trim `newName`. Reject if empty after trim, > 200 chars, or identical to existing name (NotFound vs BadRequest distinction).
  2. `findUnique({ where: { id: stationId } })` to read current name. NotFound if missing.
  3. Single transaction: `update({ data: { name: trimmedName, name_manually_set_at: new Date() } })` and `auditLog.create({ action: 'STATION_RENAME', target_kind: 'station', target_id, actor_user_id: adminId, notes: { old_name, new_name, name_manually_set_at } })`.
  4. Return the updated station shape (matches existing `getDetail` return).
- `apps/api/src/admin/admin-stations.controller.ts` — new `@Patch(':id/rename')` route. DTO: `class RenameDto { @IsString() @IsNotEmpty() name!: string }`. Calls service. `@Roles(UserRole.ADMIN)` is class-level, no per-route change needed.

**T4 — Backend tests:**
- Service spec: rename happy path (returns updated row with `name_manually_set_at` set), empty/whitespace name → BadRequest, > 200 chars → BadRequest, identical name → BadRequest, unknown id → NotFound, repeated rename refreshes `name_manually_set_at`.
- Sync test: extend `station-sync.service.spec.ts` (or add a new test) that asserts:
  - When `name_manually_set_at IS NULL`, sync overwrites name as before.
  - When `name_manually_set_at IS NOT NULL`, sync preserves name but updates address / location / last_synced_at.
- Controller-level role test not required (class-level guard, no sibling endpoint has its own).

### Admin UI (T5–T7)

**T5 — `StationRenameForm.tsx` client component:**
Inline form replacing the static `<h1>` when active. Pencil-icon button toggles to edit mode; Save / Cancel buttons. Posts via a server action (`apps/admin/app/(protected)/stations/[id]/actions.ts`). On error: show inline error message, keep form open. On success: `router.refresh()` to re-render with the new name.

**T6 — Wire into detail page:**
- Replace the static name `<h1>` block (`apps/admin/app/(protected)/stations/[id]/page.tsx:54-63`) with the new component.
- Pass `initialName` and `nameManuallySetAt` props.
- Render a small "manual override" badge next to the name (when `name_manually_set_at` is set) — tooltip: "Manual rename, won't be overwritten by sync".
- Update `StationDetail` type in `apps/admin/lib/types.ts` to include `name_manually_set_at: string | null`.
- Update `getDetail` API service shape to include the new field.

**T7 — i18n keys:**
PL / EN / UK additions in `apps/admin/lib/i18n.ts`:
- `stations.editNameLabel` ("Edit name" / "Edytuj nazwę" / "Редагувати назву")
- `stations.editNameSave` ("Save" / "Zapisz" / "Зберегти")
- `stations.editNameCancel` ("Cancel" / "Anuluj" / "Скасувати")
- `stations.editNamePlaceholder` ("Station name…")
- `stations.editNameErrorEmpty` (validation: empty)
- `stations.editNameErrorTooLong` (validation: > 200 chars)
- `stations.editNameErrorUnchanged` (validation: same as current)
- `stations.editNameErrorGeneric`
- `stations.manualOverrideBadge` ("Manual rename" / "Ręczna nazwa" / "Ручна назва")
- `stations.manualOverrideTooltip` (longer explanation)

Update `Translations` type to match.

### Code review (T8)

**T8 — Run `bmad-code-review` after dev complete:**
Focus areas to flag:
- Did the migration run cleanly on the local dev DB?
- Did the sync upsert SQL get the `CASE` clause right (Postgres syntax inside a multi-column `DO UPDATE SET`)?
- Is the `classification_version` reset still correct when the name update is blocked? (the `IS DISTINCT FROM` comparison should naturally evaluate to false when name doesn't change.)
- Are the i18n keys present in the `Translations` type (silent runtime failure risk per the project memory note)?
- Does the rename endpoint round-trip cleanly through the existing admin auth → role guard → service flow?
- Any race condition where two admins rename the same station at near-identical timestamps? (Single-row update — last writer wins; AdminAuditLog captures both. Acceptable.)

---

## Out of Scope

- **Bulk rename** — single-row only.
- **Edit address / brand / GPS** — `name` only this story; add later if needed.
- **Clear override affordance** ("let Google Places own this name again") — defer.
- **History of rename actions visible in UI** — read from AdminAuditLog if needed; not surfaced this story.
- **Validation of name uniqueness within a chain** — admin discretion; we don't reject "Orlen Mokotów" if another exists.
- **User-facing notification to drivers when a station they've submitted to gets renamed** — out of scope.

---

## Notes for the implementer

- The existing detail page header (`apps/admin/app/(protected)/stations/[id]/page.tsx:54-63`) is the entry point. Replace the static `<h1>` block with the new component; everything else (prices section, override-price form, hide button) stays as-is.
- Don't introduce a generic "edit station" form yet. Single-field rename keeps the surface narrow and the AC tight.
- The `Station` Prisma model is in `packages/db/prisma/schema.prisma:107`. Add `name_manually_set_at DateTime?` next to the existing `last_synced_at` field. Migration name suggestion: `20260508000000_add_station_name_manual_override`.
- Since the migration is additive and non-blocking, it can be applied via the laptop migration workflow per the existing memory (`project_staging_predeploy_broken.md`). Apply to staging + prod manually after merging.
- Audit log shape: use `actor_user_id` and `target_*` fields per the existing AdminAuditLog convention (look at how `STATION_HIDE` / `STATION_UNHIDE` log themselves for the exact column names — they're already in `admin-stations.service.ts`).
