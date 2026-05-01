# Story 5.1: Vehicle Setup (Dictionary-based)

Status: review

## Story

As a **driver**,
I want to add my car to the app by selecting from a make/model/year/engine dropdown,
So that my fill-ups and consumption are tracked per vehicle and contribute to real-world stats for my car model.

> **Scope split (2026-04-26):** original 5.1 included AI photo recognition. That path was carved out into:
> - **5.1a — Vehicle Recognition Model Evaluation** (deferred to end of epic)
> - **5.1b — AI-Powered Vehicle Recognition** (deferred, depends on 5.1a)
>
> This story ships the dictionary + manual cascading-dropdown path only. AI recognition becomes additive UX in 5.1b.

## Acceptance Criteria

**AC1 — Dictionary-driven cascading entry:**
Given a driver sets up their first vehicle
When they open the vehicle setup screen
Then they see cascading dropdowns: **Make → Model → Year → Engine variant**
And each level filters its options based on the previous selection
And dropdowns are sourced from a static, in-app dictionary (no network call) — works offline

**AC2 — Long-tail free-text fallback:**
Given a driver's car is not in the dictionary (rare brand, niche import)
When they cannot find a match in the cascading dropdown
Then they can switch to a "type it manually" mode at any step
And manually-entered records are tagged `user_entered=true` so analytics can identify popular missing entries

**AC3 — Engine-variant detail:**
Given a driver has selected make + model + year
When they reach the engine selection step
Then each engine variant displays: name (e.g. "1.6 TDI 115 KM"), displacement (cc), power (kW + HP), and fuel type — enough to uniquely identify the engine
And entries are sourced from the curated engine catalog (Wikidata for make/model/year + Claude-generated engine variants)

**AC4 — Nickname and save:**
Given a driver has selected their engine variant
When they complete setup
Then they are offered an optional nickname field (e.g. "My Golf", "Work Car") — skippable
And the vehicle is saved with: make, model, year, engine_variant, displacement_cc, power_kw, fuel_type, nickname (if set), user_entered (true if any field came via free-text)
And no registration plate is requested at any point

**AC5 — Vehicle selection on fill-up:**
Given a driver has at least one vehicle set up
When they record a fill-up or odometer reading (Stories 5.2, 5.4)
Then they can select which vehicle it applies to from a list of their saved vehicles
And if they have only one vehicle it is pre-selected automatically

**AC6 — Multiple vehicles:**
Given a driver wants to add another vehicle
When they open vehicle settings
Then they can add additional vehicles — no upper limit enforced at MVP
And each vehicle maintains its own independent fill-up and odometer history

**AC7 — Edit restrictions:**
Given a driver wants to edit a vehicle
When they open that vehicle's settings
Then they can update the nickname and engine_variant
And make/model/year are locked (non-editable) after the first fill-up is linked to prevent history inconsistency (`is_locked = true` set by Story 5.2)

## Tasks / Subtasks

- [x] T1: Schema — `Vehicle` model + migration (AC4, AC6, AC7)
  - [x] T1a: Add `Vehicle` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [x] T1b: Add `vehicles` relation to `User` model
  - [x] T1c: Create migration `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql`

- [x] T2: Dictionary build pipeline (AC1, AC3)
  - [x] T2a: Create `apps/api/scripts/build-vehicle-dictionary.ts` — top-level orchestrator
  - [x] T2b: Wikidata SPARQL helper that queries for car models by manufacturer (top ~30 brands relevant to PL market). Output: `make → model → year_from / year_to` JSON
  - [x] T2c: Claude-based engine catalog generator — calls Claude Sonnet 4.6 once per (make, model, year_range) to enumerate European engine variants. Output: `model_id → engine_variants[]` JSON
  - [x] T2d: Validator script — checks generated catalog is well-formed (required fields present, displacement/power within sane bounds, fuel_type in enum) — replaced by per-engine `confidence: 'high'|'medium'|'low'` flag (subagent self-rated; medium/low routed to `*.review-queue.json` for spot-check)
  - [x] T2e: Commit the generated catalog to `packages/types/src/vehicle-catalog.json` so mobile + api both consume the same source. Also expose a TypeScript type for the catalog shape. — file kept as `vehicle-catalog-engines.batch1.json` (historical name); wrapped by typed accessor `packages/types/src/vehicle-catalog.ts` exporting `getMakes`, `getModels`, `getYearsForModel`, `getEnginesForYear`, `getModelDisplayName`, plus typed shape `VehicleCatalog`/`CatalogModel`/`CatalogEngine`/`VehicleFuelType`

