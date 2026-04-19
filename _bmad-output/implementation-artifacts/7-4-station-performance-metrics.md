# Story 7.4: Station Performance Metrics

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.4
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.1/7.2 (STATION_MANAGER role, StationClaim), Story 7.3 (station management screen scaffold)
- **Required by:** Epic 8 (promotional metrics reuse the same event data)

---

## User Story

**As a verified station owner,**
I want to see how drivers are interacting with my station on the platform,
So that I can understand my station's visibility and gauge the value of participating.

---

## Context & Why

Station owners are the supply-side partner. Concrete interaction data gives them a reason to stay active and accurate. This dashboard is also the foundation for Epic 8 (paid promotional placements), where the same event data becomes campaign performance reporting. Getting the instrumentation right now avoids retrofitting later.

**Key design choices:**

- **Map views** are approximated as "times this station appeared in a nearby stations API response" — logged client-side as a fire-and-forget batch from `useNearbyStations`. This is a reasonable MVP proxy for "station was visible on screen."
- **Detail opens** are logged precisely: one event per `handlePinPress` call in the map screen.
- Both event types are collected via a single public batch endpoint to minimise mobile request overhead.
- **Price freshness** is current-state only (from `StationFuelStaleness`), not historical — consistent with the spec.
- **Data accumulation guard**: if the station has been claimed for < 7 days, show a message instead of potentially misleading low counts.

---

## Acceptance Criteria

**Given** a verified station owner opens the Performance section of the partner portal
**When** they view it
**Then** they see the following metrics for their station, filterable by last 7 days / 30 days / 90 days:
- **Map views** — how many times the station appeared in a nearby stations query result (mobile map load)
- **Detail opens** — how many times a driver tapped to view the station's price detail screen
- **Price contributions received** — count of community `verified` submissions for this station in the period
- **Price freshness per fuel type** — current state: "fresh" (no staleness flag) or "stale" (has `StationFuelStaleness` row)

**Given** the owner views any metric
**When** they inspect it
**Then** counts are shown as absolute numbers — no comparison to other stations is displayed

**Given** the station has been claimed for fewer than 7 days
**When** the owner opens Performance
**Then** a message is shown: "Your data is accumulating. Full metrics will be visible once your station has been active for 7 days." and metric values are not rendered

**Given** the owner views the portal
**When** it is in Polish, English, or Ukrainian
**Then** all labels and date formats are displayed in that language

**Given** a driver's mobile app fetches nearby stations
**When** this station is in the response
**Then** a `map_view` event is logged for this station (batched with other visible stations, fire-and-forget)

**Given** a driver taps the station marker
**When** the station detail sheet opens
**Then** a `detail_open` event is logged (fire-and-forget)

---

## Schema Changes

### New model: `StationViewEvent`

```prisma
model StationViewEvent {
  id         String   @id @default(uuid())
  station_id String
  event_type String   // 'map_view' | 'detail_open'
  user_id    String?  // null for unauthenticated guests
  created_at DateTime @default(now())

  station    Station  @relation(fields: [station_id], references: [id], onDelete: Cascade)

  @@index([station_id, created_at])
  @@index([event_type, created_at])
}
```

Add to `Station` model:
```prisma
viewEvents StationViewEvent[]
```

**Migration name:** `add_station_view_event`

---

## New API Endpoints

### `POST /v1/stations/events` — public, batched event logging

```typescript
// dto/log-station-events.dto.ts
import { IsArray, IsIn, IsUUID, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StationEventItemDto {
  @IsUUID()
  stationId!: string;

  @IsIn(['map_view', 'detail_open'])
  eventType!: string;
}

export class LogStationEventsDto {
  @IsArray()
  @ArrayMaxSize(50) // guard against abuse
  @ValidateNested({ each: true })
  @Type(() => StationEventItemDto)
  events!: StationEventItemDto[];
}
```

Add to `StationController`:

```typescript
@Public()
@SkipThrottle() // global throttler (3/hr) is too restrictive for event logging
@Post('events')
async logEvents(
  @Body() dto: LogStationEventsDto,
  @CurrentUser() user?: User, // optional — public endpoint, guard is @Public()
  @Req() req?: FastifyRequest,
) {
  // Note: @CurrentUser() returns undefined on public routes
  // Extract userId from token if present (best-effort)
  const userId = (req as any)?.currentUser?.id ?? null;

  if (dto.events.length === 0) return;

  await this.stationService.logViewEvents(dto.events, userId);
}
```

