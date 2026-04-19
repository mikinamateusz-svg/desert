# Story web-7 — Fleet Manager Dashboard

## Metadata

- **Epic:** web — Web App — Public Site & Content
- **Story ID:** web-7
- **Status:** ready-for-dev
- **Created:** 2026-04-08
- **Depends on:** web-6 (`web_token` httpOnly cookie, `fetchWithAuth` helper, `/logowanie` login page, middleware protected-route pattern)
- **Also depends on:** Story 9.3 (`GET /v1/fleet/analytics/dashboard` endpoint, `FleetDashboardDto`), Story 9.1 (Fleet model, `FLEET_MANAGER` role in JWT)

---

## User Story

As a **fleet manager**,
I want a lightweight fleet overview page on the Litro website,
So that I can see a quick summary of my fleet's fuel activity and navigate to the full fleet portal without opening the mobile app.

**Why:** Fleet managers may land on desert.app and need a clear path into fleet features. The page serves two purposes: (1) a marketing entry point for drivers who are not yet on a fleet plan, and (2) a quick summary view for active fleet managers with a prominent link to the full fleet portal at fleet.desert.app. The page is intentionally thin — it does not replicate fleet.desert.app functionality; it surfaces key numbers and directs users to the right place.

---

## Acceptance Criteria

- **AC1 — Route protection:** `GET /flota` is protected by middleware; a request with no `web_token` cookie is redirected to `/logowanie`.

- **AC2 — Non-fleet-manager marketing view:** Given an authenticated user whose JWT `role` is NOT `FLEET_MANAGER`, when they visit `/flota`, then they see:
  - Headline: "Zarządzaj flotą z Litro" (locale-translated)
  - Feature list: CSV export, cost tracking, price alerts (locale-translated)
  - "Zarejestruj flotę" CTA button linking to `${FLEET_APP_URL}/register`
  - "Dowiedz się więcej" secondary link (links to `/cennik`)

- **AC3 — Fleet manager summary view:** Given an authenticated user whose JWT `role` is `FLEET_MANAGER`, when they visit `/flota`, then they see:
  - Quick stats header with: vehicle count, total spend this month (PLN), average price per litre (PLN/L) — fetched from `GET /v1/fleet/analytics/dashboard?period=month`
  - Last 5 fill-ups across the fleet — fetched from `GET /v1/fleet/fill-ups?limit=5`
  - A prominent "Otwórz Portal Flotowy" button linking to `${FLEET_APP_URL}`
  - A secondary note: "Pełne raporty, eksport CSV, planowanie tras i więcej dostępne w Portalu Flotowym."