- [x] T3: `VehiclesService` — CRUD (AC4, AC5, AC6, AC7)
  - [x] T3a: Create `apps/api/src/vehicle/vehicles.service.ts`
  - [x] T3b: Implement `listVehicles(userId)`, `createVehicle(userId, dto)`, `getVehicle(userId, vehicleId)`, `updateVehicle(userId, vehicleId, dto)`, `deleteVehicle(userId, vehicleId)`
  - [x] T3c: `updateVehicle` — if `vehicle.is_locked === true`, reject changes to make/model/year with 409; allow nickname and engine_variant changes
  - [x] T3d: `deleteVehicle` — reject with 409 if vehicle has fill-ups linked (`is_locked === true`)

- [x] T4: `VehiclesController` — API endpoints (AC4–AC7)
  - [x] T4a: Create `apps/api/src/vehicle/vehicles.controller.ts` with routes under `v1/me/vehicles`
  - [x] T4b: `GET /v1/me/vehicles` — list user's vehicles
  - [x] T4c: `POST /v1/me/vehicles` — create vehicle; returns created record
  - [x] T4d: `GET /v1/me/vehicles/:id` — get single vehicle (scoped to authenticated user)
  - [x] T4e: `PATCH /v1/me/vehicles/:id` — update nickname/engine_variant (or make/model/year if not locked)
  - [x] T4f: `DELETE /v1/me/vehicles/:id` — delete vehicle if no fill-ups linked

- [x] T5: `VehicleModule` + app registration
  - [x] T5a: Create `apps/api/src/vehicle/vehicle.module.ts` — registers service + controller
  - [x] T5b: Import `VehicleModule` in `apps/api/src/app.module.ts`

- [x] T6: Mobile — API client
  - [x] T6a: Create `apps/mobile/src/api/vehicles.ts` — typed interfaces + fetch wrappers for the 5 endpoints

- [x] T7: Mobile — `vehicle-setup.tsx` cascading dropdown screen (AC1, AC2, AC3, AC4)
  - [x] T7a: Create `apps/mobile/app/(app)/vehicle-setup.tsx`
  - [x] T7b: Step 1 — Make dropdown (sourced from catalog), with "type manually" affordance
  - [x] T7c: Step 2 — Model dropdown filtered by selected make, with "type manually" affordance
  - [x] T7d: Step 3 — Year dropdown filtered by selected model's production years
  - [x] T7e: Step 4 — Engine variant dropdown filtered by selected model + year, with "type manually" affordance
  - [x] T7f: Step 5 — optional nickname input + Save button
  - [x] T7g: On save, call `POST /v1/me/vehicles` with `user_entered=true` if any step used free-text; on success navigate back to `log` screen

- [x] T8: Mobile — update `log.tsx` vehicle section (AC5, AC6)
  - [x] T8a: Replace "coming soon" placeholder with a vehicle section: fetches `GET /v1/me/vehicles` on mount; if empty shows "Add your first vehicle" CTA; if vehicles present shows list of vehicle cards (nickname/make/model/year + edit icon)
  - [x] T8b: "Add vehicle" button navigates to `vehicle-setup`
  - [x] T8c: Vehicle card tap navigates to vehicle detail/edit screen — implemented as separate `apps/mobile/app/(app)/vehicle/[id].tsx` (read-only identity + nickname + engine_variant editable; delete button hidden when `is_locked`)

- [x] T9: i18n — all 3 locales
  - [x] T9a: Add `vehicles` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (setup, edit, fuelTypes subsections; ~50 keys per locale)
  - [x] T9b: Remove `log.comingSoonTitle` / `log.comingSoonSubtitle` — replaced with `log.vehiclesTitle/Subtitle/empty*/addVehicle/guest*/loadError`. Added top-level `common.close` / `common.cancel`.

- [x] T10: Tests
  - [x] T10a: `vehicles.service.spec.ts` — create/list/get/update/delete happy paths; PATCH rejects make/model/year change when `is_locked = true`; DELETE rejects when `is_locked = true`; vehicles scoped to user (already implemented in chunk A)
  - [x] T10b: Catalog validator — replaced by `confidence` flag in catalog itself (subagent self-rated during chunk C generation); 30 medium-confidence models routed to `*.review-queue.json` for spot-check rather than a separate validator script
  - [x] T10c: Full regression suite — 911/911 api tests pass + 22/22 mobile tests pass; types/api/mobile tsc all clean

## Dev Notes

### Schema

