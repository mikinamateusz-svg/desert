# Story 5.4: Odometer OCR & Consumption Tracking

Status: review

## Story

As a **driver**,
I want to take a photo of my odometer at each fill-up,
So that the app automatically calculates my fuel consumption in l/100km without me keeping a manual logbook.

## Acceptance Criteria

**AC1 — Vehicle selection:**
Given a driver opens the odometer capture flow (standalone or via fill-up nudge)
When they proceed
Then they are asked to confirm which vehicle this reading is for — pre-selected automatically if they have only one vehicle

**AC2 — OCR extraction:**
Given a driver takes an odometer photo
When OCR processes it
Then the extracted km value is shown on a confirmation screen before saving — the driver can correct it if misread

**AC3 — First reading as baseline:**
Given this is the driver's first odometer reading for a vehicle
When it is saved
Then it is stored as a baseline — no l/100km is calculated and none is shown to the driver

**AC4 — Consumption calculation:**
Given a driver saves an odometer reading and a previous reading exists for that vehicle
When the system calculates consumption
Then l/100km = (sum of litres from all FillUp records for that vehicle between the two readings) ÷ km_delta × 100
And the result is stored as `consumption_l_per_100km` on the most recent FillUp record in that segment

**AC5 — No fill-ups in segment:**
Given there are no FillUp records for that vehicle between two odometer readings
When consumption would be calculated
Then no l/100km is calculated — the segment is stored with `consumption_l_per_100km: null`; distance is retained

**AC6 — Zero or negative delta:**
Given the km value entered is less than or equal to the previous odometer reading for that vehicle
When the reading would be saved
Then no calculation is made — the driver is shown a gentle validation prompt to check the value entered; the reading is not saved until corrected

**AC7 — FillUp session linking:**
Given a driver saves an odometer reading immediately after a fill-up (within 30 minutes, same vehicle)
When the reading is saved
Then the OdometerReading is linked to that FillUp via `fillup_id`; the `odometer_km` field on the FillUp record is set to the reading's km value

**AC8 — OCR fallback:**
Given OCR cannot extract a readable km value (confidence < 0.6)
When processing completes
Then the driver is shown a retake prompt with manual numeric entry as a fallback — the same confirm → save flow applies

**AC9 — OCR service down:**
Given the OCR endpoint returns 5xx or times out (> 10 seconds)
When the failure is detected
Then the driver is taken directly to manual entry — no stuck spinner, no crash

**AC10 — Standalone flow:**
Given a driver submits an odometer reading without a pump meter photo in the same session
When it is saved
Then it is stored normally — odometer tracking works independently of fill-up recording

**AC11 — Fill-up nudge upgrade:**
Given a driver has just completed a fill-up (is on the odometer nudge screen in Story 5.2)
When they tap "Take odometer photo"
Then the camera opens for odometer capture within the same flow — no navigation away from the fill-up session
And the OCR path from AC2 applies; the reading is auto-linked to the current fill-up (AC7)

## Tasks / Subtasks

- [ ] T1: Schema — `OdometerReading` model + FillUp amendments + migration (AC3–AC7)
  - [ ] T1a: Add `OdometerReading` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Add `consumption_l_per_100km Float?` to `FillUp` model (amends Story 5.2 schema)
  - [ ] T1c: Add `odometerReadings OdometerReading[]` relation to `Vehicle` and `User` models
  - [ ] T1d: Add optional `odometerReading OdometerReading?` back-relation to `FillUp`
  - [ ] T1e: Create migration `packages/db/prisma/migrations/<timestamp>_add_odometer_readings/migration.sql`

- [ ] T2: `OdometerOcrService` — Claude Haiku OCR (AC2, AC8, AC9)
  - [ ] T2a: Create `apps/api/src/odometer/odometer-ocr.service.ts`
  - [ ] T2b: Implement `extractKm(imageBuffer, mediaType)` — calls Claude Haiku with `ODOMETER_OCR_PROMPT`; 10s `AbortSignal.timeout`; returns `OdometerOcrResult`; returns `{ km: null, confidence: 0 }` on parse failure, low confidence, or timeout
  - [ ] T2c: Track Haiku spend via `OcrSpendService.recordSpend()` — same daily budget as pump meter

