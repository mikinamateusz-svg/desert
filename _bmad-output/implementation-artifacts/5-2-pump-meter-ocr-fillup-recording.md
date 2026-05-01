# Story 5.2: Pump Meter OCR & Fill-Up Recording

Status: in-progress

## Story

As a **driver**,
I want to take a photo of the pump meter display after filling up,
So that the app automatically records my fill-up volume, cost, and fuel type without manual entry.

## Acceptance Criteria

**AC1 — Entry point:**
Given a driver taps "Log fill-up" on the map screen (or the fill-up nudge on a price confirmation screen)
When location permission has been granted
Then the in-app camera opens with a framing overlay guiding them to capture the pump display clearly — no station pre-selection required; GPS matching uses the same 200m radius logic as price board submission

**AC2 — Location required:**
Given location permission has not been granted
When they attempt to open the fill-up camera
Then a blocking screen is shown explaining location is needed, with a deep-link to device settings — identical behaviour to price board capture

**AC3 — OCR extraction:**
Given a driver takes a pump meter photo
When it is submitted to the backend OCR endpoint
Then Claude Haiku extracts: total cost (PLN), volume (litres), and price per litre — all three must be present for a successful extraction
And the response is synchronous (within the HTTP request) — no BullMQ queue for fill-up OCR

**AC4 — Fuel type confirmation:**
Given OCR has extracted a fuel type suggestion from the pump display
When the driver sees the confirmation screen
Then the suggested fuel type is displayed with a one-tap correction option (dropdown: LPG, Diesel, PB 95, PB 98, ON Premium)
And they are never blocked — the correction is always available

**AC5 — Odometer nudge:**
Given a driver confirms or corrects the fuel type
When they tap "Save"
Then before landing on the confirmation screen, a single-screen odometer nudge is shown: "Add odometer reading for l/100km tracking →" with an "Add reading" input and a clearly visible "Skip" option
And skipping saves the FillUp without an odometer reading

**AC6 — FillUp record creation:**
Given a driver confirms the fuel type and either adds or skips the odometer reading
When the FillUp record is saved
Then a FillUp record is created with: timestamp, vehicle, station (GPS-matched or null), fuel type, litres, total cost PLN, price per litre PLN, area_avg_at_fillup (most recent regional benchmark for this voivodeship × fuel_type, or null if none)
And the Vehicle's `is_locked` flag is set to `true`
And the price per litre is written as a community PriceHistory entry for (station × fuel_type) — only if station was matched

**AC7 — Dual celebration:**
Given the fill-up confirmation screen is shown
When it is displayed
Then it shows fill-up data (e.g. "47.3L · 314 PLN") and, if a station was matched, the community update badge ("PB95 at Orlen updated ✓")
And a secondary nudge offers: "Other fuel prices here may be outdated — update them? Add price →" — one tap opens the price board camera; dismissing requires no action

**AC8 — No-match save:**
Given GPS station matching fails (no station within 200m)
When the fill-up is saved
Then it is saved without a station link — volume, cost, and fuel type are retained
And no PriceHistory entry is written
And no community update badge is shown on the confirmation screen

**AC9 — OCR failure fallback:**
Given OCR cannot extract all three required values (cost, volume, price per litre)
When processing completes
Then the driver is shown a retake prompt — they may tap "Enter manually" as a fallback to type in the three values

**AC10 — OCR service down:**
Given the OCR endpoint returns a 5xx error or times out (>10 seconds)
When the failure is detected
Then the driver is taken directly to manual entry (same screen as retake fallback) — no spinner stuck indefinitely, no crash

**AC11 — Manual entry path:**
Given a driver chooses "Enter manually" (retake fallback or OCR failure)
When they provide total cost, volume, and price per litre
Then the same fuel type confirmation → odometer nudge → save flow applies — no difference from the OCR path from confirmation onwards

## Tasks / Subtasks

