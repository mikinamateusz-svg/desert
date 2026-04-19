# Story web-10 — Price Alerts & Notifications

## Metadata

- **Epic:** web — Web App — Public Site & Content
- **Story ID:** web-10
- **Status:** ready-for-dev
- **Created:** 2026-04-08
- **Depends on:** web-6 (`web_token` httpOnly cookie, `fetchWithAuth` helper, `/logowanie` login page, `middleware.ts` protected-route pattern)
- **Also depends on:** Story 6.1 (price-drop alert delivery pipeline), Story 6.4 (`NotificationPreference` Phase 2 columns, `PriceAlert` concept)

---

## User Story

As an **authenticated driver**,
I want to create and manage price alerts on the Litro website,
So that I receive an email when fuel prices drop below my chosen threshold — without needing the mobile app.

**Why:** The mobile app (Stories 6.1, 6.4) already handles push notifications for opted-in drivers. Web users who don't have the app installed have no way to set price alerts. The `/powiadomienia` page closes that gap: it exposes email-based alerts that work independently of push notifications, and shows a CTA to the mobile app for drivers who want instant push alerts as well. It also serves as a unified management interface — alerts created on mobile are visible here, and vice versa.

---

## Acceptance Criteria

- **AC1 — Auth gate:** `GET /powiadomienia` is protected by middleware. A request with no valid `web_token` cookie is redirected to `/logowanie?next=/powiadomienia`.

- **AC2 — Alert list:** Given an authenticated user, when they visit `/powiadomienia`, then the page shows all their active price alerts. Each alert card displays: fuel type (human-readable label), threshold (`Poniżej X,XX PLN/L`), location context (station name, voivodeship name, or radius description), status badge (active / paused), and last triggered timestamp (or "Nigdy" if never triggered).

- **AC3 — Delete alert:** Each alert card has a "Usuń" button. When clicked, a confirmation dialog appears ("Czy na pewno chcesz usunąć ten alert?"). On confirmation, the alert is deleted via `DELETE /v1/me/alerts/:alertId`. The list updates immediately (optimistic removal). If the API call fails, the item is restored and an error toast is shown.

- **AC4 — Create alert form validation:** The create alert form validates that: fuel type is selected, threshold is a number between 1.00 and 15.00 (inclusive), and a location is set. Submit is disabled until all three are valid.

- **AC5 — Location options:** The create alert form supports three location types:
  - "Konkretna stacja" — station search via existing station search API (`GET /v1/stations/search?q=...`); user picks from results
  - "Województwo" — dropdown with all 16 Polish voivodeships
  - "Pobliska stacja" (radius) — uses browser `navigator.geolocation` if granted; or address search via Mapbox geocoding API if geolocation is denied/unavailable

- **AC6 — Create alert submission:** The "Utwórz alert" button submits `POST /v1/me/alerts`. On success, the new alert appears at the top of the list and the form resets. If the API returns a 400 error with message containing "maximum" (i.e. >10 alerts limit), an inline error is shown: "Osiągnięto limit 10 alertów. Usuń jeden, aby dodać nowy."

- **AC7 — Email-only notifications:** The notification method selector shows a single checkbox "E-mail" that is pre-checked and cannot be unchecked (disabled). A tooltip on hover (or tap on mobile) reads: "Powiadomienia push są dostępne w aplikacji mobilnej Litro." There is no push notification option in the web form.

- **AC8 — Mobile app CTA:** Below the create form (or below the alert list when the list is non-empty), a banner shows: "Chcesz natychmiastowe powiadomienia push?" with App Store and Google Play buttons linking to `process.env.NEXT_PUBLIC_APP_STORE_URL` and `process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL` respectively (fallback: `/pobierz`).

- **AC9 — `GET /v1/me/alerts`:** Returns all `PriceAlert` records for the authenticated user, ordered by `created_at DESC`. Returns `{ alerts: [] }` when no alerts exist.

- **AC10 — `POST /v1/me/alerts`:** Creates a `PriceAlert` for the authenticated user. Validates: `fuel_type` must be a valid `FuelType` enum value, `threshold_pln` must be between 1.00 and 15.00, `location_type` must be `'station' | 'voivodeship' | 'radius'`, conditional fields must be present for the chosen location type. Throws `BadRequestException` if the user already has 10 or more active alerts.

- **AC11 — `DELETE /v1/me/alerts/:alertId`:** Deletes the alert. Throws `NotFoundException` if the alert does not exist. Throws `ForbiddenException` if `alert.user_id !== req.user.id`. Returns 204 No Content on success.

- **AC12 — i18n strings:** All UI strings (page title, section headings, form labels, button labels, error messages, tooltip text, CTA copy) are defined in `lib/i18n.ts` under the `alerts` key for all three locales (pl/en/uk). No hardcoded UI strings in components.

---

## Technical Architecture

### Schema — New `PriceAlert` model

The existing schema has no `PriceAlert` model. Add it:

```prisma
// packages/db/prisma/schema.prisma — add to User relations:
priceAlerts  PriceAlert[]

// New model:
model PriceAlert {
  id               String    @id @default(uuid())
  user_id          String
  fuel_type        String    // 'PB_95' | 'PB_98' | 'ON' | 'LPG'
  threshold_pln    Decimal   @db.Decimal(5, 2)
  location_type    String    // 'station' | 'voivodeship' | 'radius'
  station_id       String?
  station_name     String?   // denormalised for display (station may be deleted)
  voivodeship      String?
  lat              Float?
  lng              Float?
  radius_km        Int?
  enabled          Boolean   @default(true)
  last_triggered_at DateTime?
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt
  user             User      @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([user_id, created_at])
  @@index([fuel_type, enabled])
}
```

Migration file: `packages/db/prisma/migrations/<timestamp>_add_price_alert/migration.sql`

### Route Protection via Middleware

`apps/web/middleware.ts` (established in web-6) maintains a `PROTECTED_PATHS` array. Add `/powiadomienia`:

```typescript
// apps/web/middleware.ts — add /powiadomienia to the array
const PROTECTED_PATHS = ['/konto', '/flota', '/powiadomienia'];
```

