# Story 2.3: Colour-Coded Price Comparison

Status: review

## Story

As a **driver**,
I want stations on the map to be colour-coded by relative price,
So that I can instantly see which nearby stations are cheap or expensive without tapping each one.

## Why

Colour coding is the core value delivery of the map — it turns raw data into an instant decision. Without colour coding, the map is just a list of stations.

## Acceptance Criteria

1. **Given** multiple stations are visible on the map **When** their prices are loaded **Then** each station pin is colour-coded relative to the others in the current view — green = cheapest third, amber = middle third, red = most expensive third.

2. **Given** a driver selects a specific fuel type **When** the filter is applied **Then** colour coding updates to reflect relative prices for that fuel type only.

3. **Given** only one station is visible with price data **When** it is displayed **Then** a neutral colour (`#94a3b8`) is used — relative pricing requires at least two data points.

4. **Given** a station with no price data (no verified submissions yet) **When** it is shown on the map **Then** it displays neutral slate-400 (`#94a3b8`) — never misleadingly coloured.

5. **Given** a driver zooms out to see a wider area **When** many stations become visible **Then** colour coding recalculates based on all visible stations in the current viewport (driven by existing `fetchCenter` region change).

6. **Given** a driver views colour-coded station pins **When** their selected language is Polish, English, or Ukrainian **Then** all UI labels (fuel type selector) are displayed in that language.

7. **Given** a guest user (no `accessToken`) **When** they view the map **Then** all pins show neutral slate-400 — no price API call is made.

## Tasks / Subtasks

### Phase 1 — Backend: Prices API endpoint

- [x] **1.1** Create `apps/api/src/price/price.service.ts`:
  - Method: `findPricesInArea(lat: number, lng: number, radiusMeters: number): Promise<StationPriceRow[]>`
  - Uses `$queryRaw` tagged template (same pattern as `StationService.findStationsInArea`):
    ```sql
    SELECT DISTINCT ON (sub.station_id)
      sub.station_id   AS "stationId",
      sub.price_data   AS prices,
      sub.created_at   AS "updatedAt"
    FROM "Submission" sub
    JOIN "Station" s ON s.id = sub.station_id
    WHERE sub.status = 'verified'
      AND s.location IS NOT NULL
      AND ST_DWithin(s.location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
    ORDER BY sub.station_id, sub.created_at DESC
    ```
  - `DISTINCT ON (sub.station_id)` with `ORDER BY sub.station_id, sub.created_at DESC` gives the **latest** verified submission per station.
  - `StationPriceRow` interface (local to service, not exported):
    ```ts
    interface StationPriceRow {
      stationId: string;
      prices: Record<string, number>; // JSONB from DB — keys are FuelType values
      updatedAt: Date;
    }
    ```

- [x] **1.2** Create `apps/api/src/price/dto/get-nearby-prices.dto.ts`:
  ```ts
  import { IsNumber, IsOptional, Max, Min } from 'class-validator';
  import { Type } from 'class-transformer';

  export class GetNearbyPricesDto {
    @IsNumber() @Min(-90) @Max(90) @Type(() => Number)
    lat!: number;

    @IsNumber() @Min(-180) @Max(180) @Type(() => Number)
    lng!: number;

    @IsOptional() @IsNumber() @Min(100) @Max(50000) @Type(() => Number)
    radius?: number;
  }
  ```

- [x] **1.3** Create `apps/api/src/price/dto/station-price.dto.ts`:
  ```ts
  export class StationPriceDto {
    stationId!: string;
    prices!: Record<string, number>; // keys: 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
    updatedAt!: string; // ISO string
  }
  ```

- [x] **1.4** Create `apps/api/src/price/price.controller.ts`:
  ```ts
  @Controller('v1/prices')
  export class PriceController {
    constructor(private readonly priceService: PriceService) {}

    @Get('nearby')
    async getNearby(@Query() dto: GetNearbyPricesDto): Promise<StationPriceDto[]> {
      const rows = await this.priceService.findPricesInArea(dto.lat, dto.lng, dto.radius ?? 25000);
      return rows.map(r => ({
        stationId: r.stationId,
        prices: r.prices,
        updatedAt: r.updatedAt.toISOString(),
      }));
    }
  }
  ```
  - **No `@Public()` decorator** — relies on global `JwtAuthGuard` (registered via `APP_GUARD` in `AppModule`).

