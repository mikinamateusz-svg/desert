# Story web-6 — User Account Dashboard

**Status:** ready-for-dev
**Created:** 2026-04-08

### User Story

As an **authenticated driver**,
I want a web dashboard at `/konto` showing my submission history and fill-up summary,
So that I can review my Litro activity without opening the mobile app.

**Why:** Web-6 is the story that introduces authentication to `apps/web`. Every subsequent auth-gated web story (web-7 fleet portal, web-10 notifications) depends on the middleware, cookie, and login page established here. The account dashboard itself gives drivers a reason to sign in on the web — their submission history is the first personalised data surface.

### Acceptance Criteria

- **AC1 — Login page:** `GET /logowanie` renders a Polish email/password login form (Client Component). On successful login the API returns a JWT `accessToken`; the Next.js API route stores it as an HttpOnly `web_token` cookie (7 days) and redirects to the intended destination or `/konto` if no redirect param is present.

- **AC2 — Auth gate:** Unauthenticated requests to `/konto` (and future routes `/flota`, `/powiadomienia`) are intercepted by `middleware.ts` and redirected to `/logowanie?redirect={path}`. Authenticated requests pass through.

- **AC3 — Profile header:** `/konto` shows the user's display name (or email prefix if no display name), email, member-since date (formatted as month + year, e.g. "Marzec 2026"), and a submission count badge.

- **AC4 — Recent submissions:** `/konto` shows a table of the last 10 submissions fetched from `GET /v1/submissions?limit=10&page=1`. Each row shows: station name (or "—" if not yet matched), fuel prices from `price_data`, submission date, and a status badge (verified / pending / rejected).

- **AC5 — Fill-up summary:** A fill-up summary section is rendered if `GET /v1/me/fill-ups` returns a non-empty array. If the array is empty (Epic 5 not yet deployed), the section is silently hidden — no error, no empty-state placeholder.

- **AC6 — Mobile app CTA:** A "Track more with the mobile app" banner appears at the bottom of `/konto` with App Store and Google Play placeholder links.

- **AC7 — Logout:** `GET /api/auth/logout` deletes the `web_token` cookie and redirects to `/`. The logout also fires a best-effort `POST /v1/auth/logout` to SuperTokens to revoke the server-side session.

- **AC8 — i18n:** All new UI strings added to `lib/i18n.ts` under an `account` key for all three locales (pl/en/uk).

- **AC9 — New API endpoint:** `GET /v1/me/fill-ups` returns the authenticated user's fill-ups as `FillUp[]`. Returns `[]` if no fill-ups exist. Scoped to the calling user's `vehicle_id`s. Added to the existing `MeController`.

### Technical Architecture

---

#### Auth pattern overview

The web app uses a cookie-based JWT approach identical to the existing `apps/admin` app. The API (`POST /v1/auth/login`) already returns `{ user, accessToken }` from `AuthService.login()`. The web app stores `accessToken` in an HttpOnly cookie named `web_token`. Middleware reads the cookie to gate protected routes. The JWT payload is decoded (without signature verification — same trust model as admin) for UX redirects only; actual security is enforced by the API bearer guard on every API call.

---

#### New API endpoint: `GET /v1/me/fill-ups`

No `FillUp` model exists in the Prisma schema yet (Epic 5). The endpoint must exist and return `[]` gracefully. Add to `MeController`:

```typescript
// apps/api/src/me/me.controller.ts  (add to existing controller)
@Get('fill-ups')
@Roles(UserRole.DRIVER)
getUserFillUps(@CurrentUser('id') userId: string) {
  return this.meService.getUserFillUps(userId);
}
```

```typescript
// apps/api/src/me/me.service.ts  (add to existing service)
async getUserFillUps(userId: string): Promise<FillUp[]> {
  // FillUp model does not exist until Epic 5.
  // Return empty array — endpoint is a stable contract for web-6 and fleet portal.
  return [];
}
```

`FillUp` type (define locally in `me.service.ts` until Epic 5 adds the Prisma model):