- [x] T1: Schema — `FillUp` model + migration (AC6, AC8)
  - [x] T1a: Add `FillUp` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [x] T1b: Add `fillUps FillUp[]` relation to `User` and `Vehicle` models; add optional `fillUps FillUp[]` to `Station`
  - [x] T1c: Create migration `packages/db/prisma/migrations/20260501000000_add_fill_ups/migration.sql`

- [x] T2: `FillupOcrService` — synchronous Claude Haiku OCR (AC3, AC9, AC10)
  - [x] T2a: Create `apps/api/src/fillup/fillup-ocr.service.ts`
  - [x] T2b: Implement `extractFromPumpMeter(imageBuffer, mediaType)` — calls Claude Haiku with PUMP_METER_OCR_PROMPT; returns `FillupOcrResult`; returns `{ confidence: 0 }` (all nulls) on parse failure / timeout / API error
  - [x] T2c: Track Haiku spend for pump meter OCR — pre-computes cost using **Haiku** rates (input $1/M, output $5/M) and passes the precomputed amount to `OcrSpendService.recordSpend()`. The shared service's `computeCostUsd` is keyed to Gemini Flash rates (existing OCR), so re-using it would under-report Haiku spend. Same daily cap, accurate accounting.

- [x] T3: `FillupService` — business logic (AC6, AC7, AC8)
  - [x] T3a: Create `apps/api/src/fillup/fillup.service.ts`
  - [x] T3b: Implement `createFillup(userId, dto)`:
    - Vehicle ownership check — throws **403 Forbidden** when the vehicle exists but belongs to a different user; **404 NotFound** when missing.
    - GPS station match — only when `gpsLat` and `gpsLng` are both present; calls `StationService.findNearestStation(lat, lng, 200)` (nullable result).
    - Benchmark snapshot — only when station matched; `RegionalBenchmarkService.getLatestForStation(stationId, fuelType)` (nullable). Cold-start regions get `area_avg_at_fillup: null`.
    - `FillUp` row written with `gps_lat`/`gps_lng` NOT persisted (privacy — same convention as Submission). GPS lives only in the request DTO.
    - If station matched: writes `PriceHistory(source: 'community')` and clears `StationFuelStaleness` for (station × fuelType). Both side-effects are best-effort — failures are logged, do not propagate, and `communityUpdated` reflects the actual write success.
    - `vehicle.is_locked` flipped to `true` via atomic `updateMany({ where: { id, is_locked: false }, ... })` — race-safe under concurrent fill-ups, no-op fast path when already locked.
  - [x] T3c: Implement `listFillups(userId, vehicleId?, page, limit)` — paginated newest-first, optional vehicleId filter scoped to caller, page/limit clamped (page ≥ 1, limit ≤ 100).

- [x] T4: `FillupController` — API endpoints (AC3, AC6, AC9, AC10, AC11)
  - [x] T4a: Create `apps/api/src/fillup/fillup.controller.ts` — routes under `v1/me/fillups`, allow-list of all driving roles
  - [x] T4b: `POST /v1/me/fillups/ocr` — multipart/form-data with `photo` field; 10s timeout via AbortSignal inside service; **always returns 200** with FillupOcrResult (confidence: 0 routes mobile to manual entry)
  - [x] T4c: `POST /v1/me/fillups` — JSON body, returns 201 Created with `{ fillUp, stationMatched, stationName, communityUpdated }` for celebration screen
  - [x] T4d: `GET /v1/me/fillups` — paginated list with `?vehicleId=` / `?page=` / `?limit=` query params

- [x] T5: `FillupModule` + app registration
  - [x] T5a: `apps/api/src/fillup/fillup.module.ts` — imports StationModule, RegionalBenchmarkModule, PhotoModule (for OcrSpendService); exports FillupService for Stories 5.3 / 5.5
  - [x] T5b: `FillupModule` registered in `apps/api/src/app.module.ts` after VehicleModule

- [x] T6: Mobile — API client (AC3, AC6)
  - [x] T6a: `apps/mobile/src/api/fillups.ts` — typed `FillUp` / `FillupOcrResult` / `CreateFillupPayload` / `CreateFillupResponse` / `ListFillupsResponse` interfaces + `apiRunFillupOcr` (multipart), `apiCreateFillup`, `apiListFillups`. Mirrors the auth header / fetch pattern from `vehicles.ts`. OCR upload deliberately skips the `Content-Type` header so fetch derives the multipart boundary (same trick used by submissions.ts).