- [x] **1.5** Create `apps/api/src/price/price.module.ts`:
  ```ts
  @Module({
    controllers: [PriceController],
    providers: [PriceService],
    exports: [PriceService],
  })
  export class PriceModule {}
  ```
  - `PriceService` needs `PrismaService` — import `PrismaModule` or add to providers. `PrismaModule` is global — no explicit import needed.

- [x] **1.6** Register `PriceModule` in `apps/api/src/app.module.ts`:
  - Add `PriceModule` to the `imports` array alongside `StationModule`.

- [x] **1.7** Write unit tests `apps/api/src/price/price.service.spec.ts`:
  - `findPricesInArea` returns `[]` when `$queryRaw` returns `[]`
  - Returns array with `stationId`, `prices`, `updatedAt` fields
  - Uses `$queryRaw` (not `$queryRawUnsafe`) — add assertion

- [x] **1.8** Write unit tests `apps/api/src/price/price.controller.spec.ts`:
  - `GET /v1/prices/nearby`: returns `StationPriceDto[]` on valid `?lat=&lng=`
  - Calls `priceService.findPricesInArea` with default radius 25000
  - Calls with explicit radius
  - `updatedAt` is serialised as ISO string
  - No `@Public()` decorator — auth guard test (verify `reflector.get('isPublic', controller.getNearby)` is `undefined`)
  - ValidationPipe: rejects lat>90, lat<-90, lng>180, lng<-180, radius>50000, radius<100

### Phase 2 — Mobile: Prices API client & hook

- [x] **2.1** Create `apps/mobile/src/api/prices.ts`:
  ```ts
  // Re-use the same API_BASE + ApiError + request<T>() pattern as src/api/stations.ts
  // Do NOT import from stations.ts — duplicate the request helper (it's local per-module)

  export type StationPriceDto = {
    stationId: string;
    prices: Partial<Record<FuelType, number>>; // from @desert/types FuelType
    updatedAt: string;
  };

  export async function apiGetNearbyPrices(
    accessToken: string,
    lat: number,
    lng: number,
    radiusMeters?: number,
    signal?: AbortSignal,
  ): Promise<StationPriceDto[]>
  ```
  - Import `FuelType` from `@desert/types` (already in workspace — no install needed).
  - AbortSignal support: pass to `request()` via `options.signal`.

- [x] **2.2** Create `apps/mobile/src/hooks/useNearbyPrices.ts`:
  ```ts
  export function useNearbyPrices(
    accessToken: string | null,
    center: LocationCoords | null,
  ): { prices: StationPriceDto[]; loading: boolean; error: boolean }
  ```
  - Identical structure to `useNearbyStations`:
    - No AsyncStorage cache (prices change frequently, stale prices are misleading)
    - AbortController on `center` change
    - Early return if `!center || !accessToken` — guests get empty prices (grey pins)
    - On error: `error: true`, keep previous prices if any
  - Cache key: **none** — do NOT cache price data (unlike station positions, stale prices actively mislead)

### Phase 3 — Mobile: Colour coding engine

