# Web Epic — All Stories

**Epic:** web — Web App — Public Site & Content
**Created:** 2026-03-28

---

## Story web-1 — Layout Shell: Navbar, Footer, i18n Routing

**Status:** done
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

**Status:** done
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

**Status:** done
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

**Status:** done
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

**Status:** ready-for-dev
**Created:** 2026-03-28

### User Story

As a **visitor to the Litro website**,
I want to read fuel price news and see a weekly price trend summary,
So that I understand the market context and trust Litro as an authoritative source on fuel prices.

**Why:** Content pages build SEO authority and return traffic. The auto-generated weekly price summary from MarketSignal data is the first step toward differentiating Litro as a data platform, not just a map app.

### Acceptance Criteria

- **AC1 — Article list:** `GET /aktualnosci` renders a server-side list of articles sorted by date (newest first). The auto-generated weekly price summary appears pinned at the top, followed by editorial markdown articles. EN at `/en/news`, UK at `/uk/news`.

- **AC2 — Article detail:** `GET /aktualnosci/[slug]` renders the full article with: title, date, body content, and an inline ad slot (`aktualnosci-inline`, 100px height) after the body. EN at `/en/news/[slug]`, UK at `/uk/news/[slug]`.

- **AC3 — Auto-generated price summary:** The slug `tygodniowe-ceny-paliw` is always present. Its content is rendered dynamically server-side from MarketSignal data fetched from a new `@Public()` API endpoint. Shows PB_95, ON, and LPG rack prices with week-on-week % change. When MarketSignal table is empty (as it currently is), shows a graceful "data not yet available" message — no error, no crash.

- **AC4 — Editorial articles:** Markdown files in `apps/web/content/articles/` are parsed at build/request time using `gray-matter` for frontmatter (`slug`, `title`, `date`, `excerpt`) and `marked` for body HTML. At least 2 example articles included.

- **AC5 — SEO:** Each article page has `generateMetadata()` with: title, description (from excerpt), `og:title`, `og:description`, `og:type: article`, `og:url`. JSON-LD `Article` structured data block rendered in `<script type="application/ld+json">`. **Exception:** the auto price summary page (`tygodniowe-ceny-paliw`) omits JSON-LD — it is a live data table, not an editorial article, and `Article` schema would be semantically incorrect. It does include `og:title`, `og:type: article`, and `og:url`.

- **AC6 — Ad slot:** `<AdSlot slotId="aktualnosci-inline" className="h-[100px] w-full my-6" />` rendered after article body. Reuses existing `AdSlot` component from `components/AdSlot.tsx`.

- **AC7 — i18n:** All UI chrome strings (section title, "read more", "back to news", "no articles", price summary labels) added to `lib/i18n.ts` for all three locales (pl/en/uk). Article titles and bodies are Polish-only for MVP — locale chrome wraps them.

- **AC8 — New API endpoint:** `GET /v1/market-signal/summary` returns the latest MarketSignal record per signal type as `{ signals: SummaryItem[] }`. Is `@Public()` — no auth required. Returns `{ signals: [] }` when table is empty.

### Technical Architecture

**New API endpoint: `GET /v1/market-signal/summary`**

Add `MarketSignalController` to `MarketSignalModule`:

```typescript
// apps/api/src/market-signal/market-signal.controller.ts
@Controller('v1/market-signal')
export class MarketSignalController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('summary')
  async getSummary() {
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT DISTINCT ON (signal_type)
        signal_type, value, pct_change, recorded_at
      FROM "MarketSignal"
      WHERE signal_type IN ('orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg')
      ORDER BY signal_type, recorded_at DESC
    `;
    return {
      signals: rows.map(r => ({
        signalType: r.signal_type,
        value: r.value,
        pctChange: r.pct_change ?? null,
        recordedAt: r.recorded_at.toISOString(),
      })),
    };
  }
}
```

Response shape:
```typescript
interface SummaryItem {
  signalType: 'orlen_rack_pb95' | 'orlen_rack_on' | 'orlen_rack_lpg';
  value: number;          // PLN/litre, rack price
  pctChange: number | null; // fraction e.g. 0.015 = +1.5%, null if first record
  recordedAt: string;     // ISO timestamp
}
```

Register in `market-signal.module.ts` — add `MarketSignalController` to controllers array. Inject `PrismaService`.

**Article content system**

Directory: `apps/web/content/articles/` with frontmatter format:
```markdown
---
slug: start-litro
title: Witamy w Litro — społecznościowe ceny paliw
date: 2026-03-28
excerpt: Litro to nowa aplikacja, która zbiera ceny paliw od kierowców w czasie rzeczywistym.
---
Treść artykułu...
```

Article reader `apps/web/lib/articles.ts` exports: `getAllArticles()`, `getArticleBySlug(slug)`, `getAutoArticleMeta()`. The slug `tygodniowe-ceny-paliw` is always synthetic (auto-generated price summary). `html` field is rendered from markdown via `marked`; empty string for the auto article.

**Auto-generated price summary component**

`apps/web/components/pages/PriceSummaryContent.tsx` — Server Component rendered when `article.auto === true`. Fetches `GET /v1/market-signal/summary` using `process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL`. Signal type → label: `orlen_rack_pb95` → `PB 95`, `orlen_rack_on` → `ON (Diesel)`, `orlen_rack_lpg` → `LPG`. Shows rack price + `pctChange` as `+1.5%` / `-0.8%` / `—`. Empty signals array → locale-aware "no data yet" message.

**Web route structure**
```
apps/web/app/
├── aktualnosci/
│   ├── page.tsx                    ← PL list (Server Component)
│   └── [slug]/page.tsx             ← PL article detail
├── en/news/
│   ├── page.tsx                    ← EN list
│   └── [slug]/page.tsx             ← EN article detail
└── uk/news/
    ├── page.tsx                    ← UK list
    └── [slug]/page.tsx             ← UK article detail
