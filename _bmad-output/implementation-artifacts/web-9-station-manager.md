# Story web-9 — Station Manager Portal

## Metadata

- **Epic:** 9 — Station Manager Touchpoints in apps/web
- **Story ID:** web-9
- **Status:** ready-for-dev
- **Created:** 2026-04-08
- **Depends on:** web-6 (web_token cookie + middleware auth pattern), Story 7.1 (StationClaim schema, STATION_MANAGER role, apps/partner scaffolding), Story 2.1 (Station DB), Story 2.14 (brand field)
- **Required by:** web-10 (price alerts)

---

## User Story

As a **station owner discovering Litro**,
I want a clear public landing page that explains the benefits of listing my station, and a simple way to register my interest,
So that I can get started without needing to navigate a complex portal.

As an **authenticated station manager**,
I want a lightweight dashboard in the main Litro website showing my claimed stations and quick links to the full partner portal,
So that I can check basic stats and jump to full management without leaving the main site.

---

## Context & Why

This story adds three pages to `apps/web` (desert.app) that form the station-owner funnel within the main consumer app. It is **not** a duplicate of `apps/partner` (partner.desert.app) — the full claim verification flow, price management, and analytics live there. Web-9's role is:

1. **Marketing** (`/dla-stacji`) — SEO-facing landing page to attract station owners.
2. **Lead capture** (`/dla-stacji/zglos`) — Lightweight claim-request form that emails ops; hands off to `apps/partner` for the actual verification workflow (Story 7.1).
3. **Quick dashboard** (`/dla-stacji/konto`) — Authenticated view showing managed stations and a prominent "Open Partner Portal" link. Role-gated to STATION_MANAGER; non-managers see an upsell to `/dla-stacji/zglos`.

The API side adds:
- `POST /v1/stations/claim-request` — public, rate-limited, emails ops via Resend. No DB write; ops handles manually until Story 7.1 is live and the full claim flow in `apps/partner` takes over.
- `GET /v1/me/stations` — authenticated, returns stations the current user manages via `StationClaim` (APPROVED claims only).

**Architecture note:** The `web_token` cookie and middleware guard introduced in web-6 protect `/dla-stacji/konto`. The same decode pattern from `apps/partner/middleware.ts` (Story 7.1) is followed, but using `web_token` (not `partner_token`). Role is read directly from the JWT payload — no extra API call.

---

## Acceptance Criteria

**AC1 — `/dla-stacji` public landing page**
- Renders server-side (Server Component, no auth required).
- Contains: hero heading + subheading, "How it works" (3 steps), benefits section (free vs premium), CTA button linking to `/dla-stacji/zglos`, FAQ section (minimum 4 questions).
- `generateMetadata()` returns title and og:title/og:description for SEO.
- All strings sourced from `lib/i18n.ts` under `stationManager` key.
- EN at `/en/for-stations`, UK at `/uk/for-stations` — locale detection via `detectLocale` same as `o-nas/page.tsx`.

**AC2 — `/dla-stacji/zglos` claim initiation form**
- Public page (no auth required). Client Component form.
- Fields: station name (required), contact email (required, validated), optional message.
- On submit: `POST /api/claim-request` (Next.js route handler proxy).
- Shows inline success message on `{ success: true }` response: "Otrzymaliśmy Twoje zgłoszenie. Sprawdź email — odezwiemy się wkrótce."
- Shows inline error on non-2xx response.
- Submit button disabled while submitting (loading state).

**AC3 — `POST /v1/stations/claim-request` API endpoint**
- `@Public()` — no auth required.
- Body: `{ station_name: string, contact_email: string, message?: string }` — validated via class-validator DTO.
- Sends email to ops via Resend (`OPS_EMAIL` env var). If `RESEND_API_KEY` or `OPS_EMAIL` not set, logs warning and still returns `{ success: true }` (graceful degradation).
- Returns `{ success: true }` with HTTP 201.
- Rate-limited: `@Throttle({ default: { limit: 3, ttl: 3600 } })` — 3 requests per hour per IP.

**AC4 — `/dla-stacji/konto` auth gate**
- Middleware redirects unauthenticated visitors to `/logowanie` (preserving `?redirect=/dla-stacji/konto`).
- Route added to `PROTECTED_PATHS` in `apps/web/middleware.ts`.