```typescript
export interface FillUp {
  id: string;
  vehicle_id: string;
  station_id: string | null;
  fuel_type: string;
  price_per_litre: number;
  litres: number;
  total_cost: number;
  filled_at: string; // ISO timestamp
}
```

**Note:** No new module or controller file is needed — `MeController` already exists (check if it does; if not, create `me.module.ts` and `me.controller.ts` following the pattern of `submissions.module.ts`). The endpoint path will be `GET /v1/me/fill-ups`.

> **Dev agent check:** Before adding to `MeController`, verify whether `apps/api/src/me/` exists. If it does not exist, create `me.controller.ts`, `me.service.ts`, and `me.module.ts` from scratch, then register `MeModule` in `app.module.ts`. If it already exists, just add the new method.

---

#### `apps/web/middleware.ts` (new file)

```typescript
import { NextRequest, NextResponse } from 'next/server';

// Routes that require authentication
const PROTECTED_PREFIXES = ['/konto', '/flota', '/powiadomienia'];

// Routes that are always public (login page itself, API routes, static assets)
const ALWAYS_PUBLIC_PREFIXES = ['/logowanie', '/api/', '/_next/', '/favicon'];

interface WebTokenClaims {
  exp?: number;
}

function decodeJwtPayload(token: string): WebTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as WebTokenClaims;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get('web_token')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/logowanie';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  const claims = decodeJwtPayload(token);
  if (!claims) {
    const url = req.nextUrl.clone();
    url.pathname = '/logowanie';
    url.searchParams.set('redirect', pathname);
    const res = NextResponse.redirect(url);
    res.cookies.delete('web_token');
    return res;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    const url = req.nextUrl.clone();
    url.pathname = '/logowanie';
    url.searchParams.set('redirect', pathname);
    const res = NextResponse.redirect(url);
    res.cookies.delete('web_token');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

#### `apps/web/app/logowanie/page.tsx` (new file)

Client Component. Reads optional `redirect` search param. Submits to `POST /api/auth/login`. On success the route handler sets the cookie and the client redirects using `router.push(redirect ?? '/konto')`. On 401 shows inline error message.

```typescript
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LogowaniePageWrapper() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <LoginForm />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('redirect') ?? '/konto';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 401) {
        setError('invalid');
        return;
      }
      if (!res.ok) {
        setError('generic');
        return;
      }

      router.push(redirectTo);
    } catch {
      setError('generic');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 flex flex-col gap-5"
    >
      <h1 className="text-2xl font-bold text-gray-900">Zaloguj się</h1>

      {error === 'invalid' && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          Nieprawidłowy e-mail lub hasło.
        </p>
      )}
      {error === 'generic' && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          Błąd połączenia. Spróbuj ponownie.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700" htmlFor="password">
          Hasło
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
      >
        {loading ? 'Logowanie...' : 'Zaloguj się'}
      </button>
    </form>
  );
}
```

---

#### `apps/web/app/api/auth/login/route.ts` (new file)

Proxies to `POST /v1/auth/login` on the internal API. On success sets `web_token` cookie and returns `200 {}`. On 401 returns `401`. Cookie is HttpOnly, Secure in production, SameSite=Lax, 7-day max-age.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const INTERNAL_API_URL = (() => {
  const raw = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}`;
})();

