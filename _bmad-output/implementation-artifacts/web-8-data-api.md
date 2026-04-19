# Story web-8 — Data API & Data Buyer Page

## Metadata

- **Story ID:** web-8
- **Epic:** 10 — Data Licensing & Public Portal
- **Status:** ready-for-dev
- **Created:** 2026-04-08
- **Depends on:** Story 10.2 (`/data` landing page + `/data/signup` + `/data/success` exist; `DataBuyerProfile` model), Story 10.3 (`DataApiKey` model + `DataBuyerKeysService` + buyer key management API endpoints exist), Story web-6 (`web_token` cookie auth pattern + middleware structure established)
- **Required by:** (nothing blocks on web-8; it is a self-contained web layer over already-defined API)

---

## User Story

As a **prospective or active data buyer**,
I want a public API reference page that explains what endpoints I can query and how to authenticate,
And — once I'm an approved buyer — a self-service page where I can create and revoke my own API keys,
So that I can evaluate the API before signing up and manage my access credentials without contacting support.

**Why:** Story 10.2 built the commercial funnel (`/data` landing, application form, Stripe checkout). Story 10.3 defined the actual API. web-8 bridges them: documentation gives buyers confidence before they purchase, and the key management page reduces ops load post-approval. Both pages are part of the `/dane` subtree (Polish-first product, consistent with `/aktualnosci`, `/o-nas`) with a redirect from `/dane` itself to the existing `/data` landing.

---

## Context & Why

The data buyer journey ends today at the `/data/success` confirmation. After ops approves them they receive a key by email, but there is no self-service web page to:

1. Read API documentation (endpoint shapes, query parameters, curl examples).
2. Create additional keys (e.g. separate staging and production keys).
3. Revoke a compromised key without emailing support.

This story adds both surfaces. The docs page (`/dane/dokumentacja`) is fully public — it improves conversion by letting buyers evaluate the API before paying. The key management page (`/dane/klucze`) is auth-gated to DATA_BUYER role only — it reuses the `web_token` cookie established in web-6 and the same middleware pattern used for `/konto`.

### Overlap with Story 10.2

Story 10.2 already owns:
- `/data` — pricing/tier landing page (do **not** rebuild it here)
- `/data/signup` — application form
- `/data/success` — post-checkout confirmation

web-8 adds **only**:
- `/dane` → 301 redirect to `/data` (avoids duplicate landing page in Polish subtree)
- `/dane/dokumentacja` — full public API reference
- `/dane/klucze` — auth-gated key management for DATA_BUYER role

### Route Naming Rationale

`/dane` means "data" in Polish — consistent with `/aktualnosci` (news), `/o-nas` (about). Docs at `/dane/dokumentacja` follows the same naturalisation pattern. The English `/data` subtree is owned by 10.2's Stripe funnel; the Polish subtree (`/dane`) owns documentation and self-service tooling.

---

## Acceptance Criteria

**AC1 — `/dane` redirect:** `GET /dane` returns a 301 permanent redirect to `/data`. No content rendered. Verified by checking `next.config.js` redirects array (preferred over a page.tsx that calls `redirect()`).

**AC2 — Docs page renders all PRICE_DATA endpoints:** `GET /dane/dokumentacja` renders a full-page API reference. All four PRICE_DATA tier endpoints documented with: description, all accepted query parameters (names, types, required/optional), example response shape, and at least one curl example per endpoint:
- `GET /v1/data-api/prices/latest`
- `GET /v1/data-api/prices/history`
- `GET /v1/data-api/prices/aggregated`
- `GET /v1/data-api/stations`

**AC3 — CONSUMPTION_DATA endpoints mentioned with upgrade CTA:** `GET /v1/data-api/consumption/fill-ups` and `GET /v1/data-api/consumption/aggregated` appear in the docs as a gated tier section. Rendered with a visually distinct "locked" treatment (e.g. padlock icon, muted text) and a "Upgrade to Consumption Data tier" CTA linking to `/data`.

**AC4 — Docs page ISR:** `export const revalidate = 86400` in `apps/web/app/dane/dokumentacja/page.tsx`. Page is a Server Component. No client-side fetch required — all content is static strings from i18n.

**AC5 — Docs page SEO:** `generateMetadata()` in docs page exports `title`, `description`, `openGraph.title`, `openGraph.description`, `openGraph.type: 'website'`, `openGraph.url`. Canonical URL is `https://desert.app/dane/dokumentacja`.

**AC6 — `/dane/klucze` redirects unauthenticated visitors:** A visitor with no `web_token` cookie is redirected to `/logowanie?next=/dane/klucze`. Enforced in Next.js middleware (not just in the page component).

**AC7 — `/dane/klucze` rejects non-DATA_BUYER roles:** A user whose decoded `web_token` has a role other than `DATA_BUYER` sees an "Access denied" page with a message "Ta sekcja jest dostępna tylko dla nabywców danych." and a link back to `/data`.

**AC8 — Key list:** `GET /dane/klucze` (Server Component) fetches `GET /v1/data-buyers/me/keys` using the `web_token` cookie as `Authorization: Bearer`. Renders a table showing: key prefix (e.g. `ddk_a1b2c3d4`), label (or "—" if unset), created date, last used date (or "Never" if null). Empty state: "Nie masz jeszcze żadnych kluczy API."

**AC9 — Create key flow:** "Utwórz nowy klucz" button opens `CreateKeyModal`. Modal contains an optional "Label" text input (max 64 chars). On submit, POSTs to `/api/data-keys/create` (Next.js route handler proxy). On success, the modal transitions to a reveal state showing the full key in an amber alert box with: the key text (monospace, selectable), a "Kopiuj" button, and the warning "Ten klucz nie zostanie pokazany ponownie." The modal can only be closed after copying (or by dismissing with an explicit "Zamknij" button). On close, the page refreshes the key list via `router.refresh()`.

**AC10 — Max 5 keys warning:** When `keys.length >= 5`, the "Utwórz nowy klucz" button is disabled and a warning banner reads "Osiągnięto limit 5 aktywnych kluczy. Usuń klucz, aby dodać nowy."

**AC11 — Revoke with confirmation:** Each key row has a "Usuń" button. Clicking it opens a `<dialog>` confirmation with "Usunąć ten klucz? Tej operacji nie można cofnąć." and "Usuń" (destructive) / "Anuluj" buttons. On confirm, sends DELETE to `/api/data-keys/revoke/[keyId]`. On success, calls `router.refresh()`.

