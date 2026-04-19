# Story 5.1: Vehicle Setup & Car Recognition

Status: ready-for-dev

## Story

As a **driver**,
I want to add my car to the app — either by photographing it or selecting from a dropdown — and record its engine details,
So that my fill-ups and consumption are tracked per vehicle and contribute to real-world stats for my car model.

## Acceptance Criteria

**AC1 — Entry paths:**
Given a driver sets up their first vehicle
When they are shown the vehicle setup screen
Then they are offered three entry paths: take a photo, upload from gallery, or enter manually via dropdowns

**AC2 — Photo recognition:**
Given a driver takes a photo or uploads from gallery
When the image is submitted to Claude Opus 4.6
Then the model identifies the most likely make, model, and year range and presents it as a suggestion with a confidence indicator
And the driver can confirm the suggestion or dismiss it and select manually

**AC3 — Manual cascading dropdown:**
Given a driver has confirmed or selected make and model
When they proceed to engine selection
Then a cascading dropdown presents: year → engine variant (sourced from InfoExpert or equivalent Polish vehicle dictionary)
And each engine variant displays: displacement, power (kW/HP), and fuel type — enough to uniquely identify the engine

**AC4 — Low-confidence silent fallback:**
Given Claude Vision cannot identify the car with sufficient confidence (below 0.6)
When recognition fails or confidence is low
Then the driver is taken directly to manual entry with no error shown — the suggestion step is silently skipped

**AC5 — Nickname and save:**
Given a driver has selected their engine variant
When they complete setup
Then they are offered an optional nickname field (e.g. "My Golf", "Work Car") — skippable
And the vehicle is saved with: make, model, year, engine variant, displacement, power, fuel type, nickname (if set)
And no registration plate is requested at any point

**AC6 — Vehicle selection on fill-up:**
Given a driver has at least one vehicle set up
When they record a fill-up or odometer reading (Stories 5.2, 5.4)
Then they can select which vehicle it applies to from a list of their saved vehicles
And if they have only one vehicle it is pre-selected automatically

**AC7 — Multiple vehicles:**
Given a driver wants to add another vehicle
When they open vehicle settings
Then they can add additional vehicles — no upper limit enforced at MVP
And each vehicle maintains its own independent fill-up and odometer history

**AC8 — Edit restrictions:**
Given a driver wants to edit a vehicle
When they open that vehicle's settings
Then they can update the nickname and engine variant
And make/model/year are locked (non-editable) after the first fill-up is linked to prevent history inconsistency

## Tasks / Subtasks

- [ ] T1: Schema — `Vehicle` model + migration (AC1, AC5–AC8)
  - [ ] T1a: Add `Vehicle` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Add `vehicles` relation to `User` model
  - [ ] T1c: Create migration `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql`

- [ ] T2: `VehicleRecognitionService` — Claude Opus 4.6 vision call (AC2, AC4)
  - [ ] T2a: Create `apps/api/src/vehicle/vehicle-recognition.service.ts`
  - [ ] T2b: Implement `recognize(imageBuffer, mediaType)` — calls Claude Opus 4.6 with VEHICLE_RECOGNITION_PROMPT; returns `VehicleRecognitionResult | null`; returns null when confidence < 0.6
  - [ ] T2c: Track Opus spend in Redis key `vehicle:vision:spend:{YYYY-MM-DD}` with 48h TTL (same `incrbyfloat` pattern as `OcrSpendService`) — log `[OPS-ALERT]` if daily spend exceeds $5

- [ ] T3: `VehiclesService` — CRUD (AC1, AC5–AC8)
  - [ ] T3a: Create `apps/api/src/vehicle/vehicles.service.ts`
  - [ ] T3b: Implement `listVehicles(userId)`, `createVehicle(userId, dto)`, `getVehicle(userId, vehicleId)`, `updateVehicle(userId, vehicleId, dto)`, `deleteVehicle(userId, vehicleId)`
  - [ ] T3c: `updateVehicle` — if `vehicle.is_locked === true`, reject changes to make/model/year with 409; allow nickname and engine_variant changes
  - [ ] T3d: `deleteVehicle` — reject with 409 if vehicle has fill-ups linked (`is_locked === true`)

