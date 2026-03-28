# Web Epic — All Stories

**Epic:** web — Web App — Public Site & Content
**Created:** 2026-03-28

---

## Story web-1 — Layout Shell: Navbar, Footer, i18n Routing

**Status:** review
**Created:** 2026-03-28

### User Story

As a **public user**,
I want a consistent, navigable website shell on every page,
So that I can easily explore the site, switch language, and find legal/contact information.

**Why:** The public map page exists but looks like a raw prototype with no navigation, no footer, and no brand presence. Adding a proper shell converts the tool into a website — increasing trust and discoverability.

### Acceptance Criteria

- **AC1 — Sticky navbar:** Given any page, when the user scrolls, then the navbar remains pinned to the top and all navigation links are accessible
- **AC2 — Active nav link:** Given the user is on a specific page, when they view the navbar, then the current page link is visually highlighted
- **AC3 — Language switcher:** Given a user on any page, when they click PL/EN/UK in the navbar or footer, then the interface language switches immediately and persists across page navigation
- **AC4 — Mobile menu:** Given a user on a mobile viewport, when they tap the hamburger icon, then a slide-down menu appears with all nav links and language switcher
- **AC5 — Footer links:** Given any page, when the user scrolls to the bottom, then they see links to About, Contact, Pricing, Privacy policy, and Terms of service
- **AC6 — i18n routing:** Given a user with EN or UK locale, when they navigate to content pages, then the URL reflects the locale prefix (/en/about, /uk/about, etc.) and all text is in the correct language

### Technical Architecture

**Locale detection priority:**
1. `locale` cookie (set by `/api/set-locale?l=XX` route handler)
2. `Accept-Language` header fallback
3. Default: `pl`

**Route structure:**
- PL content pages: `/o-nas`, `/kontakt`, `/cennik`, `/polityka-prywatnosci`, `/regulamin`
- EN content pages: `/en/about`, `/en/contact`, `/en/pricing`, `/en/privacy`, `/en/terms`
- UK content pages: `/uk/about`, `/uk/contact`, `/uk/pricing`, `/uk/privacy`, `/uk/terms`
- Map is always at `/` regardless of locale (language determined by cookie)

**Lang switching:** `GET /api/set-locale?l=XX` — sets `locale` cookie (1 year, `lax`, path `/`) and redirects back to the same page. Same-origin referer validation; falls back to `/` to prevent open redirect (CWE-601).

**Navbar:** `'use client'`, uses `usePathname()` for active link detection. Receives `locale` and `t` props from layout Server Component. Sticky `h-16`, z-index 50.

**Layout:** `app/layout.tsx` is async Server Component. Reads locale from cookies + Accept-Language, sets `<html lang>`, renders `<Navbar>`. Map page sets its own height to `calc(100dvh - 64px)`.

**`middleware.ts`:** Stub — matcher config only. Locale is read directly from cookies in Server Components; no header injection needed.

### File List

- `apps/web/app/layout.tsx` — async Server Component; reads locale, renders Navbar, sets html lang
- `apps/web/components/Navbar.tsx` — `'use client'`; sticky header, mobile menu, lang switcher, usePathname active highlight
- `apps/web/components/Footer.tsx` — Server Component; 4-col grid with locale-prefixed links
- `apps/web/middleware.ts` — matcher config only
- `apps/web/app/api/set-locale/route.ts` — GET handler; validates locale, sets cookie, same-origin redirect
- `apps/web/lib/i18n.ts` — expanded with cookie override, full Translations interface (nav, footer, sidebar, station, about, contact, pricing, legal), pl/en/uk values

### Dev Agent Record

