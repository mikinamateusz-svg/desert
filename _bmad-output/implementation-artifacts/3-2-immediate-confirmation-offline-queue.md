# Story 3.2: Immediate Confirmation & Offline Queue

**Status:** review
**Epic:** 3 — Photo Contribution Pipeline
**Created:** 2026-04-01

---

## User Story

As a **driver**,
I want to see an instant "Thank you" confirmation after submitting a photo and have it automatically retry if I'm offline,
So that I'm never left waiting or wondering if my contribution was received.

**Why:** The fire-and-forget UX is central to the product's 10-second promise. If drivers had to wait for OCR to complete before seeing confirmation, the contribution flow would feel broken. The offline queue means a driver at a remote station with poor signal never loses a submission — it will always eventually reach the server.

---

## Acceptance Criteria

### AC1 — Fire-and-forget submission (no confirmation card)
**Given** a driver takes a photo and exactly one station is within 200m GPS radius
**When** the photo is captured and quality-checked
**Then** `enqueueSubmission()` is called immediately with the GPS-matched station — the `PriceConfirmationCard` is skipped entirely
**And** navigation replaces to `/(app)/confirm` with the station name as a param
**And** the driver sees the thank-you screen within 300ms of the shutter

**Given** multiple stations are within 200m
**When** the photo is captured
**Then** the `StationDisambiguationSheet` is shown — after the driver picks a station, submission is queued and navigation goes to the thank-you screen (no `PriceConfirmationCard`)

### AC2 — Thank-you screen content
**Given** the driver is on the `/(app)/confirm` screen
**When** it is displayed
**Then** the screen shows:
- Checkmark icon in amber circle
- Headline: `t('confirmation.thankYou')` — "Thank you!" / "Dzięki!" / "Дякуємо!"
- Station name (when GPS-matched): e.g. "Orlen Wola Rakowa"
- Impact message: `t('confirmation.impactMessage')` — "Drivers nearby will see this update"
- Primary CTA: `t('confirmation.done')` — "Back to map" — navigates to `/(app)/`
- Auto-dismiss: if user taps nothing for 4 seconds, auto-navigate to map

### AC3 — Background upload on connectivity
**Given** the device has network connectivity when a photo is enqueued
**When** the queue processor runs (triggered immediately after enqueue)
**Then** `POST /v1/submissions` is called in the background with the photo + metadata
**And** on `202 Accepted`, the queue entry is deleted from SQLite
**And** the driver is never blocked — this happens fully in the background after they've already seen confirmation

### AC4 — Offline resilience with exponential backoff
**Given** the device has no connectivity at submission time (or upload fails with a 5xx / network error)
**When** a photo is added to the queue
**Then** it is retained locally with `status = 'pending'`
**And** upload is retried automatically with exponential backoff:
  - After 1st failure: retry in 30 seconds
  - After 2nd failure: retry in 2 minutes
  - After 3rd failure: retry in 10 minutes
  - After 4th failure (retry_count ≥ 3): mark as `status = 'failed'` — no more automatic retries

**Given** connectivity is restored (NetInfo `isConnected` transitions to `true`)
**When** the connectivity change is detected
**Then** pending items whose `next_retry_at <= now` are attempted immediately

**Given** the app returns to the foreground (AppState `change` to `active`)
**When** the foreground event fires
**Then** pending items whose `next_retry_at <= now` are attempted

### AC5 — Permanent failure handling (4xx)
**Given** an upload attempt receives a `400` or `401` or `403` response
**When** the processor handles the response
**Then** the entry is marked `status = 'failed'` immediately — no retry is attempted
**And** a `401` triggers no special UI — the entry simply stays in failed state; the driver will be prompted to re-auth naturally the next time they open the app

> Note: `404` is treated as a server error (retry); only `400`, `401`, `403` are permanent failures.

### AC6 — Queue indicator on map
**Given** one or more entries in the queue with `status = 'pending'` or `status = 'failed'`
**When** the map screen is displayed
**Then** a `QueueBadge` renders near the `MapFABGroup` showing:
  - `t('contribution.queuePending', { count: N })` — "N photos queued" — for pending items
  - `t('contribution.queueFailed', { count: N })` — "N photos failed to upload" — for failed items (only shown if no pending items)
**And** when the queue is empty (or all `status = 'uploaded'`), the badge is not rendered (no empty state)

### AC7 — Silent removal on success
**Given** a queued photo is successfully uploaded (server returns `202`)
**When** the server confirms receipt
**Then** the SQLite entry is deleted
**And** no notification, toast, or sound is shown to the driver — silent removal