- [ ] T4: `VehiclesController` — API endpoints (AC1, AC2, AC5–AC8)
  - [ ] T4a: Create `apps/api/src/vehicle/vehicles.controller.ts` with routes under `v1/me/vehicles`
  - [ ] T4b: `POST /v1/me/vehicles/recognize` — accepts `multipart/form-data` with `photo` field; calls `VehicleRecognitionService.recognize()`; returns suggestion or `{ suggestion: null }`
  - [ ] T4c: `GET /v1/me/vehicles` — list user's vehicles
  - [ ] T4d: `POST /v1/me/vehicles` — create vehicle; returns created record
  - [ ] T4e: `GET /v1/me/vehicles/:id` — get single vehicle (scoped to authenticated user)
  - [ ] T4f: `PATCH /v1/me/vehicles/:id` — update nickname/engine_variant (or make/model/year if not locked)
  - [ ] T4g: `DELETE /v1/me/vehicles/:id` — delete vehicle if no fill-ups linked

- [ ] T5: `VehicleModule` + app registration (AC1)
  - [ ] T5a: Create `apps/api/src/vehicle/vehicle.module.ts` — registers services, controller, Redis injection
  - [ ] T5b: Import `VehicleModule` in `apps/api/src/app.module.ts`

- [ ] T6: Mobile — API client (AC1–AC8)
  - [ ] T6a: Create `apps/mobile/src/api/vehicles.ts` — typed interfaces + fetch wrappers for all 6 endpoints

- [ ] T7: Mobile — `vehicle-setup.tsx` multi-step screen (AC1–AC5)
  - [ ] T7a: Create `apps/mobile/app/(app)/vehicle-setup.tsx`
  - [ ] T7b: Step 0 — entry choice: three buttons (Take Photo / Choose from Gallery / Enter Manually)
  - [ ] T7c: Step 1 (photo path) — camera/gallery picker → upload to `POST /recognize` → show suggestion card with confidence bar; "Looks right" confirms; "Not my car" falls through to manual
  - [ ] T7d: Step 2 — manual make/model/year selection (see Dev Notes for InfoExpert risk + fallback)
  - [ ] T7e: Step 3 — engine variant selection (dependent on make/model/year from Step 2)
  - [ ] T7f: Step 4 — optional nickname input + Save button
  - [ ] T7g: On save, call `POST /v1/me/vehicles`; on success navigate back to `log` screen

- [ ] T8: Mobile — update `log.tsx` vehicle section (AC6, AC7)
  - [ ] T8a: Replace "coming soon" placeholder with a vehicle section: fetches `GET /v1/me/vehicles` on mount; if empty shows "Add your first vehicle" CTA; if vehicles present shows list of vehicle cards each with nickname/make/model/year and an edit icon
  - [ ] T8b: "Add vehicle" button navigates to `vehicle-setup`
  - [ ] T8c: Vehicle card tap navigates to vehicle detail/edit screen (inline sheet or new screen)

- [ ] T9: i18n — all 3 locales (AC1–AC8)
  - [ ] T9a: Add `vehicles` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes for full string list)
  - [ ] T9b: Remove or replace `log.comingSoonTitle` / `log.comingSoonSubtitle` — `log` section now describes the vehicle+log hub

- [ ] T10: Tests
  - [ ] T10a: `vehicle-recognition.service.spec.ts` — returns null when API confidence < 0.6; returns structured result when confidence ≥ 0.6; handles Anthropic API errors gracefully (returns null, does not throw)
  - [ ] T10b: `vehicles.service.spec.ts` — create/list/get/update/delete happy paths; PATCH rejects make/model/year change when `is_locked = true`; DELETE rejects when `is_locked = true`; vehicles scoped to user (cannot access another user's vehicles)
  - [ ] T10c: Full regression suite — all existing tests still pass

## Dev Notes

### ⚠️ InfoExpert licensing prerequisite

The cascading make/model/year/engine dropdown (AC3, T7d/T7e) requires a Polish vehicle dictionary. **InfoExpert** (or equivalent) licensing is **not yet confirmed**.

**Fallback implementation** (use if InfoExpert is not licensed by implementation time):
- Step 2: three free-text inputs — Make, Model, Year (numeric). Pre-fill from recognition suggestion if available.
- Step 3: single free-text input for Engine Variant (e.g. "1.6 TDI 115 KM") with a helper label showing format
- Add `// TODO(InfoExpert): replace with cascading dropdown once licensed` comment at both steps

The photo recognition path (T7b/T7c) is fully independent of InfoExpert and must be implemented regardless. Do not block the whole story on the dictionary.

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
  fuel_type       String    // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  nickname        String?   // user-defined, e.g. "My Golf"
  is_locked       Boolean   @default(false)  // set to true by Story 5.2 on first fill-up
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt
  user            User      @relation(fields: [user_id], references: [id])

  @@index([user_id])
}
```

Add `vehicles Vehicle[]` to the `User` model.

`is_locked` is set to `true` by `FillUpService` (Story 5.2) when the first fill-up for this vehicle is created. Once locked, `PATCH` rejects changes to `make`, `model`, and `year`; it also blocks `DELETE`.

### Claude Opus recognition prompt

```
You are identifying a vehicle from a photograph.

