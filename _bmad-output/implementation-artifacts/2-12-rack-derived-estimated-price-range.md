# Story 2.12: Rack-Derived Estimated Price Range (Cold Start)

Status: in-progress

## Story

As a **driver**,
I want to see an estimated price range for stations that have no recent community data,
So that the app is useful from day one — even before enough contributors exist to verify prices in my area.

## Why

A blank screen on day one kills the product before it starts. A rack-derived price range ("~6.40–6.70 PLN based on market data") is honest, useful for decision-making, and visually communicates approximation. As community grows, estimated ranges are replaced by verified prices.

## Acceptance Criteria

1. **Display:** For fuel types at a station with no community-verified submission, show a price range "~6.40–6.70 zł/l" labelled "Market estimate". Never presented as a precise current price.

2. **Formula:** Estimated midpoint = ORLEN rack price + voivodeship margin + station-type modifier + brand-tier modifier + German border zone modifier + settlement-tier modifier. Band = ±0.15 PLN (symmetric). All modifier values in config file (not hardcoded in service logic).

3. **Station type modifier:** MOP → +45 gr/l; standard → 0.

4. **Brand tier modifier:** hypermarket (auchan, carrefour) → −30 gr/l; budget branded (circle_k, huzar, moya, amic) → −5 gr/l; mid-market (orlen, lotos) → 0; premium (bp, shell) → +7 gr/l; independent/unknown → 0.

5. **German border zone:** `is_border_zone_de = true` → −15 gr/l.

6. **Settlement tier:** rural → +10 gr/l; all other tiers → 0.

7. **Fallback:** If no ORLEN rack price available for a fuel type, use static national average (from config) as midpoint with ±5% band. Label reads "Estimated" rather than "Market estimate".

8. **Community replacement:** When a community-verified submission exists for a station (any fuel type), community prices continue to be returned as-is (source='community'). Estimated ranges are only generated for stations with NO community-verified submission.

9. **Staleness invalidation:** When rack price changes significantly (Story 2.8), estimated ranges shift automatically — no stale data is ever shown since ranges are computed fresh from the latest MarketSignal on each request.

10. **i18n:** All new labels and explanation text available in English, Polish, Ukrainian.

11. **Explanation tap:** Tapping an estimated range shows a brief explanation modal. Content: "We don't have a recent community price here yet. This range is based on current wholesale market data." + CTA to contribute.

12. **Tests:** Unit tests for EstimatedPriceService (midpoint formula, all modifier combinations, fallback), updated PriceService tests (estimated rows for uncovered stations).

## Tasks / Subtasks

- [ ] **Task 1: Price modifiers config** (AC: 2–6)
  - [ ] 1.1 Create `apps/api/src/price/config/price-modifiers.ts` with all modifier values (gr/l), voivodeship margin bands, brand tier map, fallback national averages

- [ ] **Task 2: EstimatedPriceService** (AC: 2–7, 9)
  - [ ] 2.1 Create `apps/api/src/price/estimated-price.service.ts`
  - [ ] 2.2 `getLatestRackPrices()` — queries MarketSignal for latest PB_95, ON, LPG rack prices
  - [ ] 2.3 `computeMidpoint(rackPln, station, fuelType)` — applies all modifiers
  - [ ] 2.4 `computeRange(midpoint)` — returns `{ low, high }` with ±0.15 band
  - [ ] 2.5 `computeFallback(station, fuelType)` — uses static national average + ±5% band
  - [ ] 2.6 `computeEstimatesForStations(stations)` — orchestrates: fetch rack prices, compute per station, return Map<stationId, StationPriceRow>
  - [ ] 2.7 Create `apps/api/src/price/estimated-price.service.spec.ts` — unit tests for all methods

- [ ] **Task 3: Extend StationPriceRow and DTOs** (AC: 1, 11)
  - [ ] 3.1 Add `priceRanges?: Record<string, { low: number; high: number }>` and `estimateLabel?: 'market_estimate' | 'estimated'` to `StationPriceRow` in `price-cache.service.ts`
  - [ ] 3.2 Add same fields to `StationPriceDto` in `apps/api/src/price/dto/station-price.dto.ts`
  - [ ] 3.3 Update `apps/mobile/src/api/prices.ts` `StationPriceDto` type with new optional fields

- [ ] **Task 4: Update PriceService** (AC: 8, 9, 12)
  - [ ] 4.1 Change `findStationIdsInArea` to `findStationsInArea` — return classification fields (brand, station_type, voivodeship, settlement_tier, is_border_zone_de) alongside id
  - [ ] 4.2 Inject `EstimatedPriceService` into `PriceService`
  - [ ] 4.3 After community prices fetched, identify uncovered stations and compute estimated ranges via `EstimatedPriceService`
  - [ ] 4.4 Update `price.service.spec.ts` — update existing tests for new station discovery shape, add tests for estimated range generation

