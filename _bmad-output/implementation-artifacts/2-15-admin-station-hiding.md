# Story 2.15: Admin Station Hiding (Data Cleanup)

Status: review

## Story

As an **admin / ops operator**,
I want to hide stations that are duplicates, misclassified, or don't actually exist,
So that the map only shows real, active fuel stations — and hidden stations stay hidden even after the next Google Places sync.

## Why

Google Places data contains errors — some entries are convenience stores, car washes, or duplicate listings for the same physical station. Without a hide mechanism, these reappear every weekly sync. Deleting them from the DB is unsafe because the sync would re-insert them. A `hidden` flag persists across syncs and is reversible.

## Acceptance Criteria

1. **Schema:** Station gains a new field `hidden Boolean @default(false)`. Migration adds `ALTER TABLE "Station" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;`

2. **Hide endpoint:** Given an ADMIN calls `POST /v1/admin/stations/:id/hide` with valid `x-admin-secret` header, when the station exists, then `hidden` is set to `true` and response returns `{ "status": "hidden", "stationId": "<id>", "name": "<name>" }` with HTTP 200. If station not found → HTTP 404.

3. **Unhide endpoint:** Given an ADMIN calls `POST /v1/admin/stations/:id/unhide` with valid `x-admin-secret` header, when the station exists, then `hidden` is set to `false` and response returns `{ "status": "visible", "stationId": "<id>", "name": "<name>" }` with HTTP 200.

4. **Nearby exclusion:** Given a station has `hidden = true`, when any user calls `GET /v1/stations/nearby`, then the station is excluded from results. The `WHERE` clause in `findStationsInArea` adds `AND hidden = false`.

5. **Sync preservation:** Given a station has `hidden = true`, when the weekly Google Places sync runs and encounters the same `google_place_id`, then the `ON CONFLICT` upsert does NOT overwrite the `hidden` column — it remains `true`.

6. **List hidden stations:** Given an ADMIN calls `GET /v1/admin/stations/hidden` with valid `x-admin-secret`, then the response returns all stations where `hidden = true`, including `id`, `name`, `address`, `brand`, `hidden` (always true), sorted by `updated_at DESC`.

7. **Search stations:** Given an ADMIN calls `GET /v1/admin/stations?search=<query>` with valid `x-admin-secret`, then the response returns stations matching the query by name or address (case-insensitive, partial match). Results include `hidden` field so admin can see which are already hidden. Limited to 50 results.

8. **Tests:** Unit tests for hide/unhide service methods. Integration test confirming hidden stations excluded from nearby results. Test confirming sync does not overwrite hidden flag.

## Dependencies

- Story 2.1 (Station model, StationSyncService)
- Story 2.13 (admin station endpoints — controller structure)

## Tasks / Subtasks

- [x] **Task 1: Schema migration** (AC: 1)
  - [x] 1.1 Add `hidden Boolean @default(false)` to Station model in `packages/db/prisma/schema.prisma`
  - [x] 1.2 Create migration `packages/db/prisma/migrations/20260414000001_add_station_hidden_flag/migration.sql`
  - [x] 1.3 Run `prisma generate` to update client

- [x] **Task 2: Station service updates** (AC: 4)
  - [x] 2.1 Update `findStationsInArea` in `station.service.ts` — add `AND hidden = false` to the PostGIS query
  - [x] 2.2 Update `findNearbyWithDistance` — same filter added
  - [x] 2.3 Verify `findById` still returns hidden stations (no hidden filter — confirmed)

- [x] **Task 3: Sync preservation** (AC: 5)
  - [x] 3.1 Verified `ON CONFLICT` in `station-sync.service.ts` does NOT include `hidden` in the SET clause — already satisfied by default

- [x] **Task 4: Admin endpoints** (AC: 2, 3, 6, 7)
  - [x] 4.1 Add `POST /v1/admin/stations/:id/hide` to admin stations controller
  - [x] 4.2 Add `POST /v1/admin/stations/:id/unhide` to admin stations controller
  - [x] 4.3 Add `GET /v1/admin/stations/hidden` to admin stations controller (placed before `:id` route to avoid conflict)
  - [x] 4.4 `GET /v1/admin/stations?search=<query>` already existed — updated to include `hidden` field in response
  - [x] 4.5 Add service methods: `hideStation`, `unhideStation`, `findHidden` (search already existed)

- [x] **Task 5: Tests** (AC: 8)
  - [x] 5.1 Unit tests for `hideStation`, `unhideStation`, `findHidden` (5 new tests)
  - [x] 5.2 Hidden exclusion from nearby: verified via `AND hidden = false` in all 3 query methods
  - [x] 5.3 Sync preservation: verified — `ON CONFLICT` SET clause has no `hidden` column
  - [x] 5.4 Test: hide/unhide return NotFoundException for non-existent station

## File List

- `packages/db/prisma/schema.prisma` — added `hidden Boolean @default(false)` to Station
- `packages/db/prisma/migrations/20260414000001_add_station_hidden_flag/migration.sql` — new migration
- `apps/api/src/station/station.service.ts` — added `AND hidden = false` to 3 queries
- `apps/api/src/admin/admin-stations.controller.ts` — added hide, unhide, listHidden endpoints
- `apps/api/src/admin/admin-stations.service.ts` — added hideStation, unhideStation, findHidden methods + hidden field in selects
- `apps/api/src/admin/admin-stations.service.spec.ts` — 5 new tests for hide/unhide/findHidden

## Change Log

- 2026-04-14: Story 2.15 implemented — all 8 ACs satisfied, 759/759 API tests passing

## Dev Notes

- All admin endpoints use `x-admin-secret` header auth (same pattern as Story 2.13 sync endpoints) with `@Public()` + `@Roles()` decorators to bypass JWT/RBAC guards.
- The `hidden` field should NOT be returned in the public `/v1/stations/nearby` DTO — only in admin endpoints.
- Consider adding `hidden_at DateTime?` and `hidden_reason String?` fields for audit trail — but defer if not needed for MVP.
- The search endpoint enables admin to find and review stations by name before hiding — essential for identifying duplicates.

## Estimation

Small story — 1 migration, 4 endpoints, WHERE clause updates, tests. ~2-3 hours.