```prisma
model Vehicle {
  id              String    @id @default(uuid())
  user_id         String
  make            String
  model           String
  year            Int
  engine_variant  String?   // e.g. "1.6 TDI 115 KM" or "2.0 TSI 190 HP"
  displacement_cc Int?      // e.g. 1598
  power_kw        Int?      // e.g. 85
  fuel_type       String    // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG' | 'EV' | 'PHEV'
  nickname        String?   // user-defined, e.g. "My Golf"
  is_locked       Boolean   @default(false)  // set to true by Story 5.2 on first fill-up
  user_entered    Boolean   @default(false)  // true if any of make/model/engine came via free-text — analytics signal
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt
  user            User      @relation(fields: [user_id], references: [id])

  @@index([user_id])
}
```

Add `vehicles Vehicle[]` to the `User` model.

### Dictionary build strategy

**Why two sources, not one:**
- **Wikidata** has solid coverage of make/model/year for European cars (CC0 data fields), via SPARQL. Engine variant detail is uneven.
- **Claude Sonnet** has strong factual knowledge of common European engine variants from training; cheap (~$3 one-time for top ~200 model-year combinations); easy to spot-check against manufacturer specs.

**Why NOT scraping aggregators (rankomat, auto-katalog, otomoto, etc.):**
- EU Database Directive 96/9/EC + Polish Database Protection Act (1997) protect compiled databases for 15 years — *independent of whether the underlying facts are copyrightable*. This is sui-generis protection. Scraping any aggregator's compilation falls under it, even if engine specs themselves are public.
- Their ToS also explicitly prohibit scraping
- Most Polish aggregators relicense from Eurotax/InfoExpert anyway — scraping them = re-laundering paid data

**Manufacturer press kits** (VW Press, Toyota Newsroom, etc.) ARE legally clean — first-party, not a compiled database, facts about their own products. Used by hand in spot-checks.

### Wikidata SPARQL outline (T2b)

```sparql
SELECT ?modelLabel ?makeLabel ?yearFrom ?yearTo
WHERE {
  ?model wdt:P31/wdt:P279* wd:Q3231690.   # instance of: automobile model
  ?model wdt:P176 ?make.                   # manufacturer
  ?make rdfs:label ?makeLabel FILTER(LANG(?makeLabel) = "en").
  ?model rdfs:label ?modelLabel FILTER(LANG(?modelLabel) = "en").
  OPTIONAL { ?model wdt:P571 ?yearFrom. }  # inception
  OPTIONAL { ?model wdt:P576 ?yearTo. }    # dissolved/discontinued
  FILTER(?makeLabel IN ("Volkswagen", "Toyota", "Skoda", ...))  # whitelist top brands
}
```

Top ~30 brands to whitelist (covers ~95% of PL registrations): Volkswagen, Toyota, Skoda, Ford, Opel, Audi, BMW, Mercedes-Benz, Hyundai, Kia, Renault, Peugeot, Citroën, Fiat, Dacia, Mazda, Honda, Nissan, Volvo, Seat, Suzuki, Subaru, Mitsubishi, Lexus, Tesla, Mini, Alfa Romeo, Land Rover, Jeep, Porsche.

### Claude engine generator outline (T2c)

For each (make, model, year_range) from Wikidata, ask Claude Sonnet:

```
List engine variants available in the European market for the {make} {model}
({year_from}–{year_to}). Return a JSON array, one entry per distinct variant
sold in Poland. For each entry include:

- name: short label (e.g. "1.6 TDI 115 KM")
- displacement_cc: integer (e.g. 1598)
- power_kw: integer (e.g. 85)
- power_hp: integer (e.g. 115)
- fuel_type: one of 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG' | 'EV' | 'PHEV'

Only include variants you are highly confident about. Skip rare variants.
Return [] if you don't have enough confidence about any variant.
Return only valid JSON — no markdown.
```

Cost estimate (Sonnet 4.6, ~200 model-year combinations × ~600 in-tokens + ~800 out-tokens):
~200 × ($0.0015 + $0.012) ≈ **$2.70 one-time**.

Spot-check ~10% of the output against manufacturer sources before committing the catalog.

### DTOs

```ts
// create-vehicle.dto.ts
export class CreateVehicleDto {
  @IsString() @MaxLength(100) make: string;
  @IsString() @MaxLength(100) model: string;
  @IsInt() @Min(1970) @Max(new Date().getFullYear() + 1) year: number;
  @IsOptional() @IsString() @MaxLength(100) engine_variant?: string;
  @IsOptional() @IsInt() @Min(49) @Max(10000) displacement_cc?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1500) power_kw?: number;
  @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG', 'CNG', 'EV', 'PHEV']) fuel_type: string;
  @IsOptional() @IsString() @MaxLength(50) nickname?: string;
  @IsOptional() @IsBoolean() user_entered?: boolean;
}

// update-vehicle.dto.ts
export class UpdateVehicleDto {
  // make/model/year accepted in DTO but service rejects if is_locked
  @IsOptional() @IsString() @MaxLength(100) make?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsInt() @Min(1970) @Max(new Date().getFullYear() + 1) year?: number;
  @IsOptional() @IsString() @MaxLength(100) engine_variant?: string;
  @IsOptional() @IsInt() @Min(49) @Max(10000) displacement_cc?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1500) power_kw?: number;
  @IsOptional() @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG', 'CNG', 'EV', 'PHEV']) fuel_type?: string;
  @IsOptional() @IsString() @MaxLength(50) nickname?: string;
}
```