- [x] T7: Mobile — `fillup-capture.tsx` screen (AC1–AC5, AC7–AC11)
  - [x] T7a: Outer-component Phase 2 gate — `flags.phase2 === false` returns `<Redirect href="/(app)" />` so Phase 1 prod APK can't deep-link in. Inner content holds all hooks (Rules-of-Hooks clean, mirrors the pattern from log.tsx / vehicle-setup.tsx).
  - [x] T7b: Step `'camera'` — `CameraView` with pump-display framing rectangle (narrower / shorter than the price-board overlay because pump LCDs are smaller and closer). `useLocation` permission gate flows into `'location-required'` step. Camera-mount-on-focus + permission-undetermined-prompt patterns lifted from capture.tsx. `MIN_FREE_BYTES` storage check before `takePictureAsync`.
  - [x] T7c: Step `'processing'` — `apiRunFillupOcr` call. Server contract: always 200, `confidence: 0` on any failure. Client routes to `'confirm'` when `confidence ≥ 0.6` AND all three required values are present, otherwise `'manual'` with partial pre-fill.
  - [x] T7d: Step `'confirm'` — shared form with `'manual'` (same fields, same Save flow). Fuel-type chip row + vehicle chip row (only when >1 vehicle — single-vehicle case is auto-selected and hidden).
  - [x] T7e: Step `'manual'` — same form as confirm but with retake-prompt copy. Pre-filled with whatever OCR returned; user types in any nulls.
  - [x] T7f: Step `'odometer'` — numeric input + "Add reading" + "Skip". Both paths route to `'saving'`. `// TODO(Story 5.4)` comment marks where the photo-OCR option will be added.
  - [x] T7g: Step `'saving'` — `apiCreateFillup` call. On success → `'celebration'`. On error → bounce back to `'manual'` with `errorMessage` so the user doesn't lose their typed values.
  - [x] T7h: Step `'celebration'` — fill-up summary (`{{litres}} L · {{cost}} PLN`), community-updated badge (only when `stationMatched && communityUpdated`), "Add price →" nudge that routes to `/(app)/capture`, "Done" → log screen.

- [x] T8: Mobile — add "Log fill-up" entry point to map screen (`index.tsx`) (AC1)
  - [x] T8a: Phase-2-gated `TouchableOpacity` rendered above the existing `MapFABGroup` row. Accent colour (different from the dark "Add price" pill) to avoid mental-model confusion between "log my own fill-up" and "contribute a price-board photo". Hidden during splash + while a station detail sheet is open. Guest tap opens the same `SoftSignUpSheet` as Add price (symmetry — the photo + the fill-up are both contribution paths).
  - [x] T8b: No-vehicles guard implemented inline on `fillup-capture.tsx` (renders the "Set up your vehicle first" prompt when `vehicles.length === 0`) rather than blocking navigation. Spec called for "do not block navigation entirely — just show the prompt", which the screen does.

- [x] T9: i18n — all 3 locales (AC1–AC11)
  - [x] T9a: `fillup` section added to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (~25 keys/locale): `logFillupCta`, camera/processing/confirm/odometer/celebration copy, `addPrice` nudge, `errorSaving`, `noVehicleTitle`/`noVehicleAction`, `locationRequired`. Re-uses `vehicles.fuelTypes.*` for fuel-type pill labels so we don't duplicate translations.

