# Story 5.3: Savings vs. Area Average Calculation

Status: ready-for-dev

## Story

As a **driver**,
I want to see how much I saved (or overpaid) compared to the area average after each fill-up,
So that I can feel the tangible financial benefit of using the app to find cheaper stations.

## Acceptance Criteria

**AC1 — Savings display on confirmation:**
Given a FillUp record has been saved with a matched station, fuel type, and `area_avg_at_fillup`
When the fill-up celebration screen is shown
Then the savings calculation is displayed: `(area_avg_at_fillup − price_per_litre_pln) × litres`
And positive savings are shown in green: "You saved X PLN vs. area average"
And negative savings (overpaid) are shown neutrally in amber: "X PLN above area average" — no red, no shaming language

**AC2 — Omit when no benchmark:**
Given a FillUp record has no `area_avg_at_fillup` (benchmark unavailable for that voivodeship × fuel_type)
When the celebration screen is shown
Then the savings line is omitted entirely — no placeholder text, no zero, no error, no visible gap

**AC3 — GPS-only voivodeship fallback:**
Given a FillUp record has no matched station but GPS coordinates were available at save time
When savings are calculated
Then the voivodeship is inferred from the GPS coordinates and stored on the FillUp — station match is not required for the savings calculation
And the most recent `RegionalBenchmark` for that inferred voivodeship × fuel_type is used as `area_avg_at_fillup`

**AC4 — Historical accuracy:**
Given a driver views any past fill-up in their history
When the savings figure is displayed
Then it always reflects the `area_avg_at_fillup` snapshot stored at the time of the fill-up — never recalculated against current benchmarks

## Tasks / Subtasks

- [ ] T1: Schema — add `voivodeship` to `FillUp` + migration (AC3, AC4)
  - [ ] T1a: Add `voivodeship String?` column to `FillUp` model in `packages/db/prisma/schema.prisma`
  - [ ] T1b: Create migration `packages/db/prisma/migrations/<timestamp>_add_fillup_voivodeship/migration.sql`

- [ ] T2: `VoivodeshipLookupService` — GPS-to-voivodeship (AC3)
  - [ ] T2a: Create `apps/api/src/fillup/voivodeship-lookup.service.ts`
  - [ ] T2b: Implement `lookupByGps(lat, lng)` — calls Nominatim reverse geocode API; parses `address.state`; maps to one of the 16 valid voivodeship slugs (from `VALID_VOIVODESHIPS`); returns `string | null`
  - [ ] T2c: Cache results in Redis: key `voivodeship:gps:{lat2}:{lng2}` (lat/lng rounded to 2 decimal places ≈ 1km grid); 24h TTL
  - [ ] T2d: Graceful failure: on Nominatim timeout (5s) or non-200 response, return `null` silently — never throw

- [ ] T3: `FillupService` amendment — populate voivodeship + savings benchmark (AC3, AC4)
  - [ ] T3a: Update `createFillup()` in `apps/api/src/fillup/fillup.service.ts`:
    - If station matched: set `voivodeship = station.voivodeship`
    - If no station but GPS provided: call `VoivodeshipLookupService.lookupByGps(lat, lng)` and set `voivodeship` from result
    - If voivodeship resolved (from either path) and no station matched: call `RegionalBenchmarkService.getLatestForVoivodeship(voivodeship, fuelType)` to populate `area_avg_at_fillup`
    - (When station IS matched, `area_avg_at_fillup` is already populated via `getLatestForStation` from Story 5.2)

- [ ] T4: `RegionalBenchmarkService` — add `getLatestForVoivodeship()` (AC3)
  - [ ] T4a: Add `getLatestForVoivodeship(voivodeship: string, fuelType: string): Promise<{ medianPrice: number } | null>` to `apps/api/src/regional-benchmark/regional-benchmark.service.ts`
  - [ ] T4b: Query: `findFirst({ where: { voivodeship, fuel_type: fuelType }, orderBy: { calculated_at: 'desc' } })` — same pattern as `getLatestForStation()` minus the Station join

- [ ] T5: Mobile — `SavingsDisplay` component (AC1, AC2)
  - [ ] T5a: Create `apps/mobile/src/components/SavingsDisplay.tsx` — pure presentational component; accepts `savingsPln: number | null`; renders savings line or nothing (see Dev Notes)
  - [ ] T5b: Add `calculateSavings(areaAvg: number | null, paidPerLitre: number, litres: number): number | null` utility to `apps/mobile/src/utils/savings.ts`

- [ ] T6: Mobile — wire savings into fill-up celebration screen (AC1, AC2)
  - [ ] T6a: In `fillup-capture.tsx` Step 5 `'celebration'`: compute `savingsPln` from fill-up response and render `<SavingsDisplay savingsPln={savingsPln} />`

- [ ] T7: i18n — savings strings in all 3 locales (AC1)
  - [ ] T7a: Add `fillup.savedPln` and `fillup.aboveAvgPln` keys to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes)