**AC12 — i18n strings:** All user-visible strings on both pages are defined in `lib/i18n.ts` under a new `dataApi` key for all three locales (pl/en/uk). No hardcoded Polish-only strings in JSX (except in curl examples which are locale-agnostic).

---

## Technical Architecture

### Route: `/dane` → redirect to `/data`

Add to `next.config.js` (or `next.config.ts`) `redirects` array — do not create a `page.tsx` for `/dane`:

```typescript
// apps/web/next.config.ts  (or next.config.js)
async redirects() {
  return [
    {
      source: '/dane',
      destination: '/data',
      permanent: true,
    },
  ];
},
```

This is preferable to `redirect()` in a Server Component because it is handled at the routing layer (no JS execution, correct HTTP 301 status, Googlebot follows it immediately).

---

### Route: `/dane/dokumentacja` — API Reference Page

**File:** `apps/web/app/dane/dokumentacja/page.tsx`

Server Component with ISR. All content comes from `lib/i18n.ts` `dataApi` strings plus hardcoded code examples. No API fetches at render time.

```typescript
// apps/web/app/dane/dokumentacja/page.tsx
import { headers, cookies } from 'next/headers';
import { Metadata } from 'next';
import { detectLocale } from '../../../lib/i18n';
import { translations } from '../../../lib/i18n';
import ApiDocsPageContent from '../../../components/pages/ApiDocsPageContent';

export const revalidate = 86400; // 24-hour ISR

export async function generateMetadata(): Promise<Metadata> {
  // Metadata is locale-independent for SEO (canonical is the PL page)
  return {
    title: 'API Danych Paliw — Dokumentacja | Litro',
    description:
      'Dokumentacja REST API Litro dla nabywców danych. Ceny paliw w czasie rzeczywistym, historia i agregaty dla stacji w Polsce.',
    openGraph: {
      title: 'Litro Data API — Dokumentacja',
      description:
        'REST API z cenami paliw dla deweloperów i firm. Bearer token (ddk_), 300 req/hr, 4 endpointy PRICE_DATA.',
      type: 'website',
      url: 'https://desert.app/dane/dokumentacja',
    },
  };
}

export default async function DaneDokumentacjaPage() {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerStore.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];
  return <ApiDocsPageContent t={t} />;
}
```

**File:** `apps/web/components/pages/ApiDocsPageContent.tsx`

Server Component (no 'use client'). Renders static content — navigation anchors, endpoint cards, code blocks:

```typescript
// apps/web/components/pages/ApiDocsPageContent.tsx
import { Translations } from '../../lib/i18n';

interface Props {
  t: Translations;
}

export default function ApiDocsPageContent({ t }: Props) {
  const d = t.dataApi;
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-2">{d.docsTitle}</h1>
      <p className="text-gray-600 mb-8">{d.docsSubtitle}</p>

      {/* Overview */}
      <section id="overview" className="mb-10">
        <h2 className="text-xl font-semibold mb-3">{d.overviewTitle}</h2>
        <p className="mb-4">{d.overviewBody}</p>
        <div className="bg-gray-50 border rounded p-4 font-mono text-sm">
          {`Authorization: Bearer ddk_<your-key>`}
        </div>
        <p className="mt-3 text-sm text-gray-500">{d.rateLimitNote}</p>
      </section>

      {/* PRICE_DATA endpoints */}
      <section id="price-data" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">{d.priceDataTitle}</h2>
        <EndpointCard
          method="GET"
          path="/v1/data-api/prices/latest"
          description={d.latestDesc}
          params={d.latestParams}
          responseSample={LATEST_RESPONSE_SAMPLE}
          curlExample={LATEST_CURL}
          jsFetchExample={LATEST_JS}
        />
        <EndpointCard
          method="GET"
          path="/v1/data-api/prices/history"
          description={d.historyDesc}
          params={d.historyParams}
          responseSample={HISTORY_RESPONSE_SAMPLE}
          curlExample={HISTORY_CURL}
          jsFetchExample={HISTORY_JS}
        />
        <EndpointCard
          method="GET"
          path="/v1/data-api/prices/aggregated"
          description={d.aggregatedDesc}
          params={d.aggregatedParams}
          responseSample={AGGREGATED_RESPONSE_SAMPLE}
          curlExample={AGGREGATED_CURL}
          jsFetchExample={AGGREGATED_JS}
        />
        <EndpointCard
          method="GET"
          path="/v1/data-api/stations"
          description={d.stationsDesc}
          params={d.stationsParams}
          responseSample={STATIONS_RESPONSE_SAMPLE}
          curlExample={STATIONS_CURL}
          jsFetchExample={STATIONS_JS}
        />
      </section>

      {/* CONSUMPTION_DATA tier — gated */}
      <section id="consumption-data" className="mb-10">
        <h2 className="text-xl font-semibold mb-4">{d.consumptionTitle}</h2>
        <div className="border border-dashed border-gray-300 rounded-lg p-6 bg-gray-50 opacity-70">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🔒</span>
            <span className="font-medium text-gray-700">{d.consumptionGatedLabel}</span>
          </div>
          <ul className="list-disc list-inside text-gray-600 mb-4 space-y-1">
            <li><code className="text-sm">GET /v1/data-api/consumption/fill-ups</code></li>
            <li><code className="text-sm">GET /v1/data-api/consumption/aggregated</code></li>
          </ul>
          <p className="text-sm text-gray-600 mb-4">{d.consumptionGatedBody}</p>
          <a
            href="/data"
            className="inline-block bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-orange-600 transition-colors"
          >
            {d.consumptionUpgradeCta}
          </a>
        </div>
      </section>
    </main>
  );
}

// ─── EndpointCard sub-component ───────────────────────────────────────────

interface EndpointCardProps {
  method: string;
  path: string;
  description: string;
  params: string;
  responseSample: string;
  curlExample: string;
  jsFetchExample: string;
}

function EndpointCard({
  method, path, description, params, responseSample, curlExample, jsFetchExample,
}: EndpointCardProps) {
  return (
    <div className="mb-8 border rounded-lg overflow-hidden">
      <div className="bg-gray-100 px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-xs font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded">
          {method}
        </span>
        <code className="font-mono text-sm font-semibold">{path}</code>
      </div>
      <div className="p-4">
        <p className="text-gray-700 mb-4">{description}</p>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Parametry</h4>
        {/* params is pre-formatted HTML string from i18n — rendered as description list */}
        <p className="text-sm text-gray-600 mb-4 whitespace-pre-line">{params}</p>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">curl</h4>
        <pre className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-x-auto mb-3">
          <code>{curlExample}</code>
        </pre>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">JavaScript (fetch)</h4>
        <pre className="bg-gray-900 text-gray-100 rounded p-3 text-xs overflow-x-auto mb-3">
          <code>{jsFetchExample}</code>
        </pre>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Przykładowa odpowiedź</h4>
        <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto">
          <code>{responseSample}</code>
        </pre>
      </div>
    </div>
  );
}

// ─── Hardcoded code examples (locale-agnostic) ────────────────────────────

const BASE = 'https://api.desert.app';
const BEARER = 'ddk_a1b2c3d4e5f6...';

const LATEST_CURL = `curl -H "Authorization: Bearer ${BEARER}" \\
  "${BASE}/v1/data-api/prices/latest?fuel_type=PB_95&limit=50"`;

const LATEST_JS = `const res = await fetch('${BASE}/v1/data-api/prices/latest?fuel_type=PB_95', {
  headers: { Authorization: 'Bearer ${BEARER}' },
});
const { data, meta } = await res.json();`;

const LATEST_RESPONSE_SAMPLE = `{
  "data": [
    {
      "station_id": "clxyz...",
      "station_name": "Orlen Warszawa Centrum",
      "voivodeship": "mazowieckie",
      "lat": 52.2297,
      "lng": 21.0122,
      "fuel_type": "PB_95",
      "price_pln": 6.29,
      "recorded_at": "2026-04-07T14:32:00.000Z",
      "source": "community"
    }
  ],
  "meta": { "total": 2847, "limit": 50, "offset": 0 }
}`;

const HISTORY_CURL = `curl -H "Authorization: Bearer ${BEARER}" \\
  "${BASE}/v1/data-api/prices/history?voivodeship=mazowieckie&fuel_type=ON&date_from=2026-03-01&date_to=2026-03-31"`;

const HISTORY_JS = `const params = new URLSearchParams({
  voivodeship: 'mazowieckie',
  fuel_type: 'ON',
  date_from: '2026-03-01',
  date_to: '2026-03-31',
  limit: '500',
});
const res = await fetch(\`${BASE}/v1/data-api/prices/history?\${params}\`, {
  headers: { Authorization: 'Bearer ${BEARER}' },
});
const { data, meta } = await res.json();`;

const HISTORY_RESPONSE_SAMPLE = `{
  "data": [
    {
      "station_id": "clxyz...",
      "station_name": "BP Modlińska",
      "voivodeship": "mazowieckie",
      "lat": 52.31,
      "lng": 20.98,
      "fuel_type": "ON",
      "price_pln": 6.15,
      "recorded_at": "2026-03-15T09:12:00.000Z",
      "source": "community"
    }
  ],
  "meta": {
    "total": 1243,
    "limit": 500,
    "offset": 0,
    "date_from": "2026-03-01T00:00:00.000Z",
    "date_to": "2026-03-31T00:00:00.000Z"
  }
}`;

const AGGREGATED_CURL = `curl -H "Authorization: Bearer ${BEARER}" \\
  "${BASE}/v1/data-api/prices/aggregated?fuel_type=PB_95&granularity=week&date_from=2026-01-01&date_to=2026-03-31"`;

const AGGREGATED_JS = `const res = await fetch(
  '${BASE}/v1/data-api/prices/aggregated?fuel_type=PB_95&granularity=week',
  { headers: { Authorization: 'Bearer ${BEARER}' } },
);
const { data, meta } = await res.json();`;

const AGGREGATED_RESPONSE_SAMPLE = `{
  "data": [
    {
      "period": "2026-03-30T00:00:00.000Z",
      "avg_price": 6.31,
      "min_price": 5.99,
      "max_price": 6.59,
      "sample_count": 4821
    }
  ],
  "meta": {
    "granularity": "week",
    "fuel_type": "PB_95",
    "voivodeship": null,
    "date_from": "2026-03-01T00:00:00.000Z",
    "date_to": "2026-03-31T00:00:00.000Z"
  }
}`;

const STATIONS_CURL = `curl -H "Authorization: Bearer ${BEARER}" \\
  "${BASE}/v1/data-api/stations?voivodeship=mazowieckie&has_price_within_days=7&limit=100"`;

const STATIONS_JS = `const res = await fetch(
  '${BASE}/v1/data-api/stations?has_price_within_days=7',
  { headers: { Authorization: 'Bearer ${BEARER}' } },
);
const { data, meta } = await res.json();`;

const STATIONS_RESPONSE_SAMPLE = `{
  "data": [
    {
      "station_id": "clxyz...",
      "station_name": "Orlen Warszawa Al. Jerozolimskie",
      "slug": "orlen-warszawa-al-jerozolimskie",
      "address": "Al. Jerozolimskie 65/79, Warszawa",
      "voivodeship": "mazowieckie",
      "lat": 52.2297,
      "lng": 21.0122,
      "brand": "ORLEN"
    }
  ],
  "meta": { "total": 319, "limit": 100, "offset": 0 }
}`;
```

---

### Middleware update: protect `/dane/klucze`

**File:** `apps/web/middleware.ts`

Add `/dane/klucze` to the same protected-routes matcher already handling `/konto`. The middleware reads the `web_token` cookie, verifies it is present (full JWT decode is not required at middleware level — just presence check with redirect; role check happens in the page Server Component via full decode).

```typescript
// apps/web/middleware.ts  — diff-style, add to existing matcher and logic

// Add to the existing PROTECTED_ROUTES array (or equivalent matcher config):
const PROTECTED_ROUTES = [
  '/konto',
  '/dane/klucze',
  // ... existing routes
];

// Existing logic: if pathname matches PROTECTED_ROUTES and no web_token cookie:
//   redirect to /logowanie?next=<pathname>
// No change to the redirect target or cookie name — reuse existing pattern exactly.
```

The full implementation must follow whatever pattern `middleware.ts` already uses for `/konto`. Do not invent a new cookie name — `web_token` is the established name from web-6.

---

### Route: `/dane/klucze` — Key Management Page

**File:** `apps/web/app/dane/klucze/page.tsx`

Server Component. Reads `web_token`, decodes JWT (without verifying signature — verification happens on the API side), checks `role === 'DATA_BUYER'`. If wrong role, renders access denied. Otherwise, fetches key list from API and renders `ApiKeyList`.

```typescript
// apps/web/app/dane/klucze/page.tsx
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import { detectLocale, translations } from '../../../lib/i18n';
import ApiKeyList from '../../../components/ApiKeyList';

export const metadata: Metadata = {
  title: 'Moje klucze API | Litro',
  // noindex — private page; no value in search indexing
  robots: { index: false, follow: false },
};

interface JwtPayload {
  sub: string;
  role: string;
  exp: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

export default async function DaneKluczePage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token = cookieStore.get('web_token')?.value;

  // Middleware already redirected unauthenticated users; this is a belt-and-suspenders check.
  if (!token) {
    redirect('/logowanie?next=/dane/klucze');
  }

  const payload = decodeJwtPayload(token);

  if (!payload || payload.role !== 'DATA_BUYER') {
    const locale = detectLocale(
      headerStore.get('accept-language'),
      cookieStore.get('locale')?.value,
    );
    const t = translations[locale];
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t.dataApi.accessDeniedTitle}</h1>
        <p className="text-gray-600 mb-6">{t.dataApi.accessDeniedBody}</p>
        <a href="/data" className="text-orange-600 underline">
          {t.dataApi.accessDeniedCta}
        </a>
      </main>
    );
  }

  // Fetch key list server-side
  const apiUrl = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  let keys: Array<{
    id: string;
    label: string | null;
    key_prefix: string;
    created_at: string;
    last_used_at: string | null;
  }> = [];
  let fetchError = false;

  try {
    const res = await fetch(`${apiUrl}/v1/data-buyers/me/keys`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      keys = await res.json();
    } else {
      fetchError = true;
    }
  } catch {
    fetchError = true;
  }

  const locale = detectLocale(
    headerStore.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">{t.dataApi.keysTitle}</h1>
      <p className="text-gray-600 mb-8">{t.dataApi.keysSubtitle}</p>
      {fetchError ? (
        <p className="text-red-600">{t.dataApi.keysLoadError}</p>
      ) : (
        <ApiKeyList initialKeys={keys} t={t} />
      )}
    </main>
  );
}
```

---

### `ApiKeyList` Component

**File:** `apps/web/components/ApiKeyList.tsx`

Client Component — handles create modal, revoke confirmation, and list refresh:

```typescript
// apps/web/components/ApiKeyList.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Translations } from '../lib/i18n';
import CreateKeyModal from './CreateKeyModal';

