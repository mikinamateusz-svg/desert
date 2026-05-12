# Story 3.15: Optimistic Activity UI (Show Queued Rows Immediately)

**Status:** ready-for-dev
**Trigger:** 2026-05-06 field test observation — drivers don't see their submission in the activity log until 30+ seconds after capture (server-side polling delay), even though the local SQLite queue has the row immediately. Strong feedback during the flag-wrong / retake loop (Story 3.14) requires the just-submitted row to be visible right away.

---

## Story

As a **driver**,
I want my submission to appear in the activity log the moment I tap shutter,
So that I get instant confirmation it was captured and I can immediately flag it (or retake) without waiting for the server.

## Why

Currently the activity log only renders submissions that the server already knows about. The local upload pipeline:
1. Photo captured → row inserted into local SQLite (`SubmissionsQueue`)
2. Background uploader fires → photo uploaded to R2
3. API creates a server-side `Submission` row
4. Mobile activity polling (30s) eventually picks up the new row

Even with `useFocusEffect` refetching on tab focus, there's a 5–30 second window where the driver's just-captured submission is invisible. The flag-wrong flow from Story 3.14 needs the driver to find their submission in activity within seconds of capture — without optimistic UI, the driver perceives the system as broken or laggy when in fact the data is just in transit.

The local SQLite row already has everything we need to render: photo URI (preview), GPS, fuel type, timestamp. We just need to merge it into the activity list.

---

## Acceptance Criteria