Full middleware (copy from web-6/web-7 if not yet merged):

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/konto', '/flota', '/powiadomienia'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
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

### Page Shell — `apps/web/app/powiadomienia/page.tsx`

Server Component. Reads `web_token` cookie, fetches alerts from API, passes token + data to Client Components.

```typescript
// apps/web/app/powiadomienia/page.tsx
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { detectLocale, translations } from '../../lib/i18n';
import { fetchWithAuth } from '../../lib/api';
import AlertList from '../../components/AlertList';
import AlertForm from '../../components/AlertForm';
import MobileAppCta from '../../components/MobileAppCta';

export const metadata = {
  title: 'Alerty cenowe — Litro',
};

export default async function PowiadomieniaPage() {
  const cookieStore = await cookies();
  const headerList = await headers();

  const token = cookieStore.get('web_token')?.value;
  if (!token) {
    redirect('/logowanie?next=/powiadomienia');
  }

  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];

  const data = await fetchWithAuth<{ alerts: PriceAlertDto[] }>(
    '/v1/me/alerts',
    token,
  );
  const initialAlerts = data?.alerts ?? [];

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t.alerts.pageTitle}</h1>
      <AlertList
        initialAlerts={initialAlerts}
        token={token}
        t={t}
        locale={locale}
      />
      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-4">{t.alerts.createTitle}</h2>
        <AlertForm token={token} t={t} locale={locale} />
      </section>
      <MobileAppCta t={t} />
    </main>
  );
}
```

`PriceAlertDto` interface (local to page, mirrored in API response):

```typescript
interface PriceAlertDto {
  id: string;
  fuel_type: string;
  threshold_pln: number;
  location_type: 'station' | 'voivodeship' | 'radius';
  station_id?: string;
  station_name?: string;
  voivodeship?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  enabled: boolean;
  last_triggered_at?: string;
  created_at: string;
}
```

### `AlertList` Component — `apps/web/components/AlertList.tsx`

Client Component (`'use client'`). Manages the alert list in local state; handles optimistic deletion.

```typescript
'use client';

import { useState } from 'react';
import type { Locale, Translations } from '../lib/i18n';

interface PriceAlertDto {
  id: string;
  fuel_type: string;
  threshold_pln: number;
  location_type: 'station' | 'voivodeship' | 'radius';
  station_id?: string;
  station_name?: string;
  voivodeship?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  enabled: boolean;
  last_triggered_at?: string;
  created_at: string;
}

interface Props {
  initialAlerts: PriceAlertDto[];
  token: string;
  t: Translations;
  locale: Locale;
}

export default function AlertList({ initialAlerts, token, t, locale }: Props) {
  const [alerts, setAlerts] = useState<PriceAlertDto[]>(initialAlerts);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const ta = t.alerts;

  async function handleDelete(id: string) {
    setConfirmId(null);
    setDeletingId(id);
    // Optimistic removal
    const snapshot = alerts;
    setAlerts((prev) => prev.filter((a) => a.id !== id));

    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: 'DELETE',
        headers: { 'x-web-token': token },
      });
      if (!res.ok) throw new Error('delete failed');
    } catch {
      setAlerts(snapshot);
      setErrorId(id);
    } finally {
      setDeletingId(null);
    }
  }

  if (alerts.length === 0) {
    return <p className="text-gray-500 mb-4">{ta.noAlerts}</p>;
  }

  return (
    <ul className="space-y-3 mb-6">
      {alerts.map((alert) => (
        <li key={alert.id} className="border rounded-lg p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {t.fuelTypes[alert.fuel_type] ?? alert.fuel_type}
                {' — '}
                {ta.below}{' '}
                <span className="font-bold">
                  {Number(alert.threshold_pln).toFixed(2)} PLN/L
                </span>
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {locationLabel(alert, ta)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {alert.enabled ? ta.statusActive : ta.statusPaused}
                {' · '}
                {ta.lastTriggered}:{' '}
                {alert.last_triggered_at
                  ? new Date(alert.last_triggered_at).toLocaleDateString(
                      localeToDateLocale(locale),
                    )
                  : ta.never}
              </p>
              {errorId === alert.id && (
                <p className="text-xs text-red-500 mt-1">{ta.deleteError}</p>
              )}
            </div>
            <div className="flex-shrink-0">
              {confirmId === alert.id ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleDelete(alert.id)}
                    disabled={deletingId === alert.id}
                    className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
                  >
                    {ta.confirmDelete}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-sm border px-3 py-1 rounded"
                  >
                    {ta.cancel}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setErrorId(null);
                    setConfirmId(alert.id);
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  {ta.delete}
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function locationLabel(
  alert: PriceAlertDto,
  ta: Translations['alerts'],
): string {
  if (alert.location_type === 'station') {
    return `${ta.locationStation}: ${alert.station_name ?? alert.station_id ?? '—'}`;
  }
  if (alert.location_type === 'voivodeship') {
    return `${ta.locationVoivodeship}: ${alert.voivodeship ?? '—'}`;
  }
  if (alert.location_type === 'radius') {
    return `${ta.locationRadius}: ${alert.radius_km ?? '?'} km`;
  }
  return '—';
}

function localeToDateLocale(locale: string): string {
  if (locale === 'uk') return 'uk-UA';
  if (locale === 'en') return 'en-GB';
  return 'pl-PL';
}
```

### `AlertForm` Component — `apps/web/components/AlertForm.tsx`

Client Component (`'use client'`). Handles all form state, Mapbox geocoding for address search, geolocation, and station search.