- [ ] T8: Tests
  - [ ] T8a: `voivodeship-lookup.service.spec.ts` — returns correct slug on valid Nominatim response; returns null on timeout; returns null on unmapped `address.state` value; caches result on second call (Nominatim not called twice)
  - [ ] T8b: `regional-benchmark.service.spec.ts` — `getLatestForVoivodeship`: returns latest row for matching voivodeship × fuel_type; returns null when none exists
  - [ ] T8c: `savings.spec.ts` (mobile util) — positive savings: correct PLN rounded to 2dp; negative savings: correct negative value; null when areaAvg is null
  - [ ] T8d: Full regression suite — all existing tests still pass

## Dev Notes

### Schema amendment to FillUp

This story adds one column to the `FillUp` model defined in Story 5.2:

```prisma
model FillUp {
  // ... all Story 5.2 fields ...
  voivodeship         String?  // set at save time: from station.voivodeship or GPS lookup
}
```

The `voivodeship` field is populated at FillUp creation time and never updated afterwards — it represents the region at the moment of the fill-up.

### calculateSavings utility

```ts
// apps/mobile/src/utils/savings.ts
export function calculateSavings(
  areaAvgAtFillup: number | null,
  pricePerLitrePln: number,
  litres: number,
): number | null {
  if (areaAvgAtFillup === null) return null;
  return Math.round((areaAvgAtFillup - pricePerLitrePln) * litres * 100) / 100;
}
```

Returns `null` when `areaAvgAtFillup` is missing. Rounds to 2 decimal places. Positive = saved money. Negative = overpaid.

### SavingsDisplay component

```tsx
// apps/mobile/src/components/SavingsDisplay.tsx
interface Props {
  savingsPln: number | null;
  t: TFunction;
}

export function SavingsDisplay({ savingsPln, t }: Props) {
  if (savingsPln === null) return null;  // AC2: omit entirely

  const abs = Math.abs(savingsPln).toFixed(2);
  const saved = savingsPln >= 0;

  return (
    <View style={styles.row}>
      <Text style={[styles.amount, saved ? styles.green : styles.amber]}>
        {saved
          ? t('fillup.savedPln', { amount: abs })
          : t('fillup.aboveAvgPln', { amount: abs })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', marginVertical: 8 },
  amount: { fontSize: 17, fontWeight: '600' },
  green: { color: '#16a34a' },   // tokens.price.cheap equivalent
  amber: { color: '#d97706' },   // neutral amber — not red (AC1: no shaming)
});
```

Never use red for negative savings — red implies an error. Amber communicates "could be better" without shaming.

### Nominatim reverse geocode

```ts
// voivodeship-lookup.service.ts
private readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

async lookupByGps(lat: number, lng: number): Promise<string | null> {
  const cacheKey = `voivodeship:gps:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return cached === 'null' ? null : cached;

  try {
    const url = `${this.NOMINATIM_URL}?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=pl`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': 'desert-app/2.0 (contact@desert.app)' },
    });
    if (!res.ok) { await this.redis.set(cacheKey, 'null', 'EX', 86400); return null; }

    const body = await res.json() as NominatimResponse;
    const stateName = body?.address?.state?.toLowerCase() ?? '';
    const slug = this.mapStateToSlug(stateName);

    await this.redis.set(cacheKey, slug ?? 'null', 'EX', 86400);
    return slug;
  } catch {
    return null;  // timeout, network error — silently return null
  }
}
```

**Nominatim User-Agent requirement:** Nominatim's usage policy requires a valid `User-Agent` with contact info. Use `desert-app/2.0 (contact@desert.app)` or equivalent. This is a hard requirement — requests without it may be rate-limited or blocked.

**`mapStateToSlug()`** maps Polish state names to slugs. Example mappings:
```ts
private mapStateToSlug(state: string): string | null {
  const MAP: Record<string, string> = {
    'województwo dolnośląskie': 'dolnoslaskie',
    'województwo kujawsko-pomorskie': 'kujawsko-pomorskie',
    'województwo lubelskie': 'lubelskie',
    'województwo lubuskie': 'lubuskie',
    'województwo łódzkie': 'lodzkie',
    'województwo małopolskie': 'malopolskie',
    'województwo mazowieckie': 'mazowieckie',
    'województwo opolskie': 'opolskie',
    'województwo podkarpackie': 'podkarpackie',
    'województwo podlaskie': 'podlaskie',
    'województwo pomorskie': 'pomorskie',
    'województwo śląskie': 'slaskie',
    'województwo świętokrzyskie': 'swietokrzyskie',
    'województwo warmińsko-mazurskie': 'warminsko-mazurskie',
    'województwo wielkopolskie': 'wielkopolskie',
    'województwo zachodniopomorskie': 'zachodniopomorskie',
  };
  return MAP[state] ?? null;
}
```

Use the shared `VALID_VOIVODESHIPS` list from `apps/api/src/station/config/voivodeship-slugs.ts` (created in Story 4.8) as the source of valid slugs.

### FillupService amendment — full voivodeship + savings flow

```ts
// Updated createFillup() logic (adds to Story 5.2 implementation)