- [ ] T3: `OdometerService` — CRUD + consumption calculation (AC3–AC7, AC10)
  - [ ] T3a: Create `apps/api/src/odometer/odometer.service.ts`
  - [ ] T3b: Implement `createReading(userId, dto)`:
    - Validate vehicle belongs to user
    - Validate km > previous reading for that vehicle (throw 422 with `NEGATIVE_DELTA` code if not — AC6)
    - Flag internally if km looks like OCR artifact (all same digit: 111111, 222222…999999)
    - Save `OdometerReading`
    - If `dto.fillupId` provided: update `FillUp.odometer_km = dto.km`, set `fillup_id` on reading
    - Else: check for fill-up within 30 minutes for same vehicle — auto-link if found
    - Trigger consumption calculation (see T3c)
  - [ ] T3c: Implement `calculateConsumption(vehicleId, newReadingId)`:
    - Find previous OdometerReading for vehicle (by recorded_at DESC, excluding new one)
    - If none: return early (baseline — AC3)
    - km_delta = new.km − previous.km (guaranteed > 0 after T3b validation)
    - Sum litres from FillUps where `vehicle_id = vehicleId AND filled_at BETWEEN previous.recorded_at AND new.recorded_at`
    - If sum_litres = 0: return null (AC5)
    - consumption = (sum_litres / km_delta) * 100, rounded to 1 decimal place
    - Find the most recent FillUp in the segment; update its `consumption_l_per_100km`
    - Return `{ consumptionL100km: number | null, kmDelta: number, litresInSegment: number }`
  - [ ] T3d: Implement `listReadings(userId, vehicleId?, page, limit)` — newest first

- [ ] T4: `OdometerController` — API endpoints (AC2, AC8, AC9, AC10)
  - [ ] T4a: Create `apps/api/src/odometer/odometer.controller.ts` — routes under `v1/me/odometer`
  - [ ] T4b: `POST /v1/me/odometer/ocr` — multipart `photo` field; 10s timeout guard; returns `OdometerOcrResult`; always 200
  - [ ] T4c: `POST /v1/me/odometer` — create reading; returns reading + consumption result
  - [ ] T4d: `GET /v1/me/odometer` — list readings; supports `?vehicleId=`, `?page=`, `?limit=`

- [ ] T5: `OdometerModule` + app registration
  - [ ] T5a: Create `apps/api/src/odometer/odometer.module.ts`
  - [ ] T5b: Import `OdometerModule` in `apps/api/src/app.module.ts`

- [ ] T6: Mobile — API client (AC2, AC7, AC11)
  - [ ] T6a: Create `apps/mobile/src/api/odometer.ts` — `OdometerReading` interface + wrappers for OCR, create, list

- [ ] T7: Mobile — upgrade odometer nudge in `fillup-capture.tsx` (AC11)
  - [ ] T7a: In Step 3 `'odometer'` of `fillup-capture.tsx`: replace the TODO comment with a two-option layout — "Take photo" button (launches inline camera → OCR flow) and manual text input (existing) — both feed into the same confirm → save step
  - [ ] T7b: Add Step 3b `'odometer-confirm'`: shows extracted km, allows correction, "Save" calls `POST /v1/me/odometer` with `fillupId` from the current session
  - [ ] T7c: On save success: show consumption result inline if available (e.g. "7.4 L/100km")

- [ ] T8: Mobile — `odometer-capture.tsx` standalone screen (AC1, AC10)
  - [ ] T8a: Create `apps/mobile/app/(app)/odometer-capture.tsx` — reuses same step machine as T7 but without a pre-set `fillupId`; includes vehicle selector step (AC1) at the start
  - [ ] T8b: Entry point: add "Record odometer" action to the log screen (`log.tsx`) below the vehicle list

- [ ] T9: i18n — all 3 locales
  - [ ] T9a: Add `odometer` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes for full string list)