```typescript
'use client';

import { useState, useCallback } from 'react';
import type { Locale, Translations } from '../lib/i18n';

const VOIVODESHIPS = [
  'dolnośląskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie',
  'łódzkie', 'małopolskie', 'mazowieckie', 'opolskie',
  'podkarpackie', 'podlaskie', 'pomorskie', 'śląskie',
  'świętokrzyskie', 'warmińsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
] as const;

const FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'LPG'] as const;

type LocationType = 'station' | 'voivodeship' | 'radius';

interface StationSearchResult {
  id: string;
  name: string;
  address: string | null;
}

interface Props {
  token: string;
  t: Translations;
  locale: Locale;
  onCreated?: (alert: unknown) => void;
}

export default function AlertForm({ token, t, onCreated }: Props) {
  const ta = t.alerts;

  // Form state
  const [fuelType, setFuelType] = useState<string>('');
  const [threshold, setThreshold] = useState<string>('');
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [locationType, setLocationType] = useState<LocationType>('radius');

  // Station search state
  const [stationQuery, setStationQuery] = useState('');
  const [stationResults, setStationResults] = useState<StationSearchResult[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationSearchResult | null>(null);
  const [stationSearching, setStationSearching] = useState(false);

  // Voivodeship state
  const [voivodeship, setVoivodeship] = useState<string>('');

  // Radius / location state
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<
    Array<{ place_name: string; center: [number, number] }>
  >([]);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Station search
  const searchStations = useCallback(async (q: string) => {
    if (q.length < 2) { setStationResults([]); return; }
    setStationSearching(true);
    try {
      const res = await fetch(`/api/stations/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as { stations: StationSearchResult[] };
        setStationResults(data.stations ?? []);
      }
    } catch { /* silently ignore */ } finally {
      setStationSearching(false);
    }
  }, []);

  // Geolocation
  const requestGeolocation = useCallback(() => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError(ta.geoNotSupported);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(pos.coords.latitude);
        setGeoLng(pos.coords.longitude);
      },
      () => setGeoError(ta.geoDenied),
      { timeout: 10000 },
    );
  }, [ta]);

  // Mapbox address geocoding
  const geocodeAddress = useCallback(async (q: string) => {
    if (q.length < 3) { setAddressResults([]); return; }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=PL&types=address,place&limit=5&access_token=${token}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          features: Array<{ place_name: string; center: [number, number] }>;
        };
        setAddressResults(data.features ?? []);
      }
    } catch { /* silently ignore */ }
  }, []);

  // Validate threshold
  function validateThreshold(val: string): boolean {
    const num = parseFloat(val.replace(',', '.'));
    if (isNaN(num) || num < 1.0 || num > 15.0) {
      setThresholdError(ta.thresholdError);
      return false;
    }
    setThresholdError(null);
    return true;
  }

  // Form validity
  const locationValid =
    (locationType === 'station' && selectedStation !== null) ||
    (locationType === 'voivodeship' && voivodeship !== '') ||
    (locationType === 'radius' && (geoLat !== null || addressResults.length > 0));

  const thresholdNum = parseFloat(threshold.replace(',', '.'));
  const formValid =
    fuelType !== '' &&
    !isNaN(thresholdNum) &&
    thresholdNum >= 1.0 &&
    thresholdNum <= 15.0 &&
    locationValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateThreshold(threshold) || !formValid) return;

    setSubmitting(true);
    setSubmitError(null);

    const body: Record<string, unknown> = {
      fuel_type: fuelType,
      threshold_pln: parseFloat(threshold.replace(',', '.')),
      location_type: locationType,
    };

    if (locationType === 'station' && selectedStation) {
      body.station_id = selectedStation.id;
    } else if (locationType === 'voivodeship') {
      body.voivodeship = voivodeship;
    } else if (locationType === 'radius') {
      body.lat = geoLat;
      body.lng = geoLng;
      body.radius_km = radiusKm;
    }

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-web-token': token,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        const msg = err.message ?? '';
        if (msg.toLowerCase().includes('maximum') || msg.toLowerCase().includes('limit')) {
          setSubmitError(ta.limitReached);
        } else {
          setSubmitError(ta.createError);
        }
        return;
      }

      const newAlert = await res.json();
      setSubmitSuccess(true);
      onCreated?.(newAlert);

      // Reset form
      setFuelType('');
      setThreshold('');
      setSelectedStation(null);
      setStationQuery('');
      setVoivodeship('');
      setGeoLat(null);
      setGeoLng(null);
      setAddressQuery('');
      setAddressResults([]);
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch {
      setSubmitError(ta.createError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 border rounded-lg p-5">

      {/* Fuel type */}
      <div>
        <label className="block text-sm font-medium mb-1">{ta.fuelType}</label>
        <select
          value={fuelType}
          onChange={(e) => setFuelType(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          required
        >
          <option value="">{ta.selectFuelType}</option>
          {FUEL_TYPES.map((f) => (
            <option key={f} value={f}>{t.fuelTypes[f] ?? f}</option>
          ))}
        </select>
      </div>

      {/* Threshold */}
      <div>
        <label className="block text-sm font-medium mb-1">{ta.threshold}</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={() => threshold && validateThreshold(threshold)}
            placeholder={ta.thresholdPlaceholder}
            className="border rounded px-3 py-2 text-sm w-32"
          />
          <span className="text-sm text-gray-500">PLN/L</span>
        </div>
        {thresholdError && (
          <p className="text-xs text-red-500 mt-1">{thresholdError}</p>
        )}
      </div>

      {/* Location type selector */}
      <div>
        <label className="block text-sm font-medium mb-2">{ta.locationType}</label>
        <div className="flex gap-2 flex-wrap">
          {(['radius', 'voivodeship', 'station'] as const).map((lt) => (
            <button
              key={lt}
              type="button"
              onClick={() => setLocationType(lt)}
              className={`px-3 py-1 rounded text-sm border ${
                locationType === lt
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              {ta[`locationType_${lt}` as keyof typeof ta] as string}
            </button>
          ))}
        </div>
      </div>

      {/* Station search */}
      {locationType === 'station' && (
        <div>
          <label className="block text-sm font-medium mb-1">{ta.stationSearch}</label>
          {selectedStation ? (
            <div className="flex items-center gap-2 border rounded px-3 py-2 text-sm">
              <span className="flex-1">{selectedStation.name}</span>
              <button
                type="button"
                onClick={() => setSelectedStation(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={stationQuery}
                onChange={(e) => {
                  setStationQuery(e.target.value);
                  void searchStations(e.target.value);
                }}
                placeholder={ta.stationSearchPlaceholder}
                className="w-full border rounded px-3 py-2 text-sm"
              />
              {stationSearching && (
                <p className="text-xs text-gray-400 mt-1">{ta.searching}</p>
              )}
              {stationResults.length > 0 && (
                <ul className="border rounded mt-1 divide-y max-h-40 overflow-y-auto">
                  {stationResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStation(s);
                          setStationResults([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium">{s.name}</span>
                        {s.address && (
                          <span className="text-gray-400 ml-2 text-xs">
                            {s.address}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Voivodeship dropdown */}
      {locationType === 'voivodeship' && (
        <div>
          <label className="block text-sm font-medium mb-1">
            {ta.voivodeshipLabel}
          </label>
          <select
            value={voivodeship}
            onChange={(e) => setVoivodeship(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          >
            <option value="">{ta.selectVoivodeship}</option>
            {VOIVODESHIPS.map((v) => (
              <option key={v} value={v}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Radius / geolocation */}
      {locationType === 'radius' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{ta.radiusLabel}</label>
            <div className="flex gap-2">
              {[5, 10, 25].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadiusKm(r)}
                  className={`px-3 py-1 rounded text-sm border ${
                    radiusKm === r
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>

          {geoLat !== null ? (
            <p className="text-sm text-green-700">
              {ta.geoGranted} ({geoLat.toFixed(4)}, {geoLng?.toFixed(4)})
              <button
                type="button"
                onClick={() => { setGeoLat(null); setGeoLng(null); }}
                className="ml-2 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={requestGeolocation}
                className="text-sm text-blue-600 hover:underline"
              >
                {ta.useMyLocation}
              </button>
              {geoError && (
                <p className="text-xs text-red-500">{geoError}</p>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">
                  {ta.orSearchAddress}
                </label>
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => {
                    setAddressQuery(e.target.value);
                    void geocodeAddress(e.target.value);
                  }}
                  placeholder={ta.addressSearchPlaceholder}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
                {addressResults.length > 0 && (
                  <ul className="border rounded mt-1 divide-y max-h-40 overflow-y-auto">
                    {addressResults.map((r) => (
                      <li key={r.place_name}>
                        <button
                          type="button"
                          onClick={() => {
                            setGeoLat(r.center[1]);
                            setGeoLng(r.center[0]);
                            setAddressQuery(r.place_name);
                            setAddressResults([]);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          {r.place_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Notification method (email-only, disabled) */}
      <div>
        <label className="block text-sm font-medium mb-2">{ta.notificationMethod}</label>
        <div className="relative group inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked
            disabled
            readOnly
            className="w-4 h-4 opacity-60"
          />
          <span className="text-sm text-gray-600">{ta.emailMethod}</span>
          {/* Tooltip trigger */}
          <span className="text-gray-400 cursor-help text-xs border rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
          <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 w-52">
            {ta.pushTooltip}
          </span>
        </div>
      </div>

      {/* Submit error */}
      {submitError && (
        <p className="text-sm text-red-600">{submitError}</p>
      )}
      {submitSuccess && (
        <p className="text-sm text-green-600">{ta.createSuccess}</p>
      )}

      <button
        type="submit"
        disabled={!formValid || submitting}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded"
      >
        {submitting ? ta.creating : ta.createButton}
      </button>
    </form>
  );
}
```

### `MobileAppCta` Component — `apps/web/components/MobileAppCta.tsx`

Server Component. Renders App Store / Google Play links.

```typescript
// apps/web/components/MobileAppCta.tsx
import type { Translations } from '../lib/i18n';

interface Props { t: Translations; }

export default function MobileAppCta({ t }: Props) {
  const ta = t.alerts;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL ?? '/pobierz';
  const googlePlayUrl = process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL ?? '/pobierz';

  return (
    <div className="mt-10 border rounded-lg p-5 bg-gray-50">
      <p className="font-semibold mb-2">{ta.ctaTitle}</p>
      <p className="text-sm text-gray-600 mb-4">{ta.ctaSubtitle}</p>
      <div className="flex flex-wrap gap-3">
        <a
          href={appStoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block border px-4 py-2 rounded text-sm font-medium hover:bg-white"
        >
          {t.download.appStore}
        </a>
        <a
          href={googlePlayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block border px-4 py-2 rounded text-sm font-medium hover:bg-white"
        >
          {t.download.googlePlay}
        </a>
      </div>
    </div>
  );
}
```

### Web API Proxy Routes

**`apps/web/app/api/alerts/route.ts`** — GET + POST proxy:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-web-token') ??
    request.cookies.get('web_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/v1/me/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-web-token') ??
    request.cookies.get('web_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const res = await fetch(`${API_URL}/v1/me/alerts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

**`apps/web/app/api/alerts/[alertId]/route.ts`** — DELETE proxy:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { alertId: string } },
) {
  const token = request.headers.get('x-web-token') ??
    request.cookies.get('web_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${API_URL}/v1/me/alerts/${params.alertId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

Note on `x-web-token` header: Client Components cannot access `httpOnly` cookies directly. The page Server Component passes the token as a prop, and Client Components send it via a custom `x-web-token` request header to the Next.js API proxy. The proxy then uses it as a `Bearer` token to call the NestJS API. The cookie is also checked as a fallback for GET requests from server-side fetch calls.

### NestJS — `UserController` additions

Add three endpoints to `apps/api/src/user/user.controller.ts`:

```typescript
import {
  BadRequestException, Body, Controller, Delete,
  ForbiddenException, Get, HttpCode, NotFoundException,
  Param, Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConsentType, User, UserRole } from '@prisma/client';
import { UserService } from './user.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreatePriceAlertDto } from './dto/create-price-alert.dto.js';

// (existing ALL_ROLES constant and existing endpoints unchanged)

@Get('alerts')
@Roles(...ALL_ROLES)
async getAlerts(@CurrentUser() user: User) {
  return this.userService.getAlerts(user.id);
}

@Post('alerts')
@Roles(...ALL_ROLES)
@Throttle({ default: { ttl: 60, limit: 20 } })
async createAlert(
  @CurrentUser() user: User,
  @Body() dto: CreatePriceAlertDto,
): Promise<unknown> {
  return this.userService.createAlert(user.id, dto);
}

@Delete('alerts/:alertId')
@HttpCode(204)
@Roles(...ALL_ROLES)
async deleteAlert(
  @CurrentUser() user: User,
  @Param('alertId') alertId: string,
): Promise<void> {
  await this.userService.deleteAlert(user.id, alertId);
}
```

### DTO — `apps/api/src/user/dto/create-price-alert.dto.ts`

```typescript
import {
  IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, Max, Min, ValidateIf,
} from 'class-validator';

const VALID_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'LPG'] as const;
const VALID_LOCATION_TYPES = ['station', 'voivodeship', 'radius'] as const;

export class CreatePriceAlertDto {
  @IsNotEmpty()
  @IsIn(VALID_FUEL_TYPES)
  fuel_type!: string;

  @IsNumber()
  @Min(1.0)
  @Max(15.0)
  threshold_pln!: number;

  @IsIn(VALID_LOCATION_TYPES)
  location_type!: 'station' | 'voivodeship' | 'radius';

  @ValidateIf((o) => o.location_type === 'station')
  @IsNotEmpty()
  @IsString()
  station_id?: string;

  @ValidateIf((o) => o.location_type === 'voivodeship')
  @IsNotEmpty()
  @IsString()
  voivodeship?: string;

  @ValidateIf((o) => o.location_type === 'radius')
  @IsNumber()
  lat?: number;

  @ValidateIf((o) => o.location_type === 'radius')
  @IsNumber()
  lng?: number;

  @ValidateIf((o) => o.location_type === 'radius')
  @IsInt()
  @Min(1)
  @Max(50)
  radius_km?: number;
}
```

### NestJS — `UserService` additions

Add three methods to `apps/api/src/user/user.service.ts`:

```typescript
// Inject PrismaService — already injected in UserService constructor

async getAlerts(userId: string): Promise<{ alerts: PriceAlertDto[] }> {
  const rows = await this.prisma.priceAlert.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
  });
  return {
    alerts: rows.map((r) => ({
      id: r.id,
      fuel_type: r.fuel_type,
      threshold_pln: Number(r.threshold_pln),
      location_type: r.location_type as 'station' | 'voivodeship' | 'radius',
      station_id: r.station_id ?? undefined,
      station_name: r.station_name ?? undefined,
      voivodeship: r.voivodeship ?? undefined,
      lat: r.lat ?? undefined,
      lng: r.lng ?? undefined,
      radius_km: r.radius_km ?? undefined,
      enabled: r.enabled,
      last_triggered_at: r.last_triggered_at?.toISOString(),
      created_at: r.created_at.toISOString(),
    })),
  };
}

async createAlert(
  userId: string,
  dto: CreatePriceAlertDto,
): Promise<PriceAlertDto> {
  const count = await this.prisma.priceAlert.count({
    where: { user_id: userId, enabled: true },
  });
  if (count >= 10) {
    throw new BadRequestException(
      'You have reached the maximum of 10 active alerts.',
    );
  }

  // Denormalise station name for display
  let stationName: string | undefined;
  if (dto.location_type === 'station' && dto.station_id) {
    const station = await this.prisma.station.findUnique({
      where: { id: dto.station_id },
      select: { name: true },
    });
    stationName = station?.name;
  }

  const alert = await this.prisma.priceAlert.create({
    data: {
      user_id: userId,
      fuel_type: dto.fuel_type,
      threshold_pln: dto.threshold_pln,
      location_type: dto.location_type,
      station_id: dto.station_id ?? null,
      station_name: stationName ?? null,
      voivodeship: dto.voivodeship ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      radius_km: dto.radius_km ?? null,
    },
  });

  return {
    id: alert.id,
    fuel_type: alert.fuel_type,
    threshold_pln: Number(alert.threshold_pln),
    location_type: alert.location_type as 'station' | 'voivodeship' | 'radius',
    station_id: alert.station_id ?? undefined,
    station_name: alert.station_name ?? undefined,
    voivodeship: alert.voivodeship ?? undefined,
    lat: alert.lat ?? undefined,
    lng: alert.lng ?? undefined,
    radius_km: alert.radius_km ?? undefined,
    enabled: alert.enabled,
    created_at: alert.created_at.toISOString(),
  };
}

async deleteAlert(userId: string, alertId: string): Promise<void> {
  const alert = await this.prisma.priceAlert.findUnique({
    where: { id: alertId },
  });
  if (!alert) throw new NotFoundException('Alert not found');
  if (alert.user_id !== userId) throw new ForbiddenException('Not your alert');
  await this.prisma.priceAlert.delete({ where: { id: alertId } });
}
```

Add `PriceAlertDto` interface to `user.service.ts` (or extract to a shared types file):

```typescript
interface PriceAlertDto {
  id: string;
  fuel_type: string;
  threshold_pln: number;
  location_type: 'station' | 'voivodeship' | 'radius';
  station_id?: string;
  station_name?: string;
  voivodeship?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  enabled: boolean;
  last_triggered_at?: string;
  created_at: string;
}
```

Also add `BadRequestException`, `ForbiddenException`, `NotFoundException` to NestJS imports in `user.service.ts`.

### Station Search Proxy Route

The `AlertForm` needs to search stations. Add a proxy at `apps/web/app/api/stations/search/route.ts` that proxies to the existing `GET /v1/stations/search?q=...` endpoint (which is `@Public()`):

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  const res = await fetch(
    `${API_URL}/v1/stations/search?q=${encodeURIComponent(q)}&limit=5`,
    { cache: 'no-store' },
  );
  if (!res.ok) return NextResponse.json({ stations: [] });
  const data = await res.json();
  return NextResponse.json(data);
}
```

Verify the exact station search endpoint URL and response shape in the existing station controller before implementing. If `GET /v1/stations/search` does not exist, use `GET /v1/stations?q=...` or the appropriate existing search endpoint.

### i18n Additions

Add `alerts` key to the `Translations` interface and all three locale objects in `lib/i18n.ts`.

**Interface extension:**

```typescript
alerts: {
  pageTitle: string;          // "Alerty cenowe" / "Price alerts" / "Цінові сповіщення"
  createTitle: string;        // "Nowy alert" / "New alert" / "Новий алерт"
  noAlerts: string;           // "Nie masz jeszcze żadnych alertów." / "You have no alerts yet." / "У вас ще немає сповіщень."
  below: string;              // "Poniżej" / "Below" / "Нижче"
  statusActive: string;       // "Aktywny" / "Active" / "Активний"
  statusPaused: string;       // "Wstrzymany" / "Paused" / "Призупинений"
  lastTriggered: string;      // "Ostatnio wyzwolony" / "Last triggered" / "Останнє спрацювання"
  never: string;              // "Nigdy" / "Never" / "Ніколи"
  locationStation: string;    // "Stacja" / "Station" / "Станція"
  locationVoivodeship: string; // "Województwo" / "Region" / "Регіон"
  locationRadius: string;     // "Zasięg" / "Radius" / "Радіус"
  delete: string;             // "Usuń" / "Delete" / "Видалити"
  confirmDelete: string;      // "Tak, usuń" / "Yes, delete" / "Так, видалити"
  cancel: string;             // "Anuluj" / "Cancel" / "Скасувати"
  deleteError: string;        // "Nie udało się usunąć alertu." / "Failed to delete alert." / "Не вдалося видалити сповіщення."

  // Form
  fuelType: string;           // "Rodzaj paliwa" / "Fuel type" / "Тип палива"
  selectFuelType: string;     // "Wybierz paliwo..." / "Select fuel..." / "Оберіть паливо..."
  threshold: string;          // "Próg cenowy (poniżej)" / "Price threshold (below)" / "Ціновий поріг (нижче)"
  thresholdPlaceholder: string; // "np. 5,99" / "e.g. 5.99" / "напр. 5,99"
  thresholdError: string;     // "Podaj cenę między 1,00 a 15,00 PLN." / "Enter a price between 1.00 and 15.00 PLN." / "Введіть ціну від 1,00 до 15,00 PLN."
  locationType: string;       // "Lokalizacja" / "Location" / "Місцезнаходження"
  locationType_radius: string;   // "Moja okolica" / "Nearby" / "Поруч"
  locationType_voivodeship: string; // "Województwo" / "Region" / "Регіон"
  locationType_station: string;  // "Konkretna stacja" / "Specific station" / "Конкретна станція"
  stationSearch: string;      // "Szukaj stacji" / "Search station" / "Знайти станцію"
  stationSearchPlaceholder: string; // "Wpisz nazwę stacji..." / "Type station name..." / "Назва станції..."
  searching: string;          // "Szukam..." / "Searching..." / "Пошук..."
  voivodeshipLabel: string;   // "Wybierz województwo" / "Select region" / "Оберіть регіон"
  selectVoivodeship: string;  // "Województwo..." / "Region..." / "Регіон..."
  radiusLabel: string;        // "Zasięg alertu" / "Alert radius" / "Радіус сповіщення"
  useMyLocation: string;      // "Użyj mojej lokalizacji" / "Use my location" / "Використати мою локацію"
  geoGranted: string;         // "Lokalizacja pobrana" / "Location obtained" / "Локацію отримано"
  geoDenied: string;          // "Brak dostępu do lokalizacji. Wyszukaj adres." / "Location access denied. Search by address." / "Доступ до локації відхилено."
  geoNotSupported: string;    // "Twoja przeglądarka nie obsługuje geolokalizacji." / "Your browser doesn't support geolocation." / "Браузер не підтримує геолокацію."
  orSearchAddress: string;    // "lub podaj adres" / "or enter address" / "або введіть адресу"
  addressSearchPlaceholder: string; // "np. Warszawa, Marszałkowska" / "e.g. Warsaw, Main Street" / "напр. Варшава, вулиця..."
  notificationMethod: string; // "Metoda powiadamiania" / "Notification method" / "Метод сповіщення"
  emailMethod: string;        // "E-mail" / "E-mail" / "Ел. пошта"
  pushTooltip: string;        // "Powiadomienia push są dostępne w aplikacji mobilnej Litro." / "Push notifications are available in the Litro mobile app." / "Push-сповіщення доступні в мобільному додатку Litro."
  createButton: string;       // "Utwórz alert" / "Create alert" / "Створити сповіщення"
  creating: string;           // "Tworzę..." / "Creating..." / "Створення..."
  createSuccess: string;      // "Alert został utworzony." / "Alert created successfully." / "Сповіщення створено."
  createError: string;        // "Nie udało się utworzyć alertu." / "Failed to create alert." / "Не вдалося створити сповіщення."
  limitReached: string;       // "Osiągnięto limit 10 alertów. Usuń jeden, aby dodać nowy." / "Maximum of 10 alerts reached. Delete one to add a new alert." / "Досягнуто ліміт 10 сповіщень."

  // CTA
  ctaTitle: string;           // "Chcesz natychmiastowe powiadomienia push?" / "Want instant push notifications?" / "Бажаєте миттєві push-сповіщення?"
  ctaSubtitle: string;        // "Pobierz aplikację Litro i otrzymuj alerty w czasie rzeczywistym." / "Download the Litro app and get real-time price alerts." / "Завантажте Litro і отримуйте сповіщення в реальному часі."
};
```

**PL locale values:**
```typescript
alerts: {
  pageTitle: 'Alerty cenowe',
  createTitle: 'Nowy alert',
  noAlerts: 'Nie masz jeszcze żadnych alertów cenowych.',
  below: 'Poniżej',
  statusActive: 'Aktywny',
  statusPaused: 'Wstrzymany',
  lastTriggered: 'Ostatnio wyzwolony',
  never: 'Nigdy',
  locationStation: 'Stacja',
  locationVoivodeship: 'Województwo',
  locationRadius: 'Zasięg',
  delete: 'Usuń',
  confirmDelete: 'Tak, usuń',
  cancel: 'Anuluj',
  deleteError: 'Nie udało się usunąć alertu.',
  fuelType: 'Rodzaj paliwa',
  selectFuelType: 'Wybierz paliwo...',
  threshold: 'Próg cenowy (alert poniżej)',
  thresholdPlaceholder: 'np. 5,99',
  thresholdError: 'Podaj cenę między 1,00 a 15,00 PLN.',
  locationType: 'Lokalizacja alertu',
  locationType_radius: 'Moja okolica',
  locationType_voivodeship: 'Województwo',
  locationType_station: 'Konkretna stacja',
  stationSearch: 'Szukaj stacji',
  stationSearchPlaceholder: 'Wpisz nazwę stacji...',
  searching: 'Szukam...',
  voivodeshipLabel: 'Wybierz województwo',
  selectVoivodeship: 'Województwo...',
  radiusLabel: 'Zasięg alertu',
  useMyLocation: 'Użyj mojej lokalizacji',
  geoGranted: 'Lokalizacja pobrana',
  geoDenied: 'Brak dostępu do lokalizacji. Wyszukaj adres.',
  geoNotSupported: 'Twoja przeglądarka nie obsługuje geolokalizacji.',
  orSearchAddress: 'lub podaj adres',
  addressSearchPlaceholder: 'np. Warszawa, ul. Marszałkowska',
  notificationMethod: 'Metoda powiadamiania',
  emailMethod: 'E-mail',
  pushTooltip: 'Powiadomienia push są dostępne w aplikacji mobilnej Litro.',
  createButton: 'Utwórz alert',
  creating: 'Tworzę...',
  createSuccess: 'Alert cenowy został utworzony.',
  createError: 'Nie udało się utworzyć alertu. Spróbuj ponownie.',
  limitReached: 'Osiągnięto limit 10 alertów. Usuń jeden, aby dodać nowy.',
  ctaTitle: 'Chcesz natychmiastowe powiadomienia push?',
  ctaSubtitle: 'Pobierz aplikację Litro i otrzymuj alerty cenowe w czasie rzeczywistym.',
},
```

**EN locale values:**
```typescript
alerts: {
  pageTitle: 'Price alerts',
  createTitle: 'New alert',
  noAlerts: 'You have no price alerts yet.',
  below: 'Below',
  statusActive: 'Active',
  statusPaused: 'Paused',
  lastTriggered: 'Last triggered',
  never: 'Never',
  locationStation: 'Station',
  locationVoivodeship: 'Region',
  locationRadius: 'Radius',
  delete: 'Delete',
  confirmDelete: 'Yes, delete',
  cancel: 'Cancel',
  deleteError: 'Failed to delete alert.',
  fuelType: 'Fuel type',
  selectFuelType: 'Select fuel...',
  threshold: 'Price threshold (alert below)',
  thresholdPlaceholder: 'e.g. 5.99',
  thresholdError: 'Enter a price between 1.00 and 15.00 PLN.',
  locationType: 'Alert location',
  locationType_radius: 'Nearby',
  locationType_voivodeship: 'Region',
  locationType_station: 'Specific station',
  stationSearch: 'Search station',
  stationSearchPlaceholder: 'Type station name...',
  searching: 'Searching...',
  voivodeshipLabel: 'Select region',
  selectVoivodeship: 'Region...',
  radiusLabel: 'Alert radius',
  useMyLocation: 'Use my location',
  geoGranted: 'Location obtained',
  geoDenied: 'Location access denied. Search by address.',
  geoNotSupported: "Your browser doesn't support geolocation.",
  orSearchAddress: 'or enter address',
  addressSearchPlaceholder: 'e.g. Warsaw, Marszałkowska St.',
  notificationMethod: 'Notification method',
  emailMethod: 'E-mail',
  pushTooltip: 'Push notifications are available in the Litro mobile app.',
  createButton: 'Create alert',
  creating: 'Creating...',
  createSuccess: 'Price alert created.',
  createError: 'Failed to create alert. Please try again.',
  limitReached: 'Maximum of 10 alerts reached. Delete one to add a new alert.',
  ctaTitle: 'Want instant push notifications?',
  ctaSubtitle: 'Download the Litro app and get real-time price alerts.',
},
```

**UK locale values:**
```typescript
alerts: {
  pageTitle: 'Цінові сповіщення',
  createTitle: 'Нове сповіщення',
  noAlerts: 'У вас ще немає цінових сповіщень.',
  below: 'Нижче',
  statusActive: 'Активне',
  statusPaused: 'Призупинене',
  lastTriggered: 'Останнє спрацювання',
  never: 'Ніколи',
  locationStation: 'Станція',
  locationVoivodeship: 'Регіон',
  locationRadius: 'Радіус',
  delete: 'Видалити',
  confirmDelete: 'Так, видалити',
  cancel: 'Скасувати',
  deleteError: 'Не вдалося видалити сповіщення.',
  fuelType: 'Тип палива',
  selectFuelType: 'Оберіть паливо...',
  threshold: 'Ціновий поріг (сповіщення нижче)',
  thresholdPlaceholder: 'напр. 5,99',
  thresholdError: 'Введіть ціну від 1,00 до 15,00 PLN.',
  locationType: 'Місце сповіщення',
  locationType_radius: 'Поруч',
  locationType_voivodeship: 'Регіон',
  locationType_station: 'Конкретна станція',
  stationSearch: 'Знайти станцію',
  stationSearchPlaceholder: 'Введіть назву станції...',
  searching: 'Пошук...',
  voivodeshipLabel: 'Оберіть регіон',
  selectVoivodeship: 'Регіон...',
  radiusLabel: 'Радіус сповіщення',
  useMyLocation: 'Використати мою локацію',
  geoGranted: 'Локацію отримано',
  geoDenied: 'Доступ до локації відхилено. Введіть адресу.',
  geoNotSupported: 'Ваш браузер не підтримує геолокацію.',
  orSearchAddress: 'або введіть адресу',
  addressSearchPlaceholder: 'напр. Варшава, вул. Маршалківська',
  notificationMethod: 'Метод сповіщення',
  emailMethod: 'Ел. пошта',
  pushTooltip: 'Push-сповіщення доступні в мобільному додатку Litro.',
  createButton: 'Створити сповіщення',
  creating: 'Створення...',
  createSuccess: 'Цінове сповіщення створено.',
  createError: 'Не вдалося створити сповіщення. Спробуйте ще раз.',
  limitReached: 'Досягнуто ліміт 10 сповіщень. Видаліть одне, щоб додати нове.',
  ctaTitle: 'Бажаєте миттєві push-сповіщення?',
  ctaSubtitle: 'Завантажте Litro і отримуйте цінові сповіщення в реальному часі.',
},
```

---

## File List

**New (Schema):**
- `packages/db/prisma/migrations/<timestamp>_add_price_alert/migration.sql` — adds `PriceAlert` table

**Modified (Schema):**
- `packages/db/prisma/schema.prisma` — new `PriceAlert` model + `priceAlerts` relation on `User`

**New (API):**
- `apps/api/src/user/dto/create-price-alert.dto.ts` — validated DTO for `POST /v1/me/alerts`
- `apps/api/src/user/user.service.spec.ts` *(modified — new tests for alert methods)*

**Modified (API):**
- `apps/api/src/user/user.controller.ts` — add `GET`, `POST`, `DELETE /v1/me/alerts` endpoints
- `apps/api/src/user/user.service.ts` — add `getAlerts`, `createAlert`, `deleteAlert` methods

**New (Web):**
- `apps/web/app/powiadomienia/page.tsx` — Server Component shell; auth gate + data fetch
- `apps/web/components/AlertList.tsx` — Client Component; alert list with optimistic delete
- `apps/web/components/AlertForm.tsx` — Client Component; create alert form with Mapbox geocoding
- `apps/web/components/MobileAppCta.tsx` — Server Component; App Store/Google Play CTA banner
- `apps/web/app/api/alerts/route.ts` — GET + POST proxy to NestJS
- `apps/web/app/api/alerts/[alertId]/route.ts` — DELETE proxy to NestJS
- `apps/web/app/api/stations/search/route.ts` — GET proxy for station autocomplete (public)

**Modified (Web):**
- `apps/web/middleware.ts` — add `/powiadomienia` to `PROTECTED_PATHS`
- `apps/web/lib/i18n.ts` — add `alerts` key to `Translations` interface + all 3 locale objects (pl/en/uk)

---

## Dev Notes

### No Locale-Prefixed Routes

`/powiadomienia` is auth-gated; no `/en/notifications` or `/uk/notifications` routes are needed for MVP. Locale is read from the cookie inside the Server Component, matching the pattern established for `/konto` (web-6) and `/flota` (web-7).

### `PriceAlert` vs `NotificationPreference`

The `NotificationPreference` model (Stories 6.1, 6.4) stores push-notification preferences per user: it controls *how* price drop alerts are delivered to mobile devices. `PriceAlert` (this story) stores individual alert records: each record is a specific threshold + location combination created by a user. They are complementary, not redundant. Story 6.1 reads `NotificationPreference` to find opted-in users when a price drop occurs. A future story will integrate `PriceAlert` records into the price-drop check pipeline to trigger email delivery.

### Email Delivery — Out of Scope for This Story

This story creates the `PriceAlert` model and the management UI. Actual email sending when an alert triggers is **not implemented here** — it is deferred to a separate backend story (Epic 6 continuation). The `enabled` flag and `last_triggered_at` column are placeholders for that story. The UI accurately reflects that email delivery is configured — the delivery pipeline follow-up story will honour the stored records.

### `fetchWithAuth` Dependency

The page Server Component uses `fetchWithAuth` from `apps/web/lib/api.ts` (established in web-6). If web-6 has not merged, implement `fetchWithAuth` as documented in web-7:

```typescript
// apps/web/lib/api.ts
const API_URL = normalizeApiUrl(process.env.INTERNAL_API_URL);

export async function fetchWithAuth<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}
```

### Client Component Token Passing

`AlertList` and `AlertForm` are Client Components and cannot read `httpOnly` cookies. The page Server Component reads the cookie and passes the token as a prop. The Client Components include it as an `x-web-token` header in calls to the Next.js API proxy routes. The proxy reads it from the header and forwards it as `Authorization: Bearer {token}` to NestJS. Do not attempt to pass cookies from Client Components — this is by design.

### Mapbox Geocoding — Client-Side Only

Mapbox geocoding in `AlertForm` is called only from the client browser using `NEXT_PUBLIC_MAPBOX_TOKEN`. It is not called from the server. Geocoding results (lat/lng) are stored in form state and submitted to `POST /v1/me/alerts` when the form is submitted. No geocoding happens server-side in this story.

### Station Search Endpoint

The proxy at `/api/stations/search` calls the NestJS station search endpoint. Verify the exact endpoint path in `apps/api/src/station/station.controller.ts` before implementing the proxy. It may be `/v1/stations/search?q=` or `/v1/stations?q=` depending on what was implemented in prior stories. The response must include at minimum: `id`, `name`, `address`.

### `BadRequestException` / `ForbiddenException` / `NotFoundException` in UserService

Add NestJS HTTP exception imports to `user.service.ts`:

```typescript
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
```

### PriceAlert — `onDelete: Cascade`

The `PriceAlert` model uses `onDelete: Cascade` on the `User` relation. This ensures alerts are automatically deleted when a user deletes their account (Story 1.8). No additional cleanup code is needed in `UserService.deleteAccount`.

### Testing Requirements

**`user.service.spec.ts`** — add test cases for:
- `getAlerts`: returns empty `{ alerts: [] }` when user has no alerts
- `getAlerts`: returns mapped alerts (Decimal `threshold_pln` → `number`, optional fields → `undefined` not `null`)
- `createAlert` (`location_type: 'station'`): creates alert with `station_name` denormalised from station lookup
- `createAlert` (`location_type: 'voivodeship'`): creates alert with `voivodeship` set
- `createAlert` (`location_type: 'radius'`): creates alert with `lat`, `lng`, `radius_km`
- `createAlert` — throws `BadRequestException` when user already has 10 enabled alerts
- `deleteAlert` — throws `NotFoundException` when alert does not exist
- `deleteAlert` — throws `ForbiddenException` when `alert.user_id !== userId`
- `deleteAlert` — deletes alert when ownership matches

No unit tests required for `AlertForm`, `AlertList`, or `MobileAppCta` — Client Components are integration tested via page rendering.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

---

## Change Log

- 2026-04-08: Story created (full spec from web-10-price-alerts.md); web-stories.md stub to be updated to ready-for-dev