// 1. GPS station match (Story 5.2)
const station = dto.gpsLat && dto.gpsLng
  ? await this.stationService.findNearest(dto.gpsLat, dto.gpsLng, 200)
  : null;

// 2. Resolve voivodeship
let voivodeship: string | null = station?.voivodeship ?? null;
if (!voivodeship && dto.gpsLat && dto.gpsLng) {
  voivodeship = await this.voivodeshipLookup.lookupByGps(dto.gpsLat, dto.gpsLng);
}

// 3. Resolve area average (Story 5.2 already handles station path; extend for GPS-only path)
let areaAvgAtFillup: number | null = null;
if (station) {
  const b = await this.benchmarkService.getLatestForStation(station.id, dto.fuelType);
  areaAvgAtFillup = b?.medianPrice ?? null;
} else if (voivodeship) {
  const b = await this.benchmarkService.getLatestForVoivodeship(voivodeship, dto.fuelType);
  areaAvgAtFillup = b?.medianPrice ?? null;
}

// 4. Create FillUp with voivodeship + area_avg_at_fillup
await this.prisma.fillUp.create({
  data: {
    ...otherFields,
    voivodeship,
    area_avg_at_fillup: areaAvgAtFillup,
  },
});
```

### API response — include savings in celebration data

Extend `CreateFillupResponse` (Story 5.2) to include precomputed savings:

```ts
interface CreateFillupResponse {
  fillUp: FillUpDto;
  stationMatched: boolean;
  stationName: string | null;
  communityUpdated: boolean;
  savingsPln: number | null;  // (area_avg_at_fillup - price_per_litre_pln) * litres, or null
}
```

Computing it server-side avoids float precision edge cases on the client. Return `null` when `area_avg_at_fillup` is null.

### i18n strings

Add to all 3 locales under `fillup`:

```
savedPln:
  en: 'You saved {{amount}} PLN vs. area average'
  pl: 'Zaoszczędziłeś {{amount}} PLN vs. średnia w regionie'
  uk: 'Ви заощадили {{amount}} PLN порівняно із середнім по регіону'

aboveAvgPln:
  en: '{{amount}} PLN above area average'
  pl: '{{amount}} PLN powyżej średniej w regionie'
  uk: '{{amount}} PLN вище середнього по регіону'
```

Use `{{amount}}` interpolation (i18next format). Never expose the raw negative number to the driver — `SavingsDisplay` always passes `Math.abs(savingsPln)` to the translation string.

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — add `voivodeship String?` to FillUp)
- `packages/db/prisma/migrations/<timestamp>_add_fillup_voivodeship/migration.sql` (new)
- `apps/api/src/fillup/voivodeship-lookup.service.ts` (new)
- `apps/api/src/fillup/fillup.service.ts` (modified — populate voivodeship + GPS-path benchmark lookup)
- `apps/api/src/regional-benchmark/regional-benchmark.service.ts` (modified — add `getLatestForVoivodeship()`)
- `apps/api/src/fillup/fillup.module.ts` (modified — add VoivodeshipLookupService to providers)
- `apps/mobile/src/utils/savings.ts` (new)
- `apps/mobile/src/components/SavingsDisplay.tsx` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (modified — render SavingsDisplay in celebration step)
- `apps/mobile/src/i18n/locales/en.ts` (modified — add fillup.savedPln, fillup.aboveAvgPln)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- `RegionalBenchmarkService.getLatestForStation()`: [apps/api/src/regional-benchmark/regional-benchmark.service.ts](apps/api/src/regional-benchmark/regional-benchmark.service.ts) (Story 5.0)
- `FillUp` model + `FillupService.createFillup()`: [apps/api/src/fillup/fillup.service.ts](apps/api/src/fillup/fillup.service.ts) (Story 5.2)
- `VALID_VOIVODESHIPS` constant: [apps/api/src/station/config/voivodeship-slugs.ts](apps/api/src/station/config/voivodeship-slugs.ts) (Story 4.8)
- Fill-up celebration screen: [apps/mobile/app/(app)/fillup-capture.tsx](apps/mobile/app/(app)/fillup-capture.tsx) (Story 5.2)
- `SavingsDisplay` consumed again by Story 5.5 (history screen) and Story 6.5 (monthly summary)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.3 (line ~2236)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — voivodeship on FillUp)
- `packages/db/prisma/migrations/<timestamp>_add_fillup_voivodeship/migration.sql` (new)
- `apps/api/src/fillup/voivodeship-lookup.service.ts` (new)
- `apps/api/src/fillup/fillup.service.ts` (modified)
- `apps/api/src/fillup/fillup.module.ts` (modified)
- `apps/api/src/regional-benchmark/regional-benchmark.service.ts` (modified — add getLatestForVoivodeship)
- `apps/mobile/src/utils/savings.ts` (new)
- `apps/mobile/src/components/SavingsDisplay.tsx` (new)
- `apps/mobile/app/(app)/fillup-capture.tsx` (modified — celebration step)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-3-savings-vs-area-average-calculation.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