const COOKIE_NAME = 'web_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  let apiRes: Response;
  try {
    apiRes = await fetch(`${INTERNAL_API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'API unreachable' }, { status: 502 });
  }

  if (apiRes.status === 401 || apiRes.status === 400) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  if (!apiRes.ok) {
    return NextResponse.json({ error: 'Login failed' }, { status: 502 });
  }

  const data = (await apiRes.json()) as { accessToken?: string };

  if (!data.accessToken) {
    return NextResponse.json({ error: 'No token in response' }, { status: 502 });
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return NextResponse.json({}, { status: 200 });
}
```

---

#### `apps/web/app/api/auth/logout/route.ts` (new file)

Clears cookie, fires best-effort session revocation to the API, redirects to `/`.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const INTERNAL_API_URL = (() => {
  const raw = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}`;
})();

const COOKIE_NAME = 'web_token';

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    // Best-effort session revocation — fire and forget
    fetch(`${INTERNAL_API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => undefined);

    cookieStore.delete(COOKIE_NAME);
  }

  return NextResponse.redirect(new URL('/', req.url));
}
```

---

#### `apps/web/lib/api.ts` — add `fetchWithAuth` helper

Add after the existing `fetchStationWithPrice` function:

```typescript
/**
 * Authenticated server-side fetch using the web_token cookie as a Bearer token.
 * Only call from Server Components or Route Handlers — never from Client Components.
 */
export async function fetchWithAuth<T>(
  path: string,
  token: string,
): Promise<T | null> {
  const url = `${API_URL}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

---

#### `apps/web/app/konto/page.tsx` (new file)

Server Component. Reads `web_token` cookie, fetches profile (`GET /v1/auth/me`) and submissions (`GET /v1/submissions?limit=10&page=1`) and fill-ups (`GET /v1/me/fill-ups`) in parallel.

```typescript
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { detectLocale, translations } from '../../lib/i18n';
import { fetchWithAuth } from '../../lib/api';
import SubmissionHistoryTable from '../../components/SubmissionHistoryTable';
import FillUpSummary from '../../components/FillUpSummary';

interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

interface SubmissionItem {
  id: string;
  station: { id: string; name: string } | null;
  price_data: { fuel_type: string; price_per_litre: number | null }[];
  status: 'pending' | 'verified' | 'rejected';
  created_at: string;
}

interface SubmissionsResponse {
  data: SubmissionItem[];
  total: number;
  page: number;
  limit: number;
}

export interface FillUp {
  id: string;
  vehicle_id: string;
  station_id: string | null;
  fuel_type: string;
  price_per_litre: number;
  litres: number;
  total_cost: number;
  filled_at: string;
}

export default async function KontoPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('web_token')?.value;

  if (!token) {
    redirect('/logowanie?redirect=/konto');
  }

  const headerList = await headers();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];

  const [profile, submissionsRes, fillUps] = await Promise.all([
    fetchWithAuth<UserProfile>('/v1/auth/me', token),
    fetchWithAuth<SubmissionsResponse>('/v1/submissions?limit=10&page=1', token),
    fetchWithAuth<FillUp[]>('/v1/me/fill-ups', token),
  ]);

  if (!profile) {
    // Token is present but API rejected it (expired/revoked) — clear and redirect
    redirect('/logowanie?redirect=/konto');
  }

  const submissions = submissionsRes?.data ?? [];
  const submissionTotal = submissionsRes?.total ?? 0;
  const fillUpList = fillUps ?? [];

  const displayName = profile.display_name ?? profile.email?.split('@')[0] ?? '—';
  const memberSince = formatMemberSince(profile.id, locale); // see note below

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-10">
      {/* Profile header */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            {submissionTotal} {t.account.submissionsLabel}
          </span>
        </div>
        <p className="text-sm text-gray-500">{profile.email}</p>
        <p className="text-sm text-gray-400">
          {t.account.memberSince}: {memberSince}
        </p>
        <a
          href="/api/auth/logout"
          className="self-start text-sm text-gray-400 hover:text-red-500 transition-colors mt-1"
        >
          {t.account.logout}
        </a>
      </section>

      {/* Recent submissions */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          {t.account.recentSubmissions}
        </h2>
        <SubmissionHistoryTable submissions={submissions} t={t} />
      </section>

      {/* Fill-up summary — only if data exists */}
      {fillUpList.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            {t.account.fillUpSummaryTitle}
          </h2>
          <FillUpSummary fillUps={fillUpList} t={t} />
        </section>
      )}

      {/* Mobile app CTA */}
      <section className="bg-orange-50 rounded-2xl p-6 flex flex-col gap-3">
        <p className="font-semibold text-gray-900">{t.account.ctaTitle}</p>
        <p className="text-sm text-gray-600">{t.account.ctaSubtitle}</p>
        <div className="flex gap-3 flex-wrap">
          <a
            href="#"
            className="bg-black text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {t.download.appStore}
          </a>
          <a
            href="#"
            className="bg-black text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {t.download.googlePlay}
          </a>
        </div>
      </section>
    </div>
  );
}