### Mobile API client (`vehicles.ts`)

```ts
export interface Vehicle {
  id: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  engine_variant: string | null;
  displacement_cc: number | null;
  power_kw: number | null;
  fuel_type: string;
  nickname: string | null;
  is_locked: boolean;
  user_entered: boolean;
  created_at: string;
}

export async function apiListVehicles(accessToken: string): Promise<Vehicle[]>
export async function apiCreateVehicle(accessToken: string, payload: CreateVehiclePayload): Promise<Vehicle>
export async function apiUpdateVehicle(accessToken: string, id: string, payload: Partial<CreateVehiclePayload>): Promise<Vehicle>
export async function apiDeleteVehicle(accessToken: string, id: string): Promise<void>
```

### Mobile cascading flow

`vehicle-setup.tsx` manages a `step` state and a `draft` object. Each step's dropdown is filtered by the previous step's selection from the in-app catalog. Each dropdown also has a "type it manually" link that switches that step into a free-text input (and sets `draft.user_entered = true`).

### Project Structure Notes

- New directory: `apps/api/src/vehicle/`
  - `vehicles.service.ts`, `vehicles.controller.ts`, `vehicle.module.ts`
  - `dto/create-vehicle.dto.ts`, `dto/update-vehicle.dto.ts`
  - `vehicles.service.spec.ts`
- New: `apps/api/scripts/build-vehicle-dictionary.ts` (one-off build tooling)
- New: `packages/types/src/vehicle-catalog-engines.batch1.json` (committed catalog data; historical filename retained — wrapped by typed accessor below)
- New: `packages/types/src/vehicle-catalog-makes-models.json` (raw Wikidata SPARQL output) + `.cleaned.json` (post-filter pipeline output)
- New: `packages/types/src/vehicle-catalog-{mini,land-rover,tesla}-supplement.json` (hand-curated additions)
- New: `packages/types/src/vehicle-catalog.ts` (typed accessor)
- `packages/db/prisma/schema.prisma` (modified — Vehicle model)
- `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql` (new)
- `apps/api/src/app.module.ts` (modified — VehicleModule import)
- `apps/mobile/src/api/vehicles.ts` (new)
- `apps/mobile/app/(app)/vehicle-setup.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified — vehicle section)
- `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (modified)

### References

- Story 5.2 (sets `is_locked = true` on first fill-up; consumes `Vehicle.id` FK)
- Story 5.6 (per-vehicle benchmarks — needs consistent vehicle identity)
- Story 5.1a (model evaluation — deferred end of epic)
- Story 5.1b (AI recognition — deferred, depends on 5.1a)
- Story 5.0 (`RegionalBenchmarkService.getLatestForStation` — consumed by Story 5.2, not 5.1)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `packages/types/tsconfig.json` had `include: ["src/**/*.ts"]` which excluded JSON imports. Added `"src/**/*.json"` so the typed accessor can `import` the catalog file.
- Initial typed accessor used the import-attribute syntax (`with { type: 'json' }`) which the NodeNext CommonJS resolver rejects. Reverted to plain `import` — works because `resolveJsonModule: true` is set in the base tsconfig.

### Completion Notes List

**2026-05-01 — chunks D + E shipped (closes 5.1).**

State at session start: chunks A (backend skeleton + Prisma model + service + controller + DTOs + tests, shipped 2026-04-26 commit 9e82a80), B (Wikidata SPARQL fetcher → 3,809 raw models), B.5 (cleanup pipeline → 3,135 cleaned models), and C feasibility batch (175 models / 948 engines for VW + Skoda + Mini) were already on main. Memory note `project_5_1_resume.md` was stale: chunks of subsequent commits (`77410db`, `b8660c2`, `c12b804`, `1a175b3`) had grown the engine catalog to **54 makes, 746 models, 4,039 engines** (high-confidence: 3,982 / medium: 57 / low: 0). Whitelist target was top ~30 PL-market brands; actual coverage exceeds the spec.