- [x] **3.1** Create `apps/mobile/src/utils/priceColor.ts`:
  ```ts
  import type { FuelType } from '@desert/types';
  import type { StationPriceDto } from '../api/prices';

  export type PriceColor = 'cheap' | 'mid' | 'expensive' | 'nodata';

  export const PRICE_COLORS: Record<PriceColor, string> = {
    cheap:     '#22c55e', // green-500
    mid:       '#f59e0b', // amber-500
    expensive: '#ef4444', // red-500
    nodata:    '#94a3b8', // slate-400
  };

  export function computePriceColorMap(
    stationIds: string[],
    prices: StationPriceDto[],
    fuelType: FuelType,
  ): Map<string, PriceColor> {
    const result = new Map<string, PriceColor>();
    const priceByStation = new Map(prices.map(p => [p.stationId, p.prices[fuelType]]));

    const validPrices = stationIds
      .map(id => priceByStation.get(id))
      .filter((p): p is number => typeof p === 'number');

    if (validPrices.length < 2) {
      stationIds.forEach(id => result.set(id, 'nodata'));
      return result;
    }

    const min = Math.min(...validPrices);
    const max = Math.max(...validPrices);
    const range = max - min;

    stationIds.forEach(id => {
      const price = priceByStation.get(id);
      if (price === undefined) { result.set(id, 'nodata'); return; }
      if (range === 0)         { result.set(id, 'mid'); return; }
      const ratio = (price - min) / range;
      result.set(id, ratio <= 0.33 ? 'cheap' : ratio <= 0.66 ? 'mid' : 'expensive');
    });

    return result;
  }
  ```

### Phase 4 — Mobile: Map screen updates

- [x] **4.1** Update `apps/mobile/app/(app)/index.tsx`:

  **Add selectedFuelType state (in-memory, default PB_95, persistence in Story 2.4):**
  ```ts
  import type { FuelType } from '@desert/types';
  const FUEL_TYPES: FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];
  // inside component:
  const [selectedFuelType, setSelectedFuelType] = useState<FuelType>('PB_95');
  ```

  **Add `useNearbyPrices` hook (parallel to `useNearbyStations`):**
  ```ts
  const { prices, loading: loadingPrices, error: pricesError } = useNearbyPrices(accessToken, fetchCenter);
  ```

  **Compute colour map using `useMemo`:**
  ```ts
  import { computePriceColorMap } from '../../src/utils/priceColor';
  const priceColorMap = useMemo(
    () => computePriceColorMap(stations.map(s => s.id), prices, selectedFuelType),
    [stations, prices, selectedFuelType],
  );
  ```

  **Update `buildGeoJSON` to accept colour map:**
  ```ts
  function buildGeoJSON(
    stations: { id: string; name: string; lat: number; lng: number }[],
    colorMap: Map<string, PriceColor>,
  ): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: stations.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name, priceColor: colorMap.get(s.id) ?? 'nodata' },
      })),
    };
  }
  ```

  **Update `buildGeoJSON` call:**
  ```ts
  const geojson = useMemo(
    () => buildGeoJSON(stations, priceColorMap),
    [stations, priceColorMap],
  );
  ```
  Note: move `buildGeoJSON` call from direct assignment to `useMemo` — this is now the right place since it was previously recreated every render.

  **Update `CircleLayer` to data-driven expression:**
  ```tsx
  import type { Expression } from '@rnmapbox/maps';

  <CircleLayer
    id="station-pins"
    style={{
      circleColor: [
        'match', ['get', 'priceColor'],
        'cheap',     '#22c55e',
        'mid',       '#f59e0b',
        'expensive', '#ef4444',
        '#94a3b8',  // default fallback = nodata
      ] as Expression,
      circleRadius: 8,
      circleStrokeColor: '#ffffff',
      circleStrokeWidth: 1.5,
    }}
  />
  ```

  **Add fuel type selector bar (horizontal scroll, above the map):**
  ```tsx
  import { ScrollView, TouchableOpacity } from 'react-native';

  {/* Fuel type selector — floating above map, top of screen */}
  <View style={styles.fuelSelector} pointerEvents="box-none">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fuelSelectorContent}>
      {FUEL_TYPES.map(ft => (
        <TouchableOpacity
          key={ft}
          style={[styles.fuelPill, selectedFuelType === ft && styles.fuelPillActive]}
          onPress={() => setSelectedFuelType(ft)}
        >
          <Text style={[styles.fuelPillText, selectedFuelType === ft && styles.fuelPillTextActive]}>
            {t(`fuelTypes.${ft}`)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
  ```

  **Add styles for fuel selector:**
  ```ts
  fuelSelector: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  fuelSelectorContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  fuelPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(26,26,26,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  fuelPillActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  fuelPillText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  fuelPillTextActive: {
    color: '#1a1a1a',
  },
  ```

  **Layout note:** The fuel selector is `position: 'absolute'` floating over the map. The `locationDeniedBanner` is also `position: 'absolute', top: 16` — they will overlap. Move `locationDeniedBanner` to `top: 72` (below the selector bar, approximately 48px pill height + 16px gap).