```

Each route shell is thin — locale detection + passing `locale` and `t` to shared `*PageContent` components. No logic duplication across PL/EN/UK.

**i18n additions to `lib/i18n.ts`** — add `news` section to `Translations` interface + all 3 locale objects:
```typescript
news: {
  title: string;           // "Aktualności" / "News" / "Новини"
  readMore: string;        // "Czytaj więcej" / "Read more" / "Читати далі"
  backToNews: string;      // "← Aktualności" / "← News" / "← Новини"
  noArticles: string;      // "Brak artykułów." / "No articles yet." / "Немає статей."
  priceSummaryTitle: string;    // "Tygodniowe ceny paliw ORLEN" / "Weekly ORLEN fuel prices" / ...
  priceSummarySubtitle: string; // "Ceny hurtowe ORLEN (PLN/litr)" / "ORLEN wholesale prices (PLN/l)" / ...
  noData: string;          // "Dane w przygotowaniu." / "Data not yet available." / ...
  weekChange: string;      // "zmiana tyg." / "wk change" / "зміна за тижд."
}
```

**SEO / structured data**

Per-article `generateMetadata()` sets title, description (from excerpt), og:title, og:description, og:type: article, og:url. JSON-LD `Article` block with headline, datePublished, description, publisher rendered in `<script type="application/ld+json">`. Do NOT add `generateStaticParams` — pages are SSR, not statically generated (keeps price summary always fresh).

### Dev Guardrails

- **Locale detection:** Follow exactly the same pattern as `o-nas/page.tsx` — `detectLocale(headerList.get('accept-language'), cookieStore.get('locale')?.value)`.
- **AdSlot reuse:** Import from existing `../../components/AdSlot`. Use `slotId="aktualnosci-inline"`.
- **`@Public()` pattern:** Import from `../../auth/public.decorator.js` — same as other public endpoints.
- **`PrismaService` injection:** Check how `price.module.ts` adds PrismaService to providers and follow same pattern.
- **`$queryRaw` type:** Use `Prisma.sql` tagged template — same pattern as `PriceHistoryService.getRegionalAverage()`.
- **`marked` output:** Render via `dangerouslySetInnerHTML={{ __html: article.html }}` only for content from your own markdown files — not from user input.
- **API URL in Server Components:** Use `process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL` — do NOT use `NEXT_PUBLIC_API_URL` for server-side fetches. `lib/api.ts` uses `INTERNAL_API_URL` (not `API_URL` — spec was wrong).
- **`pct_change` is a fraction:** `0.015` = +1.5%. Multiply by 100 and format to 1 decimal place. `null` = first ingestion → display `—`.
- **New dependencies:** Add `gray-matter: ^4.0.3`, `marked: ^12.0.0`, `@types/marked: ^6.0.0` to `apps/web/package.json`. Run `pnpm install` from repo root.

### Testing Requirements

**`market-signal.controller.spec.ts`:**
- Returns `{ signals: [] }` when `$queryRaw` returns `[]`
- Returns mapped summary items when data present (camelCase response from snake_case DB row)
- `pct_change: null` DB row → `pctChange: null` in response (not `undefined`)
- Endpoint is `@Public()` — verify via Reflector same pattern as `price.controller.spec.ts`

No unit tests required for `articles.ts` — file I/O functions; integration tested implicitly via page rendering.

### File List

**New (API):**
- `apps/api/src/market-signal/market-signal.controller.ts`
- `apps/api/src/market-signal/market-signal.controller.spec.ts`

**Modified (API):**
- `apps/api/src/market-signal/market-signal.module.ts` — add `MarketSignalController` + `PrismaService` to providers

**New (Web):**
- `apps/web/content/articles/2026-03-28-start-litro.md`
- `apps/web/content/articles/2026-03-21-ceny-paliw-marzec.md`
- `apps/web/lib/articles.ts`
- `apps/web/app/aktualnosci/page.tsx`
- `apps/web/app/aktualnosci/[slug]/page.tsx`
- `apps/web/app/en/news/page.tsx`
- `apps/web/app/en/news/[slug]/page.tsx`
- `apps/web/app/uk/news/page.tsx`
- `apps/web/app/uk/news/[slug]/page.tsx`
- `apps/web/components/pages/ArticleListPageContent.tsx`
- `apps/web/components/pages/ArticlePageContent.tsx`
- `apps/web/components/pages/PriceSummaryContent.tsx`

**Modified (Web):**
- `apps/web/lib/i18n.ts` — add `news` key to `Translations` interface + all 3 locale objects

### Dev Agent Record

**Completion Notes**

- `market-signal.controller.ts` — `GET /v1/market-signal/summary` uses `DISTINCT ON (signal_type)` to return latest record per type; returns `{ signals: [] }` when table is empty (graceful empty-state).
- `PrismaService` added to `MarketSignalModule` providers (was already global but controller needs explicit injection in module scope).
- `articles.ts` — `gray-matter` parses frontmatter; `marked` renders body HTML; `tygodniowe-ceny-paliw` slug is synthetic (never read from filesystem).
- `PriceSummaryContent` — async Server Component; uses `INTERNAL_API_URL` env var (same as `lib/api.ts`); falls back gracefully to empty signals on fetch error.
- `ArticlePageContent` — branches on `article.auto` to render `PriceSummaryContent` vs `dangerouslySetInnerHTML` (own markdown only).
- JSON-LD block emitted only for editorial articles (not for the auto price summary).
- `generateStaticParams` deliberately omitted — all article pages are SSR for fresh price data.
- tsc clean on both `apps/api` and `apps/web`; 407/407 API tests passing.

**Deferred (from code review 2026-04-01)**

- `articles.ts` — no in-memory cache; `getArticleBySlug` reads all files on every SSR render. Acceptable at current article count; add `unstable_cache` or module-level map if content library grows beyond ~20 articles.
- `articles.ts` — frontmatter fields (`slug`, `title`, `excerpt`) cast unsafely via `as string`; no guard for missing keys. Editorial-only risk; add validation before opening content authoring to non-devs.
- `PriceSummaryContent` — no `AbortController` timeout on the internal API fetch. Graceful fallback exists; revisit if API latency becomes an issue.
- `marked` output rendered via `dangerouslySetInnerHTML` without HTML sanitization. Acceptable for trusted editorial content; add `sanitize-html` if content authoring is ever opened to external contributors.
- `GET /v1/market-signal/summary` has no rate-limiting throttle guard. Public endpoint hitting DB on every request; add `@Throttle()` in a future hardening story.
- `PrismaService` added as a local provider in `MarketSignalModule` — may create a second client instance if `PrismaModule` is already `@Global()`. Investigate when consolidating module structure.

### Change Log

- 2026-03-28: Story created (stub in web-stories.md + full spec in web-5-news-trends.md)
- 2026-04-01: Full spec merged into web-stories.md; standalone file deleted
- 2026-04-01: Story implemented — all ACs satisfied, 407/407 tests passing, tsc clean
- 2026-04-01: Code review patches applied — YAML date parsing fix, duplicate h1 removed, auto article og metadata added, self-referencing footer link removed, AktualnosciPage typo fixed; AC5 clarified re: JSON-LD exclusion for auto article; INTERNAL_API_URL env var corrected in spec; 6 items deferred

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

**Status:** ready-for-dev
**Full spec:** [web-7-fleet-dashboard.md](web-7-fleet-dashboard.md)

### User Story

As a **fleet manager**,
I want a lightweight fleet overview page on the Litro website,
So that I can see a quick summary of my fleet's fuel activity and navigate to the full fleet portal without opening the mobile app.

### Acceptance Criteria

- `/flota` is protected by middleware (redirects to `/logowanie` if no `web_token`)
- Users without FLEET_MANAGER role see marketing page with "Zarejestruj flotę" CTA linking to `fleet.desert.app/register`
- FLEET_MANAGER users see: vehicle count, monthly spend, avg price per litre, last 5 fill-ups
- Prominent "Otwórz Portal Flotowy" button links to `fleet.desert.app`
- All strings in `lib/i18n.ts` under `fleet` key (PL/EN/UK)
- No ads
- `FLEET_APP_URL` env var added to `apps/web/.env.example`

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

**Status:** ready-for-dev
**Full spec:** [web-10-price-alerts.md](web-10-price-alerts.md)

### User Story

As an **authenticated driver**,
I want to create and manage price alerts on the Litro website,
So that I receive an email when fuel prices drop below my chosen threshold — without needing the mobile app.

### Acceptance Criteria

- `/powiadomienia` is auth-gated (redirects to `/logowanie`)
- Alert list shows all active alerts with fuel type, threshold, location context, status
- Alert can be deleted with confirmation
- Create alert form validates: fuel type required, threshold 1.00–15.00, location required
- Location can be set by: specific station search, voivodeship dropdown, or coordinates (geolocation or address search)
- Submit creates alert via `POST /v1/me/alerts`; error if >10 alerts
- Email notification delivery only (push disabled, tooltip explains mobile app)
- Mobile app CTA shown at bottom
- `GET /v1/me/alerts` returns user's alerts
- `DELETE /v1/me/alerts/:alertId` deletes with ownership check
- All strings in `lib/i18n.ts` under `alerts` key (PL/EN/UK)
