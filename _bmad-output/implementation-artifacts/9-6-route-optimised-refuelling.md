# Story 9.6: Route-Optimised Refuelling Suggestions

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.6
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (apps/fleet scaffold, fleetFetch helper), Story 2.1 (Station model with `location geography(Point,4326)`, `voivodeship`), Story 2.11 (PriceHistory model: `price`, `fuel_type`, `recorded_at`, `station_id`)
- **Required by:** None

---

## User Story

**As a fleet manager,**
I want to enter a start and end point for a planned route and get a list of the cheapest fuel stations within an acceptable detour,
So that I can brief drivers on the most cost-effective place to fill up on their trip.

---

## Context & Why

This is the fleet-tier feature that directly reduces fuel spend by showing managers where on a planned route they can get the cheapest fuel without meaningfully lengthening the drive. It works in three steps:

1. **Route** — call Mapbox Directions API to get the driving route as a GeoJSON LineString
2. **Find stations near route** — PostGIS `ST_DWithin` against the route LineString geometry
3. **Price join** — fetch the latest verified price per candidate station, filter by fuel type, sort by price

The result is a ranked list of up to 5 stations, each showing the price and approximate extra kilometres to detour. No map rendering for MVP — a sorted list is sufficient for the briefing use case.

### Mapbox API Usage

Two Mapbox APIs are used:
- **Geocoding API** (client-side) — address autocomplete in the browser. Uses `NEXT_PUBLIC_MAPBOX_TOKEN` (public, same token already used in `apps/web` from Story 2.10).
- **Directions API** (server-side) — compute driving route geometry. Uses `MAPBOX_API_TOKEN` (kept server-side in `apps/api`). Can be the same `pk.` token — Directions v5 supports public tokens. A dedicated `sk.` token is optional.

**Cost:** Mapbox Directions API — free for the first 100,000 requests/month, then $1 per 1,000. At fleet scale (tens of managers, a few queries per day) this stays within the free tier. Add `MAPBOX_API_TOKEN` cost note to the project cost tracker.

---

## Acceptance Criteria

**Given** a fleet manager is on the Route Planner page
**When** they type a start and end address, select a fuel type, and submit
**Then** the page displays up to 5 fuel stations sorted by price (lowest first), each showing: station name, brand, address, price per litre, and approximate detour km

**Given** no fuel stations with a recent price (within 48h) exist within the max detour of the route
**When** the suggestions are computed
**Then** the page shows an empty state: "No stations with recent prices found within {maxDetourKm} km of your route"

**Given** a fleet manager sets max detour to 3 km
**When** results are shown
**Then** only stations whose straight-line distance from the route is ≤ 3 km are included

**Given** a fleet manager submits the form
**When** the Mapbox Directions API call fails (network error, invalid coordinates)
**Then** the page shows an error: "Could not calculate route — check the addresses and try again"

**Given** the fleet manager's fleet has no active subscription (FREE_TRIAL or ACTIVE)
**When** they access the Route Planner
**Then** the feature is accessible (no subscription gate on route planner for MVP)

---

## API Changes

### New Endpoint: POST /v1/fleet/route/suggestions

**Module:** `FleetModule` (existing)

```typescript
// apps/api/src/fleet/fleet.controller.ts

@Post('route/suggestions')
@Roles(Role.FLEET_MANAGER)
async getRouteSuggestions(
  @Body() dto: RouteSuggestionsDto,
): Promise<RouteSuggestionsResponseDto> {
  return this.fleetRouteService.getSuggestions(dto);
}
```

**Request DTO:**

```typescript
// apps/api/src/fleet/dto/route-suggestions.dto.ts
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class RouteSuggestionsDto {
  @IsNumber() startLng: number;
  @IsNumber() startLat: number;
  @IsNumber() endLng: number;
  @IsNumber() endLat: number;

  @IsEnum(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'])
  fuelType: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  maxDetourKm: number = 5;
}
```

**Response DTO:**

```typescript
// apps/api/src/fleet/dto/route-suggestions.dto.ts (continued)

export class StationSuggestionDto {
  stationId: string;
  stationName: string;
  brand: string | null;
  address: string | null;
  lat: number;
  lng: number;
  pricePerLitrePln: number;
  detourKm: number;             // approximate: 2 × perpendicular distance to route
  lastRecordedAt: string;       // ISO datetime of the price record
}

export class RouteSuggestionsResponseDto {
  routeDistanceKm: number;
  routeDurationMinutes: number;
  suggestions: StationSuggestionDto[];
}
```

