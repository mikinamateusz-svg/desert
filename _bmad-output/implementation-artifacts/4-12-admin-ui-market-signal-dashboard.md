# Story 4.12: Admin UI — Market Signal Ingestion Dashboard

Status: ready-for-dev

## Story

As an **ops admin**,
I want a screen that shows the latest ingested market signals (ORLEN rack PB95/ON/LPG and Brent crude) with freshness indicators and recent history,
So that I can spot ingestion outages (Alpha Vantage rate-limit, NBP downtime, ORLEN scraper breakage, missing API key) without grepping Railway logs.

## Acceptance Criteria

**AC1 — Latest snapshot per signal:**
Given an ADMIN opens the Market Signals section of the admin panel
When the page loads
Then it shows one card per signal type (`orlen_rack_pb95`, `orlen_rack_on`, `orlen_rack_lpg`, `brent_crude_pln`) with: current value (PLN/litre, 4 decimal places), pct_change vs previous (with arrow + %), and "last ingested X ago"

**AC2 — Freshness indicator:**
Given a signal's `recorded_at` is within its expected interval
When rendered
Then the card shows a green status pill ("Fresh")
And when older than 1.5× the interval, an amber "Watch" pill
And when older than 3× the interval, a red "Stale" pill
Where expected intervals are: ORLEN signals = 12 hours (cron runs twice daily); Brent signal = 24 hours (Alpha Vantage publishes daily, cron dedups same-day re-runs)

**AC3 — Recent history:**
Given an ADMIN clicks a signal card (or always-visible expansion)
When viewed
Then a table shows the last 30 entries for that signal: timestamp, value, pct_change, and (Brent only) rate_source

**AC4 — Brent rate_source visibility:**
Given the latest Brent sample was persisted with `rate_source = 'cached'`
When the Brent card is rendered
Then a small "cached USD/PLN" badge is shown next to the value, signalling that NBP was unavailable on the most recent run

**AC5 — Brent absent state:**
Given Brent has never been ingested (no rows for `signal_type = 'brent_crude_pln'` ever)
When the Brent card is rendered
Then it shows an explicit "Not configured — set ALPHA_VANTAGE_API_KEY" state instead of the empty-data fallback, since the most likely cause is the missing env var

**AC6 — ADMIN-only:**
Given the page loads
When the request is made
Then it goes through the admin JWT check; non-ADMIN users hit the standard `(protected)` redirect

**AC7 — Consistent shell:**
Given the admin panel displays the Market Signals section
When viewed alongside other admin sections
Then it follows the same navigation shell, authentication guard, and visual language as Stories 4.1 / 4.10 (cards, badges, tables — no new design language)

## Tasks / Subtasks

- [ ] T1: Backend — admin endpoints (AC1, AC3, AC4, AC5, AC6)
  - [ ] T1a: Create `apps/api/src/admin/admin-market-signals.controller.ts` — `@Controller('v1/admin/market-signals')` with `@Roles(UserRole.ADMIN)` guard
  - [ ] T1b: Endpoint `GET /v1/admin/market-signals/summary` returns `{ signals: SignalSummary[] }` — one entry per signal type covering all 4 (ORLEN×3 + Brent), with the latest sample's value/pct_change/recorded_at/rate_source. Include all 4 even if some have no data; null fields signal absence (drives AC5).
  - [ ] T1c: Endpoint `GET /v1/admin/market-signals/:signalType/history?limit=30` returns the last N rows. Validate `signalType` against the SignalType enum — 400 on unknown. Default limit 30, hard cap 200.
  - [ ] T1d: Create `apps/api/src/admin/admin-market-signals.service.ts` — owns the queries; one `getSummary()` and one `getHistory(signalType, limit)`.
  - [ ] T1e: Wire into `AdminModule` providers + controllers.
  - [ ] T1f: Tests in `admin-market-signals.service.spec.ts` — happy path, missing-Brent path (no rows), invalid signal type → 400.