- [ ] **Task 5: Wire controller and module** (AC: 1)
  - [ ] 5.1 Update `price.controller.ts` to pass `priceRanges` and `estimateLabel` in response mapping
  - [ ] 5.2 Add `EstimatedPriceService` to `PriceModule` providers

- [ ] **Task 6: Mobile UI** (AC: 1, 10, 11)
  - [ ] 6.1 Add i18n strings (en, pl, uk): `freshness.marketEstimate`, `freshness.marketEstimateExplain`, `freshness.contributePrompt`
  - [ ] 6.2 Update `StationDetailSheet.tsx` — show range `~6.40–6.70 zł/l` when `priceRanges[ft]` present; show "Market estimate" vs "Estimated" label
  - [ ] 6.3 Add explanation modal (shown on tap of estimated row): explanation text + dismiss button

- [ ] **Task 7: Validation**
  - [ ] 7.1 `pnpm --filter @desert/api test` — all tests passing, no regressions
  - [ ] 7.2 `pnpm --filter @desert/api type-check` — zero TypeScript errors
  - [ ] 7.3 `pnpm --filter @desert/mobile type-check` — zero TypeScript errors

## Dev Notes

### Formula (all modifiers in gr/l, converted to PLN by ÷100)

```
midpoint = rack_price_pln
         + voivodeship_margin_gr / 100
         + station_type_modifier_gr / 100
         + brand_modifier_gr / 100
         + border_zone_modifier_gr / 100
         + settlement_modifier_gr / 100
```

Band = midpoint ± 0.15 PLN (BAND_RADIUS_GR = 15)

### Signal → FuelType mapping (from staleness-detection.service.ts)

```typescript
orlen_rack_pb95 → 'PB_95'
orlen_rack_on   → 'ON'
orlen_rack_lpg  → 'LPG'
```

PB_98 and ON_PREMIUM have no ORLEN rack signals — skip estimated ranges for these fuel types.

### Voivodeship margin bands (gr/l above rack price, approximate retail markup)

```typescript
export const VOIVODESHIP_MARGINS_GR: Record<string, number> = {
  dolnoslaskie:         27,
  kujawsko_pomorskie:   31,
  lubelskie:            33,
  lubuskie:             29,  // border region — lower margins due to German competition
  lodzkie:              30,
  malopolskie:          28,
  mazowieckie:          26,  // Warsaw — highest competition → lowest margin
  opolskie:             29,
  podkarpackie:         34,
  podlaskie:            35,  // eastern region — lowest competition
  pomorskie:            29,
  slaskie:              27,  // highly urbanised
  swietokrzyskie:       33,
  warminsko_mazurskie:  33,
  wielkopolskie:        29,
  zachodniopomorskie:   28,
};
const DEFAULT_MARGIN_GR = 30; // fallback when voivodeship unknown/null
```

Note: voivodeship slugs from classification use hyphen (e.g., 'kujawsko-pomorskie') — normalise to underscore for key lookup, OR store keys with hyphens (either works, be consistent).

### Brand modifiers (gr/l)

```typescript
export const BRAND_MODIFIERS_GR: Record<string, number> = {
  auchan:    -30,
  carrefour: -30,
  circle_k:   -5,
  huzar:      -5,
  moya:       -5,
  amic:       -5,
  orlen:       0,
  lotos:       0,
  bp:         +7,
  shell:      +7,
  independent: 0,
  // null/unknown brand → default 0
};
```

### Station type modifiers (gr/l)

```typescript
export const STATION_TYPE_MODIFIERS_GR: Record<string, number> = {
  mop:      45,
  standard:  0,
};
```

### Settlement tier modifiers (gr/l)

```typescript
export const SETTLEMENT_TIER_MODIFIERS_GR: Record<string, number> = {
  rural: 10,
  // metropolitan, city, town → 0
};
```

### German border zone modifier (gr/l)

```typescript
export const BORDER_ZONE_MODIFIER_GR = -15;
```

### Band constants

```typescript
export const BAND_RADIUS_GR = 15;          // ±0.15 PLN symmetric band
export const FALLBACK_BAND_PCT = 0.05;     // ±5% fallback band
```

### National fallback prices (PLN/l, used when ORLEN rack data unavailable)

```typescript
export const NATIONAL_FALLBACK_PRICES_PLN: Record<string, number> = {
  PB_95: 6.40,
  ON:    6.45,
  LPG:   2.90,
};
```

### CRITICAL: Estimated prices are NOT cached in Redis