- **AC4 — Fleet Portal link:** The "Open Fleet Portal" button on the fleet manager view uses `process.env.FLEET_APP_URL` (server-rendered as a static string in the component's `href`). Falls back to `https://fleet.desert.app` if the env var is not set.

- **AC5 — i18n:** All UI strings (headline, feature list, CTAs, stat labels, fill-up table headers, secondary note) are defined in `lib/i18n.ts` under the `fleet` key for all three locales (pl/en/uk). No hardcoded UI strings in components.

- **AC6 — Env var:** `FLEET_APP_URL` is added to `apps/web/.env.example` with a comment.

- **AC7 — No ads:** The `/flota` page renders no `<AdSlot>` components.

- **AC8 — API errors handled gracefully:** If `GET /v1/fleet/analytics/dashboard` or `GET /v1/fleet/fill-ups` fails (non-2xx or network error), the page still renders — stats show "—" and the fill-ups section shows "Brak danych" (locale-translated). No unhandled promise rejection.

---

## Technical Architecture

### Route Protection via Middleware

`apps/web/middleware.ts` (established in web-6) matches protected routes using a `PROTECTED_PATHS` array. Add `/flota` to this array. The middleware checks for the `web_token` httpOnly cookie; if absent, redirects to `/logowanie?next=/flota`.

```typescript
// apps/web/middleware.ts — add /flota to the protected paths array
const PROTECTED_PATHS = ['/konto', '/flota'];
```

The middleware pattern from web-6:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/konto', '/flota'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('web_token')?.value;
  if (!token) {
    const loginUrl = new URL('/logowanie', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
```

### JWT Role Decoding in Server Component

`apps/web/app/flota/page.tsx` is a Server Component. It reads the `web_token` cookie and decodes the JWT payload (base64url decode of the middle segment — no signature verification needed here; the NestJS API will verify on every authenticated API call).

```typescript
// apps/web/app/flota/page.tsx

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { detectLocale, translations } from '../../lib/i18n';
import FleetSummary from '../../components/FleetSummary';
import FleetUpsell from '../../components/FleetUpsell';

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1];
    if (!base64) return {};
    const json = Buffer.from(base64, 'base64url').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function FlotaPage() {
  const cookieStore = await cookies();
  const headerList = await headers();

  const token = cookieStore.get('web_token')?.value;
  if (!token) {
    // Middleware should have caught this — belt-and-braces guard
    redirect('/logowanie?next=/flota');
  }

  const payload = decodeJwtPayload(token);
  const isFleetManager = payload.role === 'FLEET_MANAGER';

  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];

  const fleetAppUrl = process.env.FLEET_APP_URL ?? 'https://fleet.desert.app';

  if (isFleetManager) {
    return <FleetSummary token={token} locale={locale} t={t} fleetAppUrl={fleetAppUrl} />;
  }
  return <FleetUpsell locale={locale} t={t} fleetAppUrl={fleetAppUrl} />;
}
```

### `fetchWithAuth` Helper

Established in web-6 at `apps/web/lib/api.ts` (or a dedicated `apps/web/lib/fetchWithAuth.ts`). Used by `FleetSummary` to make authenticated calls to the NestJS API with the `web_token` as a `Bearer` token. The same JWT is accepted by the NestJS API regardless of which cookie name it was stored in — authentication is purely token-based.

```typescript
// apps/web/lib/api.ts — addition from web-6
const API_URL = normalizeApiUrl(process.env.INTERNAL_API_URL);

export async function fetchWithAuth<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}
```

### `FleetSummary` Component

Server Component. Fetches both endpoints in parallel. Renders stats header + last-5-fill-ups table + Fleet Portal CTA.

```typescript
// apps/web/components/FleetSummary.tsx

import type { Locale, Translations } from '../lib/i18n';
import { fetchWithAuth } from '../lib/api';

interface FleetDashboardDto {
  period: { start: string; end: string };
  totals: {
    totalSpendPln: number;
    totalLitres: number;
    fillUpCount: number;
    avgConsumptionL100km: number | null;
    totalSavingsPln: number | null;
  };
  vehicles: Array<{ vehicleId: string; vehicleName: string; hasData: boolean }>;
}

interface FillUpRow {
  id: string;
  filledAt: string;
  stationName: string | null;
  fuelType: string;
  litres: number;
  totalCostPln: number;
  pricePerLitrePln: number;
  driverName: string | null;
}

interface FillUpsResponse {
  fillUps: FillUpRow[];
}

interface Props {
  token: string;
  locale: Locale;
  t: Translations;
  fleetAppUrl: string;
}