- [x] T10: Tests
  - [x] T10a: `fillup-ocr.service.spec.ts` — 13 tests covering Haiku call shape, AbortSignal timeout, never-throws on API error, Haiku-rated spend tracking ($1/M in, $5/M out — separate from Gemini-rated `OcrSpendService.computeCostUsd`), JSON parse / value coercion / fuel-type validation / confidence clamping / parse failure recovery.
  - [x] T10b: `fillup.service.spec.ts` — 15 tests covering NotFound on missing vehicle, Forbidden on cross-user, GPS station match writes PriceHistory + clears staleness, benchmark snapshot present / null, no-match path skips PriceHistory + benchmark + staleness, missing GPS skips matching entirely, vehicle locks on first fill-up via atomic `updateMany`, no-op fast path when already locked, custom `filledAt` honoured, PriceHistory + staleness failures don't propagate.
  - [x] T10c: Full regression — 944/944 api + 22/22 mobile pass; tsc clean across api / mobile / types.

## Dev Notes

### FillUp schema

```prisma
model FillUp {
  id                  String   @id @default(uuid())
  user_id             String
  vehicle_id          String
  station_id          String?  // null if GPS match failed
  fuel_type           String   // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  litres              Float
  total_cost_pln      Float
  price_per_litre_pln Float
  area_avg_at_fillup  Float?   // median from RegionalBenchmark at time of fill-up; null if no benchmark
  odometer_km         Int?     // manual entry in this story; OCR path added in Story 5.4
  filled_at           DateTime @default(now())
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt
  user                User     @relation(fields: [user_id], references: [id])
  vehicle             Vehicle  @relation(fields: [vehicle_id], references: [id])
  station             Station? @relation(fields: [station_id], references: [id], onDelete: SetNull)

  @@index([user_id, filled_at(sort: Desc)])
  @@index([vehicle_id, filled_at(sort: Desc)])
}
```

`odometer_km` is nullable here — Story 5.4 adds the OCR path to populate it. Manual numeric entry in this story populates it the same way.

### Pump meter OCR prompt

```
You are reading a fuel pump meter display.

Extract exactly three values from the display:
- "totalCostPln": the total amount paid in Polish złoty (the largest number, typically labelled "Suma", "Do zapłaty", or "PLN")
- "litres": volume dispensed in litres (typically labelled "Ilość", "Litry", or "L")
- "pricePerLitrePln": price per litre in PLN/L (typically labelled "Cena", "PLN/L", or "zł/L")
- "fuelTypeSuggestion": one of "PB_95", "PB_98", "ON", "ON_PREMIUM", "LPG" if visible on the display — otherwise null
- "confidence": your certainty 0.0–1.0
    0.9–1.0: all three values clearly readable, sharp display
    0.6–0.89: values readable but some blur or partial occlusion
    0.0–0.59: unable to reliably extract one or more required values

If you cannot reliably read all three required values, set each unreadable field to null.

Return only valid JSON — no markdown, no code fences:
{"totalCostPln": number|null, "litres": number|null, "pricePerLitrePln": number|null, "fuelTypeSuggestion": string|null, "confidence": number}
```

### FillupOcrResult type

```ts
export interface FillupOcrResult {
  totalCostPln: number | null;
  litres: number | null;
  pricePerLitrePln: number | null;
  fuelTypeSuggestion: 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG' | null;
  confidence: number;
}
```

When all three required values are present and `confidence >= 0.6`: advance to confirmation screen.
When any required value is null or `confidence < 0.6`: advance to manual entry screen.

### OCR endpoint timeout

The `POST /v1/me/fillups/ocr` handler uses a 10-second `AbortSignal.timeout(10_000)` on the Anthropic API call. On abort/timeout: return `FillupOcrResult` with all nulls and `confidence: 0` — do not throw 500. The mobile client always gets a 200 and falls back to manual entry on `confidence: 0`.

```ts
// fillup-ocr.service.ts
try {
  const response = await this.anthropic.messages.create(
    { model: 'claude-haiku-4-5', max_tokens: 256, messages: [...] },
    { signal: AbortSignal.timeout(10_000) },
  );
  // parse and return
} catch {
  return { totalCostPln: null, litres: null, pricePerLitrePln: null, fuelTypeSuggestion: null, confidence: 0 };
}
```

### createFillup DTO + GPS