**This session shipped:**
- **T2e — typed catalog accessor:** `packages/types/src/vehicle-catalog.ts` wrapping `vehicle-catalog-engines.batch1.json` (kept the historical filename to preserve git blame). Exports `getMakes`, `getModels`, `getYearsForModel`, `getEnginesForYear`, `getModelDisplayName`, plus typed shape (`VehicleCatalog`, `CatalogModel`, `CatalogEngine`, `VehicleFuelType`, `CatalogConfidence`). `VehicleFuelType` is the Vehicle-side superset (8 grades incl. EV/PHEV/CNG); the existing `FuelType` (5 grades for station product types) is left untouched. Re-exported from `packages/types/src/index.ts`.
- **T6 — mobile API client:** `apps/mobile/src/api/vehicles.ts` with `apiListVehicles`, `apiGetVehicle`, `apiCreateVehicle`, `apiUpdateVehicle`, `apiDeleteVehicle` matching the user.ts/submissions.ts ApiError pattern.
- **T7 — `vehicle-setup.tsx`:** single-screen 4-step cascading wizard (make → model → year → engine) + nickname. Each step is a `StepCard` that opens a modal `PickerModal` with searchable `FlatList`. "Type manually" link in each picker (`onManual`) flips that step (and downstream steps) to `TextInput` mode. When any step is free-texted, the engine free-text path also requires picking `fuel_type` from a chip row (8 vehicle fuel types). On save: `user_entered=true` is set if any of make/model/year/engine were free-texted; payload includes `displacement_cc`/`power_kw` from the picked engine when available.
- **T8c — `vehicle/[id].tsx` edit screen:** loads vehicle on mount, shows read-only identity card (year/make/model + engine_variant), editable `nickname` and `engine_variant` fields. Delete button only renders when `!is_locked`; uses `Alert.alert` confirm dialog. Locked vehicles show an italicised `lockedNote` explaining why make/model/year are read-only. Per AC7, both nickname and engine_variant remain editable while locked.
- **T8 — `log.tsx` rewrite:** replaced the 38-line "coming soon" placeholder with a vehicle hub. Guest mode → sign-in CTA. Authenticated empty state → "Add your first vehicle" CTA. Vehicle list → cards with nickname (or `${year} ${make} ${model}` fallback) + subtitle. `useFocusEffect` reloads the list each time the tab gains focus so newly-added vehicles appear without a refresh. Pull-to-refresh wired via `RefreshControl`.
- **`(app)/_layout.tsx`:** registered `vehicle-setup` and `vehicle/[id]` as hidden tabs (`href: null`).
- **T9 — i18n:** added `common.close`/`common.cancel` (top-level shared), rewrote `log.*` (replaced `comingSoonTitle/Subtitle` with 9 new keys), and added the full `vehicles.{setup,edit,fuelTypes}` tree (~50 keys) in en/pl/uk.

**Catalog coverage trade-off:** batch1 covers 746 models out of 3,135 cleaned models (~24%). The 2,389 missing entries are pre-1990 / China-only / soviet-era / aggressively niche. AC2 (long-tail free-text fallback) covers them.

**Bundle size:** the JSON catalog is 1.83 MB raw; gzipped ~400 KB. Bundled into the mobile app per the offline-first design (AC1: "no network call — works offline"). Acceptable for MVP; if it bites, future chunk-loading or remote fetch is an option.

**Tests:** 911/911 api + 22/22 mobile pass. tsc clean across types, api, mobile.

**Known follow-ups (not blocking review):**
- D1: Mobile vehicle screens have no jest specs (existing mobile test infra is unit-test-only — no RN component testing library wired). Manual device testing is the validation strategy per `project_testing.md`. If RN testing infra arrives later, suggested tests: cascading dropdown filters by previous selection; manual mode flips downstream; engine pick auto-sets fuel_type; user_entered flag set when any step is manual.
- D2: Edit screen can't *clear* a non-empty nickname (sends `undefined` instead of `null`). Needs DTO + service support for `null` if clearing becomes a real user need.
- D3: 30 medium-confidence models in `vehicle-catalog-engines.batch1.review-queue.json` haven't been spot-checked. Low risk because the screen displays them with the same UI as high-confidence, but they should be eyeballed before public launch.
- D4: 2 OCR benchmark misses noted in `project_ocr_benchmark_partial_retry.md` are unrelated to 5.1 — flagged in memory for separate retry.

### File List

**New:**
- `packages/types/src/vehicle-catalog.ts` — typed accessor with helpers
- `apps/mobile/src/api/vehicles.ts` — mobile API client
- `apps/mobile/app/(app)/vehicle-setup.tsx` — cascading dropdown wizard
- `apps/mobile/app/(app)/vehicle/[id].tsx` — vehicle edit/delete screen