export default async function FleetSummary({ token, locale, t, fleetAppUrl }: Props) {
  const [dashboard, fillUpsData] = await Promise.all([
    fetchWithAuth<FleetDashboardDto>('/v1/fleet/analytics/dashboard?period=month', token),
    fetchWithAuth<FillUpsResponse>('/v1/fleet/fill-ups?limit=5', token),
  ]);

  const tf = t.fleet;
  const vehicleCount = dashboard?.vehicles?.length ?? null;
  const totalSpend = dashboard?.totals.totalSpendPln ?? null;
  const avgPrice = dashboard && dashboard.totals.totalLitres > 0
    ? dashboard.totals.totalSpendPln / dashboard.totals.totalLitres
    : null;
  const fillUps = fillUpsData?.fillUps ?? [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Stats header */}
      <h1 className="text-2xl font-bold mb-6">{tf.dashboardTitle}</h1>
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label={tf.vehicleCount} value={vehicleCount !== null ? String(vehicleCount) : '—'} />
        <StatCard
          label={tf.monthlySpend}
          value={totalSpend !== null ? `${totalSpend.toFixed(2)} PLN` : '—'}
        />
        <StatCard
          label={tf.avgPricePerLitre}
          value={avgPrice !== null ? `${avgPrice.toFixed(2)} PLN/L` : '—'}
        />
      </div>

      {/* Last 5 fill-ups */}
      <h2 className="text-lg font-semibold mb-3">{tf.recentFillUps}</h2>
      {fillUps.length === 0 ? (
        <p className="text-gray-500 mb-8">{tf.noData}</p>
      ) : (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4">{tf.fillUpDate}</th>
                <th className="pb-2 pr-4">{tf.fillUpStation}</th>
                <th className="pb-2 pr-4">{tf.fillUpLitres}</th>
                <th className="pb-2 pr-4">{tf.fillUpCost}</th>
                <th className="pb-2">{tf.fillUpDriver}</th>
              </tr>
            </thead>
            <tbody>
              {fillUps.map(f => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{new Date(f.filledAt).toLocaleDateString(localeToDateLocale(locale))}</td>
                  <td className="py-2 pr-4">{f.stationName ?? '—'}</td>
                  <td className="py-2 pr-4">{f.litres.toFixed(1)} L</td>
                  <td className="py-2 pr-4">{f.totalCostPln.toFixed(2)} PLN</td>
                  <td className="py-2">{f.driverName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fleet Portal CTA */}
      <a
        href={fleetAppUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg mb-4"
      >
        {tf.openPortal}
      </a>
      <p className="text-sm text-gray-500">{tf.portalNote}</p>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function localeToDateLocale(locale: string): string {
  if (locale === 'uk') return 'uk-UA';
  if (locale === 'en') return 'en-GB';
  return 'pl-PL';
}
```

### `FleetUpsell` Component

Server Component. Pure marketing page for non-fleet-manager users.

```typescript
// apps/web/components/FleetUpsell.tsx

import type { Locale, Translations } from '../lib/i18n';

interface Props {
  locale: Locale;
  t: Translations;
  fleetAppUrl: string;
}

export default function FleetUpsell({ t, fleetAppUrl }: Props) {
  const tf = t.fleet;
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-3xl font-bold mb-4">{tf.upsellTitle}</h1>
      <p className="text-gray-600 mb-8">{tf.upsellSubtitle}</p>

      <ul className="text-left inline-block mb-10 space-y-2">
        {tf.upsellFeatures.map((f: string) => (
          <li key={f} className="flex items-center gap-2">
            <span className="text-green-500 font-bold">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <a
          href={`${fleetAppUrl}/register`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg"
        >
          {tf.registerFleet}
        </a>
        <a
          href="/cennik"
          className="border border-gray-300 hover:border-gray-400 px-6 py-3 rounded-lg text-gray-700"
        >
          {tf.learnMore}
        </a>
      </div>
    </main>
  );
}
```

### i18n Additions

Add `fleet` key to the `Translations` interface and to all three locale objects in `lib/i18n.ts`.

**Interface extension:**
```typescript
fleet: {
  // Fleet manager dashboard view
  dashboardTitle: string;     // "Przegląd floty" / "Fleet overview" / "Огляд флоту"
  vehicleCount: string;       // "Pojazdy" / "Vehicles" / "Транспортні засоби"
  monthlySpend: string;       // "Wydatki w tym miesiącu" / "Spend this month" / "Витрати цього місяця"
  avgPricePerLitre: string;   // "Śr. cena za litr" / "Avg price per litre" / "Сер. ціна за літр"
  recentFillUps: string;      // "Ostatnie tankowania" / "Recent fill-ups" / "Останні заправки"
  fillUpDate: string;         // "Data" / "Date" / "Дата"
  fillUpStation: string;      // "Stacja" / "Station" / "Станція"
  fillUpLitres: string;       // "Litry" / "Litres" / "Літри"
  fillUpCost: string;         // "Koszt" / "Cost" / "Вартість"
  fillUpDriver: string;       // "Kierowca" / "Driver" / "Водій"
  noData: string;             // "Brak danych" / "No data" / "Немає даних"
  openPortal: string;         // "Otwórz Portal Flotowy" / "Open Fleet Portal" / "Відкрити Флотовий Портал"
  portalNote: string;         // "Pełne raporty, eksport CSV, planowanie tras i więcej dostępne w Portalu Flotowym."
                              // "Full reporting, CSV export, route planning and more available in the Fleet Portal."
                              // "Повні звіти, CSV-експорт, планування маршрутів та більше доступні у Флотовому Порталі."
  // Non-fleet-manager upsell view
  upsellTitle: string;        // "Zarządzaj flotą z Litro" / "Manage your fleet with Litro" / "Керуйте флотом з Litro"
  upsellSubtitle: string;     // "Śledź koszty paliwa dla całej floty..." / "Track fuel costs for your entire fleet..."
  upsellFeatures: string[];   // ["Eksport CSV", "Śledzenie kosztów", "Alerty cenowe"]
  registerFleet: string;      // "Zarejestruj flotę" / "Register fleet" / "Зареєструвати флот"
  learnMore: string;          // "Dowiedz się więcej" / "Learn more" / "Дізнатися більше"
};
```

**PL locale values:**
```typescript
fleet: {
  dashboardTitle: 'Przegląd floty',
  vehicleCount: 'Pojazdy',
  monthlySpend: 'Wydatki w tym miesiącu',
  avgPricePerLitre: 'Śr. cena za litr',
  recentFillUps: 'Ostatnie tankowania',
  fillUpDate: 'Data',
  fillUpStation: 'Stacja',
  fillUpLitres: 'Litry',
  fillUpCost: 'Koszt',
  fillUpDriver: 'Kierowca',
  noData: 'Brak danych o tankowaniach.',
  openPortal: 'Otwórz Portal Flotowy',
  portalNote: 'Pełne raporty, eksport CSV, planowanie tras i więcej dostępne w Portalu Flotowym.',
  upsellTitle: 'Zarządzaj flotą z Litro',
  upsellSubtitle: 'Śledź koszty paliwa dla całej floty, eksportuj raporty i zarządzaj kierowcami — wszystko w jednym miejscu.',
  upsellFeatures: ['Eksport CSV kosztów paliwa', 'Śledzenie kosztów per pojazd', 'Alerty cenowe dla floty'],
  registerFleet: 'Zarejestruj flotę',
  learnMore: 'Dowiedz się więcej',
},
```

**EN locale values:**
```typescript
fleet: {
  dashboardTitle: 'Fleet overview',
  vehicleCount: 'Vehicles',
  monthlySpend: 'Spend this month',
  avgPricePerLitre: 'Avg price per litre',
  recentFillUps: 'Recent fill-ups',
  fillUpDate: 'Date',
  fillUpStation: 'Station',
  fillUpLitres: 'Litres',
  fillUpCost: 'Cost',
  fillUpDriver: 'Driver',
  noData: 'No fill-up data.',
  openPortal: 'Open Fleet Portal',
  portalNote: 'Full reporting, CSV export, route planning and more available in the Fleet Portal.',
  upsellTitle: 'Manage your fleet with Litro',
  upsellSubtitle: 'Track fuel costs for your entire fleet, export reports, and manage drivers — all in one place.',
  upsellFeatures: ['CSV fuel cost export', 'Per-vehicle cost tracking', 'Fleet price alerts'],
  registerFleet: 'Register fleet',
  learnMore: 'Learn more',
},
```

**UK locale values:**
```typescript
fleet: {
  dashboardTitle: 'Огляд флоту',
  vehicleCount: 'Транспортні засоби',
  monthlySpend: 'Витрати цього місяця',
  avgPricePerLitre: 'Сер. ціна за літр',
  recentFillUps: 'Останні заправки',
  fillUpDate: 'Дата',
  fillUpStation: 'Станція',
  fillUpLitres: 'Літри',
  fillUpCost: 'Вартість',
  fillUpDriver: 'Водій',
  noData: 'Немає даних про заправки.',
  openPortal: 'Відкрити Флотовий Портал',
  portalNote: 'Повні звіти, CSV-експорт, планування маршрутів та більше доступні у Флотовому Порталі.',
  upsellTitle: 'Керуйте флотом з Litro',
  upsellSubtitle: 'Відстежуйте витрати пального для всього флоту, експортуйте звіти та керуйте водіями — все в одному місці.',
  upsellFeatures: ['CSV-експорт витрат на пальне', 'Відстеження витрат по транспортному засобу', 'Цінові сповіщення для флоту'],
  registerFleet: 'Зареєструвати флот',
  learnMore: 'Дізнатися більше',
},
```

### API Endpoints Used

**`GET /v1/fleet/analytics/dashboard?period=month`**
- Established in Story 9.3 (`FleetAnalyticsService.getDashboard`)
- Auth: `Authorization: Bearer {web_token}` — NestJS `@Roles(FLEET_MANAGER)` guard checks JWT role
- Response: `FleetDashboardDto` (vehicle list, totals for period)
- web-7 uses: `vehicles.length` (vehicle count), `totals.totalSpendPln`, `totals.totalLitres` (to derive avg price/L)

**`GET /v1/fleet/fill-ups?limit=5`**
- New endpoint (see NestJS addition below) — returns the last N fill-ups scoped to the caller's fleet
- Auth: same `Bearer` token
- Response: `{ fillUps: VehicleFillUpRow[] }` — reuses the `VehicleFillUpRow` DTO from Story 9.3

### New NestJS Endpoint: `GET /v1/fleet/fill-ups`

This endpoint is not in Story 9.3 — it must be added to `FleetController` as part of this story.

```typescript
// apps/api/src/fleet/fleet.controller.ts — add alongside existing analytics endpoints

@Get('fill-ups')
@Roles(Role.FLEET_MANAGER)
async getRecentFillUps(
  @CurrentUser() user: JwtPayload,
  @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
): Promise<{ fillUps: VehicleFillUpRow[] }> {
  return this.fleetAnalyticsService.getRecentFillUps(user.fleetId, Math.min(limit, 50));
}
```

`FleetAnalyticsService.getRecentFillUps(fleetId, limit)`:
```typescript
// apps/api/src/fleet/fleet-analytics.service.ts

async getRecentFillUps(fleetId: string, limit: number): Promise<{ fillUps: VehicleFillUpRow[] }> {
  const rows = await this.prisma.fillUp.findMany({
    where: { fleet_id: fleetId },
    orderBy: { filled_at: 'desc' },
    take: limit,
    include: {
      station: { select: { name: true } },
      user: { select: { display_name: true } },
    },
  });

  return {
    fillUps: rows.map(r => ({
      id: r.id,
      filledAt: r.filled_at.toISOString(),
      stationName: r.station?.name ?? null,
      fuelType: r.fuel_type,
      litres: r.litres,
      totalCostPln: r.total_cost_pln,
      pricePerLitrePln: r.price_per_litre_pln,
      areaAvgAtFillup: r.area_avg_at_fillup ?? null,
      consumptionL100km: r.consumption_l_per_100km ?? null,
      driverName: r.user?.display_name ?? null,
    })),
  };
}
```

The `fleetId` comes from `user.fleetId` in the JWT payload (set by the auth system when a FLEET_MANAGER logs in). Verify the exact JWT field name in the auth service from Story 9.1 before implementing.

### `.env.example` Addition

```
# Fleet portal URL — used for "Open Fleet Portal" link on /flota page
# Dev: use http://localhost:3001 if running apps/fleet locally
# Prod: https://fleet.desert.app
FLEET_APP_URL=https://fleet.desert.app
```

---

## File List

**New (Web):**
- `apps/web/app/flota/page.tsx` — Server Component; decodes JWT role; renders FleetSummary or FleetUpsell
- `apps/web/components/FleetSummary.tsx` — Server Component; fleet stats + fill-ups table + Fleet Portal CTA
- `apps/web/components/FleetUpsell.tsx` — Server Component; marketing page for non-fleet-manager users

**Modified (Web):**
- `apps/web/lib/i18n.ts` — add `fleet` key to `Translations` interface + all 3 locale objects (pl/en/uk)
- `apps/web/.env.example` — add `FLEET_APP_URL` with comment
- `apps/web/middleware.ts` — add `/flota` to `PROTECTED_PATHS` array (if web-6 established this array; otherwise create the middleware using the pattern above)

**New (API):**
- *(no new files — addition is in existing `FleetController` and `FleetAnalyticsService`)*

**Modified (API):**
- `apps/api/src/fleet/fleet.controller.ts` — add `GET /v1/fleet/fill-ups` endpoint
- `apps/api/src/fleet/fleet-analytics.service.ts` — add `getRecentFillUps(fleetId, limit)` method

---

## Dev Notes

### This Page is NOT apps/fleet

`apps/fleet` (at fleet.desert.app) is the full fleet portal built in Epic 9. `/flota` in `apps/web` is a thin entry page. Do not import any code from `apps/fleet` — they are separate Next.js applications. All data comes from the shared NestJS API.

### JWT Decoding — No Signature Verification

The `decodeJwtPayload` helper in `page.tsx` only base64-decodes the payload to read the `role` field. It does NOT verify the signature. This is intentional and safe because:
1. The NestJS API verifies the JWT on every authenticated API call in `FleetSummary`.
2. Even if someone tampers with the token locally, they will get a 403 from the API — the UI role-branch is just a UX hint, not a security gate.
3. The real security gate is middleware (no token → redirect to login) + NestJS `@Roles(FLEET_MANAGER)` guard on every API endpoint.

### `fetchWithAuth` Dependency on web-6

`FleetSummary` uses `fetchWithAuth` from `apps/web/lib/api.ts`. This helper is established in web-6. If web-6 is not yet merged, the dev agent must implement it as described in the Technical Architecture section above. The signature: `fetchWithAuth<T>(path, token, init?) → Promise<T | null>`.

### FLEET_APP_URL Fallback

The fallback `'https://fleet.desert.app'` is hardcoded in `page.tsx` for local dev safety:
```typescript
const fleetAppUrl = process.env.FLEET_APP_URL ?? 'https://fleet.desert.app';
```
This means the link always works even when the env var is not set locally.

### `GET /v1/fleet/fill-ups` — fleet_id in JWT

The endpoint scopes fill-ups by `user.fleetId` from the JWT payload. Verify the exact field name in `JwtPayload` type (Story 9.1). It may be `fleet_id` (snake_case) or `fleetId` (camelCase) depending on how the auth service constructs the token. Use the correct field — do not guess.

### `GET /v1/fleet/analytics/dashboard?period=month` — avg price/L derivation

The `FleetDashboardDto` does not include `avgPricePerLitre` directly. Derive it client-side:
```typescript
const avgPrice = dashboard.totals.totalLitres > 0
  ? dashboard.totals.totalSpendPln / dashboard.totals.totalLitres
  : null;
```
Guard against division by zero — new fleets with no fill-ups will have `totalLitres === 0`.

### No Locale-Prefixed Routes for `/flota`

Unlike content pages (`/o-nas`, `/en/about`, `/uk/about`), `/flota` is a single authenticated route. There are no `/en/fleet` or `/uk/fleet` equivalents — locale is detected from the cookie inside the page component, as with other cookie-locale pages. This matches the `/konto` pattern from web-6.

### Testing

No unit tests required for `FleetUpsell` — it is a pure presentational component with no logic.

For `FleetSummary` — no unit test required; integration tested via page render. The API calls use `fetchWithAuth` which handles errors gracefully (returns `null` on failure).

**API tests required for `GET /v1/fleet/fill-ups`:**
- Returns `{ fillUps: [] }` for a fleet with no fill-ups
- Returns mapped rows (snake_case DB → camelCase response) with `driverName` from user join
- Returns max 50 rows even when `limit=999` is passed
- Returns 403 when caller's role is not `FLEET_MANAGER`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

---

## Change Log

- 2026-04-08: Story created (full spec from web-7-fleet-dashboard.md); web-stories.md stub updated to ready-for-dev
