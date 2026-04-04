# Story 2.2: Mobile Map View with Station Pins

Status: done

## Story

As a **driver**,
I want to see a map of nearby fuel stations centred on my current location,
so that I can quickly find stations around me without having to search manually.

## Why

The map view is the core of the product — it's what drivers open the app for. Getting this right (fast, location-aware, clear station pins) is the single most important first impression. Without it, nothing else in the product has context.

## Acceptance Criteria

1. **Given** an authenticated driver opens the app, **When** the map screen loads, **Then** it is centred on their current GPS location and nearby station pins are shown within the visible map area.

2. **Given** the map is loading, **When** it takes longer than 3 seconds, **Then** an `ActivityIndicator` loading state is shown — the screen never displays a blank white page.

3. **Given** a driver who has previously opened the app, **When** they open it again without connectivity or with GPS/API failure, **Then** the last-known station positions are shown from AsyncStorage cache — the app does not hard-fail or show an empty screen.

4. **Given** a driver moves to a new area, **When** they pan or zoom the map, **Then** station pins update to reflect the new visible area (fresh API fetch on region change, debounced 500ms).

5. **Given** the map is displayed, **When** station pins are rendered, **Then** each pin is tappable — logs station name to console as placeholder (full station detail sheet is Story 2.5).

6. **Given** a driver views the map screen, **When** their selected language is Polish, English, or Ukrainian, **Then** all UI text (error messages, loading text, permission prompts) is displayed in that language.

7. **Given** location permission is denied by the user, **When** the map loads, **Then** the map renders at a default centre (Warsaw: 52.2297° N, 21.0122° E) with a dismissible non-blocking banner explaining location is needed for full functionality — the app does not crash.

## Tasks / Subtasks

### Phase 1 — Backend: Nearby stations API endpoint (AC: 1, 4)

- [x] **1.1** Add `findStationsInArea(lat: number, lng: number, radiusMeters: number): Promise<StationDto[]>` to `apps/api/src/station/station.service.ts`:
  ```sql
  SELECT id, name, address, google_places_id,
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng
  FROM "Station"
  WHERE location IS NOT NULL
    AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
  ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
  LIMIT 500
  ```
  `ST_Y` = latitude, `ST_X` = longitude (geography stores lng,lat — do NOT swap).
  `LIMIT 500` guards against edge-case huge-radius queries.

- [x] **1.2** Create `apps/api/src/station/dto/get-nearby-stations.dto.ts`:
  ```ts
  import { IsNumber, IsOptional, Max, Min } from 'class-validator';
  import { Type } from 'class-transformer';
  export class GetNearbyStationsDto {
    @IsNumber() @Type(() => Number) lat!: number;
    @IsNumber() @Type(() => Number) lng!: number;
    @IsOptional() @IsNumber() @Min(100) @Max(50000) @Type(() => Number)
    radius?: number;
  }
  ```

- [x] **1.3** Create `apps/api/src/station/dto/station.dto.ts`:
  ```ts
  export class StationDto {
    id!: string;
    name!: string;
    address!: string | null;
    google_places_id!: string | null;
    lat!: number;
    lng!: number;
  }
  ```

- [x] **1.4** Create `apps/api/src/station/station.controller.ts`:
  - `GET /v1/stations/nearby` — protected by global `JwtAuthGuard` (no `@Public()`)
  - `@Query()` validates `GetNearbyStationsDto` (enable `ValidationPipe` via existing global pipe)
  - Calls `stationService.findStationsInArea(lat, lng, radius ?? 25000)`
  - Returns `StationDto[]`
  - Route prefix: use `@Controller('v1/stations')` or nest under existing module as `@Get('nearby')`

- [x] **1.5** Register `StationController` in `apps/api/src/station/station.module.ts`:
  - Add `controllers: [StationController]`

- [x] **1.6** Write unit tests:
  - `apps/api/src/station/station.controller.spec.ts` — GET /v1/stations/nearby: 200 with array, 400 on missing lat/lng, radius capped at 50000, calls service with correct args
  - `apps/api/src/station/station.service.spec.ts` — extend with `findStationsInArea`: empty array on zero results, returns mapped `lat`/`lng`, passes radiusMeters