Add to `StationService`:

```typescript
async logViewEvents(
  events: Array<{ stationId: string; eventType: string }>,
  userId: string | null,
): Promise<void> {
  // Filter to valid event types only (DTO validates, but defence-in-depth)
  const VALID_TYPES = new Set(['map_view', 'detail_open']);
  const valid = events.filter((e) => VALID_TYPES.has(e.eventType));
  if (valid.length === 0) return;

  await this.prisma.stationViewEvent.createMany({
    data: valid.map((e) => ({
      station_id: e.stationId,
      event_type: e.eventType,
      user_id: userId,
    })),
    skipDuplicates: false, // count all occurrences
  });
}
```

**Note on `@CurrentUser()` on public routes:** The `JwtAuthGuard` uses `@Public()` to skip auth but still attaches the user if a valid token is present. Verify this is the case — if not, parse the `Authorization` header manually with a best-effort decode (no signature verification, same approach as middleware).

### `GET /v1/partner/stations/{stationId}/metrics?period=7d|30d|90d`

Add to `PartnerController`:

```typescript
@Get('stations/:stationId/metrics')
@Roles(UserRole.STATION_MANAGER)
async getStationMetrics(
  @Param('stationId') stationId: string,
  @CurrentUser() user: User,
  @Query('period') period = '7d',
) {
  const validPeriods = ['7d', '30d', '90d'];
  const safePeriod = validPeriods.includes(period) ? period : '7d';
  return this.partnerService.getStationMetrics(user.id, stationId, safePeriod as '7d' | '30d' | '90d');
}
```

Add to `PartnerService`:

```typescript
async getStationMetrics(
  userId: string,
  stationId: string,
  period: '7d' | '30d' | '90d',
): Promise<StationMetricsResult> {
  // Verify ownership
  const claim = await this.db.stationClaim.findFirst({
    where: { user_id: userId, station_id: stationId, status: 'APPROVED' },
    select: { created_at: true },
  });
  if (!claim) throw new ForbiddenException('You do not manage this station');

  // Data accumulation guard: claim must be ≥7 days old
  const claimAgeDays = Math.floor(
    (Date.now() - claim.created_at.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (claimAgeDays < 7) {
    return { accumulating: true, claimAgeDays };
  }

  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [mapViews, detailOpens, priceContributions, stalenesRows, fuelTypes] = await Promise.all([
    this.db.stationViewEvent.count({
      where: { station_id: stationId, event_type: 'map_view', created_at: { gte: since } },
    }),
    this.db.stationViewEvent.count({
      where: { station_id: stationId, event_type: 'detail_open', created_at: { gte: since } },
    }),
    this.db.submission.count({
      where: { station_id: stationId, status: 'verified', created_at: { gte: since } },
    }),
    this.db.stationFuelStaleness.findMany({
      where: { station_id: stationId },
      select: { fuel_type: true },
    }),
    // All fuel types this station has ever had a price for
    this.db.priceHistory.findMany({
      where: { station_id: stationId },
      distinct: ['fuel_type'],
      select: { fuel_type: true },
    }),
  ]);

  const staleFuels = new Set(stalenesRows.map((r) => r.fuel_type));
  const freshness: Record<string, 'fresh' | 'stale'> = Object.fromEntries(
    fuelTypes.map((r) => [r.fuel_type, staleFuels.has(r.fuel_type) ? 'stale' : 'fresh']),
  );

  return {
    accumulating: false,
    period,
    mapViews,
    detailOpens,
    priceContributions,
    freshness,
  };
}

// Local type
type StationMetricsResult =
  | { accumulating: true; claimAgeDays: number }
  | {
      accumulating: false;
      period: string;
      mapViews: number;
      detailOpens: number;
      priceContributions: number;
      freshness: Record<string, 'fresh' | 'stale'>;
    };
```

---

## Mobile App Changes

### New API function: `apiLogStationEvents`

