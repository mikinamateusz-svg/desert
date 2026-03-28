# Story 2.10 — SSR Public Map

**Status:** review
**Epic:** 2 — Price Discovery
**Story ID:** 2.10
**Created:** 2026-03-27

---

## User Story

As a **public user**,
I want to view fuel station prices on the web without creating an account,
So that I can quickly check prices before heading out, and search engines can index the content.

**Why:** The public map is the primary SEO acquisition channel — drivers discovering the platform via Google ("fuel prices Warsaw") land here first. SSR means search engines index real price data, not a blank JS shell. It also means no raw JSON price API is exposed — prices are only accessible via the rendered page, which is the core data protection decision from the architecture.

---

## Acceptance Criteria

- **AC1 — Unauthenticated access:** Given an unauthenticated user visits the public map URL, when the page loads, then they see a fully rendered map with station prices — no login required, no blank loading state while JS hydrates

- **AC2 — SEO indexability:** Given a search engine crawler visits the public map, when it indexes the page, then station names, locations, and current prices are present in the HTML — fully indexable without JavaScript execution

- **AC3 — No client-side price API call:** Given the public map page, when it is inspected via browser dev tools (Network tab), then there is no `/v1/prices` or equivalent JSON API endpoint being called — all price data is fetched server-side via Next.js Server Components

- **AC4 — Contribution CTA:** Given a public user who wants to submit a price, when they tap the contribution button, then they are prompted to create an account — unauthenticated price submission is not permitted

- **AC5 — i18n:** Given a public user views the SSR public map, when their browser language is set to Polish, English, or Ukrainian, then all UI text on the page is displayed in that language

---

## Technical Architecture

### The Core Constraint: SSR-Only Price Data

The architecture mandates that **no price data API endpoint is exposed to browsers**. This means:

- `page.tsx` is a **Next.js Server Component** — runs only on the server, never in the browser
- The server component calls the NestJS API internally (server-to-server) using `fetch()` with the `INTERNAL_API_URL` env var
- Price data is passed as **props** to the `<MapView>` Client Component
- The browser receives rendered HTML + hydrated React state — never a price API response

### Component Split

```
apps/web/app/page.tsx          (Server Component — fetches prices, renders HTML)
  └── <MapView>                (Client Component — "use client", renders Mapbox canvas)
        └── <StationMarker>    (Client Component — price pin on map)
        └── <StationPopup>     (Client Component — detail popup on pin click)
```

The Server Component:
1. Reads `Accept-Language` header to determine language (pl / en / uk)
2. Calls NestJS API: `GET {INTERNAL_API_URL}/v1/stations/nearby?lat=52.0&lng=19.5&radius=50000` (Poland-wide default)
3. Calls NestJS API: `GET {INTERNAL_API_URL}/v1/prices/nearby?lat=52.0&lng=19.5&radius=50000`
4. Joins station + price data by `stationId`
5. Renders `<MapView stations={joined} lang={lang} />` + SEO-friendly hidden HTML list

**Default viewport:** Poland center `lat=52.0, lng=19.5`, zoom level 6.

### SEO HTML (AC2)

The map renders in a `<canvas>` — not crawlable. To satisfy AC2, the Server Component also renders a visually hidden `<ul>` with all station data:

```tsx
<ul className="sr-only" aria-hidden="false">
  {stations.map(s => (
    <li key={s.stationId}>
      {s.name} — {s.address} — PB 95: {s.prices.PB_95?.toFixed(2)} zł/l
    </li>
  ))}
</ul>
```

`sr-only` is a Tailwind utility (visually hidden but accessible/crawlable). Do NOT use `display:none` or `visibility:hidden` — these hide from crawlers too.

### Map Library