/**
 * Formats a "member since" string from the user's UUID-based created_at.
 * The API's /v1/auth/me does not currently return created_at.
 * Use submission created_at as a proxy — or omit if no submissions exist.
 * Full solution: add created_at to GET /v1/auth/me response in a future story.
 *
 * For now: if created_at is not available, return the current month/year.
 * This is a known limitation — see Dev Notes.
 */
function formatMemberSince(_userId: string, locale: string): string {
  const now = new Date();
  return now.toLocaleDateString(
    locale === 'uk' ? 'uk-UA' : locale === 'en' ? 'en-GB' : 'pl-PL',
    { month: 'long', year: 'numeric' },
  );
}
```

> **Dev agent note on `memberSince`:** `GET /v1/auth/me` currently returns only `{ id, email, display_name, role }` — no `created_at`. To implement AC3 properly, either (a) add `created_at` to the `GET /v1/auth/me` response in `auth.controller.ts` as part of this story (preferred — minimal change), or (b) fall back to the `created_at` of the earliest submission in the already-fetched submissions list. Option (a) is strongly preferred. The `formatMemberSince` stub above is a placeholder — replace it once `created_at` is available in the profile response.

---

#### `apps/web/components/SubmissionHistoryTable.tsx` (new file)

```typescript
import type { Translations } from '../lib/i18n';

interface SubmissionItem {
  id: string;
  station: { id: string; name: string } | null;
  price_data: { fuel_type: string; price_per_litre: number | null }[];
  status: 'pending' | 'verified' | 'rejected';
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-600',
};