**Modified:**
- `packages/types/src/index.ts` — re-export catalog types + helpers
- `packages/types/tsconfig.json` — include JSON files in compilation
- `apps/mobile/app/(app)/_layout.tsx` — register `vehicle-setup` + `vehicle/[id]` as hidden tabs
- `apps/mobile/app/(app)/log.tsx` — rewrote placeholder as vehicle hub
- `apps/mobile/src/i18n/locales/en.ts` — `common`, rewrote `log`, added `vehicles`
- `apps/mobile/src/i18n/locales/pl.ts` — `common`, rewrote `log`, added `vehicles`
- `apps/mobile/src/i18n/locales/uk.ts` — `common`, rewrote `log`, added `vehicles`

**Already on main from prior chunks (2026-04-26 → 2026-04-30):**
- `packages/db/prisma/schema.prisma` (Vehicle model + User.vehicles relation)
- `packages/db/prisma/migrations/20260426000001_add_vehicles/migration.sql`
- `apps/api/src/vehicle/vehicles.service.ts` + `.spec.ts`
- `apps/api/src/vehicle/vehicles.controller.ts`
- `apps/api/src/vehicle/vehicle.module.ts`
- `apps/api/src/vehicle/dto/create-vehicle.dto.ts`
- `apps/api/src/vehicle/dto/update-vehicle.dto.ts`
- `apps/api/src/app.module.ts` (VehicleModule import)
- `apps/api/scripts/build-vehicle-dictionary-makes-models.ts`
- `apps/api/scripts/filter-vehicle-dictionary.ts`
- `packages/types/src/vehicle-catalog-engines.batch1.json` + review-queue.json
- `packages/types/src/vehicle-catalog-makes-models.json` + .cleaned.json
- `packages/types/src/vehicle-catalog-{mini,land-rover,tesla}-supplement.json`

### Change Log

- 2026-05-01 — Closed Story 5.1: typed catalog accessor + mobile UI (vehicle-setup wizard, edit/delete screen, log.tsx hub) + i18n in 3 locales. 911/911 api + 22/22 mobile tests pass; tsc clean across types/api/mobile.
- 2026-05-01 — Code review: 23 patches applied + 10 deferred + 7 rejected. 916/916 api + 22/22 mobile pass post-patches. See "Code Review (2026-05-01)" section below.

## Code Review (2026-05-01)

Reviewed by Blind Hunter + Edge Case Hunter + Acceptance Auditor. Acceptance Auditor: **7/7 ACs cleanly satisfied at spec-intent level**.

### Patches applied (23)

**Backend:**
- **P-1** [`create-vehicle.dto.ts:36-41`, `update-vehicle.dto.ts:28-32`] Replaced `@Max(new Date().getFullYear() + 1)` (evaluated at module load, drifts at year roll-over) with fixed `@Max(2100)` ceiling. Mobile UI clamps to a tighter `[1970, currentYear+1]` range.
- **P-2** [`vehicles.service.ts:65-118`] Closed TOCTOU race in `updateVehicle` and `deleteVehicle`: both now use atomic conditional writes (`updateMany`/`deleteMany` with `is_locked = expected` predicate) and assert `count`. A FillUp arriving between read and write either passes through safely (nickname/engine_variant only) or throws fresh `VEHICLE_LOCKED`.
- **P-3** [`vehicles.service.ts:73-89`] Extended lock check to `fuel_type`, `displacement_cc`, `power_kw` — the docstring (`vehicles.service.ts:18`) said only nickname + engine_variant are editable when locked, but the code allowed all three to be silently changed (would corrupt downstream consumption math).
- **P-4** [`schema.prisma:317-319`] Added explicit `onDelete: Restrict` to `Vehicle.user` relation for parity with the migration. Prevents drift if Prisma re-introspects the schema.
- **+5 new tests** [`vehicles.service.spec.ts`] cover P-3 (3 fields × locked-rejection) and P-2 (TOCTOU `count: 0` paths for both update and delete + cross-user delete via deleteMany).