### AC8 — i18n
**Given** a driver views the confirmation screen or map queue badge
**When** their selected language is Polish, English, or Ukrainian
**Then** all text including the "Thank you" message, nudge, and queue status is displayed in that language

---

## Out of Scope (Story 3.2)

- Server-side `POST /v1/submissions` endpoint implementation → **Story 3.3** (upload will fail gracefully until 3.3 is live; queue retries handle this)
- Fill-up camera screen → **future story** (nudge renders but tapping navigates to `/(app)/capture` which opens price board camera — acceptable placeholder)
- Streak display ("3-day streak 🔥") → deferred to post-MVP (no server-side streak data yet; removed from scope)
- Push notification when queued photo finally uploads → **not in MVP** (architecture decision: no FCM for submission status)
- Failed entries UI beyond the map badge → **not in MVP** (no retry button, no detail screen)

---

## Technical Architecture

### New Dependencies

Run from `apps/mobile/`:
```bash
npx expo install expo-sqlite @react-native-community/netinfo
```

Expected versions compatible with Expo SDK ~55:
- `expo-sqlite` → `~15.x`
- `@react-native-community/netinfo` → `^11.x`

> **Do not** manually set version numbers. Always use `npx expo install` so Expo selects compatible versions.

### SQLite Queue Schema

```sql
CREATE TABLE IF NOT EXISTS capture_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_uri TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  manual_price REAL,
  preselected_station_id TEXT,
  gps_lat REAL,
  gps_lng REAL,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
```

`status` values: `'pending'` | `'failed'`
`next_retry_at`: Unix epoch milliseconds. `NULL` means "try immediately". Set to `NULL` on initial insert.

### expo-sqlite v15 API (Expo SDK 55)

Use the **synchronous** API — it is safe to call on the JS thread in Expo SDK 55 and is simpler than the async promise API for queue operations:

```typescript
import * as SQLite from 'expo-sqlite';

// Open (creates file if not exists)
const db = SQLite.openDatabaseSync('desert_queue.db');

// Schema migration (run once on init)
db.execSync(`CREATE TABLE IF NOT EXISTS capture_queue (...)`);

// Insert
db.runSync(
  `INSERT INTO capture_queue (photo_uri, fuel_type, ...) VALUES (?, ?, ...)`,
  [photoUri, fuelType, ...]
);

// Query
type QueueRow = { id: number; photo_uri: string; fuel_type: string; ... };
const rows = db.getAllSync<QueueRow>(
  `SELECT * FROM capture_queue WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
  [Date.now()]
);

// Update
db.runSync(`UPDATE capture_queue SET status = ?, retry_count = ?, next_retry_at = ? WHERE id = ?`,
  [status, retryCount, nextRetryAt, id]);

// Delete
db.runSync(`DELETE FROM capture_queue WHERE id = ?`, [id]);

// Count
const row = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM capture_queue WHERE status = 'pending'`);
```

> **Do NOT use the old API** (`openDatabase`, `.transaction()`, callbacks). The old API is deprecated in expo-sqlite v14+.

### New Files

```
apps/mobile/
├── app/(app)/
│   └── confirm.tsx                       ← Confirmation screen (hidden tab)
├── src/
│   ├── services/
│   │   ├── queueDb.ts                    ← SQLite init + CRUD operations
│   │   └── queueProcessor.ts             ← Background upload processor
│   ├── hooks/
│   │   └── useQueueCount.ts              ← Pending/failed count for map badge
│   └── components/contribution/
│       └── QueueBadge.tsx                ← "N photos queued" pill
```

### Modified Files

```
apps/mobile/
├── app/(app)/
│   ├── _layout.tsx                       ← Add hidden 'confirm' route
│   └── capture.tsx                       ← Change router.replace to /(app)/confirm
├── app/
│   └── _layout.tsx                       ← Init queueProcessor.start() here (root layout)
├── src/
│   ├── services/
│   │   └── captureQueue.ts               ← Replace stub with queueDb.insert() + processQueue()
│   ├── api/
│   │   └── submissions.ts                ← Add uploadSubmission() function
│   └── i18n/locales/
│       ├── en.ts                         ← Add confirmation.* + contribution.queue* keys
│       ├── pl.ts
│       └── uk.ts
```

> Do NOT add `QueueBadge` to `index.tsx` directly — compose it inside `MapFABGroup` so the badge and FAB move together. See integration details below.