- [ ] T2: Admin page — `app/(protected)/market-signals/` (AC1, AC2, AC3, AC4, AC5, AC7)
  - [ ] T2a: Create `apps/admin/app/(protected)/market-signals/page.tsx` (server component — fetches initial summary, renders `MarketSignalsDashboard`)
  - [ ] T2b: Create `apps/admin/app/(protected)/market-signals/actions.ts` — server actions `fetchSummary()` and `fetchHistory(signalType)`
  - [ ] T2c: Create `apps/admin/app/(protected)/market-signals/MarketSignalsDashboard.tsx` (client component) — 4 status cards in a 2×2 grid (or stacked on narrow screens), each with the value/delta/freshness pill and an expandable history table
  - [ ] T2d: Polling: refresh summary every 60 seconds while the tab is foregrounded (matches the cron's 12-hour cadence; longer interval would feel stale to an ops user actively investigating)
  - [ ] T2e: Local types in `actions.ts` (or `types.ts`) — do NOT import from API package, follow the metrics/station-sync pattern

- [ ] T3: Nav item in admin layout (AC7)
  - [ ] T3a: Add `{ href: '/market-signals', label: t.nav.marketSignals }` to `navItems` in `apps/admin/app/(protected)/layout.tsx`

- [ ] T4: i18n — all 3 locales (pl, en, uk) (AC1–AC5)
  - [ ] T4a: Add `marketSignals` key to `nav` in all 3 locales
  - [ ] T4b: Add `marketSignals` section under `sections` in all 3 locales (title + description)
  - [ ] T4c: Add `marketSignals` translations section in all 3 locales — see Dev Notes for the full string list (≈20 keys)
  - [ ] T4d: Update `Translations` interface to include the new `nav.marketSignals`, `sections.marketSignals`, and `marketSignals` section

- [ ] T5: Tests
  - [ ] T5a: Service spec — `getSummary` returns all 4 signal types (with null values when absent); `getHistory` returns ordered rows with limit; `getHistory` rejects unknown signal type
  - [ ] T5b: Server-action specs (admin app) — `fetchSummary` / `fetchHistory` call correct paths; surface AdminApiError messages cleanly
  - [ ] T5c: Full regression suite — all existing tests still pass

## Dev Notes

### API endpoint shapes

```ts
// GET /v1/admin/market-signals/summary
interface SignalSummary {
  signalType: 'orlen_rack_pb95' | 'orlen_rack_on' | 'orlen_rack_lpg' | 'brent_crude_pln';
  value: number | null;            // null = never ingested (Brent edge case for AC5)
  pctChange: number | null;        // null on first ingestion or no data
  recordedAt: string | null;       // ISO datetime; null = no data
  rateSource: 'live' | 'cached' | null;  // only meaningful for brent_crude_pln
}

interface SummaryResponse {
  signals: SignalSummary[];        // always all 4 entries, in canonical order
}
```

```ts
// GET /v1/admin/market-signals/:signalType/history?limit=30
interface HistoryRow {
  recordedAt: string;
  value: number;
  pctChange: number | null;
  rateSource: 'live' | 'cached' | null;
  significantMovement: boolean;
}

interface HistoryResponse {
  signalType: string;
  rows: HistoryRow[];              // newest first
}
```

### Service implementation sketch

```ts
@Injectable()
export class AdminMarketSignalsService {
  private static readonly ALL_SIGNAL_TYPES: SignalType[] = [
    'orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg', 'brent_crude_pln',
  ];

  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<SignalSummary[]> {
    // DISTINCT ON gives us the latest row per signal_type in one round trip.
    const rows = await this.prisma.$queryRaw<Array<{
      signal_type: SignalType;
      value: number;
      pct_change: number | null;
      recorded_at: Date;
      rate_source: string | null;
    }>>`
      SELECT DISTINCT ON (signal_type)
        signal_type, value, pct_change, recorded_at, rate_source
      FROM "MarketSignal"
      ORDER BY signal_type, recorded_at DESC
    `;
    const byType = new Map(rows.map(r => [r.signal_type, r]));
    // Always return all 4 — null fields drive AC5's "not configured" state
    return AdminMarketSignalsService.ALL_SIGNAL_TYPES.map(type => {
      const r = byType.get(type);
      return {
        signalType: type,
        value: r?.value ?? null,
        pctChange: r?.pct_change ?? null,
        recordedAt: r?.recorded_at?.toISOString() ?? null,
        rateSource: type === 'brent_crude_pln' ? (r?.rate_source ?? null) : null,
      };
    });
  }

  async getHistory(signalType: string, limit: number): Promise<HistoryRow[]> {
    if (!AdminMarketSignalsService.ALL_SIGNAL_TYPES.includes(signalType as SignalType)) {
      throw new BadRequestException(`Unknown signalType: ${signalType}`);
    }
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.prisma.marketSignal.findMany({
      where: { signal_type: signalType as SignalType },
      orderBy: { recorded_at: 'desc' },
      take: safeLimit,
      select: {
        value: true,
        pct_change: true,
        recorded_at: true,
        rate_source: true,
        significant_movement: true,
      },
    });
    return rows.map(r => ({
      recordedAt: r.recorded_at.toISOString(),
      value: r.value,
      pctChange: r.pct_change,
      rateSource: r.rate_source as 'live' | 'cached' | null,
      significantMovement: r.significant_movement,
    }));
  }
}
```

### Freshness threshold logic

The dashboard computes the pill colour client-side from `recordedAt`:

```ts
// Per signal-type expected interval (ms)
const EXPECTED_INTERVAL_MS: Record<string, number> = {
  orlen_rack_pb95: 12 * 3600_000,
  orlen_rack_on:   12 * 3600_000,
  orlen_rack_lpg:  12 * 3600_000,
  brent_crude_pln: 24 * 3600_000,  // Alpha Vantage publishes daily
};

function freshnessPill(signalType: string, recordedAt: string | null): 'fresh' | 'watch' | 'stale' | 'none' {
  if (!recordedAt) return 'none';
  const age = Date.now() - new Date(recordedAt).getTime();
  const expected = EXPECTED_INTERVAL_MS[signalType] ?? 12 * 3600_000;
  if (age <= expected * 1.5) return 'fresh';
  if (age <= expected * 3)   return 'watch';
  return 'stale';
}
```

### Card layout (status badges)

| Pill | Background | Border | Text | i18n key |
|------|-----------|--------|------|----------|
| `fresh` | green-50  | green-300  | green-700  | `marketSignals.fresh` |
| `watch` | amber-50  | amber-300  | amber-700  | `marketSignals.watch` |
| `stale` | red-50    | red-300    | red-700    | `marketSignals.stale` |
| `none`  | neutral-50| neutral-300| neutral-500| `marketSignals.notConfigured` (Brent only) / `marketSignals.noData` |

For pct_change display: `+X.XX%` in red-600 if positive, `−X.XX%` in green-600 if negative (mirrors Bloomberg/financial UX where rising is bad for fuel-price context — flip from typical green-up/red-down convention with a one-line code comment explaining why).

### History table

Columns:
- Time (relative `2h ago` for last 24h, then absolute `2026-05-09 14:00`)
- Value (4 decimal places, "PLN/l" suffix)
- Change (with arrow, coloured)
- Source (Brent only — "live" / "cached" badge)

Limit to 30 rows by default; no pagination needed for the MVP. If history grows past 30 rows worth investigating, the admin can hit the API directly.

### Polling

```ts
useEffect(() => {
  const id = setInterval(async () => {
    const result = await fetchSummary();
    if (result.data) setSummary(result.data);
  }, 60_000);
  return () => clearInterval(id);
}, []);
```

60-second interval matches the ops-screen "actively investigating" use case without flooding the API; the cron's 12-hour cadence means individual cards rarely change between polls.

### i18n strings (pl / en / uk)

**`nav.marketSignals`**: `'Sygnały rynkowe'` / `'Market Signals'` / `'Ринкові сигнали'`

**`sections.marketSignals`**:
- title: `'Sygnały rynkowe'` / `'Market Signals'` / `'Ринкові сигнали'`
- description: `'Stan ostatniego pobrania cen ORLEN i Brent crude.'` / `'Latest ingested ORLEN rack + Brent crude prices.'` / `'Останні отримані ціни ORLEN та Brent crude.'`

**`marketSignals`** section (full key list — pl / en / uk):
```
signalOrlenPb95:    'ORLEN Pb95 (hurt)' / 'ORLEN Pb95 (rack)' / 'ORLEN Pb95 (опт)'
signalOrlenOn:      'ORLEN ON (hurt)' / 'ORLEN ON (rack)' / 'ORLEN ON (опт)'
signalOrlenLpg:     'ORLEN LPG (hurt)' / 'ORLEN LPG (rack)' / 'ORLEN LPG (опт)'
signalBrentCrude:   'Brent crude (PLN/l)' / 'Brent crude (PLN/l)' / 'Brent crude (PLN/л)'
fresh:              'Świeże' / 'Fresh' / 'Свіжі'
watch:              'Obserwuj' / 'Watch' / 'Спостерігати'
stale:              'Nieaktualne' / 'Stale' / 'Застарілі'
notConfigured:      'Nie skonfigurowano — ustaw ALPHA_VANTAGE_API_KEY' / 'Not configured — set ALPHA_VANTAGE_API_KEY' / 'Не налаштовано — встановіть ALPHA_VANTAGE_API_KEY'
noData:             'Brak danych' / 'No data' / 'Немає даних'
lastIngested:       'Ostatnie pobranie' / 'Last ingested' / 'Останнє отримання'
pctChangeLabel:     'Zmiana' / 'Change' / 'Зміна'
historyTitle:       'Ostatnie {{count}} wpisów' / 'Last {{count}} entries' / 'Останні {{count}} записів'
historyTime:        'Czas' / 'Time' / 'Час'
historyValue:       'Wartość' / 'Value' / 'Значення'
historySource:      'Źródło' / 'Source' / 'Джерело'
sourceLive:         'live (NBP)' / 'live (NBP)' / 'live (NBP)'
sourceCached:       'cached (NBP)' / 'cached (NBP)' / 'cached (NBP)'
significantBadge:   'Istotny ruch' / 'Significant move' / 'Важливий рух'
loadError:          'Nie udało się załadować sygnałów rynkowych.' / 'Failed to load market signals.' / 'Не вдалося завантажити ринкові сигнали.'
never:              'Nigdy' / 'Never' / 'Ніколи'
```

### Project Structure Notes

- `apps/api/src/admin/admin-market-signals.controller.ts` (new)
- `apps/api/src/admin/admin-market-signals.service.ts` (new)
- `apps/api/src/admin/admin-market-signals.service.spec.ts` (new)
- `apps/api/src/admin/admin.module.ts` (modified — register new providers)
- `apps/admin/app/(protected)/market-signals/page.tsx` (new)
- `apps/admin/app/(protected)/market-signals/actions.ts` (new)
- `apps/admin/app/(protected)/market-signals/MarketSignalsDashboard.tsx` (new)
- `apps/admin/app/(protected)/layout.tsx` (modified — add nav item)
- `apps/admin/lib/i18n.ts` (modified — add translations + update interface)
- **No schema changes** — purely additive readers over existing `MarketSignal` table.

### References

- Existing public summary endpoint (smaller scope, no auth, ORLEN-only): [apps/api/src/market-signal/market-signal.controller.ts](apps/api/src/market-signal/market-signal.controller.ts)
- `MarketSignal` model + `SignalType` enum (`brent_crude_pln` added in 6.0): [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)
- Admin shell + nav pattern (Story 4.10): [apps/admin/app/(protected)/station-sync/](apps/admin/app/(protected)/station-sync/)
- `adminFetch` helper: [apps/admin/lib/admin-api.ts](apps/admin/lib/admin-api.ts)
- i18n interface: [apps/admin/lib/i18n.ts](apps/admin/lib/i18n.ts)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Epic 4 (line ~1806)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/admin/admin-market-signals.controller.ts` (new)
- `apps/api/src/admin/admin-market-signals.service.ts` (new)
- `apps/api/src/admin/admin-market-signals.service.spec.ts` (new)
- `apps/api/src/admin/admin.module.ts` (modified)
- `apps/admin/app/(protected)/market-signals/page.tsx` (new)
- `apps/admin/app/(protected)/market-signals/actions.ts` (new)
- `apps/admin/app/(protected)/market-signals/MarketSignalsDashboard.tsx` (new)
- `apps/admin/app/(protected)/layout.tsx` (modified)
- `apps/admin/lib/i18n.ts` (modified)
- `_bmad-output/implementation-artifacts/4-12-admin-ui-market-signal-dashboard.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