Return a JSON object with exactly these fields:
- "make": string — the vehicle manufacturer (e.g. "Volkswagen", "Toyota", "Skoda", "Ford")
- "model": string — the model name (e.g. "Golf", "Corolla", "Octavia", "Focus")
- "year_from": number | null — earliest plausible production year for this generation
- "year_to": number | null — latest plausible production year (null if still in production)
- "confidence": number — your certainty from 0.0 to 1.0:
    0.9–1.0: make, model, and generation clearly and unambiguously identifiable
    0.6–0.89: make and model clear, but generation or trim uncertain
    below 0.6: too uncertain to make a reliable suggestion

If the image does not clearly show a vehicle (blurry, wrong subject, partial view where make/model cannot be determined), return:
{"make": null, "model": null, "year_from": null, "year_to": null, "confidence": 0}

Return only valid JSON — no markdown, no code fences, no explanation.
```

Return `null` (skip suggestion) when `confidence < 0.6`.

### VehicleRecognitionResult type

```ts
export interface VehicleRecognitionResult {
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  confidence: number; // 0.6–1.0 (already filtered — never below 0.6 in result)
}
```

### Opus pricing and spend tracking

Opus 4.6 pricing: `$15.00/MTok input`, `$75.00/MTok output`
PoC measured cost: ~$0.0045 per vehicle recognition event.

```ts
// vehicle-recognition.service.ts
private readonly INPUT_PRICE = 15.0;   // $/MTok
private readonly OUTPUT_PRICE = 75.0;  // $/MTok
private readonly DAILY_ALERT_THRESHOLD_USD = 5.0;
private readonly REDIS_KEY = (date: string) => `vehicle:vision:spend:${date}`;
```

Redis tracking is identical to `OcrSpendService` (`incrbyfloat`, 48h TTL). Log `[OPS-ALERT] Vehicle vision spend {amount} exceeds daily threshold` when threshold crossed (once per day — use a separate flag key `vehicle:vision:alerted:{date}`).

### API endpoint: POST /v1/me/vehicles/recognize

Accepts `multipart/form-data` with a single `photo` field (image file).

Response when suggestion found:
```json
{ "suggestion": { "make": "Volkswagen", "model": "Golf", "yearFrom": 2020, "yearTo": null, "confidence": 0.92 } }
```

Response when no reliable suggestion (confidence < 0.6 or API error):
```json
{ "suggestion": null }
```

Always returns 200 — never 422/500 for low confidence. The mobile app silently falls back to manual entry on `suggestion: null`.

Use `@UseInterceptors(FileInterceptor('photo'))` with NestJS Multer. Store image in memory buffer only — do not persist to disk or R2 (vehicle photos are not user content).

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
  @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG']) fuel_type: string;
  @IsOptional() @IsString() @MaxLength(50) nickname?: string;
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
  @IsOptional() @IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG']) fuel_type?: string;
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
  created_at: string;
}

export interface VehicleRecognitionResponse {
  suggestion: {
    make: string;
    model: string;
    yearFrom: number | null;
    yearTo: number | null;
    confidence: number;
  } | null;
}

export async function apiRecognizeVehicle(accessToken: string, photoUri: string): Promise<VehicleRecognitionResponse>
export async function apiListVehicles(accessToken: string): Promise<Vehicle[]>
export async function apiCreateVehicle(accessToken: string, payload: CreateVehiclePayload): Promise<Vehicle>
export async function apiUpdateVehicle(accessToken: string, id: string, payload: Partial<CreateVehiclePayload>): Promise<Vehicle>
export async function apiDeleteVehicle(accessToken: string, id: string): Promise<void>
```

`apiRecognizeVehicle` uses `FormData` (same pattern as `uploadSubmission` in `submissions.ts`) — do NOT set `Content-Type` manually; let fetch set the multipart boundary.

### Mobile multi-step flow design

`vehicle-setup.tsx` manages a `step` state (`'entry' | 'recognizing' | 'suggestion' | 'manual' | 'engine' | 'nickname'`) and a `draft` object that accumulates across steps.