### Phase 2 — Mobile: Dependencies & permissions (AC: 1, 7)

- [x] **2.1** Add to `apps/mobile/package.json` dependencies:
  - `"@rnmapbox/maps": "^10.1.33"` — Mapbox SDK, Expo 55 / RN 0.83 / New Arch compatible
  - `"expo-location": "^18.1.5"` — foreground GPS permission + position
  - Run `pnpm install` from repo root

- [x] **2.2** Add `EXPO_PUBLIC_MAPBOX_TOKEN=` to `apps/mobile/.env.example`

- [x] **2.3** Update `apps/mobile/app.json`:
  - `ios.infoPlist.NSLocationWhenInUseUsageDescription`: `"We use your location to show nearby fuel stations."`
  - `android.permissions`: add `"android.permission.ACCESS_FINE_LOCATION"` alongside existing `POST_NOTIFICATIONS`

### Phase 3 — Mobile: API client, hooks (AC: 1, 3, 4)

- [x] **3.1** Create `apps/mobile/src/api/stations.ts`:
  ```ts
  export type StationDto = {
    id: string; name: string;
    address: string | null; google_places_id: string | null;
    lat: number; lng: number;
  };
  // Re-use same API_BASE + ApiError + request<T>() pattern as src/api/user.ts
  // Include AbortSignal support: request(..., { signal })
  export async function apiGetNearbyStations(
    accessToken: string, lat: number, lng: number,
    radiusMeters?: number, signal?: AbortSignal,
  ): Promise<StationDto[]>
  ```

- [x] **3.2** Create `apps/mobile/src/hooks/useLocation.ts`:
  ```ts
  export function useLocation(): {
    location: { lat: number; lng: number } | null;
    permissionDenied: boolean;
    loading: boolean;
  }
  ```
  - `Location.requestForegroundPermissionsAsync()` on mount
  - `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })` if granted
  - Returns `permissionDenied: true` if status !== 'granted' — map uses Warsaw fallback

- [x] **3.3** Create `apps/mobile/src/hooks/useNearbyStations.ts`:
  ```ts
  export function useNearbyStations(
    accessToken: string | null,
    center: { lat: number; lng: number } | null,
  ): { stations: StationDto[]; loading: boolean; error: boolean }
  ```
  - On mount: load `AsyncStorage.getItem('desert.stations_cache')` → parse JSON → set stations immediately
  - When `center` changes: cancel previous request (AbortController), call `apiGetNearbyStations`
  - On success: update stations state + write cache (`AsyncStorage.setItem('desert.stations_cache', JSON.stringify(data))`)
  - On error with cache available: log warn, keep cached stations, `error: false` (silent degradation — AC3)
  - On error with NO cache: `error: true`
  - When `accessToken` is null (guest): skip API call, return `{ stations: cachedStations, loading: false, error: false }`

### Phase 4 — Mobile: Map screen (AC: 1, 2, 3, 4, 5, 6, 7)

- [x] **4.1** Create `apps/mobile/src/components/map/MapPin.tsx` (future-use component for `MarkerView` pattern):
  - 32×32 circle, fill `#94a3b8` (slate-400 neutral — price-tier colour added in Story 2.3)
  - `accessibilityLabel` prop for station name
  - NOT rendered in Story 2.2 (ShapeSource+CircleLayer used instead) — created for Story 2.5 reference