- `detectLocale` extended with optional `cookieLocale` param; cookie takes precedence over Accept-Language
- Navbar uses `usePathname()` — avoids unreliable `x-invoke-path` server header approach (header doesn't exist in Next.js)
- `/api/set-locale` validates referer is same-origin; falls back to `/` for external or malformed referers

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patches — active nav (usePathname), open redirect fix, dead middleware cleanup

---

## Story web-2 — Station Detail Page

**Status:** review
**Created:** 2026-03-28

### User Story

As a **public user**,
I want to view a dedicated page for each fuel station with current prices and a map,
So that I can share a link to a specific station and search engines can index per-station price data.

**Why:** The map popup shows prices but isn't linkable or indexable. A dedicated SSR page per station creates SEO-indexable content, enables sharing, and gives users a richer view with all fuel types.

### Acceptance Criteria

- **AC1 — SSR page per station:** Given a URL `/stacje/{id}` (PL), `/en/stations/{id}`, or `/uk/stations/{id}`, when the page loads, then station name, address, and all available fuel prices are rendered server-side in the HTML
- **AC2 — SEO metadata:** Given a station detail page, when a crawler fetches it, then `<title>` and `<meta description>` include the station name, address, and PB95 price
- **AC3 — Fuel prices table:** Given a station with prices, when the page renders, then all available fuel types (PB_95, PB_98, ON, ON_PREMIUM, LPG) are shown with price, source badge (community/estimated), and last updated date
- **AC4 — No price state:** Given a station with no price data, then a "no data" message is shown instead of an empty table
- **AC5 — Navigate CTA:** Given any station detail page, when the user clicks Navigate, then Google Maps directions open in a new tab
- **AC6 — Static map:** Given `NEXT_PUBLIC_MAPBOX_TOKEN` is set, then a Mapbox static map image shows the station's pin
- **AC7 — Not found:** Given a non-existent station ID, then Next.js `notFound()` returns a 404
- **AC8 — i18n:** Given EN or UK locale at a locale-prefixed URL, then all labels are in the correct language

### Technical Architecture

**API:** `GET /v1/stations/:id` added to NestJS (`@Public()`). Returns `{ id, name, address, lat, lng }`. Prices fetched via `GET /v1/prices/nearby?lat=X&lng=Y&radius=200` — 200m radius centred on station's own coords, filtered by `stationId`.

**Routes:** Three parallel pages with same rendering logic:
- `/stacje/[id]` — reads locale from cookie
- `/en/stations/[id]` — locale `'en'` hardcoded
- `/uk/stations/[id]` — locale `'uk'` hardcoded

**Mapbox static map:** `pin-l+2563eb({lng},{lat})`, 600×300@2x, zoom 15. Falls back to coordinate display if token not set.

**Ad slots:** `station-detail-sidebar` (250px, desktop only), `station-detail-inline` (100px, mobile only).

**Deferred — D1:** EN/UK station detail pages are full duplicates of the PL page (unlike content pages which use shared components). Deferred extraction to `StationDetailPageContent.tsx`.

### File List

**New:**
- `apps/web/app/stacje/[id]/page.tsx` — PL SSR station detail (cookie-locale-aware)
- `apps/web/app/en/stations/[id]/page.tsx` — EN SSR station detail (locale hardcoded)
- `apps/web/app/uk/stations/[id]/page.tsx` — UK SSR station detail (locale hardcoded)

**Modified:**
- `apps/web/lib/api.ts` — added `fetchStationWithPrice(id)`
- `apps/api/src/station/station.service.ts` — added `findById(id)` PostGIS query
- `apps/api/src/station/station.controller.ts` — added `@Public() @Get(':id') getById()`

### Dev Agent Record

- `fetchStationWithPrice` makes two sequential fetches — parallel not possible since price fetch requires station coordinates
- `toLocaleDateString` uses pl-PL / uk-UA / en-GB locale for correct date formatting
- `t.station.fuelHeader` used for fuel type column header (replaced broken ternary that always showed Polish)
- `notFound()` before rendering narrows TypeScript to non-null station

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patch — fuel column header ternary bug fixed (t.station.fuelHeader)
- 2026-03-28: D1 logged — EN/UK station detail pages are full duplicates; deferred to StationDetailPageContent

---

## Story web-3 — Content Pages: About, Contact, Pricing, Legal

**Status:** review
**Created:** 2026-03-28

### User Story

As a **public user**,
I want informational pages (about, contact, pricing, legal) on the site,
So that I can learn about the service, contact the team, and find legal documents.

**Why:** Without these pages the site looks unfinished and untrustworthy. They're also required for app store submissions and GDPR compliance.

### Acceptance Criteria

- **AC1 — About page:** `/o-nas` renders hero, "How it works" steps, "Why Litro" features, and download CTA — all SSR
- **AC2 — Contact page:** `/kontakt` renders a contact form with `mailto:` action and contact info sidebar
- **AC3 — Pricing page:** `/cennik` renders 3-tier comparison (Driver/free, Pro/coming soon, Fleet/contact us) with feature lists
- **AC4 — Legal stubs:** `/polityka-prywatnosci` and `/regulamin` render stub documents with amber "in preparation" notice
- **AC5 — Full i18n:** All pages render in PL/EN/UK based on locale cookie; locale-prefixed routes exist for EN and UK
- **AC6 — Shared components:** EN/UK locale pages are thin wrappers over shared `*PageContent` components — no JSX duplication
- **AC7 — Navbar + footer:** Every content page includes the standard Navbar (via layout) and Footer

### Technical Architecture

**Shared component pattern:**
```
components/pages/AboutPageContent.tsx   ← all JSX, accepts { locale, t }
app/o-nas/page.tsx                      ← detects locale from cookie → renders component
app/en/about/page.tsx                   ← <AboutPageContent locale="en" t={translations.en} />
app/uk/about/page.tsx                   ← <AboutPageContent locale="uk" t={translations.uk} />
```

**Translations:** All strings in `lib/i18n.ts` under `about`, `contact`, `pricing`, `legal`. Feature lists in `pricing.features.{free,pro,fleet}` as `string[]`.

**Legal pages:** Stub content with amber notice. Sufficient for pre-launch.

**Contact form:** `<form action="mailto:...">` — intentional stub; proper handler when email infra is in place.

### File List

**Shared content components:**
- `apps/web/components/pages/AboutPageContent.tsx`
- `apps/web/components/pages/ContactPageContent.tsx`
- `apps/web/components/pages/PricingPageContent.tsx`
- `apps/web/components/pages/PrivacyPageContent.tsx`
- `apps/web/components/pages/TermsPageContent.tsx`

**PL route pages:** `app/o-nas`, `app/kontakt`, `app/cennik`, `app/polityka-prywatnosci`, `app/regulamin`

**EN route pages:** `app/en/about`, `app/en/contact`, `app/en/pricing`, `app/en/privacy`, `app/en/terms`

**UK route pages:** `app/uk/about`, `app/uk/contact`, `app/uk/pricing`, `app/uk/privacy`, `app/uk/terms`

**Modified:** `apps/web/lib/i18n.ts` — added about/contact/pricing/legal sections and `pricing.features` arrays

### Dev Agent Record

- Privacy/Terms use locale-conditional content blocks (PL/EN/UK inline) — legal text differs across languages
- Pricing feature lists initially hardcoded per-locale in component; moved to `i18n.ts` in review pass
- Footer uses English slugs for EN (`/en/about`) and Ukrainian slugs for UK (`/uk/about`) — consistent with Navbar

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patch D2 — pricing features moved from component to i18n.ts `pricing.features`

---

## Story web-4 — Ad Slot Infrastructure

**Status:** review
**Created:** 2026-03-28

### User Story

As a **developer**,
I want ad slot placeholder components in place throughout the site,
So that integrating a real ad network requires only swapping the placeholder content — no layout changes.

**Why:** Ad revenue is a planned monetisation channel. Reserving space now avoids layout refactors later and lets us test layouts with realistic spatial constraints.

### Acceptance Criteria

- **AC1 — AdSlot component:** Accepts `slotId`, `className`, optional `label`; renders dashed-border placeholder with `data-slot-id`
- **AC2 — Slot inventory placed:** Slots in station detail desktop sidebar, station detail mobile inline, map sidebar bottom
- **AC3 — No ads on map mobile:** Full-screen map on mobile has no ad slot
- **AC4 — Easy swap-in:** Component comment indicates where to replace with real ad network code

### Slot Inventory

| Slot ID | Location | Size | Breakpoint |
|---|---|---|---|
| `station-detail-sidebar` | Station detail right column | 250px h | Desktop only |
| `station-detail-inline` | Station detail below CTAs | 100px h | Mobile only |
| `sidebar-map-bottom` | Map sidebar bottom | 120px h | Desktop only |

### File List

- `apps/web/components/AdSlot.tsx` — placeholder with `data-slot-id`, `aria-hidden="true"`, dashed border

### Dev Agent Record

- `aria-hidden="true"` — placeholder carries no meaningful content for screen readers
- `label` defaults to `'Reklama'` — visible during development
- Intentionally minimal: no state, no effects — replace inner content in one edit when integrating a real ad script

### Change Log

- 2026-03-28: Story created and implemented

---

## Story web-5 — News & Fuel Price Trends

**Status:** backlog

### User Story

As a **public user**,
I want to read news articles and regional fuel price trends,
So that I understand what's driving price changes and can plan my fill-ups.

### Acceptance Criteria

- `/aktualnosci` lists articles sorted by date
- `/aktualnosci/[slug]` renders full article with inline ad slot
- Weekly fuel price summary auto-generated from MarketSignal rack data
- SEO: structured data, OG tags per article

---

## Story web-6 — User Account Dashboard

**Status:** backlog

### User Story

As an **authenticated driver**,
I want a web dashboard showing my fuel log and submission history,
So that I can review my activity without opening the mobile app.

### Acceptance Criteria

- `/konto` is auth-gated (redirects to login if unauthenticated)
- Shows consumption log, price submission history, saved stations
- No ads
- Links to mobile app for full consumption tracking

---

## Story web-7 — Fleet Manager Dashboard

**Status:** backlog

### User Story

As a **fleet manager**,
I want a web dashboard for managing multiple vehicles and viewing fuel cost reports,
So that I can track fleet fuel spend without needing the mobile app.

### Acceptance Criteria

- `/flota` is role-gated (FLEET_MANAGER)
- Shows multi-vehicle log, cost per km, monthly reports, CSV export
- Upsell CTA for drivers to upgrade to fleet plan
- No ads

---

## Story web-8 — Data API & Data Buyer Page

**Status:** backlog

### User Story

As a **data buyer**,
I want a page explaining the Litro data API with pricing and sample payloads,
So that I can evaluate the API before contacting sales.

### Acceptance Criteria

- `/dane` renders API documentation, pricing tiers, sample payloads
- Lead capture form → sales contact
- Role-gated API explorer for DATA_BUYER accounts

---

## Story web-9 — Station Manager Portal

**Status:** backlog

### User Story

As a **station manager**,
I want to claim my station on Litro and update its information,
So that drivers see accurate details and I can monitor price submissions.

### Acceptance Criteria

- `/dla-stacji` is a public landing page with value prop and sign-up CTA
- Authenticated portal: claim station, update hours/amenities, view submission history
- Role-gated (STATION_MANAGER)

---

## Story web-10 — Price Alerts & Notifications

**Status:** backlog

### User Story

As an **authenticated driver**,
I want to set price alerts for specific fuel types and locations on the web,
So that I get notified when prices drop below my threshold.

### Acceptance Criteria

- `/powiadomienia` is auth-gated
- User sets: fuel type, price threshold, location radius
- Delivery: email + push notification
- Links to mobile app for push setup
