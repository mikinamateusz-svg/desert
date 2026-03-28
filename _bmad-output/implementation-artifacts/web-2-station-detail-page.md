# Story web-2 — Station Detail Page

**Status:** review
**Epic:** web — Web App — Public Site & Content
**Story ID:** web-2
**Created:** 2026-03-28

---

## User Story

As a **public user**,
I want to view a dedicated page for each fuel station with current prices and a map,
So that I can share a link to a specific station and search engines can index per-station price data.

**Why:** The map popup shows prices but isn't linkable or indexable. A dedicated SSR page per station creates SEO-indexable content, enables sharing, and gives users a richer view with all fuel types.

---

## Acceptance Criteria

- **AC1 — SSR page per station:** Given a URL `/stacje/{id}` (PL), `/en/stations/{id}`, or `/uk/stations/{id}`, when the page loads, then station name, address, and all available fuel prices are rendered server-side in the HTML

- **AC2 — SEO metadata:** Given a station detail page, when a crawler or social sharing tool fetches it, then the `<title>` and `<meta description>` include the station name, address, and PB95 price

- **AC3 — Fuel prices table:** Given a station with prices, when the detail page renders, then all available fuel types (PB_95, PB_98, ON, ON_PREMIUM, LPG) are shown in a table with price, source badge (community/estimated), and last updated date

- **AC4 — No price state:** Given a station with no price data, when the detail page renders, then a "no data" message is shown instead of an empty table

- **AC5 — Navigate CTA:** Given any station detail page, when the user clicks Navigate, then Google Maps directions open in a new tab using the station's coordinates

- **AC6 — Static map:** Given `NEXT_PUBLIC_MAPBOX_TOKEN` is set, when the page renders, then a Mapbox static map image shows the station's pin location

- **AC7 — Not found:** Given a station ID that does not exist, when the page is requested, then a 404 (Next.js notFound()) is returned

- **AC8 — i18n:** Given a user with EN or UK locale at the locale-prefixed URL, when the page renders, then all labels (fuel types, source badges, CTA text) are in the correct language

---

## Technical Architecture

### API Dependency

Requires `GET /v1/stations/:id` endpoint on the NestJS API (added in this story). The endpoint returns `{ id, name, address, lat, lng }`. It is `@Public()` — no auth required.

Prices are fetched via the existing `GET /v1/prices/nearby?lat=X&lng=Y&radius=200` endpoint, filtering by `stationId`. The 200m radius is centered on the station's own coordinates — tight enough to avoid returning prices for adjacent stations.

### Route Structure

Three parallel routes share the same rendering logic with hardcoded locale:
- `/stacje/[id]/page.tsx` — reads locale from cookie (cookie-aware, serves any locale at PL URL)
- `/en/stations/[id]/page.tsx` — locale = 'en' hardcoded
- `/uk/stations/[id]/page.tsx` — locale = 'uk' hardcoded

### Mapbox Static Map

URL pattern: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+2563eb({lng},{lat})/{lng},{lat},15,0/600x300@2x?access_token={token}`

Rendered as `<img>` with `loading="lazy"`. Falls back to coordinate display if token not set.

### Ad Slots

- Mobile: `AdSlot slotId="station-detail-inline"` 100px height, hidden on lg
- Desktop sidebar: `AdSlot slotId="station-detail-sidebar"` 250px height, hidden on mobile

### Deferred

- **D1:** EN/UK station detail pages are near-duplicate of PL page — not yet extracted to a shared `StationDetailPageContent` component (unlike content pages). Deferred to a future refactor.

---

## File List

### New files
- `apps/web/app/stacje/[id]/page.tsx` — PL SSR station detail (cookie-locale-aware)
- `apps/web/app/en/stations/[id]/page.tsx` — EN SSR station detail (locale hardcoded)
- `apps/web/app/uk/stations/[id]/page.tsx` — UK SSR station detail (locale hardcoded)

### Modified
- `apps/web/lib/api.ts` — added `fetchStationWithPrice(id)`: fetches station by ID then prices via nearby 200m
- `apps/api/src/station/station.service.ts` — added `findById(id)`: PostGIS query returning lat/lng as floats
- `apps/api/src/station/station.controller.ts` — added `@Public() @Get(':id') getById()`

---

## Dev Agent Record

### Completion Notes

- `fetchStationWithPrice` makes two sequential fetches (station then nearby prices) — parallel fetch not possible since price fetch requires station coordinates
- `station.price.updatedAt` date is formatted with `toLocaleDateString` using the page's locale for correct date formatting (pl-PL / uk-UA / en-GB)
- `notFound()` is called before any rendering if station is missing — TypeScript narrows `station` to non-null after the check
- `t.station.fuelHeader` used for the fuel type column header (replaced a broken ternary that always showed Polish regardless of locale)

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patch — fuel column header ternary bug fixed (used t.station.fuelHeader)
- 2026-03-28: D1 logged — EN/UK station detail pages are full duplicates; deferred extraction to StationDetailPageContent