Use `react-map-gl` (Visgl's React wrapper for Mapbox GL JS):
- `react-map-gl` ^7.1.7
- `mapbox-gl` ^3.10.0

These are Client Components only (`"use client"`). Mapbox renders to a `<canvas>` element and requires browser APIs.

**Mapbox token:** The `NEXT_PUBLIC_MAPBOX_TOKEN` env var holds the public Mapbox token (starts with `pk.`). Public tokens are safe in client-side code — this is by Mapbox design.

### i18n

**Do not use next-intl or react-i18next for this story.** Keep it simple: a static translation object read by the server component. Three supported locales: `pl`, `en`, `uk`.

```typescript
// apps/web/lib/i18n.ts
export type Locale = 'pl' | 'en' | 'uk';

export function detectLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return 'pl';
  const lang = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();
  if (lang === 'uk') return 'uk';
  if (lang === 'en') return 'en';
  return 'pl'; // default
}

export const translations: Record<Locale, Record<string, string>> = {
  pl: {
    title: 'Ceny paliw — desert',
    contribute: 'Dodaj cenę',
    contributePrompt: 'Zaloguj się, aby dodać cenę',
    // ...add all UI strings
  },
  en: { /* ... */ },
  uk: { /* ... */ },
};
```

Pass the translations object as a prop from server to client component.

### Internal API URL

The web app calls the NestJS API server-to-server. No auth is currently required on station/price GET endpoints (no `@UseGuards` decorator in the existing controllers). The URL is configured via env var:

- Dev: `INTERNAL_API_URL=http://localhost:3000` (NestJS dev server port)
- Production (Railway → Vercel): `INTERNAL_API_URL=https://your-api.railway.app`

The fetch is done with `cache: 'no-store'` to prevent stale data, OR with `next: { revalidate: 600 }` for a 10-minute ISR cache (matches Redis TTL). Use ISR revalidate to avoid hammering the API on every page load. **Use `revalidate: 600`.**

---

## File Structure

### New files to create

```
apps/web/
├── app/
│   └── page.tsx                    ← REPLACE placeholder (Server Component)
├── components/
│   ├── MapView.tsx                 ← NEW (Client Component, "use client")
│   ├── StationMarker.tsx           ← NEW (Client Component, price pin)
│   └── StationPopup.tsx            ← NEW (Client Component, detail popup)
├── lib/
│   ├── api.ts                      ← NEW (server-side fetch utilities)
│   └── i18n.ts                     ← NEW (locale detection + translations)
└── .env.example                    ← UPDATE (add new env vars)
```

### Files to modify

```
apps/web/
├── package.json                    ← Add react-map-gl, mapbox-gl
├── next.config.ts                  ← Add mapbox-gl transpile if needed
└── app/layout.tsx                  ← Update title/description dynamically
```

---

## Implementation Tasks

### Task 1: Add dependencies

In `apps/web/package.json`, add to `dependencies`:
```json
"react-map-gl": "^7.1.7",
"mapbox-gl": "^3.10.0"
```

Run `pnpm install` from repo root.

Update `apps/web/next.config.ts` to transpile mapbox-gl if needed:
```typescript
const nextConfig: NextConfig = {
  transpilePackages: ['@desert/types'],
};
```
(react-map-gl/mapbox-gl typically don't need transpilePackages with Next.js 16 — only add if you see a compilation error)

### Task 2: i18n utility

Create `apps/web/lib/i18n.ts` with:
- `detectLocale(acceptLanguage: string | null): Locale` — parses `Accept-Language` header, returns `'pl' | 'en' | 'uk'`
- `translations: Record<Locale, Record<string, string>>` — all UI strings for the map page
- Export `Locale` type

UI strings needed:
- `pageTitle` — browser tab title
- `contribute` — CTA button label
- `contributePrompt` — modal/sheet text explaining login requirement
- `noData` — shown when no prices available
- `updatedAt` — "Updated {time}"
- `fuelTypes.PB_95`, `fuelTypes.ON`, `fuelTypes.LPG`, `fuelTypes.PB_98`, `fuelTypes.ON_PREMIUM`

### Task 3: Internal API client

Create `apps/web/lib/api.ts`:
```typescript
// Server-side only — do not import in Client Components
const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export interface StationDto {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface StationPriceDto {
  stationId: string;
  prices: Partial<Record<string, number>>;
  priceRanges?: Partial<Record<string, { low: number; high: number }>>;
  estimateLabel?: Partial<Record<string, string>>;
  sources: Partial<Record<string, string>>;
  updatedAt: string;
}

export interface StationWithPrice extends StationDto {
  price: StationPriceDto | null;
}

export async function fetchStationsWithPrices(
  lat: number,
  lng: number,
  radius: number,
): Promise<StationWithPrice[]> {
  const [stations, prices] = await Promise.all([
    fetch(`${API_URL}/v1/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      next: { revalidate: 600 },
    }).then(r => r.json() as Promise<StationDto[]>),
    fetch(`${API_URL}/v1/prices/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      next: { revalidate: 600 },
    }).then(r => r.json() as Promise<StationPriceDto[]>),
  ]);

  const priceMap = new Map(prices.map(p => [p.stationId, p]));
  return stations.map(s => ({ ...s, price: priceMap.get(s.id) ?? null }));
}
```

**Note on radius:** Default to `radius=50000` (50km) for the initial server render. The map client can re-fetch on pan/zoom in future stories — for now, load a wide area on initial render.

### Task 4: Server Component page

Replace `apps/web/app/page.tsx` with a Server Component:

```tsx
import { headers } from 'next/headers';
import { detectLocale, translations } from '../lib/i18n';
import { fetchStationsWithPrices } from '../lib/api';
import MapView from '../components/MapView';

// Poland center coordinates
const DEFAULT_LAT = 52.0;
const DEFAULT_LNG = 19.5;
const DEFAULT_RADIUS = 50000; // 50km for initial load

export default async function PublicMapPage() {
  const headerList = headers();
  const locale = detectLocale(headerList.get('accept-language'));
  const t = translations[locale];

  const stations = await fetchStationsWithPrices(DEFAULT_LAT, DEFAULT_LNG, DEFAULT_RADIUS);

  return (
    <>
      {/* SEO-indexable hidden list (AC2) */}
      <ul className="sr-only">
        {stations.map(s => (
          <li key={s.id}>
            {s.name}
            {s.address ? `, ${s.address}` : ''}
            {s.price?.prices.PB_95 != null
              ? ` — PB 95: ${s.price.prices.PB_95.toFixed(2)} zł/l`
              : ''}
          </li>
        ))}
      </ul>

      {/* Interactive map (Client Component) */}
      <MapView
        stations={stations}
        defaultLat={DEFAULT_LAT}
        defaultLng={DEFAULT_LNG}
        t={t}
      />
    </>
  );
}
```

### Task 5: MapView Client Component

Create `apps/web/components/MapView.tsx`:

```tsx
'use client';

import Map, { Marker, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState } from 'react';
import type { StationWithPrice } from '../lib/api';

interface Props {
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Record<string, string>;
}

export default function MapView({ stations, defaultLat, defaultLng, t }: Props) {
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [showContributePrompt, setShowContributePrompt] = useState(false);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: defaultLng,
          latitude: defaultLat,
          zoom: 6,
        }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
      >
        {stations.map(station => (
          <StationMarker
            key={station.id}
            station={station}
            onClick={() => setSelected(station)}
          />
        ))}

        {selected && (
          <StationPopup
            station={selected}
            t={t}
            onClose={() => setSelected(null)}
            onContribute={() => {
              setSelected(null);
              setShowContributePrompt(true);
            }}
          />
        )}
      </Map>

      {/* Contribute CTA button (AC4) */}
      <button
        style={{ position: 'absolute', top: 16, right: 16 }}
        onClick={() => setShowContributePrompt(true)}
      >
        {t.contribute}
      </button>

      {/* Login prompt modal (AC4) */}
      {showContributePrompt && (
        <ContributePrompt
          message={t.contributePrompt}
          onClose={() => setShowContributePrompt(false)}
        />
      )}
    </div>
  );
}
```

Split `StationMarker` and `StationPopup` into separate files:

**`apps/web/components/StationMarker.tsx`** — renders a `<Marker>` with a small price label (show PB_95 price, or "?" if no data).

**`apps/web/components/StationPopup.tsx`** — renders a `<Popup>` with all available fuel prices from `station.price.prices`, formatted to 2 decimal places. Include the contribute button (AC4).

**Styling approach:** Use Tailwind CSS classes. The map container uses inline styles for `width: 100vw; height: 100vh` (required by Mapbox GL). All other elements use Tailwind.

### Task 6: Environment variables

Update `apps/web/.env.example`:
```
# Internal NestJS API URL (server-side only — not NEXT_PUBLIC_)
INTERNAL_API_URL=http://localhost:3000

# Mapbox public token (safe in client code — starts with pk.)
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your-token-here
```

Update `apps/web/app/layout.tsx` to set the `<html lang>` attribute dynamically — or keep `lang="pl"` as the default (Polish is primary audience). The per-request locale detection in `page.tsx` is sufficient for text content.

### Task 7: Type safety

The `StationWithPrice` type lives in `apps/web/lib/api.ts` (server-side). The `MapView` component imports it. Since `MapView` is a Client Component but the type is only used at compile time, this is fine — types are erased at runtime.

Do NOT import `@desert/types` `FuelType` in Client Components unless the type is already transpiled (it is — `@desert/types` is in `transpilePackages`). You can safely import `FuelType` from `@desert/types` in both server and client components.

---

## Patterns from Previous Stories

**From Story 2.9 (Redis Price Cache):**
- The `GET /v1/prices/nearby` endpoint now serves from Redis cache with a 10-minute TTL. ISR revalidate of 600s in the web app aligns with this TTL. No changes to the API needed.
- The price shape includes `prices`, `priceRanges` (optional), `estimateLabel` (optional), `sources`, `updatedAt`
- Estimated prices (`sources.PB_95 === 'seeded'`) should display with a `~` prefix on the map pin and in the popup

**From Story 2.12 (Rack-derived estimated prices):**
- Stations without community prices now have estimated price ranges. Display `priceRanges.PB_95.low–high` if `estimateLabel.PB_95` exists. Use `~` prefix to signal estimation.

**Established code conventions:**
- NestJS API responses use camelCase JSON
- Fuel types: `PB_95`, `ON`, `LPG`, `PB_98`, `ON_PREMIUM`
- All monetary values in PLN, 2 decimal places, per litre

---

## Dev Notes

### mapbox-gl CSS

`mapbox-gl/dist/mapbox-gl.css` **must be imported** in the Client Component (or in a global CSS file). Without it, the map renders with broken controls. Import it in `MapView.tsx`:

```tsx
import 'mapbox-gl/dist/mapbox-gl.css';
```

### SSR compatibility of react-map-gl

`react-map-gl` requires browser APIs. Since `MapView.tsx` has `'use client'`, Next.js will NOT attempt to SSR it — only the Server Component (`page.tsx`) renders on the server. The map canvas itself is client-side only, which is correct.

If you see a "window is not defined" error, double-check that all Mapbox-related imports are inside `'use client'` components only.

### `react-map-gl` v7 API

The Map component API for v7:
```tsx
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl';
```

The `Marker` component renders at absolute lat/lng. The `Popup` component renders a floating box at lat/lng. Both require `longitude` and `latitude` props (numbers).

### No tests required for Client Components

The existing test suite is Jest/NestJS-focused. React component testing (via React Testing Library) is not set up in the web app. **Do not add tests for MapView, StationMarker, or StationPopup.** The story is validated via manual inspection of the running map.

### Vercel deployment

The web app deploys to Vercel (free Hobby tier). For the deployment to work:
1. Set `INTERNAL_API_URL` in Vercel environment variables (pointing to Railway API URL)
2. Set `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel environment variables
3. Vercel auto-detects Next.js — no special configuration needed

---

## Definition of Done

- [x] `pnpm dev` in `apps/web` shows the interactive map at `localhost:3002` without login
- [x] Network tab shows no call to `/v1/prices` or `/v1/stations` from the browser
- [x] View page source: station names and prices are present in the raw HTML (`<ul class="sr-only">`)
- [x] Contribute button shows a login prompt (not a submission form)
- [x] Page text changes when browser language is set to `en`, `pl`, or `uk`
- [x] TypeScript: `pnpm type-check` passes in `apps/web`
- [x] ESLint: `pnpm lint` passes in `apps/web`

---

## File List

- apps/web/package.json (modified — added mapbox-gl ^2.15.0, react-map-gl ^7.1.7, @types/mapbox-gl devDep)
- apps/web/.env.example (modified — added INTERNAL_API_URL, NEXT_PUBLIC_MAPBOX_TOKEN)
- apps/web/lib/i18n.ts (new — Locale type, detectLocale, Translations interface, pl/en/uk strings; extended in web-1)
- apps/web/lib/api.ts (new — fetchStationsWithPrices, StationDto, StationPriceDto, StationWithPrice)
- apps/web/app/page.tsx (modified — replaced placeholder with SSR Server Component; extended in web-1 with sidebar)
- apps/web/components/MapView.tsx (new — "use client" Mapbox map wrapper with contribute modal)
- apps/web/components/StationMarker.tsx (new — "use client" Mapbox Marker with price pin)
- apps/web/components/StationPopup.tsx (new — "use client" Mapbox Popup with fuel price list)

## Dev Agent Record

### Completion Notes

- `lib/i18n.ts`: `detectLocale` parses first segment of `Accept-Language` header; defaults to `pl`. `Translations` interface typed explicitly (not `Record<string,string>`) so Client Components can use typed keys.
- `lib/api.ts`: server-side only. Both fetches run in `Promise.all` with `next: { revalidate: 600 }` (10-min ISR, matches Redis TTL). Graceful `r.ok` check returns `[]` on API unavailability rather than throwing.
- `app/page.tsx`: `await headers()` (Next.js 16 requires `await` on `headers()`). `<ul className="sr-only">` renders all station names + PB_95 prices in the HTML for SEO indexability (AC2). Passes pre-fetched `stations` as props to MapView — no client-side API call (AC3).
- `components/MapView.tsx`: uses `react-map-gl` `Map` with `mapboxAccessToken` from `NEXT_PUBLIC_MAPBOX_TOKEN`. All Mapbox imports are inside `"use client"` boundary — no SSR issues. Contribute CTA opens an inline modal (not a navigation) that explains login requirement (AC4). Map dimensions changed from `100vw/100vh` to `100%/100%` to fill flex container correctly when sidebar is present.
- `components/StationMarker.tsx`: renders a `<button>` inside a `<Marker>`. Shows `~` prefix for estimated prices.
- `components/StationPopup.tsx`: shows all available fuels in standard order, range display for estimated prices, contribute button that triggers parent modal.
- API tests: 380/380 pass, no regressions.
- Build: `next build` succeeds, route `/` is `ƒ (Dynamic)` (correct — reads `headers()`).
- `mapbox-gl` uses v2.x (not v3) because react-map-gl v7 is compatible with mapbox-gl v2. This is the established stable pairing.

### Extensions (web-1 stories)

The following changes were made to 2.10 files as part of the web-1/web-2 implementation sprint:

**`app/page.tsx`**
- Map restructured into a flex row: map fills `flex-1`, desktop sidebar in `hidden lg:flex w-80 xl:w-96` aside
- Height set to `calc(100dvh - 64px)` to fill viewport below sticky navbar
- Cookie locale detection added: `detectLocale(acceptLanguage, cookieLocale?)` — cookie takes precedence over Accept-Language
- `MapSidebar` component added (station list sorted by PB95, top 30, links to station detail pages)

**`lib/i18n.ts`**
- `detectLocale` extended with optional `cookieLocale` parameter
- `localeToHtmlLang()` utility added
- `Translations` interface massively expanded with `nav`, `footer`, `sidebar`, `station`, `about`, `contact`, `pricing`, `legal` sections
- `sidebar.sortedByPrice` added (translated subtitle for the map sidebar)
- `station.fuelHeader` added (translated fuel type column header)
- `pricing.features` added (`{ free: string[], pro: string[], fleet: string[] }` per locale)
- All three locale objects fully populated

**`lib/api.ts`**
- `fetchStationWithPrice(id)` added: fetches single station by ID then prices via nearby 200m radius

## Change Log

- 2026-03-27: Story created — SSR public map with Mapbox, server-side price fetching, i18n, SEO list
- 2026-03-27: Story implemented — all tasks complete, 380 API tests passing, tsc + lint clean, next build succeeds
- 2026-03-28: Extended by web-1/web-2 — map page restructured with sidebar, cookie locale, MapSidebar; i18n massively expanded; fetchStationWithPrice added