**AC5 — Non-STATION_MANAGER empty state**
- Authenticated user whose JWT role is NOT `STATION_MANAGER` sees:
  - Heading: "Nie zarządzasz jeszcze żadną stacją"
  - Body copy explaining the partner programme.
  - CTA button: "Zgłoś swoją stację" → `/dla-stacji/zglos`.
- No API call to `GET /v1/me/stations` made in this branch.

**AC6 — STATION_MANAGER managed station list**
- `GET /v1/me/stations` called server-side (with `web_token` forwarded in Authorization header).
- Each station card shows: station name, brand, address, last price update timestamp, submission count in last 7 days.
- "Otwórz Portal Partnera" link per station → `${PARTNER_APP_URL}/station/{stationId}` (opens new tab).
- Empty list (no approved claims yet, despite role) shows: "Brak przypisanych stacji. Skontaktuj się z support@litro.pl."

**AC7 — `GET /v1/me/stations` API endpoint**
- Added to `UserController` (`v1/me`).
- Requires `@Roles(UserRole.STATION_MANAGER)` (only station managers can call it; DRIVER calling it gets 403).
- Returns array of `ManagedStationDto` (see Technical Architecture).
- Returns `[]` if no `APPROVED` StationClaims exist for user.

**AC8 — Environment variable**
- `PARTNER_APP_URL` added to `apps/web/.env.example` with comment.

**AC9 — i18n**
- All UI strings added to `lib/i18n.ts` under `stationManager` key for all three locales (pl/en/uk).

---

## Technical Architecture

### New API endpoint: `POST /v1/stations/claim-request`

Add to `StationController`:

```typescript
// apps/api/src/station/station.controller.ts — additions

import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateClaimRequestDto } from './dto/create-claim-request.dto.js';

// Inside StationController class:

@Public()
@Post('claim-request')
@Throttle({ default: { limit: 3, ttl: 3600 } })
async createClaimRequest(@Body() dto: CreateClaimRequestDto): Promise<{ success: true }> {
  await this.stationService.createClaimRequest(dto);
  return { success: true };
}
```

New DTO:

```typescript
// apps/api/src/station/dto/create-claim-request.dto.ts
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClaimRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  station_name!: string;

  @IsEmail()
  contact_email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
```

Add `createClaimRequest()` to `StationService`:

```typescript
// apps/api/src/station/station.service.ts — addition

async createClaimRequest(dto: CreateClaimRequestDto): Promise<void> {
  const apiKey = this.config.get<string>('RESEND_API_KEY');
  const opsEmail = this.config.get<string>('OPS_EMAIL');

  if (!apiKey || !opsEmail) {
    this.logger.warn(
      'RESEND_API_KEY or OPS_EMAIL not set — claim request received but not forwarded',
    );
    return;
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'noreply@litro.pl',
      to: opsEmail,
      subject: `Nowe zgłoszenie stacji: ${dto.station_name}`,
      html: `
        <h2>Nowe zgłoszenie stacji</h2>
        <p><strong>Stacja:</strong> ${dto.station_name}</p>
        <p><strong>Email:</strong> ${dto.contact_email}</p>
        ${dto.message ? `<p><strong>Wiadomość:</strong> ${dto.message}</p>` : ''}
        <p><em>Wysłano z desert.app/dla-stacji/zglos</em></p>
      `,
    });
  } catch (err) {
    this.logger.error('Failed to send claim request email', err);
  }
}
```

`StationService` constructor needs `ConfigService` injected — add it alongside `PrismaService`. Also add `private readonly logger = new Logger(StationService.name)` field.

Register `ConfigService` in `StationModule` providers (it is available globally via `ConfigModule.forRoot({ isGlobal: true })` in `AppModule`, so no import needed — just inject in constructor).

Response shape:

```typescript
// HTTP 201
{ success: true }
```

### New API endpoint: `GET /v1/me/stations`

Add to `UserController`:

```typescript
// apps/api/src/user/user.controller.ts — addition

import { ManagedStationDto } from './dto/managed-station.dto.js';

// Inside UserController class:

@Get('stations')
@Roles(UserRole.STATION_MANAGER)
async getManagedStations(@CurrentUser('id') userId: string): Promise<ManagedStationDto[]> {
  return this.userService.getManagedStations(userId);
}
```

New DTO:

```typescript
// apps/api/src/user/dto/managed-station.dto.ts
export interface ManagedStationDto {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  lastPriceUpdate: string | null;   // ISO timestamp or null
  submissionsLast7Days: number;
}
```