**AC1 — Local queue rows visible immediately:**
Given a driver has just captured a photo,
And the row exists in `SubmissionsQueue` (local SQLite) with status `pending` (not yet uploaded) or `uploading` (in flight),
When the activity screen renders,
Then the row appears at the top of the activity list with:
- A station name placeholder (`Wykrywanie stacji…` / "Detecting station..." — we don't know the matched station until the server processes)
- Selected fuel type chip (from local row)
- Timestamp (from local `captured_at`)
- A status indicator showing `Wysyłanie…` ("Uploading…") for `uploading` rows or `W kolejce` ("Queued") for `pending` rows
- No prices line (none extracted yet)

**AC2 — Reconciliation when server-side row arrives:**
Given a local queue row exists for submission `X`,
When the server-side activity fetch returns a row with the same `client_submission_id` (or matching by photo hash + capture time as a fallback),
Then the local-queue row is replaced by the server row in the rendered list,
And there's no flicker / no duplicate row appearing momentarily,
And the driver sees the transition from `Uploading…` to the actual server status (Processing → Verified) seamlessly.

This requires the server-side `Submission` to expose a `client_submission_id` field that matches what the mobile inserts locally. If the schema doesn't have it, add it (small migration: `client_submission_id TEXT` with unique index per user_id).

**AC3 — Failed uploads show distinctly:**
Given a local queue row has been retried 3+ times by the background uploader and is in `failed` state,
When the activity screen renders,
Then the row shows:
- Status indicator: `Nie udało się wysłać` ("Failed to upload") in red/warning color
- A small `Spróbuj ponownie` ("Retry") button that re-triggers the uploader for this row
- Tap target: opens a modal showing the photo preview + retry button + delete-from-queue button

**AC4 — Local rows disappear once verified or rejected:**
Given a server-side row arrives matching a local queue row,
When the server row's status is `verified`, `rejected`, or `shadow_rejected` (terminal),
Then the corresponding local SQLite row is deleted from the queue (cleanup),
And only the server row remains in the rendered list.

This avoids unbounded local-queue growth.

**AC5 — Sort order preserved:**
Given the activity list is sorted by `created_at` desc,
When local + server rows are merged,
Then ordering uses local `captured_at` for local rows and server `created_at` for server rows,
And the merged list is consistently sorted (no jumping when reconciliation happens).

**AC6 — Pull-to-refresh + 30s poll continue to work:**
Given the existing refresh mechanisms from commit 8db0d28,
When pull-to-refresh fires or the 30s focus-poll fires,
Then the merged-list logic correctly handles re-fetched server rows without losing local rows that are still in flight.

**AC7 — Test coverage:**
- Unit: `mergeActivityRows(localQueue, serverRows)` — empty queue, queue+server overlap, no overlap, terminal-status cleanup
- Integration: SubmissionRow renders correctly for local-pending, local-uploading, local-failed, server-pending, server-verified states
- E2E (manual checklist): capture photo → row visible in <1s → row updates to verified after pipeline completes (no duplicate, no flicker)

---

## Implementation Notes

### Backend (apps/api)

**Schema delta:** add `client_submission_id` to `Submission` if not already present. Used to correlate locally-generated rows with server-created ones.

```prisma
model Submission {
  ...
  client_submission_id String?
  ...
  @@unique([user_id, client_submission_id])
}
```

**Submissions endpoint** — return `client_submission_id` in the row payload so mobile can match.

**Submissions create endpoint** — accept `client_submission_id` in body, persist on the row.

### Mobile (apps/mobile)

**New hook** `src/hooks/useLocalSubmissionQueue.ts` — reactively reads from local SQLite, returns `{ rows, retry, deleteRow }`. Subscribes to queue changes via existing event mechanism.

**Merge logic** in `apps/mobile/app/(app)/activity.tsx`:
```ts
const { rows: localRows } = useLocalSubmissionQueue();
const { submissions: serverRows } = useApiSubmissions();
const merged = useMemo(() => mergeActivityRows(localRows, serverRows), [localRows, serverRows]);
```

**`mergeActivityRows` utility** — pure function, easy to test:
- Index server rows by `client_submission_id`
- For each local row: if its `client_submission_id` exists in server index, drop the local row (server wins)
- Otherwise include the local row
- Concat with server rows, sort by timestamp desc

**`SubmissionRow` component** — extend to handle local-only states (`pending`, `uploading`, `failed`):
- Discriminated-union prop type: `{ kind: 'server', row: ServerSubmission } | { kind: 'local', row: LocalQueueRow }`
- Different status indicators per kind
- Tap target differs for failed local rows (opens retry modal)

**Local queue cleanup** — after each activity fetch, find local rows whose `client_submission_id` matches a server row in terminal status and delete them.

### Database

```sql
-- New migration: 20260507000000_add_client_submission_id
ALTER TABLE "Submission" ADD COLUMN "client_submission_id" TEXT;
CREATE UNIQUE INDEX "Submission_user_id_client_submission_id_key"
  ON "Submission"("user_id", "client_submission_id")
  WHERE "client_submission_id" IS NOT NULL;
```

Partial unique index — old rows without `client_submission_id` are unaffected. New rows from updated mobile clients will have it.

### i18n

New keys under `activity.localStatus`:
- `queued` — `W kolejce`
- `uploading` — `Wysyłanie…`
- `failed` — `Nie udało się wysłać`
- `retry` — `Spróbuj ponownie`
- `delete` — `Usuń`
- `detectingStation` — `Wykrywanie stacji…`

---

## Out of Scope

- **Real-time push** (WebSocket / SSE / FCM data-only message) for instant server-to-client status updates. Optimistic UI + 30s polling is enough for v1; push can come later if we measure perceived staleness still being a problem.
- **Photo-hash-based reconciliation fallback** for older mobile builds without `client_submission_id`. Force a min-version requirement instead — this is Phase 1, so we control the rollout.
- **Background upload retry tuning** — keep existing backoff schedule; this story is purely UI.

---

## Dependencies

- Story 3.14 (self-flag) becomes far better UX with this in place — driver sees their just-captured row immediately and can flag/retake without waiting.
- Existing activity-refresh mechanism (commit 8db0d28) — must continue to work alongside the merge logic.
- The local SQLite `SubmissionsQueue` infrastructure (Story 3.2 — Immediate Confirmation / Offline Queue) is a hard prerequisite. Already shipped.