### File: `src/services/queueDb.ts`

Singleton module. Opens the DB once, exports typed helpers:

```typescript
import * as SQLite from 'expo-sqlite';
import type { FuelType } from '@desert/types';

const db = SQLite.openDatabaseSync('desert_queue.db');

// Call once on app start (idempotent)
export function initQueueDb(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS capture_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_uri TEXT NOT NULL,
      fuel_type TEXT NOT NULL,
      manual_price REAL,
      preselected_station_id TEXT,
      gps_lat REAL,
      gps_lng REAL,
      captured_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
}

export interface QueueRow {
  id: number;
  photo_uri: string;
  fuel_type: FuelType;
  manual_price: number | null;
  preselected_station_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  captured_at: string;
  status: 'pending' | 'failed';
  retry_count: number;
  next_retry_at: number | null;
}

export function insertQueueEntry(entry: {
  photoUri: string;
  fuelType: FuelType;
  manualPrice?: number;
  preselectedStationId?: string;
  gpsLat?: number;
  gpsLng?: number;
  capturedAt: string;
}): void {
  db.runSync(
    `INSERT INTO capture_queue (photo_uri, fuel_type, manual_price, preselected_station_id, gps_lat, gps_lng, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.photoUri,
      entry.fuelType,
      entry.manualPrice ?? null,
      entry.preselectedStationId ?? null,
      entry.gpsLat ?? null,
      entry.gpsLng ?? null,
      entry.capturedAt,
    ],
  );
}

export function getDueEntries(): QueueRow[] {
  return db.getAllSync<QueueRow>(
    `SELECT * FROM capture_queue
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC`,
    [Date.now()],
  );
}

export function markSuccess(id: number): void {
  db.runSync(`DELETE FROM capture_queue WHERE id = ?`, [id]);
}

export function markRetry(id: number, retryCount: number): void {
  const BACKOFF_MS = [30_000, 120_000, 600_000];
  const delay = BACKOFF_MS[retryCount] ?? 600_000;
  db.runSync(
    `UPDATE capture_queue SET retry_count = ?, next_retry_at = ? WHERE id = ?`,
    [retryCount + 1, Date.now() + delay, id],
  );
}

export function markFailed(id: number): void {
  db.runSync(`UPDATE capture_queue SET status = 'failed' WHERE id = ?`, [id]);
}

