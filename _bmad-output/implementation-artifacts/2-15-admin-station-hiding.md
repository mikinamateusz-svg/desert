# Story 2.15: Admin Station Hiding (Data Cleanup)

Status: ready

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

- [ ] **Task 1: Schema migration** (AC: 1)
  - [ ] 1.1 Add `hidden Boolean @default(false)` to Station model in `packages/db/prisma/schema.prisma`
  - [ ] 1.2 Create migration `packages/db/prisma/migrations/[timestamp]_add_station_hidden_flag/migration.sql`
  - [ ] 1.3 Run `prisma generate` to update client

- [ ] **Task 2: Station service updates** (AC: 4)
  - [ ] 2.1 Update `findStationsInArea` in `station.service.ts` — add `AND hidden = false` to the PostGIS query
  - [ ] 2.2 Update `findNearbyWithDistance` if it has a separate query — same filter
  - [ ] 2.3 Verify `findById` still returns hidden stations (admin needs to see them)

- [ ] **Task 3: Sync preservation** (AC: 5)
  - [ ] 3.1 Update `ON CONFLICT` in `station-sync.service.ts` upsert — exclude `hidden` from the SET clause so it's never overwritten during sync

- [ ] **Task 4: Admin endpoints** (AC: 2, 3, 6, 7)
  - [ ] 4.1 Add `POST /v1/admin/stations/:id/hide` to admin stations controller
  - [ ] 4.2 Add `POST /v1/admin/stations/:id/unhide` to admin stations controller
  - [ ] 4.3 Add `GET /v1/admin/stations/hidden` to admin stations controller
  - [ ] 4.4 Add `GET /v1/admin/stations?search=<query>` to admin stations controller
  - [ ] 4.5 Add service methods: `hideStation`, `unhideStation`, `findHidden`, `searchStations`

- [ ] **Task 5: Tests** (AC: 8)
  - [ ] 5.1 Unit tests for `hideStation`, `unhideStation`, `findHidden`, `searchStations`
  - [ ] 5.2 Test: hidden station excluded from `findStationsInArea`
  - [ ] 5.3 Test: sync upsert does not overwrite `hidden = true`
  - [ ] 5.4 Test: hide/unhide return 404 for non-existent station

## Dev Notes

- All admin endpoints use `x-admin-secret` header auth (same pattern as Story 2.13 sync endpoints) with `@Public()` + `@Roles()` decorators to bypass JWT/RBAC guards.
- The `hidden` field should NOT be returned in the public `/v1/stations/nearby` DTO — only in admin endpoints.
- Consider adding `hidden_at DateTime?` and `hidden_reason String?` fields for audit trail — but defer if not needed for MVP.
- The search endpoint enables admin to find and review stations by name before hiding — essential for identifying duplicates.

## Estimation

Small story — 1 migration, 4 endpoints, WHERE clause updates, tests. ~2-3 hours.