Add `getManagedStations()` to `UserService`:

```typescript
// apps/api/src/user/user.service.ts — addition

async getManagedStations(userId: string): Promise<ManagedStationDto[]> {
  const claims = await this.prisma.stationClaim.findMany({
    where: { user_id: userId, status: 'APPROVED' },
    include: { station: true },
  });

  if (claims.length === 0) return [];

  const stationIds = claims.map(c => c.station_id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Count recent submissions per station
  const submissionCounts = await this.prisma.submission.groupBy({
    by: ['station_id'],
    where: {
      station_id: { in: stationIds },
      created_at: { gte: sevenDaysAgo },
    },
    _count: { _all: true },
  });
  const countMap = new Map(
    submissionCounts.map(r => [r.station_id, r._count._all]),
  );

  // Latest approved price per station
  const latestPrices = await this.prisma.price.findMany({
    where: { station_id: { in: stationIds } },
    orderBy: { updated_at: 'desc' },
    distinct: ['station_id'],
    select: { station_id: true, updated_at: true },
  });
  const priceMap = new Map(latestPrices.map(p => [p.station_id, p.updated_at]));

  return claims.map(c => ({
    id: c.station.id,
    name: c.station.name,
    brand: c.station.brand ?? null,
    address: c.station.address ?? null,
    lastPriceUpdate: priceMap.get(c.station_id)?.toISOString() ?? null,
    submissionsLast7Days: countMap.get(c.station_id) ?? 0,
  }));
}
```

**Note:** `StationClaim` model is introduced by Story 7.1 (`add_station_claim` migration). `getManagedStations` must only be called after that migration is applied. If deploying web-9 before Story 7.1 is merged, `getManagedStations` will always return `[]` (no APPROVED claims exist yet) — which is safe. Prisma will throw at startup only if the `StationClaim` table is missing; add a try/catch guard if deploying in this order, or deploy web-9 together with / after Story 7.1.

### Web route structure

```
apps/web/app/
├── dla-stacji/
│   ├── page.tsx                ← PL landing (Server Component, public)
│   ├── zglos/
│   │   └── page.tsx            ← Claim initiation form (Client Component, public)
│   └── konto/
│       └── page.tsx            ← Station manager dashboard (Server Component, auth-gated)
├── en/for-stations/
│   └── page.tsx                ← EN landing (thin locale shell)
└── uk/for-stations/
    └── page.tsx                ← UK landing (thin locale shell)
```

### `apps/web/app/dla-stacji/page.tsx`

```typescript
import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import StationLandingPageContent from '../../components/pages/StationLandingPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Dla stacji — Litro',
    openGraph: {
      title: 'Dla stacji — Litro',
      description: 'Dołącz do Litro i docieraj do tysięcy kierowców w swojej okolicy.',
      type: 'website',
    },
  };
}

export default async function ForStationsPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <StationLandingPageContent locale={locale} t={translations[locale]} />;
}
```

### `apps/web/app/dla-stacji/zglos/page.tsx`

```typescript
import type { Metadata } from 'next';
import ClaimRequestForm from '../../../components/ClaimRequestForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Zgłoś stację — Litro' };
}

// Server Component shell — form is a Client Component
export default function ClaimInitiationPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12 max-w-xl mx-auto">
      <ClaimRequestForm />
    </main>
  );
}
```

### `apps/web/app/dla-stacji/konto/page.tsx`

```typescript
import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../../lib/i18n';
import StationManagerDashboard from '../../../components/pages/StationManagerDashboard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Moje stacje — Litro' };
}

export default async function StationManagerPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );

  // Role from JWT — middleware guarantees web_token exists at this point.
  // Decode payload client-side is not needed; role is also readable server-side
  // via the raw cookie (no signature verification needed here — just role-based
  // conditional rendering; API enforces roles on every call).
  const token = cookieStore.get('web_token')?.value ?? '';
  let role: string | null = null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf-8'),
    ) as { role?: string };
    role = payload.role ?? null;
  } catch {
    // malformed token — middleware would normally have caught this, but be safe
  }

  const partnerAppUrl = process.env.PARTNER_APP_URL ?? 'https://partner.litro.pl';

  return (
    <StationManagerDashboard
      locale={locale}
      t={translations[locale]}
      role={role}
      partnerAppUrl={partnerAppUrl}
    />
  );
}
```

### `apps/web/app/api/claim-request/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