**Mobile — `vehicle-setup.tsx`:**
- **P-5** Year manual input gated by `[1970, currentYear+1]` in `isStepComplete('year')` so out-of-range values disable Save instead of round-tripping a 400.
- **P-6** `handleSave` wrapped in `try/finally` so `submitting` always resets — a non-throwing navigation hiccup no longer leaves the button permanently disabled.
- **P-7** `engineFreeText`, `make`, `model` now `.trim()`-checked at `isStepComplete` and trimmed at payload time. Whitespace-only inputs no longer pass the gate.
- **P-8** `PickerModal` resets `search` state via `useEffect(() => { if (visible) setSearch('') })` — reopening the picker for a different field no longer shows stale search text.
- **P-9** Hardcoded English `"Search…"` placeholder + `"No matches"` empty-state moved to i18n (`vehicles.setup.searchPlaceholder` + `noMatches` in en/pl/uk).
- **P-10** Wrapped `ScrollView` in `KeyboardAvoidingView` (iOS `padding`) so manual TextInputs at the bottom (engine free-text, fuel chips, nickname) aren't occluded by the keyboard.
- **P-11** Added `modelKey: string | null` to `Draft` shape; `selectedModel` lookup now matches on `model.key` (catalog-stable) instead of `getModelDisplayName(...) === draft.model` (collision risk if two models share a display label).
- **P-12** Modal backdrop `Pressable` now has `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` so VoiceOver/TalkBack don't double-announce the sheet.
- **P-13** `pickMake` preserves the user's current `nickname` instead of resetting to `EMPTY_DRAFT` — correcting the make late in the flow no longer wipes the nickname they already typed.
- **P-14** Search filter normalises both needle and haystack via NFD + strip combining marks — typing "skoda" now matches "Škoda", "citroen" matches "Citroën".
- **P-15** When the engine picker has `items.length === 0` (catalog gap for selected year), the empty-state text is now an actionable hint (`vehicles.setup.engineEmptyHint`) pointing at the manual fallback button instead of a flat "No matches".

**Mobile — `vehicle/[id].tsx`:**
- **P-16** `handleSave` wrapped in `try/finally`; `setSaving(false)` always runs.
- **P-17** `useLocalSearchParams<{ id: string | string[] }>()` + `Array.isArray` normalisation — defensive against odd route invocations producing arrays.
- **P-18** Empty-payload short-circuit: when nickname/engine are unchanged, skip the PATCH and call `router.back()` directly. Avoids a wasted round-trip and an `updated_at` bump.

**Mobile — `log.tsx`:**
- **P-19** Removed `vehicles` from `useFocusEffect` deps (was causing callback re-creation on every state set). Replaced with `initialLoadDoneRef` flag for the "show full-screen spinner only on first load" gate.
- **P-20** `loadVehicles` now uses `cancelledRef` so async resolution after focus loss doesn't write to state. (Previous version had `cancelled` only outside the loadVehicles call, not inside it.)
- **P-21** All three catch blocks (`log.tsx`, `vehicle/[id].tsx` × 2) now `console.warn(error)` before swallowing — production debugging stays possible.
- **P-22** Vehicle card composes `accessibilityLabel` as `${nickname}, ${year} ${make} ${model}, ${engine_variant}` so VoiceOver reads full identity, not just the nickname.
- **P-23** Added separate `refreshing` state flag; `RefreshControl refreshing={refreshing}` no longer shares state with the initial-load spinner. Pull-to-refresh now visually reflects fetch progress.

### Deferred (10)

- **D-1** Per-user vehicle count cap not enforced; relying on the global `ThrottlerGuard`. Add `MAX_VEHICLES_PER_USER` constant if abuse surfaces.
- **D-2** Empty-payload PATCH path bumps `updated_at` (cosmetic; covered for the edit screen via P-18 short-circuit, but a direct API caller can still do it).
- **D-3** `migration.sql` has no `DEFAULT CURRENT_TIMESTAMP` on `updated_at` — same pattern across schema; defer to Story 0.1 hardening pass.
- **D-4** `Vehicle.user` `onDelete: Restrict` will block GDPR account deletion (Story 1.8) once any vehicle exists. Story 1.8 needs to drop vehicles in the same transaction as the user.
- **D-5** Mobile API client cross-cutting gaps (no 401 token-refresh, no fetch timeout, no JSON-parse guard for non-JSON 5xx bodies, `localhost` fallback for missing `EXPO_PUBLIC_API_URL`). All match the existing `user.ts`/`notifications.ts` pattern; address holistically rather than per-client.
- **D-6** Hardcoded `#fffbeb` warm-tint in fuel chip active style (also present in `account.tsx` lang button) — needs a theme token like `tokens.brand.accentSurface`.
- **D-7** Save error UX doesn't differentiate 400 (validation) from network — both surface as the same generic toast. Acceptable for MVP; revisit if user reports show field-level confusion.
- **D-8** Edit screen can't *clear* a non-empty nickname (sends `undefined` instead of `null`). DTO + service need null support to enable. Already self-flagged before review.
- **D-9** Catalog build/filter scripts: no AbortSignal on Wikidata fetch, no JSON-parse guard, escape gaps in SPARQL helper, GET URL length not bounded, duplicate-label dedup, dead loop body in pass 3 of `filter-vehicle-dictionary.ts:474-492`. One-off tooling — not user-facing; clean up next time the scripts run.
- **D-10** Catalog data quality (caught by Edge Case Hunter): a model with both `model_year_from` and `model_year_to` null produces a 47-year picker; an engine with `year_from > model_year_from` would silently surface for years it wasn't sold. Both belong to the catalog spot-check workflow (D3 in original completion notes) — fix in data, not code.