```
entry         → [Take Photo] → recognizing → suggestion (if confidence ≥ 0.6) → engine → nickname
entry         → [Take Photo] → recognizing → manual (if confidence < 0.6)       → engine → nickname
entry         → [Enter Manually]            → manual                             → engine → nickname
```

**Recognizing step:** Show spinner + "Analysing your car…" — call `POST /recognize`; on response advance to `suggestion` or `manual` depending on result.

**Suggestion card:** Show make + model + year range in large text. Confidence bar (green ≥ 0.9, amber 0.6–0.89). Two buttons: "Looks right →" (confirms, advances to engine step with `draft` pre-filled) and "Not my car" (advances to manual step, clears draft).

**Manual step:** Three inputs — Make (text), Model (text), Year (numeric picker or text). If InfoExpert is available, replace with cascading dropdowns. Pre-fill from recognition suggestion draft if available (user may have tapped "Not my car" after seeing a close-but-wrong suggestion).

**Engine step:** Single free-text field for engine variant (e.g. "1.6 TDI 115 KM") + optional displacement + power + fuel type picker. If InfoExpert is available, show filtered engine variants as a picker.

**Nickname step:** Optional text input. "Skip" navigates forward without saving nickname.

### log.tsx update

Replace the placeholder with:
```tsx
// When vehicles list is loading: spinner
// When vehicles list is empty:
<View style={styles.emptyState}>
  <Text style={styles.emptyTitle}>{t('vehicles.noVehiclesTitle')}</Text>
  <Text style={styles.emptySubtitle}>{t('vehicles.noVehiclesSubtitle')}</Text>
  <TouchableOpacity onPress={() => router.push('/(app)/vehicle-setup')}>
    <Text>{t('vehicles.addFirstVehicle')}</Text>
  </TouchableOpacity>
</View>

// When vehicles exist: flat list of vehicle cards + "Add another vehicle" button at bottom
// Each card shows: nickname (or make + model), year, fuel_type badge, engine_variant
// Tap → navigate to vehicle detail/edit (inline bottom sheet for MVP)
```

Full fill-up history section (Stories 5.2, 5.5) will be added to `log.tsx` in those stories — Story 5.1 only owns the vehicle section.

### i18n strings

Add `vehicles` section to all 3 locales in `apps/mobile/src/i18n/locales/{en,pl,uk}.ts`:

```
noVehiclesTitle:     'No vehicles yet' | 'Brak pojazdów' | 'Немає транспортних засобів'
noVehiclesSubtitle:  'Add your car to track fill-ups and savings' | 'Dodaj swój samochód, aby śledzić tankowania i oszczędności' | 'Додайте свій автомобіль для відстеження заправок'
addFirstVehicle:     'Add my car' | 'Dodaj mój samochód' | 'Додати мій автомобіль'
addAnother:          'Add another vehicle' | 'Dodaj kolejny pojazd' | 'Додати інший транспортний засіб'
setupTitle:          'Add your vehicle' | 'Dodaj swój pojazd' | 'Додайте свій транспортний засіб'
choosePhoto:         'Take a photo' | 'Zrób zdjęcie' | 'Сфотографувати'
chooseGallery:       'Choose from gallery' | 'Wybierz z galerii' | 'Вибрати з галереї'
enterManually:       'Enter manually' | 'Wpisz ręcznie' | 'Ввести вручну'
recognising:         'Analysing your car…' | 'Analizuję Twój samochód…' | 'Аналізую автомобіль…'
suggestionTitle:     'Is this your car?' | 'Czy to Twój samochód?' | 'Це ваш автомобіль?'
confirmSuggestion:   'Looks right' | 'Tak, to mój' | 'Так, це мій'
rejectSuggestion:    'Not my car' | 'To nie mój samochód' | 'Це не мій автомобіль'
makePlaceholder:     'e.g. Volkswagen' | 'np. Volkswagen' | 'напр. Volkswagen'
modelPlaceholder:    'e.g. Golf' | 'np. Golf' | 'напр. Golf'
yearLabel:           'Year' | 'Rok' | 'Рік'
engineVariantLabel:  'Engine' | 'Silnik' | 'Двигун'
enginePlaceholder:   'e.g. 1.6 TDI 115 HP' | 'np. 1.6 TDI 115 KM' | 'напр. 1.6 TDI 115 к.с.'
fuelTypeLabel:       'Fuel type' | 'Rodzaj paliwa' | 'Тип палива'
nicknameLabel:       'Nickname (optional)' | 'Nazwa własna (opcjonalnie)' | 'Прізвисько (необов'язково)'
nicknamePlaceholder: 'e.g. My Golf' | 'np. Mój Golf' | 'напр. Мій Golf'
skipNickname:        'Skip' | 'Pomiń' | 'Пропустити'
saveVehicle:         'Save vehicle' | 'Zapisz pojazd' | 'Зберегти транспортний засіб'
editVehicle:         'Edit vehicle' | 'Edytuj pojazd' | 'Редагувати транспортний засіб'
lockedFields:        'Make, model and year cannot be changed after your first fill-up' | 'Marka, model i rok nie mogą być zmienione po pierwszym tankowaniu' | 'Марку, модель і рік не можна змінити після першої заправки'
deleteVehicle:       'Remove vehicle' | 'Usuń pojazd' | 'Видалити транспортний засіб'
deleteConfirm:       'Remove this vehicle?' | 'Usunąć ten pojazd?' | 'Видалити цей транспортний засіб?'
deleteBlocked:       'Cannot remove a vehicle with fill-up history' | 'Nie można usunąć pojazdu z historią tankowań' | 'Неможливо видалити транспортний засіб з історією заправок'
errorSaving:         'Failed to save vehicle' | 'Nie udało się zapisać pojazdu' | 'Не вдалося зберегти транспортний засіб'
errorLoading:        'Failed to load vehicles' | 'Nie udało się załadować pojazdów' | 'Не вдалося завантажити транспортні засоби'
```