- [x] **4.2** Rewrite `apps/mobile/app/(app)/index.tsx` as full map screen:
  ```tsx
  import Mapbox, { MapView, Camera, ShapeSource, CircleLayer } from '@rnmapbox/maps';
  Mapbox.setAccessToken(process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? ''); // outside component

  export default function MapScreen() {
    // useLocation() → { location, permissionDenied, loading: loadingGPS }
    // useNearbyStations(accessToken, center) → { stations, loading: loadingStations, error }
    // center: GPS location or Warsaw fallback { lat: 52.2297, lng: 21.0122 }
    // debounce region change: setTimeout/clearTimeout ref, 500ms
    // GeoJSON FeatureCollection built from stations[]
    // Loading overlay: ActivityIndicator when loadingGPS || (loadingStations && stations.length === 0)
    // Location-denied banner: dismissible View overlay (not a modal), uses t('map.locationDenied')
    // Preserve SoftSignUpSheet for unauthenticated first-time users
  }
  ```

  **GeoJSON construction:**
  ```ts
  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, // lng first — GeoJSON order
      properties: { id: s.id, name: s.name },
    })),
  };
  ```

  **CircleLayer paint properties:**
  ```ts
  circleColor: '#94a3b8'  // Story 2.3 replaces with data-driven expression
  circleRadius: 8
  circleStrokeColor: '#ffffff'
  circleStrokeWidth: 1.5
  ```

  **Pin tap:**
  ```tsx
  <ShapeSource id="stations" shape={geojson} onPress={e => {
    const name = e.features[0]?.properties?.name ?? 'Unknown';
    console.log('Station tapped:', name); // Story 2.5 opens sheet
  }}>
  ```

  **Camera:**
  ```tsx
  <Camera
    defaultSettings={{ centerCoordinate: [center.lng, center.lat], zoomLevel: 13 }}
    centerCoordinate={[center.lng, center.lat]}
    animationMode="flyTo"
    animationDuration={800}
  />
  ```

  **Region change (debounced):**
  ```tsx
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onRegionDidChange on MapView:
  const handleRegionChange = (feature: GeoJSON.Feature) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      setCenter({ lat, lng });
    }, 500);
  };
  ```

- [x] **4.3** Update i18n locale files — add to `map` namespace in `en.ts`, `pl.ts`, `uk.ts`:
  ```ts
  map: {
    loadingMap: 'Loading map...',                          // en / 'Ładowanie mapy...' / 'Завантаження карти...'
    locationDenied: 'Location access denied — showing default area',  // en / pl / uk
    locationDeniedDismiss: 'OK',
    offlineNotice: 'Offline — showing last known stations', // en / pl / uk
    stationsLoadError: 'Could not load stations',           // en / pl / uk
    // Keep: signedInAs, signOut (still used in account screen indirectly)
    // Remove: comingSoon (no longer needed)
  }
  ```

### Phase 5 — Tests (AC: all)

- [x] **5.1** `apps/api/src/station/station.controller.spec.ts` (new file):
  - 200 + StationDto[] on valid `?lat=52.23&lng=21.01`
  - 400 on missing `lat`
  - 400 on missing `lng`
  - Calls `stationService.findStationsInArea(lat, lng, 25000)` with default radius
  - Calls with explicit radius when provided; clamps to 50000 via DTO `@Max`
  - Auth guard mock: controller is protected

- [x] **5.2** Extend `apps/api/src/station/station.service.spec.ts`:
  - `findStationsInArea` returns `[]` when `$queryRaw` returns `[]`
  - `findStationsInArea` maps raw rows to `StationDto` with `lat`/`lng` numeric fields
  - `findStationsInArea` passes `radiusMeters` to the query template

- [x] **5.3** Mobile: no Jest configured in `apps/mobile` — do NOT add Jest. Mobile tests are outside scope.

## Dev Notes

### Critical Architecture Decisions

- **Map SDK locked:** `@rnmapbox/maps` — NOT react-native-maps. Specified in architecture and UX spec. Do not substitute.
- **Pin rendering strategy:** `ShapeSource` + `CircleLayer` (GeoJSON-driven), NOT `MarkerView`. Scales to 8,000 stations; allows Story 2.3 to replace `circleColor` with a data-driven expression (`['match', ['get', 'priceColor'], ...]`) with zero structural changes.
- **Pin colour in 2.2:** Neutral `#94a3b8` slate-400 ONLY. Price-tier colours (`#22c55e`/`#f59e0b`/`#ef4444`) are added in Story 2.3 — do NOT pre-implement any price colour logic.
- **Station detail:** Pin tap is `console.log` only. `@gorhom/bottom-sheet` and `StationSheet` are Story 2.5.
- **Styling:** NativeWind is NOT installed. All styles via `StyleSheet.create`. Do not add NativeWind.
- **Auth for stations API:** Guests see map tiles but no pins (skip API call when `accessToken` is null). This is intentional — architecture requires auth for all price/station data endpoints.
- **GeoJSON coordinate order:** `[longitude, latitude]` — Mapbox and GeoJSON standard. `Camera.centerCoordinate` also takes `[lng, lat]`. The PostGIS `ST_X` = lng, `ST_Y` = lat.