function normalizeApiUrl(raw: string | undefined): string {
  const url = raw ?? 'http://localhost:3000';
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}

const API_URL = normalizeApiUrl(process.env.INTERNAL_API_URL);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Forward client IP for rate-limiting (Throttler uses X-Forwarded-For or socket IP)
  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/stations/claim-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  if (res.status === 429) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text }, { status: res.status });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
```

### `apps/web/components/ClaimRequestForm.tsx`

```typescript
'use client';

import { useState } from 'react';

interface FormState {
  stationName: string;
  contactEmail: string;
  message: string;
}

export default function ClaimRequestForm() {
  const [form, setForm] = useState<FormState>({
    stationName: '',
    contactEmail: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/claim-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_name: form.stationName,
          contact_email: form.contactEmail,
          message: form.message || undefined,
        }),
      });

      if (res.status === 429) {
        setError('Zbyt wiele zgłoszeń. Spróbuj ponownie za godzinę.');
        return;
      }
      if (!res.ok) {
        setError('Coś poszło nie tak. Spróbuj ponownie lub napisz na support@litro.pl.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Brak połączenia. Sprawdź sieć i spróbuj ponownie.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div role="status" className="rounded-lg bg-green-50 border border-green-200 p-6 text-center">
        <h2 className="text-lg font-semibold text-green-800 mb-2">Zgłoszenie wysłane!</h2>
        <p className="text-green-700">
          Otrzymaliśmy Twoje zgłoszenie. Sprawdź email — odezwiemy się wkrótce.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <h1 className="text-2xl font-bold text-gray-900">Zgłoś swoją stację</h1>
      <p className="text-gray-600">
        Wypełnij formularz, a skontaktujemy się z Tobą w ciągu 1-2 dni roboczych.
      </p>

      <div>
        <label htmlFor="stationName" className="block text-sm font-medium text-gray-700 mb-1">
          Nazwa stacji *
        </label>
        <input
          id="stationName"
          type="text"
          required
          minLength={2}
          maxLength={200}
          value={form.stationName}
          onChange={e => setForm(f => ({ ...f, stationName: e.target.value }))}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="np. Orlen ul. Przykładowa 1, Warszawa"
        />
      </div>

      <div>
        <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700 mb-1">
          Twój email *
        </label>
        <input
          id="contactEmail"
          type="email"
          required
          value={form.contactEmail}
          onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="wlasciciel@stacja.pl"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
          Dodatkowe informacje (opcjonalnie)
        </label>
        <textarea
          id="message"
          rows={3}
          maxLength={1000}
          value={form.message}
          onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="Np. mam kilka stacji, pytanie o integrację..."
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Wysyłanie...' : 'Wyślij zgłoszenie'}
      </button>
    </form>
  );
}
```

### `apps/web/components/StationList.tsx`

```typescript
import type { ManagedStationDto } from '../lib/types';

interface Props {
  stations: ManagedStationDto[];
  partnerAppUrl: string;
  t: {
    openPortal: string;
    lastUpdate: string;
    submissionsLast7Days: string;
    noLastUpdate: string;
    noStations: string;
  };
}