Community prices are cached via Redis (existing behavior). Estimated ranges are always computed fresh from MarketSignal (rack prices) + Station classification fields. Rack prices are fetched once per `findPricesInArea` call and reused for all uncovered stations in that request.

### CRITICAL: Only PB_95, ON, LPG get estimated ranges

PB_98 and ON_PREMIUM are not tracked by ORLEN rack signals — skip them in estimation. If a station only has PB_98/ON_PREMIUM community data, it will still be excluded from estimation (has community price already).

### StationPriceRow extension

Add two optional fields to the existing interface in `price-cache.service.ts`:

```typescript
export interface StationPriceRow {
  stationId: string;
  prices: Record<string, number>;
  priceRanges?: Record<string, { low: number; high: number }>;  // present for seeded only
  estimateLabel?: 'market_estimate' | 'estimated';               // present for seeded only
  updatedAt: Date;
  source: 'community' | 'seeded';
}
```

The `prices` field for seeded rows carries the midpoint (used for map pin color coding). The `priceRanges` field carries the actual display range. The cache `deserialize` method is backward compatible since both fields are optional.

### PriceService update — station discovery query

Change `findStationIdsInArea` to `findStationsInArea` returning classification data:

```typescript
private async findStationsInArea(lat, lng, radius): Promise<StationRow[]> {
  return this.prisma.$queryRaw<StationRow[]>`
    SELECT id, brand, station_type, voivodeship, settlement_tier, is_border_zone_de
    FROM "Station"
    WHERE location IS NOT NULL
      AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radius})
  `;
}
```

Then derive `stationIds = stations.map(s => s.id)` for Redis/DB price queries.

### PriceService update — combining community + estimated

```typescript
// After community prices collected from cache + DB:
const coveredIds = new Set(communityPrices.map(r => r.stationId));
const uncoveredStations = stations.filter(s => !coveredIds.has(s.id));
const estimatedPrices = uncoveredStations.length > 0
  ? [...(await this.estimatedPriceService.computeEstimatesForStations(uncoveredStations)).values()]
  : [];
return [...communityPrices, ...estimatedPrices];
```

### PriceController update

```typescript
return rows.map(r => ({
  stationId: r.stationId,
  prices: r.prices,
  ...(r.priceRanges ? { priceRanges: r.priceRanges } : {}),
  ...(r.estimateLabel ? { estimateLabel: r.estimateLabel } : {}),
  updatedAt: new Date(r.updatedAt).toISOString(),
  source: r.source,
}));
```

### Mobile: price display in StationDetailSheet

```tsx
// For each fuel type:
const price = prices!.prices[ft];
const range = prices!.priceRanges?.[ft];
if (price === undefined) return null;

const displayValue = range
  ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
  : prices!.source === 'seeded'
    ? `~${price.toFixed(2)}`
    : price.toFixed(2);
```

Label (below price list):
```tsx
{prices!.source === 'seeded' && (
  <TouchableOpacity onPress={showExplain}>
    <Text style={styles.estimatedLabel}>
      {prices!.estimateLabel === 'market_estimate'
        ? t('freshness.marketEstimate')
        : t('freshness.estimated')}
    </Text>
  </TouchableOpacity>
)}
```

### Mobile i18n additions

```typescript
// en.ts — freshness section additions
marketEstimate: 'Market estimate',
marketEstimateExplain: "We don't have a recent community price here yet. This range is based on current wholesale market data.",
contributePrompt: 'Tap to contribute a verified price.',
dismiss: 'Got it',
```

Polish (pl.ts):
```
marketEstimate: 'Szacunek rynkowy'
marketEstimateExplain: 'Nie mamy jeszcze aktualnej ceny zgłoszonej przez społeczność. Ten zakres opiera się na bieżących cenach hurtowych.'
contributePrompt: 'Kliknij, aby zgłosić zweryfikowaną cenę.'
dismiss: 'Rozumiem'
```

Ukrainian (uk.ts):
```
marketEstimate: 'Ринкова оцінка'
marketEstimateExplain: 'Ми ще не маємо актуальної ціни від спільноти. Цей діапазон базується на поточних оптових цінах.'
contributePrompt: 'Натисніть, щоб вказати перевірену ціну.'
dismiss: 'Зрозуміло'
```

### References

- `apps/api/src/market-signal/staleness-detection.service.ts` — SIGNAL_TO_FUEL_TYPE constant
- `apps/api/src/price/price.service.ts` — spatial query pattern, existing price flow
- `apps/api/src/station/station-classification.service.ts` — classification field types
- Story 2.14 — classification fields on Station model
- Story 2.7 — MarketSignal table / ORLEN rack prices

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

(none yet)

### Completion Notes List

(none yet)

### File List

(populated on completion)

## Change Log

- 2026-03-27: Story 2.12 created from epics spec, dev started.