Also update `log.comingSoonTitle` and `log.comingSoonSubtitle` — these keys can be removed once `log.tsx` is updated.

### Project Structure Notes

- New directory: `apps/api/src/vehicle/`
  - `vehicles.service.ts` (new)
  - `vehicle-recognition.service.ts` (new)
  - `vehicles.controller.ts` (new)
  - `vehicle.module.ts` (new)
  - `dto/create-vehicle.dto.ts` (new)
  - `dto/update-vehicle.dto.ts` (new)
  - `vehicles.service.spec.ts` (new)
  - `vehicle-recognition.service.spec.ts` (new)
- `packages/db/prisma/schema.prisma` (modified — new Vehicle model, User.vehicles relation)
- `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql` (new)
- `apps/api/src/app.module.ts` (modified — import VehicleModule)
- `apps/mobile/src/api/vehicles.ts` (new)
- `apps/mobile/app/(app)/vehicle-setup.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified — vehicle section replaces placeholder)
- `apps/mobile/src/i18n/locales/en.ts` (modified — vehicles section, update log keys)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- Claude Vision call pattern: [apps/api/src/ocr/ocr.service.ts](apps/api/src/ocr/ocr.service.ts)
- OcrSpendService (Redis spend tracking pattern): [apps/api/src/photo/ocr-spend.service.ts](apps/api/src/photo/ocr-spend.service.ts)
- Multipart upload pattern (mobile): [apps/mobile/src/api/submissions.ts](apps/mobile/src/api/submissions.ts)
- Photo pipeline worker (Multer/file handling): [apps/api/src/photo/photo-pipeline.worker.ts](apps/api/src/photo/photo-pipeline.worker.ts)
- Story 5.2 (sets `is_locked = true` on first fill-up; consumes `Vehicle.id` FK)
- Story 5.0 (`RegionalBenchmarkService.getLatestForStation` — consumed by Story 5.2, not 5.1)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.1 (line ~2127)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — Vehicle model, User.vehicles relation)
- `packages/db/prisma/migrations/<timestamp>_add_vehicles/migration.sql` (new)
- `apps/api/src/vehicle/vehicles.service.ts` (new)
- `apps/api/src/vehicle/vehicle-recognition.service.ts` (new)
- `apps/api/src/vehicle/vehicles.controller.ts` (new)
- `apps/api/src/vehicle/vehicle.module.ts` (new)
- `apps/api/src/vehicle/dto/create-vehicle.dto.ts` (new)
- `apps/api/src/vehicle/dto/update-vehicle.dto.ts` (new)
- `apps/api/src/vehicle/vehicles.service.spec.ts` (new)
- `apps/api/src/vehicle/vehicle-recognition.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import VehicleModule)
- `apps/mobile/src/api/vehicles.ts` (new)
- `apps/mobile/app/(app)/vehicle-setup.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified — vehicle section)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-1-vehicle-setup-car-recognition.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