interface KeyItem {
  id: string;
  label: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface Props {
  initialKeys: KeyItem[];
  t: Translations;
}

export default function ApiKeyList({ initialKeys, t }: Props) {
  const d = t.dataApi;
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<KeyItem | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const atLimit = initialKeys.length >= 5;

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/data-keys/revoke/${revokeTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRevokeError(body.error ?? d.revokeError);
        return;
      }
      setRevokeTarget(null);
      router.refresh();
    } catch {
      setRevokeError(d.revokeError);
    } finally {
      setRevoking(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  return (
    <>
      {/* Limit warning */}
      {atLimit && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
          {d.keysAtLimit}
        </div>
      )}

      {/* Create button */}
      <div className="mb-6">
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={atLimit}
          className="bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {d.createKeyButton}
        </button>
      </div>

      {/* Key table */}
      {initialKeys.length === 0 ? (
        <p className="text-gray-500">{d.keysEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500 text-xs uppercase">
                <th className="pb-2 pr-4">{d.keyColPrefix}</th>
                <th className="pb-2 pr-4">{d.keyColLabel}</th>
                <th className="pb-2 pr-4">{d.keyColCreated}</th>
                <th className="pb-2 pr-4">{d.keyColLastUsed}</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {initialKeys.map((key) => (
                <tr key={key.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 pr-4 font-mono text-xs">{key.key_prefix}...</td>
                  <td className="py-3 pr-4 text-gray-700">{key.label ?? '—'}</td>
                  <td className="py-3 pr-4 text-gray-600">{formatDate(key.created_at)}</td>
                  <td className="py-3 pr-4 text-gray-600">
                    {key.last_used_at ? formatDate(key.last_used_at) : d.keyNeverUsed}
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() => setRevokeTarget(key)}
                      className="text-red-600 hover:text-red-800 text-xs underline"
                    >
                      {d.revokeButton}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create key modal */}
      {showCreateModal && (
        <CreateKeyModal
          t={t}
          onClose={() => {
            setShowCreateModal(false);
            router.refresh();
          }}
        />
      )}

      {/* Revoke confirmation dialog */}
      {revokeTarget && (
        <dialog
          open
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h2 className="text-lg font-semibold mb-3">{d.revokeConfirmTitle}</h2>
            <p className="text-gray-600 text-sm mb-6">{d.revokeConfirmBody}</p>
            {revokeError && (
              <p className="text-red-600 text-sm mb-3">{revokeError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeError(null); }}
                disabled={revoking}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {d.cancelButton}
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {revoking ? d.revoking : d.revokeButton}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
```

---

### `CreateKeyModal` Component

**File:** `apps/web/components/CreateKeyModal.tsx`

Client Component — two-phase: form phase → reveal phase:

```typescript
// apps/web/components/CreateKeyModal.tsx
'use client';

import { useState, useRef } from 'react';
import { Translations } from '../lib/i18n';

type Phase = 'form' | 'reveal';

interface Props {
  t: Translations;
  onClose: () => void;
}

export default function CreateKeyModal({ t, onClose }: Props) {
  const d = t.dataApi;
  const [phase, setPhase] = useState<Phase>('form');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/data-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? d.createError);
        return;
      }
      const data = await res.json();
      setCreatedKey(data.key);
      setPhase('reveal');
    } catch {
      setError(d.createError);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      // Fallback: select the input
      keyRef.current?.select();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {phase === 'form' ? (
          <>
            <h2 className="text-lg font-semibold mb-4">{d.createKeyTitle}</h2>
            <form onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {d.createKeyLabelField}
                <span className="text-gray-400 ml-1 font-normal">({d.optional})</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
                placeholder={d.createKeyLabelPlaceholder}
                className="w-full border rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {d.cancelButton}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                >
                  {loading ? d.creating : d.createKeySubmit}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-3">{d.keyCreatedTitle}</h2>
            {/* Amber alert — key shown once */}
            <div className="bg-amber-50 border border-amber-300 rounded p-4 mb-4">
              <p className="text-amber-800 text-xs font-semibold mb-2 uppercase tracking-wide">
                {d.keyOnceWarning}
              </p>
              <div className="flex gap-2 items-center">
                <input
                  ref={keyRef}
                  type="text"
                  readOnly
                  value={createdKey ?? ''}
                  className="flex-1 font-mono text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 whitespace-nowrap"
                >
                  {copied ? d.copied : d.copyButton}
                </button>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-6">{d.keyCreatedBody}</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm bg-gray-800 text-white rounded hover:bg-gray-900"
              >
                {d.closeButton}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

---

### Next.js Route Handlers (API Proxy)

**File:** `apps/web/app/api/data-keys/create/route.ts`

Reads `web_token` cookie, forwards to `POST /v1/data-buyers/me/keys`:

```typescript
// apps/web/app/api/data-keys/create/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('web_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const upstream = await fetch(`${API_URL}/v1/data-buyers/me/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
```

**File:** `apps/web/app/api/data-keys/revoke/[keyId]/route.ts`

```typescript
// apps/web/app/api/data-keys/revoke/[keyId]/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { keyId: string } },
) {
  const cookieStore = await cookies();
  const token = cookieStore.get('web_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const upstream = await fetch(
    `${API_URL}/v1/data-buyers/me/keys/${params.keyId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await upstream.json().catch(() => ({ error: 'Unknown error' }));
  return NextResponse.json(data, { status: upstream.status });
}
```

---

### i18n additions to `lib/i18n.ts`

Add `dataApi` to the `Translations` interface and all three locale objects:

```typescript
// Interface addition — inside Translations {}
dataApi: {
  // Docs page
  docsTitle: string;
  docsSubtitle: string;
  overviewTitle: string;
  overviewBody: string;
  rateLimitNote: string;
  priceDataTitle: string;
  latestDesc: string;
  latestParams: string;
  historyDesc: string;
  historyParams: string;
  aggregatedDesc: string;
  aggregatedParams: string;
  stationsDesc: string;
  stationsParams: string;
  consumptionTitle: string;
  consumptionGatedLabel: string;
  consumptionGatedBody: string;
  consumptionUpgradeCta: string;

  // Keys page
  keysTitle: string;
  keysSubtitle: string;
  keysLoadError: string;
  keysEmpty: string;
  keysAtLimit: string;
  createKeyButton: string;
  createKeyTitle: string;
  createKeyLabelField: string;
  createKeyLabelPlaceholder: string;
  createKeySubmit: string;
  createError: string;
  creating: string;
  keyCreatedTitle: string;
  keyOnceWarning: string;
  keyCreatedBody: string;
  copyButton: string;
  copied: string;
  closeButton: string;
  cancelButton: string;
  revokeButton: string;
  revoking: string;
  revokeError: string;
  revokeConfirmTitle: string;
  revokeConfirmBody: string;
  keyColPrefix: string;
  keyColLabel: string;
  keyColCreated: string;
  keyColLastUsed: string;
  keyNeverUsed: string;
  optional: string;

  // Access denied
  accessDeniedTitle: string;
  accessDeniedBody: string;
  accessDeniedCta: string;
};
```

**Polish (`pl`) locale values:**

```typescript
dataApi: {
  docsTitle: 'Dokumentacja API Danych',
  docsSubtitle: 'Referencja REST API dla nabywców danych Litro. Wszystkie endpointy wymagają klucza API (Bearer ddk_...).',
  overviewTitle: 'Uwierzytelnianie',
  overviewBody: 'Każde zapytanie musi zawierać nagłówek Authorization z kluczem API w formacie Bearer. Klucze generujesz w sekcji "Moje klucze API" po zatwierdzeniu dostępu.',
  rateLimitNote: 'Limit: 300 zapytań na godzinę per klucz. Przekroczenie zwraca HTTP 429 z nagłówkiem Retry-After: 3600.',
  priceDataTitle: 'Endpointy — tier PRICE_DATA',
  latestDesc: 'Zwraca najnowszą cenę paliwa per stacja i typ paliwa (DISTINCT ON station_id, fuel_type, sortowane po recorded_at DESC). Opcjonalne filtry: voivodeship, fuel_type. Paginacja: limit (max 1000), offset.',
  latestParams: 'voivodeship — string, opcjonalny. Filtr po województwie (np. "mazowieckie").\nfuel_type — enum: PB_95 | PB_98 | ON | ON_PREMIUM | LPG, opcjonalny.\nlimit — integer 1–1000, domyślnie 100.\noffset — integer ≥ 0, domyślnie 0.',
  historyDesc: 'Surowe rekordy z historii cen. Wymaga co najmniej jednego z: station_id lub voivodeship (aby uniknąć skanowania całej tabeli). Maksymalny zakres dat: 90 dni.',
  historyParams: 'station_id — string, opcjonalny (wymagany jeśli brak voivodeship).\nvoivodeship — string, opcjonalny (wymagany jeśli brak station_id).\nfuel_type — enum FuelType, opcjonalny.\ndate_from — ISO 8601, domyślnie 30 dni wstecz.\ndate_to — ISO 8601, domyślnie teraz.\nlimit — integer 1–5000, domyślnie 500.\noffset — integer ≥ 0, domyślnie 0.',
  aggregatedDesc: 'Agregaty dzienne, tygodniowe lub miesięczne (avg, min, max, count). fuel_type jest wymagany. Maksymalny zakres dat: 365 dni.',
  aggregatedParams: 'fuel_type — enum FuelType, wymagany.\ngranularity — day | week | month, domyślnie day.\nvoivodeship — string, opcjonalny.\ndate_from — ISO 8601, domyślnie 30 dni wstecz.\ndate_to — ISO 8601, domyślnie teraz.',
  stationsDesc: 'Lista stacji z danymi master (nazwa, adres, współrzędne, marka). Opcjonalny filtr has_price_within_days zwraca tylko stacje z co najmniej jedną ceną w ostatnich N dniach.',
  stationsParams: 'voivodeship — string, opcjonalny.\nhas_price_within_days — integer 1–365, opcjonalny.\nlimit — integer 1–2000, domyślnie 200.\noffset — integer ≥ 0, domyślnie 0.',
  consumptionTitle: 'Endpointy — tier CONSUMPTION_DATA',
  consumptionGatedLabel: 'Dostępne w wyższym tierze',
  consumptionGatedBody: 'Endpointy danych o zużyciu paliwa (tankowania i agregaty per pojazd) są dostępne w tierze Consumption Data lub Full Access. Zawierają anonimizowane dane o zużyciu dla pojazdów zarejestrowanych w aplikacji.',
  consumptionUpgradeCta: 'Uaktualnij do Consumption Data',

  keysTitle: 'Moje klucze API',
  keysSubtitle: 'Zarządzaj kluczami dostępu do API danych. Maksymalnie 5 aktywnych kluczy na konto.',
  keysLoadError: 'Nie udało się załadować kluczy. Spróbuj ponownie później.',
  keysEmpty: 'Nie masz jeszcze żadnych kluczy API.',
  keysAtLimit: 'Osiągnięto limit 5 aktywnych kluczy. Usuń klucz, aby dodać nowy.',
  createKeyButton: 'Utwórz nowy klucz',
  createKeyTitle: 'Nowy klucz API',
  createKeyLabelField: 'Nazwa klucza',
  createKeyLabelPlaceholder: 'np. Produkcja, Staging',
  createKeySubmit: 'Utwórz klucz',
  createError: 'Nie udało się utworzyć klucza. Spróbuj ponownie.',
  creating: 'Tworzenie...',
  keyCreatedTitle: 'Klucz API utworzony',
  keyOnceWarning: 'Ten klucz nie zostanie pokazany ponownie',
  keyCreatedBody: 'Skopiuj klucz i zapisz go w bezpiecznym miejscu. Po zamknięciu tego okna nie będziesz mógł go ponownie wyświetlić.',
  copyButton: 'Kopiuj',
  copied: 'Skopiowano!',
  closeButton: 'Zamknij',
  cancelButton: 'Anuluj',
  revokeButton: 'Usuń',
  revoking: 'Usuwanie...',
  revokeError: 'Nie udało się usunąć klucza. Spróbuj ponownie.',
  revokeConfirmTitle: 'Usunąć ten klucz?',
  revokeConfirmBody: 'Tej operacji nie można cofnąć. Aplikacje używające tego klucza stracą dostęp natychmiast.',
  keyColPrefix: 'Prefiks klucza',
  keyColLabel: 'Nazwa',
  keyColCreated: 'Utworzono',
  keyColLastUsed: 'Ostatnie użycie',
  keyNeverUsed: 'Nigdy',
  optional: 'opcjonalne',

  accessDeniedTitle: 'Brak dostępu',
  accessDeniedBody: 'Ta sekcja jest dostępna tylko dla nabywców danych.',
  accessDeniedCta: 'Dowiedz się więcej o dostępie do danych',
},
```

**English (`en`) locale values:**

```typescript
dataApi: {
  docsTitle: 'Data API Documentation',
  docsSubtitle: 'REST API reference for Litro data buyers. All endpoints require a Bearer API key (ddk_...).',
  overviewTitle: 'Authentication',
  overviewBody: 'Every request must include an Authorization header with your API key in Bearer format. Generate keys in the "My API Keys" section after your access has been approved.',
  rateLimitNote: 'Rate limit: 300 requests per hour per key. Exceeding the limit returns HTTP 429 with a Retry-After: 3600 header.',
  priceDataTitle: 'Endpoints — PRICE_DATA tier',
  latestDesc: 'Returns the latest price per station and fuel type (DISTINCT ON station_id, fuel_type ordered by recorded_at DESC). Optional filters: voivodeship, fuel_type. Pagination: limit (max 1000), offset.',
  latestParams: 'voivodeship — string, optional. Filter by voivodeship (e.g. "mazowieckie").\nfuel_type — enum: PB_95 | PB_98 | ON | ON_PREMIUM | LPG, optional.\nlimit — integer 1–1000, default 100.\noffset — integer ≥ 0, default 0.',
  historyDesc: 'Raw price history records. Requires at least one of: station_id or voivodeship (to avoid full-table scans). Maximum date range: 90 days.',
  historyParams: 'station_id — string, optional (required if voivodeship absent).\nvoivodeship — string, optional (required if station_id absent).\nfuel_type — enum FuelType, optional.\ndate_from — ISO 8601, defaults to 30 days ago.\ndate_to — ISO 8601, defaults to now.\nlimit — integer 1–5000, default 500.\noffset — integer ≥ 0, default 0.',
  aggregatedDesc: 'Daily, weekly or monthly aggregates (avg, min, max, count). fuel_type is required. Maximum date range: 365 days.',
  aggregatedParams: 'fuel_type — enum FuelType, required.\ngranularity — day | week | month, default day.\nvoivodeship — string, optional.\ndate_from — ISO 8601, defaults to 30 days ago.\ndate_to — ISO 8601, defaults to now.',
  stationsDesc: 'Station master data (name, address, coordinates, brand). Optional has_price_within_days filter returns only stations with at least one price record in the last N days.',
  stationsParams: 'voivodeship — string, optional.\nhas_price_within_days — integer 1–365, optional.\nlimit — integer 1–2000, default 200.\noffset — integer ≥ 0, default 0.',
  consumptionTitle: 'Endpoints — CONSUMPTION_DATA tier',
  consumptionGatedLabel: 'Available at a higher tier',
  consumptionGatedBody: 'Consumption data endpoints (fill-up records and per-vehicle aggregates) are available on the Consumption Data or Full Access tier. They contain anonymised consumption data for vehicles registered in the app.',
  consumptionUpgradeCta: 'Upgrade to Consumption Data',

  keysTitle: 'My API Keys',
  keysSubtitle: 'Manage your data API access keys. Maximum 5 active keys per account.',
  keysLoadError: 'Failed to load keys. Please try again later.',
  keysEmpty: 'You have no API keys yet.',
  keysAtLimit: 'You have reached the 5-key limit. Revoke a key to create a new one.',
  createKeyButton: 'Create new key',
  createKeyTitle: 'New API Key',
  createKeyLabelField: 'Key label',
  createKeyLabelPlaceholder: 'e.g. Production, Staging',
  createKeySubmit: 'Create key',
  createError: 'Failed to create key. Please try again.',
  creating: 'Creating...',
  keyCreatedTitle: 'API key created',
  keyOnceWarning: 'This key will not be shown again',
  keyCreatedBody: 'Copy the key and store it in a safe place. After closing this dialog you will not be able to view it again.',
  copyButton: 'Copy',
  copied: 'Copied!',
  closeButton: 'Close',
  cancelButton: 'Cancel',
  revokeButton: 'Revoke',
  revoking: 'Revoking...',
  revokeError: 'Failed to revoke key. Please try again.',
  revokeConfirmTitle: 'Revoke this key?',
  revokeConfirmBody: 'This cannot be undone. Applications using this key will lose access immediately.',
  keyColPrefix: 'Key prefix',
  keyColLabel: 'Label',
  keyColCreated: 'Created',
  keyColLastUsed: 'Last used',
  keyNeverUsed: 'Never',
  optional: 'optional',

  accessDeniedTitle: 'Access denied',
  accessDeniedBody: 'This section is only available to data buyers.',
  accessDeniedCta: 'Learn more about data access',
},
```

**Ukrainian (`uk`) locale values:**

```typescript
dataApi: {
  docsTitle: 'Документація API даних',
  docsSubtitle: 'Референс REST API для покупців даних Litro. Усі ендпоінти потребують Bearer ключа (ddk_...).',
  overviewTitle: 'Автентифікація',
  overviewBody: 'Кожен запит повинен містити заголовок Authorization з ключем API у форматі Bearer. Генеруйте ключі в розділі "Мої API-ключі" після затвердження доступу.',
  rateLimitNote: 'Ліміт: 300 запитів на годину на ключ. Перевищення повертає HTTP 429 із заголовком Retry-After: 3600.',
  priceDataTitle: 'Ендпоінти — рівень PRICE_DATA',
  latestDesc: 'Повертає останню ціну на пальне по кожній станції та типу пального (DISTINCT ON station_id, fuel_type). Необов\'язкові фільтри: voivodeship, fuel_type. Пагінація: limit (макс. 1000), offset.',
  latestParams: 'voivodeship — рядок, необов\'язковий.\nfuel_type — enum: PB_95 | PB_98 | ON | ON_PREMIUM | LPG, необов\'язковий.\nlimit — ціле 1–1000, за замовчуванням 100.\noffset — ціле ≥ 0, за замовчуванням 0.',
  historyDesc: 'Сирі записи з історії цін. Потребує хоча б одного з: station_id або voivodeship. Максимальний діапазон дат: 90 днів.',
  historyParams: 'station_id — рядок, необов\'язковий (потрібен якщо відсутній voivodeship).\nvoivodeship — рядок, необов\'язковий (потрібен якщо відсутній station_id).\nfuel_type — enum FuelType, необов\'язковий.\ndate_from — ISO 8601, за замовчуванням 30 днів тому.\ndate_to — ISO 8601, за замовчуванням зараз.\nlimit — ціле 1–5000, за замовчуванням 500.\noffset — ціле ≥ 0, за замовчуванням 0.',
  aggregatedDesc: 'Денні, тижневі або місячні агрегати (avg, min, max, count). fuel_type обов\'язковий. Максимальний діапазон дат: 365 днів.',
  aggregatedParams: 'fuel_type — enum FuelType, обов\'язковий.\ngranularity — day | week | month, за замовчуванням day.\nvoivodeship — рядок, необов\'язковий.\ndate_from — ISO 8601.\ndate_to — ISO 8601.',
  stationsDesc: 'Основні дані станцій (назва, адреса, координати, бренд). Необов\'язковий фільтр has_price_within_days повертає лише станції з хоча б одним записом ціни за останні N днів.',
  stationsParams: 'voivodeship — рядок, необов\'язковий.\nhas_price_within_days — ціле 1–365, необов\'язковий.\nlimit — ціле 1–2000, за замовчуванням 200.\noffset — ціле ≥ 0, за замовчуванням 0.',
  consumptionTitle: 'Ендпоінти — рівень CONSUMPTION_DATA',
  consumptionGatedLabel: 'Доступно на вищому рівні',
  consumptionGatedBody: 'Ендпоінти даних про споживання пального доступні на рівні Consumption Data або Full Access.',
  consumptionUpgradeCta: 'Перейти на Consumption Data',

  keysTitle: 'Мої API-ключі',
  keysSubtitle: 'Управляйте ключами доступу до API даних. Максимум 5 активних ключів на акаунт.',
  keysLoadError: 'Не вдалося завантажити ключі. Спробуйте пізніше.',
  keysEmpty: 'У вас ще немає API-ключів.',
  keysAtLimit: 'Досягнуто ліміт 5 активних ключів. Видаліть ключ, щоб створити новий.',
  createKeyButton: 'Створити новий ключ',
  createKeyTitle: 'Новий API-ключ',
  createKeyLabelField: 'Назва ключа',
  createKeyLabelPlaceholder: 'напр. Продакшн, Стейджинг',
  createKeySubmit: 'Створити ключ',
  createError: 'Не вдалося створити ключ. Спробуйте ще раз.',
  creating: 'Створення...',
  keyCreatedTitle: 'API-ключ створено',
  keyOnceWarning: 'Цей ключ більше не буде показано',
  keyCreatedBody: 'Скопіюйте ключ і збережіть його в надійному місці. Після закриття цього вікна ви не зможете переглянути його знову.',
  copyButton: 'Копіювати',
  copied: 'Скопійовано!',
  closeButton: 'Закрити',
  cancelButton: 'Скасувати',
  revokeButton: 'Видалити',
  revoking: 'Видалення...',
  revokeError: 'Не вдалося видалити ключ. Спробуйте ще раз.',
  revokeConfirmTitle: 'Видалити цей ключ?',
  revokeConfirmBody: 'Цю операцію не можна скасувати. Застосунки, що використовують цей ключ, негайно втратять доступ.',
  keyColPrefix: 'Префікс ключа',
  keyColLabel: 'Назва',
  keyColCreated: 'Створено',
  keyColLastUsed: 'Останнє використання',
  keyNeverUsed: 'Ніколи',
  optional: 'необов\'язково',

  accessDeniedTitle: 'Доступ заборонено',
  accessDeniedBody: 'Цей розділ доступний лише для покупців даних.',
  accessDeniedCta: 'Дізнатися більше про доступ до даних',
},
```

---

## File List

**New (Web):**
- `apps/web/app/dane/page.tsx` — Not used (redirect handled in `next.config`). File not needed if redirect is in config.
- `apps/web/app/dane/dokumentacja/page.tsx` — API docs page (Server Component, ISR 24hr)
- `apps/web/app/dane/klucze/page.tsx` — Key management page (Server Component, auth-gated)
- `apps/web/components/pages/ApiDocsPageContent.tsx` — Static docs renderer (Server Component)
- `apps/web/components/ApiKeyList.tsx` — Key table with revoke (Client Component)
- `apps/web/components/CreateKeyModal.tsx` — Create key modal (Client Component)
- `apps/web/app/api/data-keys/create/route.ts` — POST proxy to `/v1/data-buyers/me/keys`
- `apps/web/app/api/data-keys/revoke/[keyId]/route.ts` — DELETE proxy

**Modified (Web):**
- `apps/web/next.config.ts` (or `next.config.js`) — add `/dane` → `/data` 301 redirect
- `apps/web/middleware.ts` — add `/dane/klucze` to protected routes array
- `apps/web/lib/i18n.ts` — add `dataApi` key to `Translations` interface + all 3 locale objects

---

## Dev Notes

### JWT decode in Server Component

The `decodeJwtPayload` helper in `dane/klucze/page.tsx` base64url-decodes the payload without verifying the signature. This is safe here because:
1. The middleware has already confirmed the cookie exists.
2. The actual API call (`/v1/data-buyers/me/keys`) re-verifies the JWT server-side via the NestJS JWT guard. An attacker who forged a `role: DATA_BUYER` payload would still receive a 401 from the API.
3. We are only using the decoded role to decide which UI to show (access-denied vs. key list), not to make access-control decisions that affect data.

Follow the same pattern used in `konto/page.tsx` (Story web-6) — do not invent a new verification approach.

### `INTERNAL_API_URL` vs `NEXT_PUBLIC_API_URL`

Server Components and Route Handlers must use `INTERNAL_API_URL` for server-side fetches — same constraint established in web-5. `NEXT_PUBLIC_API_URL` is the browser-facing URL; `INTERNAL_API_URL` is the internal Docker/Railway hostname. Route handlers run on the server, so they also use `INTERNAL_API_URL`.

### Redirect in `next.config` vs. `page.tsx`

Placing the `/dane` → `/data` redirect in `next.config`'s `redirects()` array ensures:
- It is a true HTTP 301 (permanent) — the browser and search engines never load the Next.js runtime for this route.
- No `page.tsx` file is needed for `/dane` itself — do not create one.
- The `/dane/dokumentacja` and `/dane/klucze` sub-routes are unaffected (the redirect only matches the exact path `/dane`, not `/dane/**`).

### `router.refresh()` after key create/revoke

`ApiKeyList` and `CreateKeyModal` call `router.refresh()` after a mutation. This triggers Next.js to re-fetch the Server Component's data (the key list fetch in `dane/klucze/page.tsx`) without a full page navigation. The `initialKeys` prop will be updated with the new list. This is the correct pattern for Next.js App Router — do not use `useState` to patch the list client-side.

### No interactive API explorer

An interactive "Try it" panel was considered but deferred. The docs page is purely static content — no fetch calls at render time, no client-side state. `'use client'` is not needed in any docs page component.

### Max 5 keys — UI vs. API enforcement

The 5-key limit is enforced server-side in `DataBuyerKeysService.createKey()` (returns HTTP 400). The UI shows a warning and disables the button when `initialKeys.length >= 5` as a UX convenience, but the API is the authoritative enforcement. Do not rely solely on the UI check.

### `dialog` element for revoke confirmation

The revoke confirmation uses the native HTML `<dialog>` element with `open` attribute (not the Web Animations API `showModal()`). This avoids the need for a ref and works with SSR hydration. The backdrop is handled via a Tailwind overlay `div` wrapping the `dialog` content, not `::backdrop`, for consistent cross-browser styling.

---

## Testing Requirements

No new unit tests required for this story. Rationale:

- `ApiDocsPageContent` — purely static rendering; no logic to test beyond "does it render without error."
- `ApiKeyList` / `CreateKeyModal` — Client Components with `fetch` calls; integration-tested against real API in the buyer flow (Story 10.3 covers the API layer unit tests).
- Route handlers (`/api/data-keys/create`, `/api/data-keys/revoke/[keyId]`) — thin proxies; correctness depends on the API contract already unit-tested in 10.3.
- `decodeJwtPayload` — pure function; add a unit test only if this helper grows in complexity.

If the project has Playwright E2E tests: add a `data-buyer-keys.spec.ts` test that signs in as a DATA_BUYER, navigates to `/dane/klucze`, creates a key, copies it from the amber alert, and revokes it — verifying the list re-renders correctly. This is post-implementation scope.

---

## Dev Agent Record

**Completion Notes**

_(To be filled in by the implementing agent)_

- Redirect `/dane` → `/data` implemented in `next.config` `redirects()` — no `page.tsx` for `/dane`.
- `ApiDocsPageContent` — pure Server Component; all code examples hardcoded as template literals; `EndpointCard` sub-component colocated in same file for simplicity; no `'use client'`.
- `dane/klucze/page.tsx` — JWT decode via `decodeJwtPayload` (payload only, no signature verify); role check renders access-denied Server Component before any API call for wrong roles; key list fetched with `cache: 'no-store'` on server using `INTERNAL_API_URL`.
- `CreateKeyModal` — two-phase form→reveal; `navigator.clipboard.writeText` with fallback to `input.select()`; `copied` state resets when modal is closed; modal always calls `onClose` which triggers `router.refresh()`.
- Route handlers — both use `INTERNAL_API_URL` env var; 204 from revoke proxied as `new NextResponse(null, { status: 204 })` (not `.json()`).
- `middleware.ts` — `/dane/klucze` added to protected routes; `/dane/dokumentacja` and `/dane` are public (no change needed).
- `lib/i18n.ts` — `dataApi` key added to interface and all three locale objects; tsc clean verified.
- ISR `revalidate = 86400` set on docs page; no `revalidate` on klucze page (it must always be fresh).

**Deferred**

_(To be filled in after code review)_

---

## Change Log

- 2026-04-08: Story created (web-8-data-api.md) — full spec replacing the 3-line stub in web-stories.md