- [ ] T10: Tests
  - [ ] T10a: `odometer-ocr.service.spec.ts` — returns null on low confidence; parses km integer correctly; handles timeout gracefully
  - [ ] T10b: `odometer.service.spec.ts`:
    - First reading saved as baseline (no consumption)
    - Correct l/100km calculated with single fill-up in segment
    - Correct l/100km calculated summing multiple fill-ups across segment
    - Null consumption when no fill-ups in segment (AC5)
    - 422 thrown on negative/zero km delta (AC6)
    - Auto-link to fill-up within 30 minutes (AC7)
    - Vehicle ownership scoped to user
  - [ ] T10c: Full regression suite — all existing tests still pass

## Dev Notes

### Schema

```prisma
model OdometerReading {
  id           String   @id @default(uuid())
  user_id      String
  vehicle_id   String
  fillup_id    String?  @unique  // one OdometerReading per FillUp max
  km           Int
  recorded_at  DateTime @default(now())
  created_at   DateTime @default(now())
  user         User     @relation(fields: [user_id], references: [id])
  vehicle      Vehicle  @relation(fields: [vehicle_id], references: [id])
  fillup       FillUp?  @relation(fields: [fillup_id], references: [id], onDelete: SetNull)

  @@index([vehicle_id, recorded_at(sort: Desc)])
  @@index([user_id])
}
```