export function getPendingCount(): number {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM capture_queue WHERE status = 'pending'`,
  );
  return row?.count ?? 0;
}

export function getFailedCount(): number {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM capture_queue WHERE status = 'failed'`,
  );
  return row?.count ?? 0;
}
```

### File: `src/api/submissions.ts` (add to existing file)

Add `uploadSubmission` to the existing file (do not replace existing `apiGetSubmissions`):

```typescript
export async function uploadSubmission(
  accessToken: string,
  entry: QueueRow,
): Promise<void> {
  const formData = new FormData();
  // React Native's FormData accepts { uri, type, name } for files
  formData.append('photo', {
    uri: entry.photo_uri,
    type: 'image/jpeg',
    name: 'photo.jpg',
  } as unknown as Blob);
  formData.append('fuel_type', entry.fuel_type);
  if (entry.manual_price != null) formData.append('manual_price', String(entry.manual_price));
  if (entry.preselected_station_id) formData.append('preselected_station_id', entry.preselected_station_id);
  if (entry.gps_lat != null) formData.append('gps_lat', String(entry.gps_lat));
  if (entry.gps_lng != null) formData.append('gps_lng', String(entry.gps_lng));
  formData.append('captured_at', entry.captured_at);

  const res = await fetch(`${API_BASE}/v1/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
    // Do NOT set Content-Type — let fetch set multipart boundary automatically
  });

  if (res.status === 202) return; // success

  // Permanent failures — do not retry
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new PermanentUploadError(res.status);
  }

  // Transient failure — caller retries
  throw new Error(`Upload failed: ${res.status}`);
}

export class PermanentUploadError extends Error {
  constructor(public readonly statusCode: number) {
    super(`Permanent upload failure: ${statusCode}`);
    this.name = 'PermanentUploadError';
  }
}
```

> Import `QueueRow` from `'../services/queueDb'` in this file.

### File: `src/services/queueProcessor.ts`

Module-level singleton processor. Reads token from secure-store directly so it has no React context dependency:

```typescript
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { getToken } from '../lib/secure-storage';
import { getDueEntries, markFailed, markRetry, markSuccess } from './queueDb';
import { PermanentUploadError, uploadSubmission } from '../api/submissions';

let _running = false;
let _unsubscribeNetInfo: (() => void) | null = null;
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

export function startQueueProcessor(): void {
  if (_running) return;
  _running = true;

  // Process immediately on start
  void processQueue();

  // Process when connectivity restored
  _unsubscribeNetInfo = NetInfo.addEventListener(state => {
    if (state.isConnected) void processQueue();
  });

  // Process when app comes to foreground
  _appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (nextState === 'active') void processQueue();
  });
}

export function stopQueueProcessor(): void {
  _running = false;
  _unsubscribeNetInfo?.();
  _appStateSubscription?.remove();
  _unsubscribeNetInfo = null;
  _appStateSubscription = null;
}

let _processingLock = false;

export async function processQueue(): Promise<void> {
  if (_processingLock) return;
  _processingLock = true;

  try {
    const accessToken = await getToken();
    if (!accessToken) return; // not signed in — skip silently

    const entries = getDueEntries();
    for (const entry of entries) {
      try {
        await uploadSubmission(accessToken, entry);
        markSuccess(entry.id);
      } catch (err) {
        if (err instanceof PermanentUploadError) {
          markFailed(entry.id);
        } else if (entry.retry_count >= 3) {
          markFailed(entry.id);
        } else {
          markRetry(entry.id, entry.retry_count);
        }
      }
    }
  } finally {
    _processingLock = false;
  }
}
```

### File: `src/services/captureQueue.ts` (replace stub)

```typescript
import type { CaptureResult } from '../types/contribution';
import { insertQueueEntry } from './queueDb';
import { processQueue } from './queueProcessor';

export async function enqueueSubmission(result: CaptureResult): Promise<void> {
  insertQueueEntry({
    photoUri: result.photoUri,
    fuelType: result.fuelType,
    manualPrice: result.manualPrice,
    preselectedStationId: result.preselectedStationId,
    gpsLat: result.gpsLat,
    gpsLng: result.gpsLng,
    capturedAt: result.capturedAt,
  });
  // Fire-and-forget — caller does not await the upload
  void processQueue();
}
```

### File: `src/hooks/useQueueCount.ts`

Polls SQLite every 5 seconds while component is mounted. Refreshes on each poll so badge stays accurate:

```typescript
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getFailedCount, getPendingCount } from '../services/queueDb';

export function useQueueCount(): { pending: number; failed: number } {
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });

  function refresh() {
    setCounts({ pending: getPendingCount(), failed: getFailedCount() });
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5_000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return counts;
}
```

### File: `src/components/contribution/QueueBadge.tsx`

```tsx
// Renders a small translucent pill above the FABs showing queue status.
// Passed pending/failed counts from parent (MapFABGroup receives them via useQueueCount).
// No-op render when both counts are 0.
```

Compose inside `MapFABGroup.tsx` — add `useQueueCount()` call inside `MapFABGroup` and conditionally render `QueueBadge` above the two pills. This keeps all contribution-related UI in the same component.

### File: `app/(app)/confirm.tsx` (new screen)

Hidden tab route. Key behaviour:
- On mount: starts a 4-second timer, then calls `router.replace('/(app)/')` automatically
- "Done" button: `router.replace('/(app)/')`
- Fill-up nudge tap: `router.replace('/(app)/capture')` (placeholder, opens price board camera for now)
- No `useEffect` cleanup needed for the timer — `router.replace` unmounts the screen

```tsx
// Structure:
// SafeAreaView (flex: 1, backgroundColor: tokens.background, alignItems: 'center', justifyContent: 'center')
//   ├── [checkmark icon or ✓ text — simple, no animated SVG required]
//   ├── Text headline: t('confirmation.title')
//   ├── Text subtitle: t('confirmation.subtitle')
//   ├── TouchableOpacity: t('confirmation.done') → router.replace('/(app)/')
//   └── TouchableOpacity: t('confirmation.fillupNudge') → router.replace('/(app)/capture')
```

No external animation library. A simple scale-in on mount via `Animated.spring` is acceptable but not required.

### Modifying `app/(app)/capture.tsx`

Change `handleConfirm` — replace `router.replace('/(app)/')` with `router.replace('/(app)/confirm')`:

```typescript
// Before (Story 3.1):
await enqueueSubmission(captureResult);
router.replace('/(app)/');

// After (Story 3.2):
await enqueueSubmission(captureResult);
router.replace('/(app)/confirm');
```

That's the only change to `capture.tsx`.

### Modifying `app/(app)/_layout.tsx`

Add hidden `confirm` route (same pattern as `capture`):

```tsx
<Tabs.Screen name="confirm" options={{ href: null, headerShown: false }} />
```

### Initialising `queueProcessor` and `queueDb` in the Root Layout

In `app/_layout.tsx` (the outermost layout, not the tab layout), add:

```typescript
import { useEffect } from 'react';
import { initQueueDb } from '../src/services/queueDb';
import { startQueueProcessor, stopQueueProcessor } from '../src/services/queueProcessor';

// Inside the root layout component, after AuthProvider wraps children:
useEffect(() => {
  initQueueDb();
  startQueueProcessor();
  return () => stopQueueProcessor();
}, []);
```

> Read `app/_layout.tsx` before modifying — check its current structure to find the right placement.

### i18n Keys

Add to all three locales (`en.ts`, `pl.ts`, `uk.ts`) under a new top-level `confirmation` key AND additional keys inside the existing `contribution` key:

**`confirmation` namespace (new):**
```typescript
confirmation: {
  title: 'Thank you for contributing!',
  subtitle: "We'll process your photo and update the price shortly.",
  done: 'Done',
  fillupNudge: 'Did you fill up here? Log pump reading →',
},
```

**Inside existing `contribution` namespace (add):**
```typescript
queuePending: '{{count}} photos queued',
queueFailed: '{{count}} photos failed to upload',
```

Polish translations (`pl.ts`):
```typescript
confirmation: {
  title: 'Dziękujemy za wkład!',
  subtitle: 'Przetworzymy Twoje zdjęcie i wkrótce zaktualizujemy cenę.',
  done: 'Gotowe',
  fillupNudge: 'Czy tu tankowałeś? Zarejestruj odczyt pompy →',
},
// inside contribution:
queuePending: '{{count}} zdjęć w kolejce',
queueFailed: '{{count}} zdjęć nie przesłano',
```

Ukrainian translations (`uk.ts`):
```typescript
confirmation: {
  title: 'Дякуємо за внесок!',
  subtitle: 'Ми обробимо ваше фото та незабаром оновимо ціну.',
  done: 'Готово',
  fillupNudge: "Ви тут заправлялись? Записати показник помпи →",
},
// inside contribution:
queuePending: '{{count}} фото в черзі',
queueFailed: '{{count}} фото не вдалося завантажити',
```

---

## Story 3.1 Intelligence (Learnings Applied)

**From Story 3.1 patches:**
- **P4 (GPS optional):** `CaptureResult.gpsLat` and `gpsLng` are `number | undefined`, not `number`. `insertQueueEntry` must handle `undefined` → `null` for SQLite. ✓ Already handled in spec above.
- **P3 (auth gate):** `enqueueSubmission` is only callable from `capture.tsx` which is already guarded by auth check in `index.tsx`. No additional auth check needed in `captureQueue.ts`.
- **D1 (error handling in handleConfirm):** `enqueueSubmission` in `captureQueue.ts` now can throw (if `insertQueueEntry` throws — SQLite out of space etc.). The `handleConfirm` in `capture.tsx` should be wrapped in try/catch. If `enqueueSubmission` throws, show an inline error toast and do NOT navigate to confirm screen.

**Handle D1 in `capture.tsx` `handleConfirm`:**
```typescript
try {
  await enqueueSubmission(captureResult);
  router.replace('/(app)/confirm');
} catch {
  // SQLite write failed (device storage full, DB corruption)
  Alert.alert(t('contribution.storageFull'));  // reuse existing key from Story 3.1
}
```

**From Story 3.1 architecture:**
- `expo-file-system` v55: use `new File(uri).size` not `getInfoAsync`. No changes needed in this story.
- `expo-sqlite` is a NEW dependency — verify it installs cleanly with `npx expo install`.
- `captureQueue.ts` already has the correct import `import type { CaptureResult } from '../types/contribution'`. Keep this import.

---

## Architecture Compliance Notes

1. **Fire-and-forget:** `enqueueSubmission` writes to SQLite synchronously, then returns. Upload is `void processQueue()` — caller never awaits it. The confirmation screen shows immediately regardless of network state.

2. **No FCM for submission status:** Architecture Decision 4 explicitly prohibits push notifications for submission outcomes. The queue badge (AC6) is the only status surface.

3. **GPS never persisted beyond matching:** `gps_lat` and `gps_lng` are stored in `capture_queue` for upload only. They are cleared from the SQLite row when `markSuccess(id)` deletes the row. After Story 3.3/3.4, the server nulls GPS from the `Submission` record after matching. This story is compliant — GPS leaves the device only in the `POST /v1/submissions` request body; the SQLite row is deleted on success.

4. **Server endpoint not yet implemented:** `POST /v1/submissions` does not exist until Story 3.3. Uploads will return network errors (connection refused) and the queue will accumulate retries. This is expected and safe — the retry mechanism handles it. Do NOT add any special handling for this state.

5. **Multipart upload — do NOT set Content-Type header manually.** Let `fetch` set `Content-Type: multipart/form-data; boundary=...` automatically when `body` is `FormData`. Setting it manually breaks the boundary.

6. **`_processingLock` prevents concurrent runs.** If `processQueue()` is called while already running (e.g., NetInfo fires and AppState fires simultaneously), the second call returns immediately. This prevents duplicate uploads.

---

---

## Dev Agent Record

### Implementation Notes

- `expo-sqlite ~55.0.11` + `@react-native-community/netinfo 11.5.2` installed via `npx expo install`
- SQLite sync API used (`openDatabaseSync`, `runSync`, `getAllSync`, `getFirstSync`) — no callbacks or Promises
- `_processingLock` in `queueProcessor.ts` prevents duplicate concurrent runs from simultaneous NetInfo + AppState events
- D1 from Story 3.1 resolved: `handleConfirm` in `capture.tsx` now wraps `enqueueSubmission` in try/catch; shows `contribution.storageFull` Alert if SQLite write fails
- `MapFABGroup` now owns the queue badge — `useQueueCount` polled inside `MapFABGroup`, `QueueBadge` conditionally rendered above FAB pills
- `QueueBadge` hidden (null render) when pending === 0 && failed === 0; badge+gap wrapper is conditional to avoid phantom spacing
- All three locales updated: `confirmation.*` namespace + `contribution.queuePending` / `contribution.queueFailed` keys
- `confirm.tsx` has 4s auto-dismiss via `setTimeout` → `router.replace`; no external animation library
- Upload function in `submissions.ts` never sets `Content-Type` header (multipart boundary set automatically by fetch)
- `POST /v1/submissions` will fail with network error until Story 3.3 implements the endpoint — queue retries handle this

### Files Changed

```
New:
  apps/mobile/app/(app)/confirm.tsx
  apps/mobile/src/services/queueDb.ts
  apps/mobile/src/services/queueProcessor.ts
  apps/mobile/src/hooks/useQueueCount.ts
  apps/mobile/src/components/contribution/QueueBadge.tsx

Modified:
  apps/mobile/app/_layout.tsx
  apps/mobile/app/(app)/_layout.tsx
  apps/mobile/app/(app)/capture.tsx
  apps/mobile/src/services/captureQueue.ts
  apps/mobile/src/api/submissions.ts
  apps/mobile/src/components/contribution/MapFABGroup.tsx
  apps/mobile/src/i18n/locales/en.ts
  apps/mobile/src/i18n/locales/pl.ts
  apps/mobile/src/i18n/locales/uk.ts
  apps/mobile/package.json (expo-sqlite, @react-native-community/netinfo)
```

### Change Log

- 2026-04-02 — Story 3.2 implemented: SQLite offline queue, background upload processor, confirmation screen, queue badge

---

## Key Risks & Edge Cases

| Scenario | Handling |
|---|---|
| SQLite write fails (device storage full) | `insertQueueEntry` throws → `handleConfirm` shows Alert, does not navigate to confirm |
| App killed mid-upload | `status` never changed (insert sets `'pending'`, only `markSuccess`/`markFailed` change it). On next launch, `initQueueDb` + `startQueueProcessor` will pick it up |
| Upload in progress when app backgrounds | `_processingLock` true; current fetch continues; on next foreground, `processQueue()` skips if lock still held, then processes next due items |
| Token expires between enqueue and upload | `getToken()` returns the stored token. If 401 → `markFailed`. Driver will need to re-authenticate naturally. No special handling. |
| Entry stuck in `uploading` state | Status column only has `'pending'` and `'failed'` — there is no `'uploading'` state. Processor reads `status = 'pending'`. No stuck state possible. |
| Duplicate NetInfo + AppState fire | `_processingLock` prevents concurrent `processQueue` runs |
| `capture_queue` table already exists on upgrade | `CREATE TABLE IF NOT EXISTS` — idempotent |