### Mapbox v10 Setup Notes

1. `Mapbox.setAccessToken(token)` must be called **before** any `<MapView>` renders — at module scope (outside component)
2. `<MapView style={{ flex: 1 }}>` — must have flex:1 or explicit height, otherwise collapses to 0
3. `Camera` `defaultSettings` sets initial viewport; `centerCoordinate` + `animationMode="flyTo"` drives programmatic pan
4. `onRegionDidChange` fires on the `<MapView>` component, receives `GeoJSON.Feature<GeoJSON.Point>` with `coordinates: [lng, lat]`
5. New Architecture (`newArchEnabled: true` in app.json) — `@rnmapbox/maps` v10 supports it
6. For Android EAS builds: no additional gradle changes needed; Mapbox token is passed via env var, not secrets/gradle

### `expo-location` Usage

```typescript
import * as Location from 'expo-location';
const { status } = await Location.requestForegroundPermissionsAsync();
if (status !== 'granted') { setPermissionDenied(true); return; }
const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
```

### Offline Cache Strategy

- Key: `'desert.stations_cache'` in AsyncStorage
- Value: `JSON.stringify(StationDto[])`
- On mount: load cache synchronously before GPS/API call → pins appear instantly from cache
- On API success: overwrite cache with fresh data
- On API error + cache exists: silent degradation, keep displaying cached pins (AC3)
- On API error + no cache: set `error: true` → show `t('map.stationsLoadError')` banner (non-blocking)

### PostGIS Query Detail

The `location` column is `geography(Point,4326)`. To extract lat/lng:
- Cast to geometry first: `location::geometry`
- `ST_Y(location::geometry)` → latitude
- `ST_X(location::geometry)` → longitude
- `ST_DWithin(location, ST_Point(lng, lat)::geography, radius)` — note `ST_Point` takes `(lng, lat)` order

The `$queryRaw` tagged template returns raw rows. TypeScript type must be explicitly declared:
```ts
const rows = await this.prisma.$queryRaw<Array<{
  id: string; name: string; address: string | null;
  google_places_id: string | null; lat: number; lng: number;
}>>`SELECT ...`;
```

### Existing Patterns to Follow

- API client: `src/api/user.ts` — `const API_BASE = process.env['EXPO_PUBLIC_API_URL']`, local `request<T>()` helper, local `ApiError` class. Replicate this exact pattern in `src/api/stations.ts`.
- Auth context: `useAuth()` from `../../src/store/auth.store` → `{ accessToken, user, hasSeenOnboarding, logout }`
- i18n: `useTranslation()` → `t('map.xxx')` — all strings through i18n, no hardcoded text
- Screen structure: `app/(app)/index.tsx` imports from `../../src/...` (two levels up)
- `SoftSignUpSheet`: preserve the existing logic — `!accessToken && !hasSeenOnboarding && !sheetDismissed` condition

### Project Structure Notes

- `StationController` is new — no existing controller in the module
- `ValidationPipe` is already registered globally in `apps/api/src/main.ts` (from Story 1.x) — DTOs work automatically
- `apps/mobile/src/hooks/` directory may not exist yet — create it
- `apps/mobile/src/components/map/` directory is new — create it
- `@types/geojson` is a transitive dependency via `@rnmapbox/maps` — no explicit install needed for TypeScript types

### References

- Map SDK: [architecture.md — Design System Foundation] `@rnmapbox/maps`
- Pin design spec: [ux-design-specification.md — Component Strategy: MapPin] 32dp, price-tier fill, freshness dot
- Color system: [ux-design-specification.md — Visual Design Foundation: Color System]
- Offline requirement: [ux-design-specification.md — Core User Experience] "Fully functional on cached data"
- API auth pattern: [architecture.md — Decision 6] all endpoints require auth; no public price API
- PostGIS pattern: [story 2.1 — station.service.ts] `$queryRaw` tagged templates

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `OnPressEvent` is not re-exported from the `@rnmapbox/maps` package root (only used internally in `ShapeSource.d.ts`). Fixed by defining a local type inline in the map screen, matching the shape from the internal type definition.