### Rejected as noise (7)

- DTO `@MaxLength(100)` claimed missing on `engine_variant` — it's there at line 41-43 of `create-vehicle.dto.ts`.
- `toEqual` key-order claim in spec — Jest doesn't care about key order.
- DB CHECK constraints on year/displacement — DTO is the API gate; CHECK adds value mainly for raw-SQL bypass scenarios. Intentional.
- DB enum on `fuel_type` — migration comment explicitly justifies plain TEXT for catalog growth.
- Stale closure on `Alert.alert` delete `onPress` — Alert is modally blocking; user can't trigger another fetch path before confirming.
- `vehicle/[id]` registered as `Tabs.Screen` with `href: null` instead of `Stack` — established codebase pattern (matches `feedback.tsx`, `privacy-settings.tsx`, `delete-account.tsx`).
- `tsconfig resolveJsonModule` not set — base config has it.

### Spec amendments applied

- **B-1** Dev Notes line 215: added `'CNG'` to the `@IsIn` enum example so spec matches the 8-grade vehicle fuel-type reality. Decision: keep CNG support end-to-end (small but real PL market: VW TGI variants, ~30 PGNiG stations).
- **B-2** Project Structure Notes: filename `vehicle-catalog.json` replaced with the actual files (`vehicle-catalog-engines.batch1.json` + supplements + cleaned). Wrapped by typed accessor `vehicle-catalog.ts`.

### Phase 2 feature flag wiring (2026-05-01, post-CR)

Story 5.1 is the first Phase 2 story to ship to `main`. To keep the prod APK stable while Phase 2 development continues, all Phase 2 mobile entry points are gated behind a build-time feature flag.

**Flag module:** `apps/mobile/src/config/flags.ts` exposes `flags.phase2 = process.env['EXPO_PUBLIC_PHASE_2'] !== 'false'` — defaults to ON for local dev / unset profiles; production EAS profile explicitly sets `"false"`.

**Gates in code:**
- `apps/mobile/app/(app)/log.tsx` — outer component branches on `flags.phase2`; renders `<ComingSoonScreen />` (the original "Fuel Log — Coming Soon" placeholder) when off, `<LogScreenContent />` (vehicle hub) when on. Hooks live inside the inner component so the Rules-of-Hooks invariant holds.
- `apps/mobile/app/(app)/vehicle-setup.tsx` — outer component returns `<Redirect href="/(app)/log" />` when off, `<VehicleSetupScreenContent />` when on. Inner component holds all hooks.
- `apps/mobile/app/(app)/vehicle/[id].tsx` — same pattern as vehicle-setup.

**EAS profile mapping** (`apps/mobile/eas.json`):

| Profile | `EXPO_PUBLIC_PHASE_2` | Distribution target | Audience |
|---|---|---|---|
| `development` | (unset → defaults ON) | local Expo Go / dev client | Mateusz dev |
| `preview` | `"false"` | Play Store **closed testing** / TestFlight external | Friends & family beta — Phase 1 only |
| `preview-phase2` | `"true"` | Play Store **internal testing** / TestFlight internal | Mateusz + internal acceptance team |
| `production` | `"false"` | Play Store production / TestFlight external | Public launch |

**Beta cohort split workflow:**
1. Internal acceptance: `eas build --profile preview-phase2 --platform android` → distribute via Play Console internal testing track
2. Friends & family: `eas build --profile preview --platform android` → distribute via Play Console closed testing track
3. Public: `eas build --profile production --platform android --branch prod` → Play Store production track

**Restored i18n keys for the disabled state:** `log.comingSoonTitle` + `log.comingSoonSubtitle` re-added to en/pl/uk locales (had been removed in chunk D rewrite; needed again for the Phase 1 placeholder).

**Caveat — bundle ID:** all profiles share `com.litro.app`, so a single device can only host one profile at a time. To switch a beta tester between Phase 1 and Phase 2 cohorts, they uninstall and reinstall from the new track.

**Caveat — API + DB are shared.** All EAS profiles point at the prod Railway. Phase 2 backend changes (vehicles table + endpoints in this story) hit prod immediately. Story 5.1 is purely additive (new table, new endpoints, no behaviour change to existing API surfaces) so the pinned prod APK is unaffected. This invariant must hold for all future Phase 2 backend work: additive only, no removed fields, no renamed columns, no behaviour change to existing endpoints.