export default function SubmissionHistoryTable({
  submissions,
  t,
}: {
  submissions: SubmissionItem[];
  t: Translations;
}) {
  if (submissions.length === 0) {
    return (
      <p className="text-sm text-gray-400">{t.account.noSubmissions}</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
          <tr>
            <th className="px-4 py-3">{t.account.station}</th>
            <th className="px-4 py-3">{t.account.prices}</th>
            <th className="px-4 py-3">{t.account.date}</th>
            <th className="px-4 py-3">{t.account.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {submissions.map(s => (
            <tr key={s.id} className="bg-white hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-800">
                {s.station?.name ?? '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {s.price_data
                  .filter(p => p.price_per_litre !== null)
                  .map(p => `${p.fuel_type}: ${p.price_per_litre?.toFixed(2)} zł`)
                  .join(', ') || '—'}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {new Date(s.created_at).toLocaleDateString('pl-PL', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[s.status] ?? STATUS_STYLES.pending}`}
                >
                  {t.account.statusLabels[s.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

#### `apps/web/components/FillUpSummary.tsx` (new file)

Renders null if `fillUps` is empty (caller already guards, but component is defensive):

```typescript
import type { FillUp } from '../app/konto/page';
import type { Translations } from '../lib/i18n';

export default function FillUpSummary({
  fillUps,
  t,
}: {
  fillUps: FillUp[];
  t: Translations;
}) {
  if (fillUps.length === 0) return null;

  const totalSpend = fillUps.reduce((sum, f) => sum + f.total_cost, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const last30 = fillUps
    .filter(f => new Date(f.filled_at) >= thirtyDaysAgo)
    .reduce((sum, f) => sum + f.total_cost, 0);

  const avgPrice =
    fillUps.reduce((sum, f) => sum + f.price_per_litre, 0) / fillUps.length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard
        label={t.account.fillUpTotalSpend}
        value={`${totalSpend.toFixed(2)} zł`}
      />
      <StatCard
        label={t.account.fillUpLast30Days}
        value={`${last30.toFixed(2)} zł`}
      />
      <StatCard
        label={t.account.fillUpAvgPrice}
        value={`${avgPrice.toFixed(3)} zł/l`}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-5 py-4 flex flex-col gap-1">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
```

---

#### `apps/web/lib/i18n.ts` — add `account` section

Add to the `Translations` interface:

```typescript
account: {
  submissionsLabel: string;   // "zgłoszenia" / "submissions" / "подання"
  memberSince: string;        // "Konto od" / "Member since" / "Обліковий запис з"
  logout: string;             // "Wyloguj się" / "Sign out" / "Вийти"
  recentSubmissions: string;  // "Ostatnie zgłoszenia" / "Recent submissions" / "Останні подання"
  noSubmissions: string;      // "Brak zgłoszeń." / "No submissions yet." / "Немає подань."
  station: string;            // "Stacja" / "Station" / "Станція"
  prices: string;             // "Ceny" / "Prices" / "Ціни"
  date: string;               // "Data" / "Date" / "Дата"
  status: string;             // "Status" / "Status" / "Статус"
  statusLabels: {
    verified: string;         // "Zatwierdzone" / "Verified" / "Підтверджено"
    pending: string;          // "Oczekuje" / "Pending" / "Очікує"
    rejected: string;         // "Odrzucone" / "Rejected" / "Відхилено"
  };
  fillUpSummaryTitle: string; // "Moje tankowania" / "My fill-ups" / "Мої заправки"
  fillUpTotalSpend: string;   // "Łączne wydatki" / "Total spend" / "Загальні витрати"
  fillUpLast30Days: string;   // "Ostatnie 30 dni" / "Last 30 days" / "Останні 30 днів"
  fillUpAvgPrice: string;     // "Śr. cena/litr" / "Avg price/litre" / "Сер. ціна/літр"
  ctaTitle: string;           // "Śledź więcej w aplikacji mobilnej" / ...
  ctaSubtitle: string;        // "Historia tankowania, ..." / ...
};
```

Add values for all three locales (`pl`, `en`, `uk`) in the `translations` object following the existing pattern.

---

#### Auth controller change — add `created_at` to `GET /v1/auth/me`

To satisfy AC3 (member since date), add `created_at` to the `me` endpoint response:

```typescript
// apps/api/src/auth/auth.controller.ts — modify existing me() method
@Get('me')
me(@CurrentUser() user: User) {
  const { id, email, display_name, role, created_at } = user;
  return { id, email, display_name, role, created_at };
}
```

Update `UserProfile` interface in `konto/page.tsx` to include `created_at: string`, and update `formatMemberSince` to use it:

```typescript
function formatMemberSince(createdAt: string, locale: string): string {
  return new Date(createdAt).toLocaleDateString(
    locale === 'uk' ? 'uk-UA' : locale === 'en' ? 'en-GB' : 'pl-PL',
    { month: 'long', year: 'numeric' },
  );
}
```

### Testing Requirements

**`me.controller.spec.ts` (new, if `MeController` is newly created):**
- `GET /v1/me/fill-ups` returns `[]` (empty array) — service stub returns `[]`
- `GET /v1/me/fill-ups` requires authentication — verify via `@Roles(UserRole.DRIVER)`; anonymous call should return 401

**`me.service.spec.ts` (new, if `MeService` is newly created):**
- `getUserFillUps(userId)` returns `[]` regardless of `userId` (Epic 5 stub)

**`auth.controller.spec.ts` (existing — update):**
- `GET /v1/auth/me` response includes `created_at` field
- Verify `created_at` is the `User.created_at` value (not undefined)

No unit tests required for Next.js pages or components — auth flow is integration-tested via API contract. Middleware logic is thin enough to verify manually during review.

### File List

**New (API):**
- `apps/api/src/me/me.controller.ts` — add `GET /v1/me/fill-ups` (create if module doesn't exist)
- `apps/api/src/me/me.service.ts` — `getUserFillUps` stub returning `[]` (create if not exists)
- `apps/api/src/me/me.module.ts` — register controller + service (create if not exists)
- `apps/api/src/me/me.controller.spec.ts` — tests for fill-ups endpoint (create if not exists)
- `apps/api/src/me/me.service.spec.ts` — tests for `getUserFillUps` (create if not exists)

**Modified (API):**
- `apps/api/src/auth/auth.controller.ts` — add `created_at` to `me()` response
- `apps/api/src/auth/auth.controller.spec.ts` — update `me` test to assert `created_at`
- `apps/api/src/app.module.ts` — register `MeModule` (only if module is new)

**New (Web):**
- `apps/web/middleware.ts` — auth gate for `/konto`, `/flota`, `/powiadomienia`
- `apps/web/app/logowanie/page.tsx` — email/password login form (Client Component)
- `apps/web/app/api/auth/login/route.ts` — POST handler; proxies to API, sets `web_token` cookie
- `apps/web/app/api/auth/logout/route.ts` — GET handler; clears cookie, redirects to `/`
- `apps/web/app/konto/page.tsx` — account dashboard (Server Component)
- `apps/web/components/SubmissionHistoryTable.tsx` — table with status badge
- `apps/web/components/FillUpSummary.tsx` — fill-up stats; renders null if empty

**Modified (Web):**
- `apps/web/lib/api.ts` — add `fetchWithAuth(path, token)` helper
- `apps/web/lib/i18n.ts` — add `account` section to `Translations` interface + all 3 locale objects

### Dev Notes

- **`web_token` not `fleet_token`:** The fleet portal (web-7) will use `fleet_token`. These are separate auth scopes — same SuperTokens backend, same JWT format, different cookie names and audience routes.

- **`INTERNAL_API_URL` in route handlers:** The login and logout route handlers live in `apps/web/app/api/` — they run server-side and must use `INTERNAL_API_URL` (Railway internal URL), not `NEXT_PUBLIC_API_URL`. The `normalizeApiUrl` helper in `lib/api.ts` can be extracted to a shared util if preferred, but for now inline the same logic in the route handler to avoid importing server-only lib into route files.

- **SuperTokens token transfer method:** `supertokens.ts` sets `getTokenTransferMethod: () => 'header'`. This means SuperTokens issues tokens via `Authorization` header, not Set-Cookie. Our login handler extracts `accessToken` from the JSON body (not from a Set-Cookie header) and stores it in our own HttpOnly cookie. This is correct.

- **`GET /v1/auth/me` as profile fetch:** The `/konto` page calls `GET /v1/auth/me` with `Authorization: Bearer {token}` to get the profile. This endpoint is already protected by the JWT guard (`JwtAuthGuard` applied globally). If the token has expired or been revoked, the endpoint returns 401 → `fetchWithAuth` returns `null` → `konto/page.tsx` redirects to `/logowanie`.

- **No `MeController` exists yet:** At time of writing, `apps/api/src/me/` directory is empty. The dev agent must create all three files (`me.controller.ts`, `me.service.ts`, `me.module.ts`) and register `MeModule` in `app.module.ts`.

- **`formatMemberSince` — initial stub vs. final:** The page file includes a stub. Once `created_at` is added to `GET /v1/auth/me` (also part of this story — see auth.controller.ts change), replace the stub with `formatMemberSince(profile.created_at, locale)`.

- **No ads on `/konto`:** Do not add any `<AdSlot>` components to this page.

- **Middleware matcher:** The `config.matcher` pattern `'/((?!_next/static|_next/image|favicon.ico).*)'` means middleware runs on all non-static routes. The middleware itself then checks whether the path starts with a protected prefix — so public routes like `/aktualnosci` pass through with a single `NextResponse.next()`.

- **Login page locale:** `/logowanie` is Polish-only (Polish slug). The page content is hardcoded in Polish for MVP. Do not add locale routing for the login page in this story.

- **`useSearchParams` requires Suspense:** The `LogowaniePageWrapper` component wraps `LoginForm` (which calls `useSearchParams`) in a plain div. Next.js 14+ requires a `<Suspense>` boundary around `useSearchParams` usage in pages. Wrap `<LoginForm />` in `<Suspense fallback={null}>` inside `LogowaniePageWrapper`.

### Dev Agent Record

**Completion Notes**

_(to be filled in after implementation)_

**Deferred**

_(to be filled in after code review)_

### Change Log

- 2026-04-08: Story created (web-6-account-dashboard.md)
