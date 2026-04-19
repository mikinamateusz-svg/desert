# Story 4.10: Admin UI — Manual Station Sync Trigger

Status: ready-for-dev

## Story

As an **ops admin**,
I want a button in the admin panel to trigger and monitor a station sync,
So that I can seed or re-populate station data without leaving the browser or using curl.

## Acceptance Criteria

**AC1 — Sync status view:**
Given an ADMIN opens the Station Sync section of the admin panel
When they view it
Then they see: current sync status (Idle / Running / Failed), last completed sync timestamp, and total station count in the database

**AC2 — Trigger sync:**
Given the ADMIN clicks "Run Sync Now"
When no sync is currently running
Then the button is disabled and replaced with a "Sync running…" indicator, and the status updates in real time (polling `GET /v1/admin/stations/sync/status` every 5 seconds)

**AC3 — Already running guard:**
Given a sync is already running
When the page is loaded or the status is polled
Then the "Run Sync Now" button is disabled with a tooltip: "Sync already in progress"

**AC4 — Completion update:**
Given the sync completes
When the status poll detects completion
Then the last completed timestamp and station count update without a page reload, and the button re-enables

**AC5 — Failure banner:**
Given the sync fails (all retries exhausted)
When the status poll detects failure
Then a dismissible error banner is shown: "Last sync failed — check Railway logs" and the button re-enables so the admin can retry

**AC6 — Consistent shell:**
Given the admin panel displays the Sync section
When it is viewed alongside other admin sections
Then it follows the same navigation shell, authentication guard (ADMIN only), and visual language as Story 4.1

## Tasks / Subtasks

- [ ] T1: New admin page — `app/(protected)/station-sync/` (AC1, AC6)
  - [ ] T1a: Create `apps/admin/app/(protected)/station-sync/page.tsx` (server component — fetches initial status, renders `StationSyncDashboard`)
  - [ ] T1b: Create `apps/admin/app/(protected)/station-sync/actions.ts` — server actions `fetchSyncStatus()` and `triggerSync()`
  - [ ] T1c: Create `apps/admin/app/(protected)/station-sync/StationSyncDashboard.tsx` (client component — handles polling and trigger button)

- [ ] T2: Add nav item to layout (AC6)
  - [ ] T2a: Add `{ href: '/station-sync', label: t.nav.stationSync }` to `navItems` in `apps/admin/app/(protected)/layout.tsx`

- [ ] T3: i18n — all 3 locales (pl, en, uk) (AC1–AC6)
  - [ ] T3a: Add `stationSync` key to `nav` in all 3 locales
  - [ ] T3b: Add `stationSync` section under `sections` in all 3 locales
  - [ ] T3c: Add `stationSync` translations section in all 3 locales (see Dev Notes for strings)
  - [ ] T3d: Update `Translations` interface to include `nav.stationSync`, `sections.stationSync`, and `stationSync` section

- [ ] T4: Tests
  - [ ] T4a: Verify `fetchSyncStatus()` server action calls correct API path and returns typed result
  - [ ] T4b: Verify `triggerSync()` server action handles 409 (already running) gracefully — returns error state, not throw
  - [ ] T4c: Full regression suite — all existing tests still pass

## Dev Notes

### API already exists — UI wrapper only

Story 2.13 built the full backend. **Do not touch the API.** This story is purely UI.

Existing endpoints (in `apps/api/src/station/station-sync-admin.controller.ts`):

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/admin/stations/sync` | ADMIN JWT | Trigger sync; returns 202 `{ status: 'queued', jobId }` or 409 if already running |
| `GET` | `/v1/admin/stations/sync/status` | ADMIN JWT | Returns `SyncStatusResult` |

`SyncStatusResult`:
```ts
interface SyncStatusResult {
  status: 'idle' | 'running' | 'failed';
  lastCompletedAt: string | null;  // ISO datetime
  lastFailedAt: string | null;     // ISO datetime
  stationCount: number;
}
```

`POST /v1/admin/stations/sync` returns **409** when already running — `adminFetch` throws `AdminApiError(409, ...)`. The `triggerSync()` server action must catch this and return an "already running" state rather than propagating the exception.

### Page structure

`page.tsx` (server component):
```ts
export default async function StationSyncPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { data: initialStatus } = await fetchSyncStatus();
  return (
    <div>
      <h1 ...>{t.sections.stationSync.title}</h1>
      <p ...>{t.sections.stationSync.description}</p>
      <StationSyncDashboard t={t.stationSync} initialStatus={initialStatus ?? null} />
    </div>
  );
}
```

### Polling pattern

`StationSyncDashboard.tsx` is a client component. Polling must use `useEffect` + `setInterval` — only poll when `status === 'running'`:

```ts
useEffect(() => {
  if (status !== 'running') return;
  const id = setInterval(async () => {
    const result = await fetchSyncStatus();
    if (result.data) setStatus(result.data);
  }, 5_000);
  return () => clearInterval(id);
}, [status]);
```

Stop polling when status transitions to `'idle'` or `'failed'`. Start polling immediately after a successful trigger (set local status to `'running'` optimistically before the first poll).

### Trigger flow

```ts
async function handleTrigger() {
  setIsTriggering(true);
  const result = await triggerSync();
  if (result.error === 'already_running') {
    // refresh status to show current running state
    const s = await fetchSyncStatus();
    if (s.data) setStatus(s.data);
  } else if (result.error) {
    setErrorBanner(result.error);
  } else {
    // Optimistically set running — polling will confirm
    setStatus(prev => prev ? { ...prev, status: 'running' } : null);
  }
  setIsTriggering(false);
}
```

### Server actions

```ts
// actions.ts
'use server';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';