Create `apps/mobile/src/api/station-events.ts`:

```typescript
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiLogStationEvents(
  accessToken: string | null,
  events: Array<{ stationId: string; eventType: 'map_view' | 'detail_open' }>,
): Promise<void> {
  if (events.length === 0) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  await fetch(`${API_URL}/v1/stations/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
  });
  // No error handling — fire-and-forget, caller should .catch(() => undefined)
}
```

### `apps/mobile/app/(app)/index.tsx` — log map views

After `useNearbyStations` returns new stations, fire map_view events. Add a `useEffect` after the existing station/price hooks:

```typescript
// Add near the top of the component, after existing hooks:
const { accessToken } = useAuthStore(); // or however token is accessed

// Log map_view events when stations change (new map region fetch)
useEffect(() => {
  if (!stations || stations.length === 0) return;

  // Batch all visible station IDs — fire-and-forget
  apiLogStationEvents(
    accessToken,
    stations.map((s) => ({ stationId: s.id, eventType: 'map_view' as const })),
  ).catch(() => undefined);
}, [stations]); // fires when the stations array reference changes (new fetch result)
```

**Debounce concern:** `useNearbyStations` likely debounces map region changes already. If not, the effect above will fire on every render where `stations` changes — acceptable since the hook should return stable array references between fetches.

### `apps/mobile/app/(app)/index.tsx` — log detail opens

In `handlePinPress`:

```typescript
const handlePinPress = useCallback(
  (stationId: string) => {
    setSelectedStation(stationId);
    // ... existing camera animation ...

    // Log detail open — fire-and-forget
    apiLogStationEvents(accessToken, [{ stationId, eventType: 'detail_open' }]).catch(
      () => undefined,
    );
  },
  [accessToken, /* existing deps */],
);
```

---

## Partner App: Performance Metrics Panel

### `app/(partner)/station/[stationId]/page.tsx` — add Performance tab

Extend the existing station management page (from Story 7.3) to include a tabbed layout:

```typescript
// Server Component — tabs: "Prices" (Story 7.3) and "Performance" (this story)
// Pass tab param via searchParams
```

OR keep it as two separate sections on the same page (simpler for MVP — no tab state needed):

```
Station Management
├── Update Prices section (Story 7.3 PriceUpdatePanel)
└── Performance section (new PerformancePanel)
```

Fetch metrics in the server component:

```typescript
const [currentPrices, metrics] = await Promise.all([
  partnerFetch<Record<string, number>>(`/v1/partner/stations/${stationId}/prices`),
  partnerFetch<StationMetricsDto>(`/v1/partner/stations/${stationId}/metrics?period=30d`),
]);
```

### `components/PerformancePanel.tsx` (Client Component)

```typescript
'use client';

type Metric = { label: string; value: number; description: string };