```ts
// create-fillup.dto.ts
export class CreateFillupDto {
  @IsUUID() vehicleId: string;
  @IsIn(['PB_95','PB_98','ON','ON_PREMIUM','LPG']) fuelType: string;
  @IsNumber() @Min(0.1) @Max(500) litres: number;
  @IsNumber() @Min(1) @Max(10000) totalCostPln: number;
  @IsNumber() @Min(1) @Max(50) pricePerLitrePln: number;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) gpsLat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) gpsLng?: number;
  @IsOptional() @IsInt() @Min(0) @Max(9999999) odometerKm?: number;
  @IsOptional() filledAt?: string; // ISO datetime; defaults to now() if omitted
}
```

GPS coordinates are passed from the mobile client (captured at the moment of the photo). They are used server-side for station matching and then **not stored** on the FillUp record (privacy — same as Submission model).

### Community price write

When station is matched, write directly to `PriceHistory` (bypasses the submission queue — this data is already driver-confirmed):

```ts
await this.prisma.priceHistory.create({
  data: {
    station_id: stationId,
    fuel_type: dto.fuelType,
    price: dto.pricePerLitrePln,
    source: 'community',
    recorded_at: new Date(filledAt),
  },
});

// Clear staleness flag for this station × fuel_type
await this.prisma.stationFuelStaleness.deleteMany({
  where: { station_id: stationId, fuel_type: dto.fuelType },
});
```

Do NOT call `enqueueSubmission` or go through the photo pipeline — fill-up data is pre-confirmed. No logo matching or trust score required.

### POST /fillups response shape

```ts
interface CreateFillupResponse {
  fillUp: FillUpDto;
  stationMatched: boolean;
  stationName: string | null;   // for celebration screen
  communityUpdated: boolean;    // true if PriceHistory was written
}
```

### Mobile fillup-capture.tsx step machine

```ts
type FillupStep =
  | 'camera'
  | 'processing'   // spinner while OCR runs
  | 'confirm'      // shows OCR results, fuel type corrector
  | 'manual'       // manual entry fallback (also retake path)
  | 'odometer'     // nudge: enter km or skip
  | 'saving'       // spinner while POST /fillups runs
  | 'celebration'  // success screen
  | 'location-required'
  | 'error';

interface FillupDraft {
  photoUri?: string;
  gpsLat?: number;
  gpsLng?: number;
  totalCostPln?: number;
  litres?: number;
  pricePerLitrePln?: number;
  fuelType?: FuelType;
  odometerKm?: number;
}
```

Reuse `useLocation` and `useNearbyStations` hooks from `capture.tsx` — same permission check, same 200m GPS logic. Do not duplicate permission-check logic; extract to shared hook if not already.

### "Log fill-up" button on map screen

Add a secondary FAB or bottom-sheet action to `apps/mobile/app/(app)/index.tsx`. Placement: lower-left (the "Add price" button sits lower-right; "Log fill-up" sits lower-left, distinct colours to avoid confusion). Navigates to `/(app)/fillup-capture`.

Guard: if `GET /v1/me/vehicles` returns an empty list when the button is tapped, show a bottom sheet: "Set up your vehicle first" → "Add my car" (navigates to `/(app)/vehicle-setup`). Do not block navigation entirely — just show the prompt.

### Odometer nudge (Story 5.4 integration point)

In Story 5.2, the odometer nudge is a **plain numeric input** (keyboard type: `number-pad`). No OCR in this story. The same nudge screen will be augmented in Story 5.4 to add a "Take photo" option that runs odometer OCR.

Placeholder comment in `fillup-capture.tsx` Step 3:
```tsx
{/* TODO(Story 5.4): Add "Take odometer photo" option here for OCR-based reading */}
<TextInput keyboardType="number-pad" placeholder={t('fillup.odometerPlaceholder')} ... />
```

### i18n strings

Add `fillup` section to all 3 locales:

```
cameraOverlay:         'Point at pump display' | 'Skieruj na wyświetlacz dystrybutora' | 'Наведіть на дисплей пістолета'
processing:            'Reading your pump display…' | 'Odczytuję wyświetlacz…' | 'Зчитую дисплей…'
confirmTitle:          'Confirm fill-up' | 'Potwierdź tankowanie' | 'Підтвердьте заправку'
totalCost:             'Total cost (PLN)' | 'Łączny koszt (PLN)' | 'Загальна вартість (PLN)'
volume:                'Volume (L)' | 'Ilość (L)' | 'Об'єм (L)'
pricePerLitre:         'Price per litre (PLN/L)' | 'Cena za litr (PLN/L)' | 'Ціна за літр (PLN/L)'
fuelType:              'Fuel type' | 'Rodzaj paliwa' | 'Тип палива'
saveButton:            'Save fill-up' | 'Zapisz tankowanie' | 'Зберегти заправку'
retakePrompt:          'Could not read display — try again or enter manually' | 'Nie mogłem odczytać wyświetlacza — spróbuj ponownie lub wpisz ręcznie' | 'Не вдалося зчитати дисплей — спробуйте знову або введіть вручну'
retakeButton:          'Retake photo' | 'Zrób zdjęcie ponownie' | 'Сфотографувати знову'
enterManually:         'Enter manually' | 'Wpisz ręcznie' | 'Ввести вручну'
odometerNudgeTitle:    'Track fuel consumption?' | 'Śledzić zużycie paliwa?' | 'Відстежувати витрату палива?'
odometerNudgeSubtitle: 'Add your odometer reading to calculate l/100km' | 'Dodaj stan licznika, aby obliczyć l/100km' | 'Додайте показник одометра для розрахунку л/100км'
odometerLabel:         'Odometer (km)' | 'Licznik (km)' | 'Одометр (км)'
odometerPlaceholder:   'e.g. 87450' | 'np. 87450' | 'напр. 87450'
addOdometer:           'Add reading' | 'Dodaj odczyt' | 'Додати показник'
skipOdometer:          'Skip' | 'Pomiń' | 'Пропустити'
celebrationFillup:     '{litres}L · {cost} PLN' | '{litres}L · {cost} PLN' | '{litres}L · {cost} PLN'
celebrationCommunity:  '{fuelType} at {station} updated ✓' | '{fuelType} w {station} zaktualizowane ✓' | '{fuelType} на {station} оновлено ✓'
nudgeOtherPrices:      'Other prices at this station may be outdated — add them?' | 'Inne ceny w tej stacji mogą być nieaktualne — dodaj je?' | 'Інші ціни на цій станції можуть бути застарілими — додати їх?'
addPrice:              'Add price →' | 'Dodaj cenę →' | 'Додати ціну →'
done:                  'Done' | 'Gotowe' | 'Готово'
errorSaving:           'Failed to save fill-up — tap to retry' | 'Nie udało się zapisać tankowania — dotknij, aby ponowić' | 'Не вдалося зберегти заправку — торкніться для повтору'
noVehicleTitle:        'Set up your vehicle first' | 'Najpierw dodaj swój pojazd' | 'Спочатку додайте свій транспортний засіб'
noVehicleAction:       'Add my car' | 'Dodaj mój samochód' | 'Додати мій автомобіль'
locationRequired:      'Location is needed to match your fill-up to a station' | 'Lokalizacja jest potrzebna, aby dopasować tankowanie do stacji' | 'Потрібна геолокація для прив'язки заправки до станції'
```

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — FillUp model; Vehicle/User/Station relations)
- `packages/db/prisma/migrations/<timestamp>_add_fill_ups/migration.sql` (new)
- New directory: `apps/api/src/fillup/`
  - `fillup.service.ts` (new)
  - `fillup-ocr.service.ts` (new)
  - `fillup.controller.ts` (new)
  - `fillup.module.ts` (new)
  - `dto/create-fillup.dto.ts` (new)
  - `fillup.service.spec.ts` (new)
  - `fillup-ocr.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import FillupModule)
- `apps/mobile/src/api/fillups.ts` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (new)
- `apps/mobile/app/(app)/index.tsx` (modified — add "Log fill-up" button)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- OCR service pattern (Claude Haiku, base64 image): [apps/api/src/ocr/ocr.service.ts](apps/api/src/ocr/ocr.service.ts)
- OcrSpendService (Redis spend tracking): [apps/api/src/photo/ocr-spend.service.ts](apps/api/src/photo/ocr-spend.service.ts)
- Photo capture screen pattern: [apps/mobile/app/(app)/capture.tsx](apps/mobile/app/(app)/capture.tsx)
- Multipart upload (mobile API): [apps/mobile/src/api/submissions.ts](apps/mobile/src/api/submissions.ts)
- StationService.findNearest: [apps/api/src/station/](apps/api/src/station/)
- RegionalBenchmarkService (Story 5.0): `apps/api/src/regional-benchmark/regional-benchmark.service.ts`
- Vehicle model + is_locked (Story 5.1): `apps/api/src/vehicle/vehicles.service.ts`
- Story 5.4 (odometer OCR — augments the nudge screen in this story)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.2 (line ~2181)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Existing `OcrSpendService` constants (`COST_PER_INPUT_MTOKEN_USD`, `COST_PER_OUTPUT_MTOKEN_USD`) are Gemini Flash rates with a stale "Claude" comment in `computeCostUsd`. Adding a Haiku-rated path inside that service would change behaviour for the existing Gemini consumers, so chunk A computes Haiku cost in `FillupOcrService` and passes the precomputed value to `recordSpend()`. The Gemini-flagged docstring on `computeCostUsd` is misleading and worth a follow-up rename, but out of scope for this story.
- Schema follows the established pattern: `created_at` has `DEFAULT CURRENT_TIMESTAMP` but `updated_at` does not (matches every other model in the repo). Story 0.1 will fix this cross-cutting; no point churning the new migration on top of the existing pattern.

### Completion Notes List

**2026-05-01 — chunk A (backend) shipped.**

Backend complete:
- `FillUp` model + migration `20260501000000_add_fill_ups` (additive — no existing tables modified).
- `FillupOcrService` (Claude Haiku 4.5, 10s timeout, never-throws, Haiku-rated spend tracking).
- `FillupService` with vehicle ownership check, GPS station match (200m), benchmark snapshot, optional PriceHistory write, optional staleness clear, atomic vehicle lock-on-first-fillup.
- `FillupController` with 3 endpoints under `v1/me/fillups` (OCR / create / list).
- `FillupModule` registered in app.module.ts.

**Tests:** 28 new (13 OCR + 15 service) → 944/944 api pass. Tsc clean.

**Phase 1 / prod APK invariant held:** chunk A is purely additive — new model, new endpoints, no behaviour changes to existing API surfaces. Pinned prod APK (`prod` branch / production EAS profile) doesn't call any of these new endpoints, so it's unaffected.

**Chunk B remaining (mobile, deferred to next session):**
- T6: `apps/mobile/src/api/fillups.ts` — typed wrappers
- T7: `apps/mobile/app/(app)/fillup-capture.tsx` — 6-step camera/OCR/confirm/odometer/save/celebration flow
- T8: "Log fill-up" entry on `index.tsx` (lower-left FAB)
- T9: i18n in en/pl/uk (~25 keys per locale)
- T10c: regression suite

**Phase 2 flag wrapping (chunk B):** per `project_phase2_feature_flag.md` the new mobile entry points (FAB on map + fillup-capture screen) must be wrapped behind `flags.phase2`. The OCR endpoint is server-side and naturally gated — Phase 1 prod APK doesn't surface it, so Phase 1 users can't trigger Haiku spend.

**Pre-launch follow-ups flagged:**
- **Consent / legal** (per `feedback_legal_docs_update.md` + `project_consent_model.md`): fill-ups introduce new data collection (cost, volume, fuel, station, area_avg, optional odometer). Privacy policy + terms drafts in `_bmad-output/planning-artifacts/privacy-policy-draft-pl.md` need a feature-specific consent AC and an updated data-processing section before public launch. Not blocking for solo testing.
- **OcrSpendService docstring drift**: `computeCostUsd` comment says "Claude API call" but the constants are Gemini rates. Rename or add per-model rates in a separate cleanup story.
- **Cap awareness**: the existing $20/day OCR cap is now shared across two services (Gemini Flash for price boards + Haiku for fill-ups). At nominal Haiku cost ~$0.002/call, that's ~10K fillup-OCR calls/day before the cap bites — plenty of headroom.

### Completion Notes List (chunk B close-out — 2026-05-01)

**Chunk B mobile UI shipped.**

Mobile complete:
- `apps/mobile/src/api/fillups.ts` — typed wrappers for the 3 endpoints
- `apps/mobile/app/(app)/fillup-capture.tsx` — 6-step wizard (camera → processing → confirm/manual → odometer → saving → celebration), location-required + camera-error states. Outer Phase 2 gate via `flags.phase2`; inner content holds all hooks. Includes a deep-link safety net for the no-vehicles case so a stale link can't crash the screen.
- `apps/mobile/app/(app)/_layout.tsx` — `fillup-capture` registered as a hidden tab (`href: null`).
- `apps/mobile/app/(app)/index.tsx` — Phase-2-gated "Log fill-up" FAB above the existing `MapFABGroup` row. Accent colour, distinct from the dark "Add price" pill. Guest tap reuses the existing `SoftSignUpSheet` for symmetry.
- `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` — `fillup` section added (~25 keys per locale, plus `logFillupCta` for the FAB label).

**Tests:** 944/944 api + 22/22 mobile pass. Tsc clean across api / mobile / types.

**Phase 1 prod APK invariant held end-to-end:**
- `flags.phase2 = false` for production EAS profile → `index.tsx` doesn't render the Log fill-up FAB → user can't reach the screen via UI.
- `fillup-capture.tsx` itself has an outer-component `<Redirect href="/(app)" />` when `flags.phase2` is off → deep-links / stale notifications can't surface the screen either.
- Backend endpoints exist on the shared prod API but are unreachable from the prod APK (no client-side caller).

**Open items / known follow-ups:**
- **Pre-launch consent / legal** — fill-ups introduce new data collection (cost, volume, fuel, station, area_avg, optional odometer). Privacy policy + terms drafts in `_bmad-output/planning-artifacts/privacy-policy-draft-pl.md` need a feature-specific consent AC + data-processing section before public launch. Not blocking for solo / acceptance testing.
- **Code review pass owed** — chunks A + B haven't been adversarially reviewed yet. Per `feedback_code_review.md` this should run before final story close-out. Will dispatch on next session unless something urgent surfaces from manual testing first.
- **Gemini-vs-Haiku decision** — Mateusz is collecting more pump-display photos to benchmark Gemini Flash against Haiku for this OCR endpoint. If Gemini wins, swap is a ~30 line change in `FillupOcrService` (move `messages.create` call to a Gemini-shaped POST + drop the Haiku-rate spend pre-computation since `OcrSpendService.computeCostUsd` is already Gemini-keyed).
- **Logo benchmark side-task** — `_bmad-output/analysis/run-logo-benchmark.mjs` + `analyse-logo-benchmark.mjs` shipped to support an unrelated Gemini-vs-Haiku decision for Story 3.6 (logo recognition). Not part of 5.2 scope; tracked separately.

### File List

- `packages/db/prisma/schema.prisma` (modified — FillUp model, Vehicle/User/Station relations)
- `packages/db/prisma/migrations/<timestamp>_add_fill_ups/migration.sql` (new)
- `apps/api/src/fillup/fillup.service.ts` (new)
- `apps/api/src/fillup/fillup-ocr.service.ts` (new)
- `apps/api/src/fillup/fillup.controller.ts` (new)
- `apps/api/src/fillup/fillup.module.ts` (new)
- `apps/api/src/fillup/dto/create-fillup.dto.ts` (new)
- `apps/api/src/fillup/fillup.service.spec.ts` (new)
- `apps/api/src/fillup/fillup-ocr.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified)
- `apps/mobile/src/api/fillups.ts` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (new)
- `apps/mobile/app/(app)/index.tsx` (modified — Log fill-up button)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-2-pump-meter-ocr-fillup-recording.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