### Completion Notes List

- Phase 1: `findStationsInArea` added to `StationService` using `ST_DWithin` + `ST_X`/`ST_Y` for lat/lng extraction. `StationController` created with `GET /v1/stations/nearby` protected by global JwtAuthGuard. DTOs with `class-validator` + `@Type(() => Number)` for query param coercion. 162/162 API tests passing, tsc clean.
- Phase 2: `@rnmapbox/maps@^10.1.33` and `expo-location@^18.1.5` added to mobile dependencies. `EXPO_PUBLIC_MAPBOX_TOKEN` added to `.env.example`. Location permissions added to `app.json` (iOS `NSLocationWhenInUseUsageDescription`, Android `ACCESS_FINE_LOCATION`).
- Phase 3: `src/api/stations.ts` — `apiGetNearbyStations` with AbortSignal support. `useLocation` hook — GPS permission + Balanced accuracy, cancelled cleanup. `useNearbyStations` hook — AsyncStorage cache load on mount, AbortController on center change, silent degradation on fetch error with cache.
- Phase 4: `app/(app)/index.tsx` rewritten — Mapbox `MapView` + `Camera` + `ShapeSource` + `CircleLayer` (neutral `#94a3b8` slate pins). Debounced region change (500ms). Loading overlay with `ActivityIndicator`. GPS-denied banner (dismissible). Offline cache fallback. `SoftSignUpSheet` preserved. i18n keys added to all three locales (en/pl/uk). Mobile `tsc --noEmit` clean.
- Phase 5: `station.controller.spec.ts` (9 tests) + extended `station.service.spec.ts` (+4 tests for `findStationsInArea`). No mobile Jest.

### File List

**Backend (new):**
- `apps/api/src/station/station.controller.ts`
- `apps/api/src/station/station.controller.spec.ts`
- `apps/api/src/station/dto/get-nearby-stations.dto.ts`
- `apps/api/src/station/dto/station.dto.ts`

**Backend (modified):**
- `apps/api/src/station/station.service.ts`
- `apps/api/src/station/station.service.spec.ts`
- `apps/api/src/station/station.module.ts`

**Mobile (new):**
- `apps/mobile/src/api/stations.ts`
- `apps/mobile/src/hooks/useLocation.ts`
- `apps/mobile/src/hooks/useNearbyStations.ts`
- `apps/mobile/src/components/map/MapPin.tsx`

**Mobile (modified):**
- `apps/mobile/app/(app)/index.tsx`
- `apps/mobile/src/i18n/locales/en.ts`
- `apps/mobile/src/i18n/locales/pl.ts`
- `apps/mobile/src/i18n/locales/uk.ts`
- `apps/mobile/app.json`
- `apps/mobile/.env.example`
- `apps/mobile/package.json`

**Artifacts:**
- `_bmad-output/implementation-artifacts/2-2-mobile-map-view-station-pins.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-03-24: Story 2.2 implemented — Mapbox map screen with GPS centering, ShapeSource+CircleLayer station pins, `useLocation`+`useNearbyStations` hooks, offline AsyncStorage cache, `GET /v1/stations/nearby` API endpoint. 162/162 API tests passing, mobile tsc clean.

## Review Notes (2026-04-04)

No new patches. Prior review (2026-03-25) applied P1–P4.

**Design decision override:** Prior review logged F1 as intent gap — "spec says no pins for guests." This has been reversed. The station endpoint is `@Public()` (made public in Story 2.10 for SSR), and Story 1.4's value proposition ("explore fuel prices before registering") requires guests to see pins. The `!accessToken` gate in `useNearbyStations` and non-optional `accessToken` in `apiGetNearbyStations` were removed in the UI-5 re-review patch (commit 94a201b). Guests now see full station data — intentional per product decision.