export default function PerformancePanel({
  stationId,
  initialMetrics,
  initialPeriod = '30d',
}: {
  stationId: string;
  initialMetrics: StationMetricsDto;
  initialPeriod?: string;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [loading, setLoading] = useState(false);

  const PERIODS = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];

  const changePeriod = async (newPeriod: string) => {
    setPeriod(newPeriod);
    setLoading(true);
    const res = await fetch(`/v1/partner/stations/${stationId}/metrics?period=${newPeriod}`);
    const data = await res.json();
    setMetrics(data);
    setLoading(false);
  };

  if (metrics.accumulating) {
    return (
      <section className="mt-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Performance</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-6 py-8 text-center">
          <p className="text-sm text-gray-600">
            Your data is accumulating. Full metrics will be visible once your station has been
            active for 7 days.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {7 - metrics.claimAgeDays} days remaining
          </p>
        </div>
      </section>
    );
  }

  const statRows: Metric[] = [
    {
      label: 'Map views',
      value: metrics.mapViews,
      description: 'Times your station appeared on a driver\'s map',
    },
    {
      label: 'Detail opens',
      value: metrics.detailOpens,
      description: 'Times a driver tapped to see your prices',
    },
    {
      label: 'Price contributions',
      value: metrics.priceContributions,
      description: 'Community price reports verified for your station',
    },
  ];

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Performance</h2>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => changePeriod(p.value)}
              disabled={loading}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                period === p.value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4">
        {statRows.map((row) => (
          <div key={row.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-gray-900">
              {loading ? '—' : row.value.toLocaleString()}
            </p>
            <p className="mt-1 text-sm font-medium text-gray-700">{row.label}</p>
            <p className="mt-0.5 text-xs text-gray-400">{row.description}</p>
          </div>
        ))}
      </div>

      {/* Freshness table */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Price freshness (current)</h3>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Fuel type</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {Object.entries(metrics.freshness).map(([ft, status]) => (
                <tr key={ft}>
                  <td className="px-4 py-2 text-gray-700">{FUEL_LABELS[ft] ?? ft}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        status === 'fresh'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {status === 'fresh' ? 'Fresh' : 'Stale'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Freshness reflects current state and is not affected by the period filter.
        </p>
      </div>
    </section>
  );
}

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Petrol 95',
  PB_98: 'Petrol 98',
  ON: 'Diesel',
  ON_PREMIUM: 'Diesel Premium',
  LPG: 'LPG',
  AdBlue: 'AdBlue',
};

// Type imported from shared types or defined locally:
interface StationMetricsDto {
  accumulating: boolean;
  claimAgeDays?: number;
  period?: string;
  mapViews?: number;
  detailOpens?: number;
  priceContributions?: number;
  freshness?: Record<string, 'fresh' | 'stale'>;
}
```

**Period filter note:** The `PerformancePanel` fetches directly from the NestJS API URL for the period change (not via a Server Action) because this is a read-only operation that doesn't modify state. The `partner_token` cookie will NOT be sent in this client-side fetch. To fix this, use a Server Action instead of a client-side `fetch` for the period change:

```typescript
// app/(partner)/station/[stationId]/actions.ts (add to existing file)
export async function fetchMetricsAction(
  stationId: string,
  period: string,
): Promise<StationMetricsDto> {
  return partnerFetch(`/v1/partner/stations/${stationId}/metrics?period=${period}`);
}
```

Call `fetchMetricsAction(stationId, newPeriod)` instead of `fetch(...)` in the client component.

---

## `lib/i18n.ts` — Partner App Translations

Add to `apps/partner/lib/i18n.ts` (pl/en/uk sections):

```typescript
performance: {
  title: { en: 'Performance', pl: 'Statystyki', uk: 'Статистика' },
  mapViews: { en: 'Map views', pl: 'Wyświetlenia na mapie', uk: 'Перегляди на карті' },
  detailOpens: { en: 'Detail opens', pl: 'Otwarcia szczegółów', uk: 'Відкриття деталей' },
  contributions: { en: 'Price contributions', pl: 'Nowe ceny od kierowców', uk: 'Внески цін' },
  freshness: { en: 'Price freshness', pl: 'Aktualność cen', uk: 'Актуальність цін' },
  fresh: { en: 'Fresh', pl: 'Aktualna', uk: 'Актуальна' },
  stale: { en: 'Stale', pl: 'Nieaktualna', uk: 'Застаріла' },
  accumulatingTitle: {
    en: 'Your data is accumulating',
    pl: 'Dane są zbierane',
    uk: 'Дані збираються',
  },
  accumulatingBody: {
    en: 'Full metrics will be visible once your station has been active for 7 days.',
    pl: 'Pełne statystyki będą widoczne po 7 dniach aktywności stacji.',
    uk: 'Повна статистика буде видна після 7 днів активності станції.',
  },
}
```

---

## `PartnerModule` — no new imports needed

`StationViewEvent` is queried via `PrismaService` which is already in `PartnerModule`. `StationModule` does NOT need to be imported into `PartnerModule` — metrics are queried directly in `PartnerService` via `this.db`.

The new `StationController` method (`logEvents`) is in the `StationModule` — no changes to `PartnerModule` for that.

---

## Dev Notes

### `map_view` approximation
"Map views" in this implementation = "times this station was in a `GET /v1/stations/nearby` response, as logged by the mobile client." This is a proxy metric — it counts query appearances, not precise viewport visibility. A station just outside the screen bounds that's still in the radius query will still be counted.

This is explicitly acceptable for MVP. The note "map views will be refined with viewport-based tracking in a future release" should be communicated to station owners via a tooltip or footnote in the UI.

### Deduplication / inflation
No per-user deduplication is applied. A user who pans the map 10 times generates 10 map_view events per station. This reflects genuine interaction volume. Owners are told these are counts, not unique driver counts. For Epic 8 campaign reporting, if unique reach is needed, a `GROUP BY user_id` or `COUNT(DISTINCT user_id)` can be added later.

### `@SkipThrottle()` on `POST /v1/stations/events`
The global throttler is configured at 3 requests per hour (designed for photo submissions). Station event logging needs to be exempt — otherwise a driver who pans the map 3 times gets throttled for the rest of the hour. Apply `@SkipThrottle()` and rely on:
- `@ArrayMaxSize(50)` in the DTO (max 50 events per request)
- UUID validation on `stationId` (prevents arbitrary string injection)

### `@Public()` and `@CurrentUser()` on the same endpoint
The `JwtAuthGuard` uses the `@Public()` metadata to skip authentication. When a valid token IS present, the guard should still parse it and attach `currentUser` to the request. Verify this behaviour in `jwt-auth.guard.ts` — if `@Public()` routes skip ALL token parsing, `user_id` will always be null for this endpoint. This is acceptable for MVP (guest events are just logged without user_id).

### `StationModule` and `StationViewEvent`
`StationService.logViewEvents()` uses `PrismaService` which is already in `StationModule`. The `StationViewEvent` model will be auto-generated by Prisma after migration — no additional module wiring needed. Ensure `PrismaModule` is imported (it already is).

### Period filter client-side fetch
As noted in the component, client-side `fetch` from `PerformancePanel` won't include the `partner_token` httpOnly cookie (cookies are sent by the browser for same-origin requests, but the NestJS API is on a different origin). Use Server Actions (`fetchMetricsAction`) for period changes — they run server-side and have access to cookies via `partnerFetch`.

### Data retention
`StationViewEvent` rows will grow quickly. For MVP no retention policy is enforced. Post-MVP: add a cleanup cron that deletes events older than 180 days (the maximum period shown is 90 days, so 180 days gives 2x safety margin). Document this as a deferred task in `project_deferred.md`.

---

## Tasks

- [ ] **Schema:** Add `StationViewEvent` model; add `viewEvents StationViewEvent[]` relation to `Station`; run `prisma migrate dev --name add_station_view_event`
- [ ] **API:** Add `logViewEvents(events, userId)` to `StationService`
- [ ] **API:** Add `POST /v1/stations/events` to `StationController` — `@Public()`, `@SkipThrottle()`, validates DTO, passes userId if available
- [ ] **API:** Add `getStationMetrics(userId, stationId, period)` to `PartnerService` with ownership check and accumulation guard
- [ ] **API:** Add `GET /v1/partner/stations/:stationId/metrics` to `PartnerController` — `@Roles(STATION_MANAGER)`
- [ ] **API:** Create `LogStationEventsDto` with `StationEventItemDto` (max 50 events, UUID validation, event type allowlist)
- [ ] **Mobile:** Create `apps/mobile/src/api/station-events.ts` with `apiLogStationEvents()` function
- [ ] **Mobile:** Add map_view logging `useEffect` to `apps/mobile/app/(app)/index.tsx` (fires when `stations` array changes)
- [ ] **Mobile:** Add detail_open logging call in `handlePinPress` in `index.tsx`
- [ ] **Partner app:** Add `StationMetricsDto` type to `apps/partner/lib/types.ts`
- [ ] **Partner app:** Create `components/PerformancePanel.tsx` (Client Component) with metric cards, period toggle, freshness table, accumulation guard UI
- [ ] **Partner app:** Add `fetchMetricsAction` Server Action to `app/(partner)/station/[stationId]/actions.ts`
- [ ] **Partner app:** Extend `app/(partner)/station/[stationId]/page.tsx` — fetch metrics and render `PerformancePanel` below `PriceUpdatePanel`
- [ ] **Partner app:** Add performance metric strings to `lib/i18n.ts` (pl/en/uk)
- [ ] **Sprint status:** Mark 7.4 ready-for-dev in sprint-status.yaml