Amendments to `FillUp` (this story's migration):
```prisma
model FillUp {
  // ... Story 5.2 + 5.3 fields ...
  consumption_l_per_100km Float?          // set when next OdometerReading triggers calculation
  odometerReading         OdometerReading? // back-relation (Story 5.4)
}
```

Add to `Vehicle`: `odometerReadings OdometerReading[]`
Add to `User`: `odometerReadings OdometerReading[]`

### Odometer OCR prompt

```
You are reading an odometer display from a vehicle dashboard.

Extract the total odometer reading in kilometres.

Look for:
- A digital or analogue odometer display showing total distance
- The number may be labelled "ODO", "km", or appear unlabelled as the largest distance number
- Ignore trip meters (labelled "TRIP A", "TRIP B", or showing small values like "0342.1")
- Ignore fuel range estimates

Return a JSON object:
- "km": integer | null — the total odometer reading rounded to the nearest whole kilometre; null if unreadable
- "confidence": number 0.0–1.0
    0.9–1.0: odometer clearly visible, digits unambiguous
    0.6–0.89: readable with minor blur or partial occlusion
    below 0.6: unable to read reliably

Return only valid JSON — no markdown, no code fences:
{"km": integer|null, "confidence": number}
```

### OdometerOcrResult type

```ts
export interface OdometerOcrResult {
  km: number | null;
  confidence: number;
}
```

Accept reading when `km !== null && confidence >= 0.6`. Otherwise present retake/manual fallback.

### Consumption calculation detail

```ts
async calculateConsumption(vehicleId: string, newReadingId: string) {
  const [newReading, prevReading] = await Promise.all([
    this.prisma.odometerReading.findUniqueOrThrow({ where: { id: newReadingId } }),
    this.prisma.odometerReading.findFirst({
      where: { vehicle_id: vehicleId, id: { not: newReadingId } },
      orderBy: { recorded_at: 'desc' },
    }),
  ]);

  if (!prevReading) return null; // baseline — no calculation

  const kmDelta = newReading.km - prevReading.km;
  // kmDelta > 0 guaranteed by createReading validation

  const fillUps = await this.prisma.fillUp.findMany({
    where: {
      vehicle_id: vehicleId,
      filled_at: { gt: prevReading.recorded_at, lte: newReading.recorded_at },
    },
    orderBy: { filled_at: 'desc' },
  });

  if (fillUps.length === 0) return null; // AC5

  const sumLitres = fillUps.reduce((acc, f) => acc + f.litres, 0);
  const consumption = Math.round((sumLitres / kmDelta) * 100 * 10) / 10; // 1 dp

  // Store on most recent fill-up in segment
  await this.prisma.fillUp.update({
    where: { id: fillUps[0].id },
    data: { consumption_l_per_100km: consumption },
  });

  return { consumptionL100km: consumption, kmDelta, litresInSegment: sumLitres };
}
```

### km validation + artifact detection

```ts
// In createReading(), before saving:

// 1. Previous reading check
const prevReading = await this.prisma.odometerReading.findFirst({
  where: { vehicle_id: dto.vehicleId },
  orderBy: { recorded_at: 'desc' },
});

if (prevReading && dto.km <= prevReading.km) {
  throw new UnprocessableEntityException({
    code: 'NEGATIVE_DELTA',
    message: 'Odometer reading must be greater than the previous reading',
    previousKm: prevReading.km,
  });
}

// 2. OCR artifact heuristic (log only — do not block)
const digits = String(dto.km).split('');
if (digits.length >= 5 && digits.every((d) => d === digits[0])) {
  this.logger.warn(
    `[OdometerService] Possible OCR artifact: all-same-digit reading ${dto.km} for vehicle ${dto.vehicleId}`,
  );
}
```

### Auto-link to fill-up (AC7)

```ts
// In createReading(), after saving OdometerReading:

let linkedFillupId: string | null = dto.fillupId ?? null;

if (!linkedFillupId) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentFillup = await this.prisma.fillUp.findFirst({
    where: {
      vehicle_id: dto.vehicleId,
      user_id: userId,
      filled_at: { gte: thirtyMinAgo },
      odometerReading: null, // not already linked
    },
    orderBy: { filled_at: 'desc' },
  });
  linkedFillupId = recentFillup?.id ?? null;
}

if (linkedFillupId) {
  await this.prisma.$transaction([
    this.prisma.odometerReading.update({
      where: { id: newReading.id },
      data: { fillup_id: linkedFillupId },
    }),
    this.prisma.fillUp.update({
      where: { id: linkedFillupId },
      data: { odometer_km: dto.km },
    }),
  ]);
}
```

### create-odometer.dto.ts

```ts
export class CreateOdometerDto {
  @IsUUID() vehicleId: string;
  @IsInt() @Min(1) @Max(2_000_000) km: number;
  @IsOptional() @IsUUID() fillupId?: string;
  @IsOptional() recordedAt?: string; // ISO; defaults to now()
}
```

### POST /v1/me/odometer response

```ts
interface CreateOdometerResponse {
  reading: OdometerReadingDto;
  consumption: {
    consumptionL100km: number | null;  // null if baseline or no fill-ups in segment
    kmDelta: number | null;            // null if baseline
    litresInSegment: number | null;
  } | null;
}
```

### Mobile step machine — fillup-capture.tsx upgrade

Story 5.2's Step 3 `'odometer'` currently shows a plain text input. Story 5.4 replaces it with:

```
'odometer'          → two options: [Take odometer photo] [type km manually]
'odometer-camera'   → CameraView for odometer photo
'odometer-ocr'      → spinner "Reading odometer…"
'odometer-confirm'  → shows km value (editable), Save + Skip
```

The `'odometer-confirm'` Save button calls `POST /v1/me/odometer` with `fillupId` from the draft. On success, show consumption in a small inline badge: "7.4 L/100km" (if `consumptionL100km` returned).

### odometer-capture.tsx — standalone

```
'vehicle-select'   → vehicle picker (skip if only one vehicle)
'odometer'         → same as fillup-capture's odometer step
'odometer-camera'  → CameraView
'odometer-ocr'     → spinner
'odometer-confirm' → confirm km, Save (no fillupId)
'saved'            → "Reading saved" + optional consumption badge + Done button
```

Entry point in `log.tsx`: a small "Record odometer" text link below the vehicle list. Not a prominent CTA — it's a secondary action for Zofia-type users who track consumption. Navigates to `/(app)/odometer-capture`.

### i18n strings

Add `odometer` section to all 3 locales:

```
takePhoto:         'Take odometer photo' | 'Sfotografuj licznik' | 'Сфотографувати одометр'
enterManually:     'Enter reading manually' | 'Wpisz odczyt ręcznie' | 'Ввести показник вручну'
processing:        'Reading odometer…' | 'Odczytuję licznik…' | 'Зчитую одометр…'
confirmTitle:      'Odometer reading' | 'Odczyt licznika' | 'Показник одометра'
kmLabel:           'Current km' | 'Aktualny przebieg' | 'Поточний пробіг'
kmPlaceholder:     'e.g. 87450' | 'np. 87450' | 'напр. 87450'
saveButton:        'Save reading' | 'Zapisz odczyt' | 'Зберегти показник'
skipButton:        'Skip' | 'Pomiń' | 'Пропустити'
retakePrompt:      'Could not read odometer — retake or enter manually' | 'Nie mogłem odczytać licznika — spróbuj ponownie lub wpisz ręcznie' | 'Не вдалося прочитати одометр — повторіть або введіть вручну'
baselineSaved:     'First reading saved — consumption tracking starts from your next fill-up' | 'Zapisano pierwszy odczyt — śledzenie zużycia zacznie się od następnego tankowania' | 'Збережено перший показник — відстеження витрати почнеться з наступної заправки'
consumptionResult: '{{value}} L/100km' | '{{value}} l/100km' | '{{value}} л/100км'
negativeDelta:     'This reading must be higher than your previous reading ({{previousKm}} km)' | 'Ten odczyt musi być wyższy niż poprzedni ({{previousKm}} km)' | 'Цей показник має бути більшим за попередній ({{previousKm}} км)'
selectVehicle:     'Which vehicle?' | 'Który pojazd?' | 'Який транспортний засіб?'
recordOdometer:    'Record odometer' | 'Zapisz odczyt licznika' | 'Записати одометр'
```

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — OdometerReading model; FillUp.consumption_l_per_100km; relations)
- `packages/db/prisma/migrations/<timestamp>_add_odometer_readings/migration.sql` (new)
- New directory: `apps/api/src/odometer/`
  - `odometer.service.ts` (new)
  - `odometer-ocr.service.ts` (new)
  - `odometer.controller.ts` (new)
  - `odometer.module.ts` (new)
  - `dto/create-odometer.dto.ts` (new)
  - `odometer.service.spec.ts` (new)
  - `odometer-ocr.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import OdometerModule)
- `apps/mobile/src/api/odometer.ts` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (modified — upgrade odometer nudge steps)
- `apps/mobile/app/(app)/odometer-capture.tsx` (new — standalone flow)
- `apps/mobile/app/(app)/log.tsx` (modified — "Record odometer" entry point)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- Pump meter OCR pattern (synchronous Haiku + 10s timeout): [apps/api/src/fillup/fillup-ocr.service.ts](apps/api/src/fillup/fillup-ocr.service.ts) (Story 5.2)
- OcrSpendService: [apps/api/src/photo/ocr-spend.service.ts](apps/api/src/photo/ocr-spend.service.ts)
- FillUp model + FillupService: [apps/api/src/fillup/](apps/api/src/fillup/) (Story 5.2)
- Vehicle model + is_locked: [apps/api/src/vehicle/](apps/api/src/vehicle/) (Story 5.1)
- Odometer nudge TODO: [apps/mobile/app/(app)/fillup-capture.tsx](apps/mobile/app/(app)/fillup-capture.tsx) Step 3 (Story 5.2)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.4 (line ~2268)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — OdometerReading; FillUp.consumption_l_per_100km; relations)
- `packages/db/prisma/migrations/<timestamp>_add_odometer_readings/migration.sql` (new)
- `apps/api/src/odometer/odometer.service.ts` (new)
- `apps/api/src/odometer/odometer-ocr.service.ts` (new)
- `apps/api/src/odometer/odometer.controller.ts` (new)
- `apps/api/src/odometer/odometer.module.ts` (new)
- `apps/api/src/odometer/dto/create-odometer.dto.ts` (new)
- `apps/api/src/odometer/odometer.service.spec.ts` (new)
- `apps/api/src/odometer/odometer-ocr.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified)
- `apps/mobile/src/api/odometer.ts` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (modified — odometer nudge upgrade)
- `apps/mobile/app/(app)/odometer-capture.tsx` (new)
- `apps/mobile/app/(app)/log.tsx` (modified — Record odometer entry point)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-4-odometer-ocr-consumption-tracking.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