export async function fetchSyncStatus(): Promise<{ data?: SyncStatusResult; error?: string }> {
  try {
    const data = await adminFetch<SyncStatusResult>('/v1/admin/stations/sync/status');
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load status.' };
  }
}

export async function triggerSync(): Promise<{ error?: string }> {
  try {
    await adminFetch('/v1/admin/stations/sync', { method: 'POST' });
    return {};
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'already_running' };
    return { error: e instanceof Error ? e.message : 'Failed to trigger sync.' };
  }
}
```

### Status display logic

| `status` | Button state | Status badge |
|----------|-------------|-------------|
| `'idle'` | Enabled | Gray "Idle / Bezczynny" |
| `'running'` | Disabled + spinner | Blue "Running… / Synchronizacja…" |
| `'failed'` | Enabled | Red badge + dismissible error banner |

Error banner (AC5): show when `status === 'failed'`. Dismissible via local state (`setErrorDismissed(true)`). Reappears if status goes to failed again after a new attempt.

Tooltip on disabled button (AC3): use HTML `title` attribute on the wrapper `<span>` (not the `<button>` directly — disabled buttons don't fire mouse events):
```tsx
<span title={status === 'running' ? t.alreadyRunningTooltip : undefined}>
  <button disabled={status === 'running' || isTriggering} ...>
    {status === 'running' ? t.syncRunning : t.triggerButton}
  </button>
</span>
```

### i18n strings

Add to all 3 locales:

**`nav.stationSync`**: `pl: 'Synchronizacja stacji'` | `en: 'Station Sync'` | `uk: 'Синхронізація станцій'`

**`sections.stationSync`**:
- `pl: { title: 'Synchronizacja stacji', description: 'Wyzwól synchronizację z Google Places i monitoruj status.' }`
- `en: { title: 'Station Sync', description: 'Trigger a Google Places sync and monitor progress.' }`
- `uk: { title: 'Синхронізація станцій', description: 'Запустіть синхронізацію з Google Places та відстежуйте статус.' }`

**`stationSync`** section (pl / en / uk):
```
statusLabel:       'Status' / 'Status' / 'Статус'
statusIdle:        'Bezczynny' / 'Idle' / 'Бездіяльний'
statusRunning:     'Synchronizacja w toku…' / 'Sync running…' / 'Синхронізація…'
statusFailed:      'Ostatnia synchronizacja nie powiodła się' / 'Last sync failed' / 'Остання синхронізація не вдалася'
lastCompleted:     'Ostatnia udana synchronizacja' / 'Last completed' / 'Остання успішна'
lastFailed:        'Ostatni błąd' / 'Last failed' / 'Остання помилка'
stationCount:      'Stacji w bazie' / 'Stations in database' / 'Станцій у базі'
triggerButton:     'Uruchom synchronizację' / 'Run Sync Now' / 'Запустити синхронізацію'
syncRunning:       'Synchronizacja w toku…' / 'Sync running…' / 'Синхронізація…'
alreadyRunningTooltip: 'Synchronizacja już trwa' / 'Sync already in progress' / 'Синхронізація вже виконується'
errorBanner:       'Ostatnia synchronizacja nie powiodła się — sprawdź logi Railway.' / 'Last sync failed — check Railway logs.' / 'Остання синхронізація не вдалася — перевірте логи Railway.'
dismissError:      'Zamknij' / 'Dismiss' / 'Закрити'
never:             'Nigdy' / 'Never' / 'Ніколи'
```

Update `Translations` interface:
```ts
interface Translations {
  nav: { ...; stationSync: string };
  sections: { ...; stationSync: { title: string; description: string } };
  stationSync: {
    statusLabel: string; statusIdle: string; statusRunning: string; statusFailed: string;
    lastCompleted: string; lastFailed: string; stationCount: string;
    triggerButton: string; syncRunning: string; alreadyRunningTooltip: string;
    errorBanner: string; dismissError: string; never: string;
  };
}
```

### SyncStatusResult type in admin app

Add to `apps/admin/app/(protected)/station-sync/actions.ts` (or a local `types.ts`):
```ts
export interface SyncStatusResult {
  status: 'idle' | 'running' | 'failed';
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  stationCount: number;
}
```

Do not import from the API package — define locally in the admin app (same pattern as `metrics/types.ts`).

### Project Structure Notes

- All new files in: `apps/admin/app/(protected)/station-sync/`
- Modified: `apps/admin/app/(protected)/layout.tsx` — add nav item
- Modified: `apps/admin/lib/i18n.ts` — add translations + update interface
- **No API changes** — Story 2.13 API is complete and untouched

### References

- Existing sync API: [apps/api/src/station/station-sync-admin.controller.ts](apps/api/src/station/station-sync-admin.controller.ts)
- `SyncStatusResult` shape: [apps/api/src/station/station-sync-admin.service.ts](apps/api/src/station/station-sync-admin.service.ts)
- `adminFetch` + `AdminApiError`: [apps/admin/lib/admin-api.ts](apps/admin/lib/admin-api.ts)
- Nav + layout pattern: [apps/admin/app/(protected)/layout.tsx](apps/admin/app/(protected)/layout.tsx)
- i18n interface: [apps/admin/lib/i18n.ts](apps/admin/lib/i18n.ts)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 4.10 (line ~2054)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/admin/app/(protected)/station-sync/page.tsx` (new)
- `apps/admin/app/(protected)/station-sync/actions.ts` (new)
- `apps/admin/app/(protected)/station-sync/StationSyncDashboard.tsx` (new)
- `apps/admin/app/(protected)/layout.tsx` (modified — add stationSync nav item)
- `apps/admin/lib/i18n.ts` (modified — add stationSync translations + update interface)
- `_bmad-output/implementation-artifacts/4-10-admin-ui-station-sync-trigger.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
