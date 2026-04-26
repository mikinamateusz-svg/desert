# Story 5.1: Vehicle Setup (Dictionary-based)

Status: in-progress

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

- [ ] T1: Schema — `Vehicle` model + migration (AC4, AC6, AC7)
  - [ ] T1a: Add `Vehicle` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Add `vehicles` relation to `User` model
  - [ ] T1c: Create migration `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql`

- [ ] T2: Dictionary build pipeline (AC1, AC3)
  - [ ] T2a: Create `apps/api/scripts/build-vehicle-dictionary.ts` — top-level orchestrator
  - [ ] T2b: Wikidata SPARQL helper that queries for car models by manufacturer (top ~30 brands relevant to PL market). Output: `make → model → year_from / year_to` JSON
  - [ ] T2c: Claude-based engine catalog generator — calls Claude Sonnet 4.6 once per (make, model, year_range) to enumerate European engine variants. Output: `model_id → engine_variants[]` JSON
  - [ ] T2d: Validator script — checks generated catalog is well-formed (required fields present, displacement/power within sane bounds, fuel_type in enum)
  - [ ] T2e: Commit the generated catalog to `packages/types/src/vehicle-catalog.json` so mobile + api both consume the same source. Also expose a TypeScript type for the catalog shape.

- [ ] T3: `VehiclesService` — CRUD (AC4, AC5, AC6, AC7)
  - [ ] T3a: Create `apps/api/src/vehicle/vehicles.service.ts`
  - [ ] T3b: Implement `listVehicles(userId)`, `createVehicle(userId, dto)`, `getVehicle(userId, vehicleId)`, `updateVehicle(userId, vehicleId, dto)`, `deleteVehicle(userId, vehicleId)`
  - [ ] T3c: `updateVehicle` — if `vehicle.is_locked === true`, reject changes to make/model/year with 409; allow nickname and engine_variant changes
  - [ ] T3d: `deleteVehicle` — reject with 409 if vehicle has fill-ups linked (`is_locked === true`)

- [ ] T4: `VehiclesController` — API endpoints (AC4–AC7)
  - [ ] T4a: Create `apps/api/src/vehicle/vehicles.controller.ts` with routes under `v1/me/vehicles`
  - [ ] T4b: `GET /v1/me/vehicles` — list user's vehicles
  - [ ] T4c: `POST /v1/me/vehicles` — create vehicle; returns created record
  - [ ] T4d: `GET /v1/me/vehicles/:id` — get single vehicle (scoped to authenticated user)
  - [ ] T4e: `PATCH /v1/me/vehicles/:id` — update nickname/engine_variant (or make/model/year if not locked)
  - [ ] T4f: `DELETE /v1/me/vehicles/:id` — delete vehicle if no fill-ups linked

- [ ] T5: `VehicleModule` + app registration
  - [ ] T5a: Create `apps/api/src/vehicle/vehicle.module.ts` — registers service + controller
  - [ ] T5b: Import `VehicleModule` in `apps/api/src/app.module.ts`

- [ ] T6: Mobile — API client
  - [ ] T6a: Create `apps/mobile/src/api/vehicles.ts` — typed interfaces + fetch wrappers for the 5 endpoints

- [ ] T7: Mobile — `vehicle-setup.tsx` cascading dropdown screen (AC1, AC2, AC3, AC4)
  - [ ] T7a: Create `apps/mobile/app/(app)/vehicle-setup.tsx`
  - [ ] T7b: Step 1 — Make dropdown (sourced from catalog), with "type manually" affordance
  - [ ] T7c: Step 2 — Model dropdown filtered by selected make, with "type manually" affordance
  - [ ] T7d: Step 3 — Year dropdown filtered by selected model's production years
  - [ ] T7e: Step 4 — Engine variant dropdown filtered by selected model + year, with "type manually" affordance
  - [ ] T7f: Step 5 — optional nickname input + Save button
  - [ ] T7g: On save, call `POST /v1/me/vehicles` with `user_entered=true` if any step used free-text; on success navigate back to `log` screen

- [ ] T8: Mobile — update `log.tsx` vehicle section (AC5, AC6)
  - [ ] T8a: Replace "coming soon" placeholder with a vehicle section: fetches `GET /v1/me/vehicles` on mount; if empty shows "Add your first vehicle" CTA; if vehicles present shows list of vehicle cards (nickname/make/model/year + edit icon)
  - [ ] T8b: "Add vehicle" button navigates to `vehicle-setup`
  - [ ] T8c: Vehicle card tap navigates to vehicle detail/edit screen (inline sheet or new screen)

- [ ] T9: i18n — all 3 locales
  - [ ] T9a: Add `vehicles` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes for full string list)
  - [ ] T9b: Remove or replace `log.comingSoonTitle` / `log.comingSoonSubtitle` — `log` section now describes the vehicle+log hub

- [ ] T10: Tests
  - [ ] T10a: `vehicles.service.spec.ts` — create/list/get/update/delete happy paths; PATCH rejects make/model/year change when `is_locked = true`; DELETE rejects when `is_locked = true`; vehicles scoped to user (cannot access another user's vehicles)
  - [ ] T10b: Catalog validator unit test — well-formed sample passes; missing required field fails; out-of-range displacement fails; bad fuel_type fails
  - [ ] T10c: Full regression suite — all existing tests still pass

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
  @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG', 'EV', 'PHEV']) fuel_type: string;
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
  @IsOptional() @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG', 'EV', 'PHEV']) fuel_type?: string;
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
- New: `packages/types/src/vehicle-catalog.json` (committed catalog data)
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

### Completion Notes List

### File List

(Updated during implementation)
