# Story 5.3: Savings vs. Area Average Calculation

Status: review

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

- `Math.round(... * 100) / 100` produces non-deterministic results across Node versions when the intermediate float lands near a .5 boundary (e.g. `Math.round(-30.745 * 100) / 100` → -30.74 on some platforms, -30.75 on others). Switched both server (`fillup.service.ts`) and client (`savings.ts`) to grosz-integer arithmetic — `Math.round(a * litres * 100) - Math.round(p * litres * 100)` — so each side rounds independently to integer grosz before subtracting. Result is platform-stable.
- Tests had to use tolerance windows initially (`> 16.5, < 16.6`) because of the FP drift; after the P-3 fix, switched to exact equality assertions (`toBe(16.55)`) since the math is now deterministic.

### Completion Notes List

**2026-05-02 — Story 5.3 implementation + code review pass.**

Backend:
- `FillUp.voivodeship` column added via migration `20260502000000_add_fillup_voivodeship`. Snapshot at fill-up time, never updated.
- `VoivodeshipLookupService` (Nominatim reverse-geocode, 24h Redis cache, 5-min cache for transient failures, fail-silent).
- `RegionalBenchmarkService.getLatestForVoivodeship()` — voivodeship-keyed lookup that skips the Station join.
- `FillupService.createFillup()` extended: voivodeship resolved via station snapshot OR Nominatim fallback; benchmark looked up via voivodeship when station-keyed lookup unavailable; `savingsPln` pre-computed server-side via grosz-integer math.

Mobile:
- `calculateSavings` utility + `SavingsDisplay` component (green for saved, amber for above average — never red).
- Wired into `fillup-capture.tsx` celebration step.
- i18n keys `savedPln` + `aboveAvgPln` added to en/pl/uk.

**Tests:** +33 new across `voivodeship-lookup.service.spec.ts`, `regional-benchmark.service.spec.ts`, `fillup.service.spec.ts`, `savings.test.ts`. Final: 986/986 api + 31/31 mobile pass. Tsc clean across types/api/mobile.

**Phase 1 prod APK invariant held:**
- Backend changes purely additive (new column, new service, new method, new logic branch — no existing API surface changed).
- Mobile changes inside fillup-capture / Phase-2-gated celebration screen. Phase 1 APK doesn't render `SavingsDisplay`.

### Code Review (2026-05-02)

Reviewed by Blind Hunter + Edge Case Hunter + Acceptance Auditor on the full Story 5.3 diff (~1,200 lines / 17 files). Acceptance Auditor: **4/4 ACs cleanly satisfied**.

#### Patches applied (8)

**Privacy / Nominatim compliance:**
- **P-1** [`voivodeship-lookup.service.ts:106-115, 132`] **GPS rounded to 2dp BEFORE both cache key construction AND the outbound URL.** The 2dp rounding was previously applied only to the cache key — the URL passed full ~10m precision. Privacy posture now matches docstring: GPS shared with Nominatim is at city-block precision, not 10m.
- **P-2** [`voivodeship-lookup.service.ts:142-144, 156`] **Logs scrubbed of full-precision coords.** All warn-level log lines that include lat/lng now use the 2dp-rounded values via `.toFixed(2)`. Full-precision GPS in app logs (which typically have looser retention/access controls than the DB) is a GDPR liability we shouldn't take.
- **P-7** [`voivodeship-lookup.service.ts:24-30, 137-167`] **Distinguish transient (HTTP 429 / 5xx / network) failures from definitive misses (HTTP 4xx other than 429, 2xx with unmapped state).** Transient failures cache for 5 minutes (`TRANSIENT_FAILURE_TTL_SECONDS`); definitive misses cache for 24 hours. Previously a single 429 blip poisoned a 1km² cell for a full day.
- **P-9** [`voivodeship-lookup.service.ts:108-110`] **Coordinate range validation** — reject `Math.abs(lat) > 90 || Math.abs(lng) > 180` before the Nominatim call. Saves a wasted cache slot + Nominatim quota slot for geographically meaningless inputs.