---

## FleetRouteService

**File:** `apps/api/src/fleet/fleet-route.service.ts` (new)

```typescript
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RouteSuggestionsDto, RouteSuggestionsResponseDto, StationSuggestionDto } from './dto/route-suggestions.dto';

const MAPBOX_API_TOKEN = process.env['MAPBOX_API_TOKEN'];
const MAX_SUGGESTIONS = 5;
const PRICE_FRESHNESS_HOURS = 48;

interface MapboxRouteResponse {
  routes: {
    distance: number;    // metres
    duration: number;    // seconds
    geometry: {
      type: 'LineString';
      coordinates: [number, number][];  // [lng, lat] pairs
    };
  }[];
  code: string;
  message?: string;
}

interface StationNearRouteRow {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  lat: number;
  lng: number;
  distance_to_route_m: number;
}

interface LatestPriceRow {
  station_id: string;
  price: number;
  recorded_at: Date;
}

@Injectable()
export class FleetRouteService {
  private readonly logger = new Logger(FleetRouteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSuggestions(dto: RouteSuggestionsDto): Promise<RouteSuggestionsResponseDto> {
    // 1. Get driving route from Mapbox Directions API
    const route = await this.fetchRoute(dto.startLng, dto.startLat, dto.endLng, dto.endLat);

    const routeDistanceKm = route.distance / 1000;
    const routeDurationMinutes = Math.round(route.duration / 60);
    const maxDetourMetres = dto.maxDetourKm * 1000;

    // 2. Build route LineString WKT from Mapbox coordinates
    const lineWkt = coordinatesToLineStringWkt(route.geometry.coordinates);

    // 3. Find stations within max detour of the route
    const nearbyStations = await this.findStationsNearRoute(lineWkt, maxDetourMetres);

    if (nearbyStations.length === 0) {
      return { routeDistanceKm, routeDurationMinutes, suggestions: [] };
    }

    // 4. Fetch latest price for each nearby station
    const stationIds = nearbyStations.map((s) => s.id);
    const latestPrices = await this.fetchLatestPrices(stationIds, dto.fuelType);

    const priceByStationId = new Map(latestPrices.map((p) => [p.station_id, p]));

    // 5. Filter to stations with a recent price, compute detour, sort by price
    const freshnessCutoff = new Date(Date.now() - PRICE_FRESHNESS_HOURS * 60 * 60 * 1000);

    const suggestions: StationSuggestionDto[] = nearbyStations
      .filter((s) => {
        const price = priceByStationId.get(s.id);
        return price && price.recorded_at >= freshnessCutoff;
      })
      .map((s) => {
        const price = priceByStationId.get(s.id)!;
        const detourKm = Math.round((s.distance_to_route_m * 2) / 100) / 10;  // 2× perp distance, 1dp
        return {
          stationId: s.id,
          stationName: s.name,
          brand: s.brand,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          pricePerLitrePln: price.price,
          detourKm,
          lastRecordedAt: price.recorded_at.toISOString(),
        };
      })
      .sort((a, b) => a.pricePerLitrePln - b.pricePerLitrePln)
      .slice(0, MAX_SUGGESTIONS);

    return { routeDistanceKm, routeDurationMinutes, suggestions };
  }

  // ─── Mapbox Directions ────────────────────────────────────────────────────

  private async fetchRoute(
    startLng: number,
    startLat: number,
    endLng: number,
    endLat: number,
  ): Promise<MapboxRouteResponse['routes'][0]> {
    const coords = `${startLng},${startLat};${endLng},${endLat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?geometries=geojson&overview=full&access_token=${MAPBOX_API_TOKEN}`;

    let json: MapboxRouteResponse;
    try {
      const res = await fetch(url);
      json = await res.json() as MapboxRouteResponse;
    } catch (err) {
      this.logger.error(`Mapbox Directions fetch failed: ${(err as Error).message}`);
      throw new BadRequestException('Could not calculate route — check the addresses and try again');
    }

    if (json.code !== 'Ok' || !json.routes?.length) {
      this.logger.warn(`Mapbox Directions error: ${json.code} — ${json.message ?? ''}`);
      throw new BadRequestException('Could not calculate route — check the addresses and try again');
    }

    return json.routes[0];
  }

  // ─── PostGIS queries ──────────────────────────────────────────────────────

  private async findStationsNearRoute(
    lineWkt: string,
    maxDetourMetres: number,
  ): Promise<StationNearRouteRow[]> {
    // ST_GeomFromText parses WKT; cast to geography for metric distance accuracy
    const rows = await this.prisma.$queryRaw<StationNearRouteRow[]>`
      SELECT
        s.id,
        s.name,
        s.brand,
        s.address,
        ST_Y(s.location::geometry)                                          AS lat,
        ST_X(s.location::geometry)                                          AS lng,
        ST_Distance(s.location, ST_GeomFromText(${lineWkt}, 4326)::geography) AS distance_to_route_m
      FROM "Station" s
      WHERE s.location IS NOT NULL
        AND ST_DWithin(
              s.location,
              ST_GeomFromText(${lineWkt}, 4326)::geography,
              ${maxDetourMetres}
            )
      ORDER BY distance_to_route_m ASC
      LIMIT 30
    `;
    return rows;
  }

  private async fetchLatestPrices(
    stationIds: string[],
    fuelType: string,
  ): Promise<LatestPriceRow[]> {
    if (stationIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<LatestPriceRow[]>`
      SELECT DISTINCT ON (ph.station_id)
        ph.station_id,
        ph.price,
        ph.recorded_at
      FROM "PriceHistory" ph
      WHERE ph.station_id = ANY(${stationIds})
        AND ph.fuel_type   = ${fuelType}
      ORDER BY ph.station_id, ph.recorded_at DESC
    `;
    return rows;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a GeoJSON coordinate array [[lng,lat], ...] to WKT LineString.
 * Mapbox coordinates are [longitude, latitude] — PostGIS ST_GeomFromText
 * with SRID 4326 uses (longitude latitude) order in WKT, matching this.
 */
function coordinatesToLineStringWkt(coords: [number, number][]): string {
  const points = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
  return `LINESTRING(${points})`;
}
```

**Register `FleetRouteService` in `FleetModule`:**

```typescript
providers: [FleetService, FleetAlertsService, FleetAlertCheckService, FleetAlertCheckWorker, FleetReportsService, FleetRouteService],
```

**Environment variable — add to `apps/api/.env.example`:**

```
# Mapbox API token for server-side Directions API calls (pk. or sk. token)
MAPBOX_API_TOKEN=pk.your-token-here
```

---

## Fleet App Changes

### Route Planner Page

**File:** `apps/fleet/app/(fleet)/route/page.tsx` (new)

```tsx
import RoutePlannerForm from './RoutePlannerForm';

export const metadata = { title: 'Route Planner' };

export default function RoutePlannerPage() {
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-2">Route Planner</h1>
      <p className="text-sm text-gray-500 mb-6">
        Find the cheapest fuel stop on a planned route.
      </p>
      <RoutePlannerForm />
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/route/RoutePlannerForm.tsx` (new Client Component)

```tsx
'use client';

import { useState, useTransition } from 'react';
import { getRouteSuggestionsAction } from './actions';
import AddressAutocomplete from './AddressAutocomplete';
import SuggestionList from './SuggestionList';

const FUEL_TYPES = [
  { value: 'ON', label: 'Diesel' },
  { value: 'PB_95', label: 'Pb 95' },
  { value: 'PB_98', label: 'Pb 98' },
  { value: 'ON_PREMIUM', label: 'Premium Diesel' },
  { value: 'LPG', label: 'LPG' },
];

interface Coordinate { lng: number; lat: number; label: string }

export default function RoutePlannerForm() {
  const [start, setStart] = useState<Coordinate | null>(null);
  const [end, setEnd] = useState<Coordinate | null>(null);
  const [fuelType, setFuelType] = useState('ON');
  const [maxDetourKm, setMaxDetourKm] = useState(5);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await getRouteSuggestionsAction({
          startLng: start.lng, startLat: start.lat,
          endLng: end.lng, endLat: end.lat,
          fuelType, maxDetourKm,
        });
        setResult(res);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to get suggestions');
        setResult(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <AddressAutocomplete
          label="Start"
          placeholder="e.g. Warszawa, ul. Marszałkowska 1"
          onSelect={setStart}
        />
        <AddressAutocomplete
          label="Destination"
          placeholder="e.g. Kraków, ul. Floriańska 1"
          onSelect={setEnd}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fuel type</label>
            <select
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {FUEL_TYPES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Max detour: {maxDetourKm} km
            </label>
            <input
              type="range"
              min={1}
              max={20}
              value={maxDetourKm}
              onChange={(e) => setMaxDetourKm(Number(e.target.value))}
              className="w-full mt-2"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || !start || !end}
          className="w-full py-3 rounded-lg bg-gray-900 text-white font-medium text-sm disabled:opacity-50"
        >
          {pending ? 'Searching…' : 'Find fuel stops'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{error}</p>
      )}

      {result && (
        <SuggestionList
          suggestions={result.suggestions}
          routeDistanceKm={result.routeDistanceKm}
          fuelType={fuelType}
          maxDetourKm={maxDetourKm}
        />
      )}
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/route/AddressAutocomplete.tsx` (new Client Component)

Uses the Mapbox Geocoding API directly from the browser with `NEXT_PUBLIC_MAPBOX_TOKEN`. No backend proxy needed — the public token is safe in client code (same pattern as Story 2.10).

```tsx
'use client';

import { useState, useCallback, useRef } from 'react';

interface Props {
  label: string;
  placeholder: string;
  onSelect: (coord: { lng: number; lat: number; label: string }) => void;
}

const MAPBOX_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';

interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];  // [lng, lat]
}

export default function AddressAutocomplete({ label, placeholder, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?country=pl&language=pl&types=address,place&limit=5&access_token=${MAPBOX_TOKEN}`;
    try {
      const res = await fetch(url);
      const data = await res.json() as { features: GeocodingFeature[] };
      setSuggestions(data.features ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), 300);
  }

  function handleSelect(feature: GeocodingFeature) {
    const [lng, lat] = feature.center;
    setQuery(feature.place_name);
    setSelected(feature.place_name);
    setSuggestions([]);
    onSelect({ lng, lat, label: feature.place_name });
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      {suggestions.length > 0 && !selected && (
        <ul className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg">
          {suggestions.map((f) => (
            <li
              key={f.id}
              onClick={() => handleSelect(f)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 truncate"
            >
              {f.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/route/SuggestionList.tsx` (new Client Component)

```tsx
'use client';

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Pb 95', PB_98: 'Pb 98', ON: 'Diesel', ON_PREMIUM: 'Premium Diesel', LPG: 'LPG',
};

interface Suggestion {
  stationId: string;
  stationName: string;
  brand: string | null;
  address: string | null;
  pricePerLitrePln: number;
  detourKm: number;
  lastRecordedAt: string;
}

interface Props {
  suggestions: Suggestion[];
  routeDistanceKm: number;
  fuelType: string;
  maxDetourKm: number;
}

export default function SuggestionList({ suggestions, routeDistanceKm, fuelType, maxDetourKm }: Props) {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-6">
        No stations with recent prices found within {maxDetourKm} km of your route.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">
        Route: ~{routeDistanceKm.toFixed(0)} km · {FUEL_LABELS[fuelType] ?? fuelType} · sorted by price
      </p>
      <ul className="divide-y divide-gray-100">
        {suggestions.map((s, i) => (
          <li key={s.stationId} className="py-3 flex gap-3 items-start">
            <span className="text-xs font-semibold text-gray-400 mt-0.5 w-4">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {s.brand ? `${s.brand} — ` : ''}{s.stationName}
                </span>
                <span className="text-base font-bold text-gray-900 whitespace-nowrap">
                  {s.pricePerLitrePln.toFixed(2)} PLN/L
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {s.address && <span>{s.address} · </span>}
                ~{s.detourKm.toFixed(1)} km detour
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/route/actions.ts` (new Server Action)

```typescript
'use server';

import { fleetFetch } from '../../../lib/fleet-api';

export async function getRouteSuggestionsAction(params: {
  startLng: number; startLat: number;
  endLng: number; endLat: number;
  fuelType: string;
  maxDetourKm: number;
}) {
  return fleetFetch<any>('/v1/fleet/route/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}
```

**Note:** `fleetFetch` already attaches `Authorization: Bearer {fleet_token}` from the httpOnly cookie. The Server Action runs on the Next.js server where the cookie is accessible.

### Navigation — Add Route Planner Tab

In `apps/fleet/app/(fleet)/layout.tsx`, add the Route Planner link:

```tsx
{ href: '/route', label: 'Route', icon: MapIcon },
```

---

## No Migration Required

No new Prisma models. The route planner queries the existing `Station` (with PostGIS `location`) and `PriceHistory` tables.

---

## Tasks / Subtasks

- [ ] API: `RouteSuggestionsDto` + `RouteSuggestionsResponseDto` + `StationSuggestionDto` (AC: 1, 2, 3, 4)

- [ ] API: `FleetRouteService` (AC: 1, 2, 3, 4)
  - [ ] `fetchRoute()` — Mapbox Directions API call; throw `BadRequestException` on failure
  - [ ] `coordinatesToLineStringWkt()` — GeoJSON coords → WKT LineString
  - [ ] `findStationsNearRoute()` — PostGIS `ST_DWithin` + `ST_Distance` on route LineString
  - [ ] `fetchLatestPrices()` — `DISTINCT ON (station_id)` query ordered by `recorded_at DESC`
  - [ ] Filter by `PRICE_FRESHNESS_HOURS = 48`, sort by price, slice to `MAX_SUGGESTIONS = 5`
  - [ ] `detourKm = 2 × distance_to_route_m / 1000` (approx)

- [ ] API: `POST /v1/fleet/route/suggestions` endpoint in `FleetController` (AC: 1, 2, 3, 4)
  - [ ] `@Roles(Role.FLEET_MANAGER)`
  - [ ] Register `FleetRouteService` in `FleetModule`

- [ ] API: `MAPBOX_API_TOKEN` env var in `.env.example` + Railway

- [ ] Fleet app: `AddressAutocomplete.tsx` — Mapbox Geocoding client-side autocomplete (AC: 1)
  - [ ] 300ms debounce
  - [ ] `country=pl` filter, `types=address,place`, limit 5

- [ ] Fleet app: `RoutePlannerForm.tsx` — start/end + fuel type + max detour slider + submit (AC: 1, 2, 3, 4)
  - [ ] Disable submit until both start and end selected
  - [ ] Show error state from `BadRequestException` (AC: 4)

- [ ] Fleet app: `SuggestionList.tsx` — ranked list with price + detour + empty state (AC: 1, 2)

- [ ] Fleet app: `actions.ts` — `getRouteSuggestionsAction` Server Action

- [ ] Fleet app: Route Planner page `page.tsx` + nav link in `(fleet)/layout.tsx`

---

## Dev Notes

### WKT LineString from Mapbox Route

Mapbox Directions returns route geometry with `overview=full` — the full-resolution route as a GeoJSON LineString. For Poland (typical 200–500 km routes), this yields ~200–800 coordinate points. The resulting WKT string is well within PostgreSQL's parameter size limits.

The `ST_GeomFromText(wkt, 4326)::geography` cast in the PostGIS query:
- `4326` is the SRID for WGS 84 (standard GPS coordinates)
- The `::geography` cast enables metric distance calculations (avoiding degree-based inaccuracies)
- Mapbox uses `[lng, lat]` order in GeoJSON coordinates; WKT `LINESTRING(lng lat, ...)` uses the same `x y` (longitude latitude) convention — no coordinate swap needed

### Detour Approximation

The `detourKm = 2 × perpendicular_distance_to_route` approximation works well for stations close to the route and for routes that don't double back. It slightly overestimates the real detour for stations near the start/end of the route (where the detour is one-way, not round-trip). For MVP this is acceptable. Post-MVP: snap the station to its nearest point on the route and use the actual route segment lengths for an exact detour.

### `NEXT_PUBLIC_MAPBOX_TOKEN` in Fleet App

The fleet app (`apps/fleet`) needs `NEXT_PUBLIC_MAPBOX_TOKEN` for client-side geocoding. Check that the token from `apps/web` (Story 2.10) and `apps/mobile` has sufficient quota. Mapbox Geocoding free tier is 100,000 requests/month — more than adequate. Add `NEXT_PUBLIC_MAPBOX_TOKEN` to `apps/fleet/.env.example` (same value as `apps/web`).

### PriceHistory Field Names

From Story 2.11: `PriceHistory` uses `price` (not `price_pln`) and `recorded_at` (not `created_at`). The raw SQL in `fetchLatestPrices()` uses these exact field names. **Note:** This also affects Story 9.5 (`FleetAlertCheckService`) — that story's Prisma query uses `price_pln` and `is_verified` incorrectly. When implementing 9.5, correct to `price` and remove the `is_verified` filter (PriceHistory only stores verified prices already).

### Geocoding `country=pl`

The `country=pl` parameter restricts geocoding results to Poland. Fleet vehicles operate domestically for MVP. Remove this restriction when fleet cross-border features are added.

### Mapbox Rate Limits

Mapbox Geocoding API: 600 requests/minute per token. Mapbox Directions: 300 requests/minute. Well above any realistic fleet portal usage. No rate-limit handling needed for MVP.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