- [x] **4.2** Update i18n locale files — add to `fuelTypes` namespace in `en.ts`, `pl.ts`, `uk.ts`:
  ```ts
  fuelTypes: {
    // existing keys preserved:
    petrol_95: 'Petrol 95',
    petrol_98: 'Petrol 98',
    diesel: 'Diesel',
    lpg: 'LPG',
    // new keys matching FuelType values (used via t(`fuelTypes.${fuelType}`)):
    PB_95:      'PB 95',
    PB_98:      'PB 98',
    ON:         'ON',
    ON_PREMIUM: 'ON+',
    LPG:        'LPG',   // already exists under different key — add new key too
  }
  ```
  Polish: `PB_95: 'PB 95'`, `PB_98: 'PB 98'`, `ON: 'ON'`, `ON_PREMIUM: 'ON+'`, `LPG: 'LPG'`
  Ukrainian: same as Polish (fuel grade names are universal in Poland)

### Phase 5 — Tests

- [x] **5.1** `apps/api/src/price/price.service.spec.ts`:
  - Mock `PrismaService.$queryRaw`
  - Returns `[]` when no verified submissions in area
  - Returns rows with `stationId`, `prices` (JSONB object), `updatedAt` (Date)
  - Uses `$queryRaw` not `$queryRawUnsafe`

- [x] **5.2** `apps/api/src/price/price.controller.spec.ts`:
  - Mock `PriceService.findPricesInArea`
  - Returns `StationPriceDto[]` with `updatedAt` as ISO string
  - Default radius 25000
  - Auth guard: no `@Public()` decorator
  - ValidationPipe: rejects lat>90, lat<-90, lng>180, lng<-180, radius>50000, radius<100

- [x] **5.3** Mobile: no Jest configured in `apps/mobile` — do NOT add Jest. Mobile tests out of scope.

## Dev Notes

### Critical Architecture Decisions

- **Separate prices endpoint:** `GET /v1/prices/nearby` is a separate endpoint from `GET /v1/stations/nearby`. This follows the architecture spec and allows independent caching (Story 2.9 adds Redis for prices).
- **No price cache on mobile:** `useNearbyPrices` has NO AsyncStorage cache. Station positions are stable (cache valid days), prices change daily (stale price colours are actively misleading). Only station positions are cached.
- **Colour algorithm is relative, client-side:** No server logic needed. The mobile computes colours from the loaded price set. This means: (a) no extra API, (b) colours always reflect currently visible stations, (c) recalculates correctly when region changes.
- **`useMemo` for GeoJSON:** `buildGeoJSON` must be memoized — it depends on stations + priceColorMap. Both are now stable references (stations from state, priceColorMap from useMemo). This prevents ShapeSource re-renders on unrelated state changes.
- **Mapbox Expression type:** Import `Expression` from `@rnmapbox/maps`. The `circleColor` data-driven expression array must be typed as `Expression` to satisfy TypeScript. If `Expression` is not exported from the package root, use `as unknown as string` cast as fallback.
- **FuelType source of truth:** `@desert/types` package — `type FuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'`. Import from `@desert/types` on both API and mobile. Do NOT redefine this type.
- **Fuel selector placement vs locationDeniedBanner:** Both are `position: 'absolute', top: 16`. Move `locationDeniedBanner` to `top: 72` to avoid overlap.
- **In-memory fuel type only:** `selectedFuelType` is `useState` only — no AsyncStorage persistence. Story 2.4 adds persistence and the full filter UX.