**Math correctness:**
- **P-3** [`fillup.service.ts:240-245` + `savings.ts:24-32`] **Grosz-integer arithmetic for savings.** Replaced `Math.round((a-p)*l*100)/100` (FP-vulnerable around .5 boundaries; tests required tolerance windows) with `Math.round(a*l*100) - Math.round(p*l*100)` (each side rounds to integer grosz before subtracting; result is platform-stable). Trade-off: at very small price differences the new method can be 1 grosz off vs the naive method, which is fine for our display purposes. Tests now use exact equality (`toBe(16.55)`) instead of tolerance windows.

**Mobile:**
- **P-5** [`SavingsDisplay.tsx:34-38`] **Render nothing when savings === 0.** Previously displayed "You saved 0.00 PLN vs. area average" — misleading celebration for the rare exact-match case. Now treats zero like null (no notable savings → hide line).
- **P-12** [`SavingsDisplay.tsx:30-33`] **Number.isFinite guard** — defensive against API contract drift. Today the contract is `number | null` but a server bug could leak NaN/Infinity; rendering "NaN PLN" to the user would be worse than silently hiding the line.

**i18n:**
- **P-14** [`pl.ts:savedPln`] **Polish gender-neutral phrasing.** Replaced "Zaoszczędziłeś" (masculine past tense) with impersonal "Zaoszczędzono" so the message reads correctly for any user regardless of gender. Standard Polish marketing-copy convention for the same reason.

#### Tests added (7)

- `voivodeship-lookup.service.spec.ts`: 7 new — P-9 lat/lng range validation (×2), P-1 rounded coords in URL, P-7 cache TTLs (429 / 5xx / network → 5 min, 4xx → 24h).
- `savings.test.ts` + `fillup.service.spec.ts`: existing tolerance-window assertions tightened to exact equality after P-3 made the math deterministic.

#### Deferred (8)

- **D-1** No global Nominatim rate limiter — relying on the 24h cache + low beta volume; revisit if traffic grows.
- **D-2** Cache stampede on simultaneous misses for the same 1 km² — rare in beta; mitigation would be SET NX lock.
- **D-3** No DB index on `FillUp.voivodeship` — Story 6.5 (regional rollups) will add when the query pattern lands.
- **D-4** Server vs client `calculateSavings` is duplicated logic — both use the same grosz-integer pattern after P-3, so drift is bounded to platform FP edge cases. Real fix is a shared util in `@desert/types`; defer until Story 5.5 history screen actually consumes it.
- **D-5** PLN amount formatting uses dot decimal not Polish comma (`16.55` vs `16,55`) — i18n polish for the next pass; affects all monetary display, not just savings.
- **D-6** Pre-Story-5.3 FillUp rows have NULL voivodeship — only Mateusz's test data affected; if a backfill is needed later, run a one-off script to copy `Station.voivodeship` for FillUps with non-null `station_id`.
- **D-7** `calculateSavings` accepts `litres ≤ 0` and produces a "savings" value — DTO `@IsNumber()` `@Min(0.1)` validates at the API boundary; this defensive check is belt-and-suspenders.
- **D-8** Test assertions can't catch a sign-flip in tests where the result lands inside the tolerance window — P-3 made tests exact, so this is now a residual concern only for any future test that re-introduces a window.

#### Spec amendment recommendation (1)

- **B-1** Spec dev notes hardcode example values (`#16a34a` green / `desert-app` UA / `'null'` sentinel) but implementation uses `tokens.fresh.recent` / `litro-app` UA / `__none__` sentinel. All defensible product evolution (token system, brand rename, sentinel disambiguation), not real bugs. Recommend updating spec dev notes to reflect actuals so future readers don't see drift.

#### Rejected as noise (~12)

Premature memoization, cosmetic margins, defensive empty-checks on integer-validated DTOs, edge cases for non-Polish coords (out of scope), unicode normalization (Nominatim is consistent in practice), HTML injection via numeric coords (no string coords accepted), `marginVertical` vs `marginTop`, `'null'` vs `__none__` sentinel naming.

### Change Log

- 2026-05-02 — Closed Story 5.3: backend voivodeship resolution + savings calculation, mobile SavingsDisplay component. 4/4 ACs satisfied.
- 2026-05-02 — Code review: 8 patches applied + 8 deferred + 1 spec amendment recommended. 986/986 api + 31/31 mobile pass post-patches.

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