export default function StationList({ stations, partnerAppUrl, t }: Props) {
  if (stations.length === 0) {
    return (
      <p className="text-gray-500 text-sm">{t.noStations}</p>
    );
  }

  return (
    <ul className="space-y-4">
      {stations.map(station => (
        <li
          key={station.id}
          className="rounded-lg border border-gray-200 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-semibold text-gray-900">{station.name}</p>
            {station.brand && (
              <p className="text-xs text-gray-500 uppercase tracking-wide">{station.brand}</p>
            )}
            {station.address && (
              <p className="text-sm text-gray-600">{station.address}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {t.lastUpdate}:{' '}
              {station.lastPriceUpdate
                ? new Date(station.lastPriceUpdate).toLocaleDateString('pl-PL')
                : t.noLastUpdate}
              {' · '}
              {t.submissionsLast7Days}: {station.submissionsLast7Days}
            </p>
          </div>
          <a
            href={`${partnerAppUrl}/station/${station.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors text-center"
          >
            {t.openPortal}
          </a>
        </li>
      ))}
    </ul>
  );
}
```

Add `ManagedStationDto` to `apps/web/lib/types.ts` (or create the file if it doesn't exist):

```typescript
// apps/web/lib/types.ts — add or create
export interface ManagedStationDto {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  lastPriceUpdate: string | null;
  submissionsLast7Days: number;
}
```

### `apps/web/components/pages/StationManagerDashboard.tsx`

```typescript
import type { Locale, Translations } from '../../lib/i18n';
import type { ManagedStationDto } from '../../lib/types';
import StationList from '../StationList';

interface Props {
  locale: Locale;
  t: Translations;
  role: string | null;
  partnerAppUrl: string;
}

async function fetchManagedStations(
  token: string,
): Promise<ManagedStationDto[]> {
  // This component is rendered server-side; token forwarded from cookie
  const API_URL = (() => {
    const raw = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  })();

  try {
    const res = await fetch(`${API_URL}/v1/me/stations`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return res.json() as Promise<ManagedStationDto[]>;
  } catch {
    return [];
  }
}
```

**Note:** `StationManagerDashboard` must be an async Server Component that receives `token` as a prop from `konto/page.tsx`, which reads it from the cookie server-side. Pass `token` down to this component so it can call the API.

Revise the component signature to accept `token: string`:

```typescript
// Full component (async Server Component):
export default async function StationManagerDashboard({ locale, t, role, partnerAppUrl, token }: Props & { token: string }) {
  const sm = t.stationManager;

  if (role !== 'STATION_MANAGER') {
    return (
      <main className="min-h-screen bg-white px-4 py-12 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{sm.notAManager}</h1>
        <p className="text-gray-600 mb-6">{sm.notAManagerBody}</p>
        <a
          href="/dla-stacji/zglos"
          className="inline-block rounded-md bg-orange-500 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          {sm.claimCta}
        </a>
      </main>
    );
  }

  const stations = await fetchManagedStations(token);

  return (
    <main className="min-h-screen bg-white px-4 py-12 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{sm.dashboardTitle}</h1>
      <p className="text-gray-600 mb-8">{sm.dashboardSubtitle}</p>
      <StationList
        stations={stations}
        partnerAppUrl={partnerAppUrl}
        t={{
          openPortal: sm.openPortal,
          lastUpdate: sm.lastUpdate,
          submissionsLast7Days: sm.submissionsLast7Days,
          noLastUpdate: sm.noLastUpdate,
          noStations: sm.noStations,
        }}
      />
    </main>
  );
}
```

Update `konto/page.tsx` to pass `token` prop down to `StationManagerDashboard`.

### `apps/web/components/pages/StationLandingPageContent.tsx`

Server Component. Renders: hero, how-it-works, benefits, CTA, FAQ. All text from `t.stationManager.*`.

```typescript
import type { Locale, Translations } from '../../lib/i18n';

interface Props {
  locale: Locale;
  t: Translations;
}

const FAQ_KEYS = ['faq1Q', 'faq1A', 'faq2Q', 'faq2A', 'faq3Q', 'faq3A', 'faq4Q', 'faq4A'] as const;

export default function StationLandingPageContent({ t }: Props) {
  const sm = t.stationManager;

  return (
    <main className="bg-white">
      {/* Hero */}
      <section className="bg-orange-50 px-4 py-20 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{sm.heroTitle}</h1>
        <p className="text-lg text-gray-600 max-w-xl mx-auto mb-8">{sm.heroSub}</p>
        <a
          href="/dla-stacji/zglos"
          className="inline-block rounded-md bg-orange-500 px-6 py-3 text-base font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          {sm.heroCta}
        </a>
      </section>

      {/* How it works */}
      <section className="px-4 py-16 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">{sm.howTitle}</h2>
        <ol className="grid gap-8 sm:grid-cols-3">
          {([1, 2, 3] as const).map(n => (
            <li key={n} className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600 font-bold text-lg">
                {n}
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">
                {sm[`step${n}Title` as keyof typeof sm]}
              </h3>
              <p className="text-sm text-gray-600">{sm[`step${n}Body` as keyof typeof sm]}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Benefits */}
      <section className="bg-gray-50 px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">{sm.benefitsTitle}</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {(['benefit1', 'benefit2', 'benefit3', 'benefit4'] as const).map(k => (
              <div key={k} className="rounded-lg bg-white border border-gray-200 p-5">
                <p className="text-gray-800">{sm[k as keyof typeof sm]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">{sm.ctaBannerTitle}</h2>
        <p className="text-gray-600 mb-6">{sm.ctaBannerSub}</p>
        <a
          href="/dla-stacji/zglos"
          className="inline-block rounded-md bg-orange-500 px-6 py-3 text-base font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          {sm.heroCta}
        </a>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 px-4 py-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">{sm.faqTitle}</h2>
          <dl className="space-y-6">
            {[1, 2, 3, 4].map(n => (
              <div key={n}>
                <dt className="font-semibold text-gray-900">{sm[`faq${n}Q` as keyof typeof sm]}</dt>
                <dd className="mt-1 text-sm text-gray-600">{sm[`faq${n}A` as keyof typeof sm]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
```

### Middleware update (`apps/web/middleware.ts`)

Web-6 introduces `apps/web/middleware.ts` with a `PROTECTED_PATHS` set or array. Web-9 adds `/dla-stacji/konto` to it. The redirect target is `/logowanie` with a `redirect` query param.

Since `apps/web/middleware.ts` does not yet exist (web-6 is backlog), web-9 must also create it if web-6 has not shipped. The middleware pattern mirrors `apps/partner/middleware.ts` from Story 7.1, using `web_token` cookie instead of `partner_token`.

```typescript
// apps/web/middleware.ts (create if not exists; extend if web-6 shipped it)
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = new Set([
  '/dla-stacji/konto',
  // web-6 will add /konto here
  // web-7 will add /flota here
]);

interface TokenClaims {
  role?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): TokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as TokenClaims;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!PROTECTED_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get('web_token')?.value;
  if (!token) {
    const loginUrl = new URL('/logowanie', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const claims = decodeJwtPayload(token);
  if (!claims) {
    const res = NextResponse.redirect(new URL('/logowanie', req.url));
    res.cookies.delete('web_token');
    return res;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    const res = NextResponse.redirect(new URL('/logowanie', req.url));
    res.cookies.delete('web_token');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
```

### i18n additions to `lib/i18n.ts`

Add `stationManager` section to `Translations` interface:

```typescript
stationManager: {
  // Landing page
  heroTitle: string;         // "Jesteś właścicielem stacji? Dołącz do Litro"
  heroSub: string;           // "Docieraj do tysięcy kierowców..."
  heroCta: string;           // "Zgłoś swoją stację"
  howTitle: string;          // "Jak to działa?"
  step1Title: string;        // "Zgłoś stację"
  step1Body: string;
  step2Title: string;        // "Zweryfikuj własność"
  step2Body: string;
  step3Title: string;        // "Zarządzaj cenami"
  step3Body: string;
  benefitsTitle: string;     // "Co zyskujesz?"
  benefit1: string;
  benefit2: string;
  benefit3: string;
  benefit4: string;
  ctaBannerTitle: string;
  ctaBannerSub: string;
  faqTitle: string;          // "Często zadawane pytania"
  faq1Q: string;
  faq1A: string;
  faq2Q: string;
  faq2A: string;
  faq3Q: string;
  faq3A: string;
  faq4Q: string;
  faq4A: string;
  // Dashboard
  dashboardTitle: string;    // "Moje stacje"
  dashboardSubtitle: string;
  openPortal: string;        // "Otwórz Portal Partnera"
  lastUpdate: string;        // "Ostatnia aktualizacja ceny"
  noLastUpdate: string;      // "brak danych"
  submissionsLast7Days: string; // "Zgłoszenia (7 dni)"
  noStations: string;        // "Brak przypisanych stacji..."
  notAManager: string;       // "Nie zarządzasz jeszcze żadną stacją"
  notAManagerBody: string;
  claimCta: string;          // "Zgłoś swoją stację"
};
```

Polish values:

```typescript
stationManager: {
  heroTitle: 'Jesteś właścicielem stacji? Dołącz do Litro',
  heroSub: 'Docieraj do tysięcy kierowców szukających paliwa w Twojej okolicy. Bezpłatnie.',
  heroCta: 'Zgłoś swoją stację',
  howTitle: 'Jak to działa?',
  step1Title: 'Zgłoś stację',
  step1Body: 'Wypełnij krótki formularz z nazwą stacji i swoim emailem.',
  step2Title: 'Zweryfikuj własność',
  step2Body: 'Potwierdzimy, że jesteś właścicielem lub operatorem — przez Google Business lub email firmowy.',
  step3Title: 'Zarządzaj i analizuj',
  step3Body: 'Aktualizuj ceny, przeglądaj statystyki i odpowiadaj na potrzeby kierowców.',
  benefitsTitle: 'Co zyskujesz?',
  benefit1: 'Widoczność dla tysięcy kierowców szukających paliwa na mapie Litro — bezpłatnie.',
  benefit2: 'Statystyki: ile razy Twoja stacja wyświetliła się w wynikach i ile cen zgłosili kierowcy.',
  benefit3: 'Możliwość samodzielnej aktualizacji cen, zamiast polegać wyłącznie na danych od użytkowników.',
  benefit4: 'Plan Premium (wkrótce): wyróżnienie na mapie, reklama kierowana, eksport danych.',
  ctaBannerTitle: 'Gotowy, żeby dołączyć?',
  ctaBannerSub: 'Rejestracja zajmuje 2 minuty. Weryfikacja zwykle do 24 godzin.',
  faqTitle: 'Często zadawane pytania',
  faq1Q: 'Czy dodanie stacji jest bezpłatne?',
  faq1A: 'Tak. Plan podstawowy jest i będzie bezpłatny. Plan Premium z dodatkowymi funkcjami jest opcjonalny.',
  faq2Q: 'Jak weryfikujecie własność stacji?',
  faq2A: 'Weryfikujemy przez Google Business Profile lub domenę emaila firmowego. W trudniejszych przypadkach nasz zespół kontaktuje się bezpośrednio.',
  faq3Q: 'Ile czasu trwa weryfikacja?',
  faq3A: 'Weryfikacja automatyczna (Google Business / email firmowy) trwa kilka minut. Weryfikacja manualna — do 48 godzin w dni robocze.',
  faq4Q: 'Co mogę zarządzać po weryfikacji?',
  faq4A: 'Przez Portal Partnera możesz aktualizować ceny paliw, godziny otwarcia, dodawać zdjęcia i przeglądać statystyki wyświetleń.',
  // Dashboard
  dashboardTitle: 'Moje stacje',
  dashboardSubtitle: 'Stacje, które zarządzasz przez Litro. Pełne zarządzanie dostępne w Portalu Partnera.',
  openPortal: 'Otwórz Portal Partnera',
  lastUpdate: 'Ostatnia aktualizacja ceny',
  noLastUpdate: 'brak danych',
  submissionsLast7Days: 'Zgłoszenia (7 dni)',
  noStations: 'Brak przypisanych stacji. Skontaktuj się z support@litro.pl jeśli uważasz, że to błąd.',
  notAManager: 'Nie zarządzasz jeszcze żadną stacją',
  notAManagerBody: 'Zarejestruj swoją stację w programie partnerskim Litro i zacznij docierać do kierowców.',
  claimCta: 'Zgłoś swoją stację',
},
```

English and Ukrainian translations follow the same structure (content translated appropriately).

### `apps/web/.env.example` addition

```
# Partner portal URL — used in /dla-stacji/konto to link station managers to the full portal
# Dev: http://localhost:3004 (apps/partner runs on port 3004)
# Prod: https://partner.litro.pl (or equivalent)
PARTNER_APP_URL=http://localhost:3004
```

---

## File List

**New (API):**
- `apps/api/src/station/dto/create-claim-request.dto.ts` — DTO for POST /v1/stations/claim-request
- `apps/api/src/station/station.controller.spec.ts` — add tests for `createClaimRequest` endpoint (extend existing file)
- `apps/api/src/user/dto/managed-station.dto.ts` — response DTO for GET /v1/me/stations

**Modified (API):**
- `apps/api/src/station/station.controller.ts` — add `POST claim-request` with `@Throttle` + `@Public()`
- `apps/api/src/station/station.service.ts` — add `createClaimRequest()`, inject `ConfigService`, add `Logger`
- `apps/api/src/user/user.controller.ts` — add `GET /v1/me/stations` with `@Roles(UserRole.STATION_MANAGER)`
- `apps/api/src/user/user.service.ts` — add `getManagedStations()`

**New (Web):**
- `apps/web/app/dla-stacji/page.tsx` — PL marketing landing (Server Component, public)
- `apps/web/app/dla-stacji/zglos/page.tsx` — claim initiation shell (Server Component, public)
- `apps/web/app/dla-stacji/konto/page.tsx` — station manager dashboard (Server Component, auth-gated)
- `apps/web/app/en/for-stations/page.tsx` — EN landing shell
- `apps/web/app/uk/for-stations/page.tsx` — UK landing shell
- `apps/web/app/api/claim-request/route.ts` — POST proxy to /v1/stations/claim-request
- `apps/web/components/ClaimRequestForm.tsx` — Client Component form
- `apps/web/components/StationList.tsx` — managed station list
- `apps/web/components/pages/StationLandingPageContent.tsx` — Server Component landing content
- `apps/web/components/pages/StationManagerDashboard.tsx` — Server Component dashboard
- `apps/web/lib/types.ts` — shared TS interfaces (ManagedStationDto); create if not exists

**Modified (Web):**
- `apps/web/lib/i18n.ts` — add `stationManager` key to `Translations` interface + all 3 locale objects
- `apps/web/.env.example` — add `PARTNER_APP_URL`
- `apps/web/middleware.ts` — create (or extend if web-6 shipped it) with `/dla-stacji/konto` in PROTECTED_PATHS

---

## Dev Guardrails

- **`@Public()` import:** `import { Public } from '../auth/decorators/public.decorator.js'` — same as `StationController.getNearby`.
- **`@Throttle` import:** `import { Throttle } from '@nestjs/throttler'` — same pattern as `UserController.requestDataExport`.
- **`@Roles` import:** `import { Roles } from '../auth/decorators/roles.decorator.js'` — same as `UserController`.
- **`ConfigService` in `StationService`:** Add to constructor as second parameter after `PrismaService`. `ConfigModule` is already global in `AppModule` — no module import needed, just inject in constructor.
- **`StationClaim` model dependency:** `getManagedStations` uses `prisma.stationClaim` which only exists after Story 7.1 (`add_station_claim` migration). Do not merge web-9 to production before that migration is applied. If you must deploy earlier, wrap the `stationClaim.findMany` in a try/catch and return `[]` on error.
- **`price` model in `getManagedStations`:** Uses `prisma.price` with `distinct` and `orderBy`. Verify the `Price` model's field name for `updated_at` in `schema.prisma` before implementing — it may be `updated_at` or `reported_at`. Adjust accordingly.
- **Server Component API calls:** Use `INTERNAL_API_URL` (not `NEXT_PUBLIC_API_URL`) for server-side fetches — same as `lib/api.ts`. Apply the same `normalizeApiUrl()` helper.
- **`web_token` cookie name:** Must match whatever name web-6 uses. If web-6 has not shipped and the cookie name is not yet decided, use `web_token` as defined here. Coordinate with web-6 implementor.
- **Middleware `matcher`:** Exclude `/api/` paths from middleware so the `claim-request` route handler is not intercepted by auth checks.
- **Base64url decoding:** `Buffer.from(part, 'base64url')` works in Node.js 18+. Do NOT use `atob()` in Server Components (Node environment) — use `Buffer`.
- **Email `from` field:** Use `noreply@litro.pl` consistent with `user.service.ts` pattern (`noreply@desert.app`). Align with whatever the verified sending domain is in Resend — check `RESEND_FROM_EMAIL` env var pattern or hardcode to match existing services.
- **`OPS_EMAIL` env var:** Add to `apps/api/.env.example` as well — document it as "email address for ops notifications".
- **Locale shells for EN/UK:** Follow exact same pattern as `apps/web/app/en/about/page.tsx` — thin shell that passes locale and translations to the same `StationLandingPageContent` component. No logic duplication.

---

## Testing Requirements

**`station.controller.spec.ts` — additions:**
- `POST /v1/stations/claim-request` is `@Public()` — verify via Reflector (same pattern as existing `@Public()` test in the file).
- `POST /v1/stations/claim-request` calls `stationService.createClaimRequest()` with the DTO body.
- `POST /v1/stations/claim-request` returns `{ success: true }` with HTTP 201.
- `POST /v1/stations/claim-request` has `@Throttle({ default: { limit: 3, ttl: 3600 } })` — verify via Reflector metadata key `throttler:options`.

**`user.controller.spec.ts` — additions (extend existing or create):**
- `GET /v1/me/stations` requires `@Roles(UserRole.STATION_MANAGER)` — verify via Reflector.
- `GET /v1/me/stations` returns array from `userService.getManagedStations()`.
- `GET /v1/me/stations` returns `[]` when service returns empty array.

No unit tests required for Next.js page components or the route handler — integration tested implicitly via page rendering and E2E.

---

## Dev Agent Record

**Completion Notes**

*(To be filled in by the implementing agent)*

**Deferred**

*(To be filled in during code review)*

---

## Change Log

- 2026-04-08: Story created — full spec written from web-9 stub in web-stories.md