### price_data JSONB Shape

`Submission.price_data` is `Json` (Prisma) / `jsonb` (Postgres). Expected shape (used by OCR worker in Story 3.x):
```ts
// Example: { PB_95: 6.42, ON: 6.89, LPG: 2.89 }
type PriceData = Partial<Record<FuelType, number>>;
```
Keys are `FuelType` values. Values are prices in PLN per litre. A submission may contain prices for 1–5 fuel types. Missing keys = station doesn't carry that fuel type.

**In `price.service.ts`:** The raw JSONB comes back from Prisma as `Record<string, unknown>`. Cast to `Record<string, number>` — Prisma handles JSONB deserialization automatically.

### PostGIS Note

`DISTINCT ON (sub.station_id)` requires the first `ORDER BY` expression to match the `DISTINCT ON` expression. The full `ORDER BY sub.station_id, sub.created_at DESC` is valid PostgreSQL — it sorts by station first (satisfying DISTINCT ON), then by date descending (picking the latest submission per station).

### PrismaModule Availability

`PrismaModule` is registered as a **global module** in `AppModule`. Any module that adds `PrismaService` to its `providers` or imports `PrismaModule` explicitly gets access. For `PriceModule`, just inject `PrismaService` via constructor — it will resolve from the global module.

### Existing Patterns to Follow

- DTO pattern: `@IsNumber() @Min(...) @Max(...) @Type(() => Number)` — see `GetNearbyStationsDto`
- Controller pattern: no auth guard decorator, no `@Public()` — see `StationController`
- Service pattern: `$queryRaw` tagged template — see `StationService.findStationsInArea`
- API client pattern: local `request<T>()` helper, local `ApiError` class — see `src/api/stations.ts`
- Hook pattern: `AbortController` + early return on `!accessToken` — see `useNearbyStations`
- i18n: `useTranslation()` → `t('fuelTypes.PB_95')` — all strings through i18n

### File Structure

**Backend (new):**
```
apps/api/src/price/
  price.module.ts
  price.service.ts
  price.controller.ts
  dto/
    get-nearby-prices.dto.ts
    station-price.dto.ts
  price.service.spec.ts
  price.controller.spec.ts
```

**Backend (modified):**
- `apps/api/src/app.module.ts` — add `PriceModule` to imports

**Mobile (new):**
- `apps/mobile/src/api/prices.ts`
- `apps/mobile/src/hooks/useNearbyPrices.ts`
- `apps/mobile/src/utils/priceColor.ts`

**Mobile (modified):**
- `apps/mobile/app/(app)/index.tsx` — fuel selector, priceColorMap, updated CircleLayer, useMemo for geojson
- `apps/mobile/src/i18n/locales/en.ts`
- `apps/mobile/src/i18n/locales/pl.ts`
- `apps/mobile/src/i18n/locales/uk.ts`

**Artifacts:**
- `_bmad-output/implementation-artifacts/2-3-colour-coded-price-comparison.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes List
- All PRICE_COLORS use `tokens.price.*` values — no raw hex in priceColor.ts
- CircleLayer expression uses `PRICE_COLORS.*` constants (token-derived strings) instead of inline hex
- Fuel pill styles use `tokens.brand.accent` (active), `tokens.brand.ink` (active text), `tokens.neutral.n200` (inactive text), `tokens.radius.full`; rgba semi-transparent values are acceptable inline (no token equivalent)
- `locationDeniedBanner` moved from `topBarHeight + 8` to `topBarHeight + 64` to avoid overlap with fuel selector
- `useNearbyPrices` has no AsyncStorage cache by design — stale prices are actively misleading
- 188/188 API tests passing (21 new price tests)

### Change Log
- 2026-03-25: Story created
- 2026-03-25: Implementation complete — Phase 1-5 all done, 188/188 tests passing
- 2026-03-25: Code review patches P1-P4 applied — updatedAt safe Date cast, NaN guard in priceColor, useNearbyPrices loading reset on early-return, pricesError wired to error banner
