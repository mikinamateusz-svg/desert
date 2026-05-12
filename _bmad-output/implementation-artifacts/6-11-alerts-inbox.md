# Story 6.11: Alerts Inbox + Read/Unread State

Status: done

> **Renamed 2026-05-10 via Story 6.13** — "premium alerts" copy + identifiers retired per four-pillar positioning lock-in. The inbox mechanic and AC are unchanged; only naming changes. See Story 6.13 spec for the rename receipt.

**Trigger:** 2026-05-08 — direct follow-up from Story 6.10. Once the bell icon lands users on `/(app)/alerts`, the destination needs more than a status banner to pay off the tap. Drivers expect an inbox metaphor: list of past alerts with unread state, the ability to scan recent pushes, and the bell badge reflecting unread count when alerts aren't expiring.

**Phase:** **1 (launch-week)** — promoted from Phase 2 alongside 6.10 on 2026-05-08. Wrap mobile entry points in the same per-feature runtime flag as 6.10 (`flags.alertsLoop`) per memory `feedback_feature_flags.md`. Default off on prod until the marketing-campaign launch flips it; on for staging. Backend persistence is additive and dark-safe.

**Coupled stories already shipped (or shipping in 6.10):**
- 6.3 (lite) — `PriceRiseAlertService` produces the pushes that need persistence.
- 6.10 — establishes the `/alerts` screen, bell icon, status banner, gating layer. **This story depends on 6.10 having shipped first** (the bell icon and `/alerts` route are the surfaces this story extends).

**Coupled stories still spec-only (relevant adjacencies):**
- 6.8 (Engagement Analytics) — will read `read_at` timestamps to compute open/read rates. Building 6.11 first gives 6.8 better data.
- 6.4 (Alert Preferences Panel) — orthogonal; doesn't conflict with the inbox surface.
- 6.5 (Monthly Summary Notification), 6.1 (Price Drop), 6.2 (Community-Confirmed Rise) — when these alerts land, they'll persist into the same `DriverAlert` table without changes; the inbox renders them automatically.

---

## Story

As a **driver**,
I want to see a list of past alerts I've received with clear unread markers,
so that I can quickly catch up on alerts I missed and trust that nothing is silently lost in my notification tray.

### Why

Push notifications are ephemeral. A driver who silenced their phone, missed the system tray, or cleared notifications has no way to recover what was sent. For a feature framed as "premium alerts" — the carrot of the engagement loop — that's a credibility gap. An inbox preserves the history, lets drivers verify the alert system is actually firing, and gives them a single canonical surface for "what's been happening?"

The bell icon's badge gains its conventional meaning here: number of unread alerts. The expiring-state badge from 6.10 takes priority (rarer, more actionable), but in the steady state the inbox unread count is the day-to-day signal.

This also unblocks downstream analytics (Story 6.8) which need delivery + read records to compute meaningful engagement metrics. We currently fire-and-forget pushes with no DB-side trace.

---

## Acceptance Criteria

**AC1 — `DriverAlert` table added (additive migration):**
Given the database lacks a per-user alert delivery record,
When the migration runs,
Then a new table `DriverAlert` exists with columns:

```
id                String      @id @default(uuid())
user_id           String
alert_type        String      -- 'price_rise' | 'premium_expiring_warning' | (future)
title             String
body              String
sent_at           DateTime    @default(now())
read_at           DateTime?
payload           Json?       -- e.g. { signalType, fuelTypes, deepLink }
@@index([user_id, sent_at(sort: Desc)])
@@index([user_id, read_at])  -- for unread-count queries
```

And a foreign key `user_id REFERENCES "User"(id) ON DELETE CASCADE`.

The `alert_type` is a string (not a Prisma enum) to keep additive evolution cheap when 6.1/6.2/6.5 add new types.

**AC2 — `PriceRiseAlertService` persists `DriverAlert` rows on send:**
Given the service is sending a push to a recipient,
When it submits the Expo push message,
Then it also creates a `DriverAlert` row with `alert_type: 'price_rise'`, `title` and `body` matching the push, `payload` of shape `{ signalTypes: string[], deepLink: string }` (plural — a single push may aggregate multiple market signals; `fuelTypes` is intentionally omitted because the existing `SignalType` enum already encodes both the source and the fuel — `orlen_rack_pb95` etc. — and there is no separate fuel-types axis to surface yet),
And the persistence happens *before* the push send (so a successful Expo send corresponds to a row already in the DB),
And if the persistence fails, the push is **not** sent (atomic intent — no orphan pushes without inbox records),
And if the push send fails after persistence succeeds, the row is left in place (driver opens inbox and sees the alert; missing push is the lesser failure mode),
And the persistence is per-recipient (one row per user, not one row per signal).

**AC3 — `PremiumExpiryWarningWorker` (from 6.10) also persists rows:**
Given the daily warning worker fires (Story 6.10 AC4),
When it sends a warning push,
Then it persists a `DriverAlert` row with `alert_type: 'premium_expiring_warning'`,
And the persistence ordering matches AC2 (DB write first, then push send).

**AC4 — `GET /v1/alerts` endpoint:**
Given an authenticated driver,
When they call `GET /v1/alerts?page=1&limit=20`,
Then the endpoint returns `{ data: DriverAlertListItem[], total, unread_count, page, limit }`,
And `data` is sorted by `sent_at DESC` (newest first),
And each item includes `id`, `alert_type`, `title`, `body`, `sent_at`, `read_at`, and a typed `payload` (or null),
And `total` is the count of all `DriverAlert` rows for the user,
And `unread_count` is the count of rows where `read_at IS NULL`,
And the user can only see their own rows (filter on `user_id = currentUser.id`).

**AC5 — `POST /v1/alerts/:id/read` endpoint:**
Given an authenticated driver and a `DriverAlert` id they own,
When they `POST /v1/alerts/:id/read`,
Then the row's `read_at` is set to `NOW()` if it was null (idempotent — repeat calls are no-op),
And the response is `200 OK` with the updated row,
And calling on another user's row returns `404 Not Found` (don't leak existence).

**AC6 — `POST /v1/alerts/read-all` endpoint:**
Given an authenticated driver,
When they `POST /v1/alerts/read-all`,
Then all of their unread `DriverAlert` rows are updated with `read_at = NOW()` in a single SQL UPDATE,
And the response is `200 OK` with `{ marked_read: <count> }`.

**AC7 — Inbox section on `/alerts` screen:**
Given the user opens `/(app)/alerts`,
When the screen renders below the status banner from 6.10,
Then a list of past alerts is rendered, paginated (initial 20, infinite-scroll on next pages),
And unread alerts (where `read_at IS NULL`) have a visible distinction (left-edge dot or background tint — pick one consistent with the app's existing patterns),
And each row shows: title, body (truncated to 2 lines), sent_at relative-time ("2d ago" / "1h ago" — locale-aware),
And tapping a row marks it read inline (calls `POST /:id/read` and updates local state immediately) — no detail navigation in this story,
And there's a "Mark all as read" affordance at the top of the list when `unread_count > 0`,
And empty-state copy when no alerts exist: *"Brak alertów. Twoje powiadomienia o cenach pojawią się tutaj."*

**AC8 — Pull-to-refresh on inbox list:**
Given the inbox is rendered,
When the user pulls down,
Then the list re-fetches from `GET /v1/alerts?page=1`,
And the refresh indicator shows during the request and dismisses on completion.

**AC9 — Bell badge with unread count + expiring override:**
Given the bell icon component from 6.10,
When it renders,
Then the badge state follows priority logic:

1. **Expiring (highest priority)**: warning-coloured exclamation badge — same as 6.10's `expiring` state. Drives attention to the action of taking a photo.
2. **Unread alerts (medium priority)**: brand-coloured numeric badge with the unread count (capped at "9+" if > 9). Renders only if **not** expiring AND `unread_count > 0`.
3. **Default**: no badge.

And the unread count is fetched via the same `GET /v1/alerts` call (using the `unread_count` field) — no separate endpoint for badge counts.

**AC10 — Cache invalidation on read actions:**
Given the inbox shows `unread_count` derived from the API,
When the user marks an alert read (single or all),
Then the bell badge updates immediately to reflect the new count (optimistic local-state update),
And next page navigation back to the map screen shows the updated badge state.

**AC11 — i18n coverage:**
Given new copy across AC7 (empty state, "Mark all as read", relative time formats),
When mobile renders,
Then PL is canonical, EN/UK translated, present in `Translations` type, type-check fails on missing keys.

**AC12 — Runtime feature flag wrap:**
The inbox UI on `/alerts` is wrapped in `flags.alertsLoop` (the same per-feature runtime flag 6.10 introduces). Backend endpoints are unguarded — additive and harmless.

---

## Tasks

### Backend (T1–T4)

**T1 — `DriverAlert` schema + migration:**
- Add the model to `packages/db/prisma/schema.prisma` per AC1.
- Migration creates table + both indexes + FK with `ON DELETE CASCADE`.
- No backfill — past alerts (from 6.3 lite running before this story) are lost and that's accepted; pre-launch state has minimal user data anyway.

**T2 — Persistence in alert services:**
- Modify `PriceRiseAlertService.sendRiseAlerts` (and the per-recipient send loop) to:
  1. Build the alert payload.
  2. Insert a `DriverAlert` row inside a transaction.
  3. On commit, send the Expo push.
  4. On commit-failure, skip push for that recipient.
- Modify `PremiumExpiryWarningWorker` (from 6.10 T4) the same way.
- Failure isolation: per-recipient try/catch — one user's persistence failure shouldn't block the batch for others.

**T3 — `GET /v1/alerts` endpoint:**
- New `AlertsController` under `apps/api/src/notifications/` (or `alert/` — pick whichever has the closer module fit). Routes:
  - `GET /v1/alerts?page=1&limit=20` returns `AlertListResult`.
- Service method `listForUser(userId, page, limit)` issues a single `findMany` + `count` + an unread-count query (or computes unread inline from a windowed query — pick simpler).
- DTO/types: `AlertListResult { data: AlertRow[]; total: number; unread_count: number; page: number; limit: number }`.
- `@Roles(UserRole.DRIVER, UserRole.ADMIN)` to scope to driver-side use.

**T4 — `POST /v1/alerts/:id/read` and `/read-all`:**
- Same controller as T3.
- `markRead(userId, alertId)`: updates `read_at = NOW()` where `id = alertId AND user_id = userId AND read_at IS NULL`. If `updateMany` returns 0 rows, check whether the row exists at all under that user (NotFound) or was already read (no-op success).
- `markAllRead(userId)`: single `updateMany` on `user_id = userId AND read_at IS NULL`. Returns count.
- Tests: own-row-only access, idempotent single read, mark-all returns correct count when zero unread.

### Mobile UI (T5–T8)

**T5 — Mobile API helpers + auth-store integration:**
- New helpers in `apps/mobile/src/api/alerts.ts`:
  - `apiGetAlerts(token, page, limit): Promise<AlertListResult>`
  - `apiMarkAlertRead(token, id): Promise<void>`
  - `apiMarkAllAlertsRead(token): Promise<{ marked_read: number }>`
- Type definitions for `AlertRow` and `AlertListResult` mirror backend.

**T6 — Inbox section on `/alerts` screen:**
- Extend the alerts screen from 6.10:
  - Below the status banner, render the inbox `<FlatList>` with paginated fetch.
  - First page on mount; infinite-scroll on `onEndReached`.
  - Pull-to-refresh resets to page 1 + clears local state.
  - Each row: title, truncated body (2 lines max via `numberOfLines`), relative-time stamp (use `date-fns/formatDistanceToNow` or similar), unread indicator.
  - Tap on row → optimistic `read_at` update + fire-and-forget `apiMarkAlertRead` (rollback only on hard failure).
  - "Mark all as read" button visible when local `unreadCount > 0`.
- Empty-state component when `data.length === 0`.
- Error / loading states match the existing app pattern.

**T7 — Bell icon badge with unread count + expiring override:**
- Modify the `BellAlertIcon` component from 6.10:
  - Read both `bellState` (from premium expiry calc) AND `unreadCount` (from a new auth-store / context value).
  - Badge logic: if `bellState === 'expiring'` render the warning exclamation badge (existing 6.10 behaviour); else if `unreadCount > 0` render numeric badge ("9+" cap); else no badge.
  - Update `unreadCount` source: a small global hook `useAlertsUnreadCount` that fetches lazily on app foreground + on read actions.
- Optimistic update: when user marks read on the alerts screen, the hook's value updates immediately; next foreground re-validates.

**T8 — Mark-as-read coherence with bell badge:**
- When the user marks a single alert read, decrement the local unread count in the hook.
- When the user marks all read, set local count to 0.
- If the alerts screen and the bell are mounted simultaneously (e.g., bell visible during animation transition), the optimistic update propagates via the shared hook.

### i18n (T9)

**T9 — Translations + type:**
- New keys under `inbox` block in `apps/mobile/src/i18n/locales/{pl,en,uk}.ts`:
  - `inbox.emptyState`
  - `inbox.markAllRead`
  - `inbox.markedAllReadToast` (e.g., "Oznaczono wszystkie jako przeczytane")
  - `inbox.errorLoad`
  - Relative-time formats (or use a date-fns locale import; prefer the library).
- `Translations` type updated.

### Code review (T10)

**T10 — Run `bmad-code-review` after dev complete.** Focus areas:
- T2 ordering — is the DB write definitively before the push send? Race condition: if the DB write is slow and the worker queue advances, are there scenarios where a duplicate send could happen? Idempotency key on `DriverAlert.id` reuse?
- T3/T4 own-row-only enforcement — are there any code paths where a user could see another user's alert? Test admin-role bypass behaviour.
- T6 infinite-scroll pagination — what happens if a new alert lands while the user is viewing page 3? Off-by-one risk; test with mock data.
- T7 unread-count hook freshness — what if the user receives a push, taps the system notification, lands on the alerts screen with the bell badge stale? Hook should re-fetch on screen-mount, not just on app foreground.
- AC10 / T8 — the "click row → mark read → badge updates" path must not rely on a full re-fetch from the server (slow); local optimistic updates are required.
- Empty state: does the inbox render correctly for users who've never received any alerts? (Most users at launch will be in this state.)

---

## Out of Scope

- **Alert detail view** — tapping a row marks read but doesn't navigate to a detail screen. The body is shown inline (truncated to 2 lines, expandable on tap if cheap to add — otherwise full body always shown).
- **Filtering by alert type** — flat list, newest-first. When 6.1/6.2/6.5 add more alert types, filter affordances may be useful — defer to that point.
- **Search within inbox** — not at this volume.
- **Archive / delete affordances** — alerts are immutable history. Read-or-unread is the only state. Drivers can ignore alerts that don't matter; they don't disappear.
- **Server-sent events / live updates** — pull-to-refresh + foreground re-fetch is enough at this scale.
- **Localised relative-time formats beyond the basic "X ago"** — use the date-fns locale; deeper polish is out of scope.
- **Alert-engagement analytics aggregations** — read_at is captured (input data), but the aggregation / dashboards / decision surfaces are Story 6.8.

---

## Notes for the implementer

- **Depends on 6.10** — the bell icon and `/alerts` screen scaffold come from 6.10. Don't start this until 6.10 has at least the routing + bell icon merged.
- **Test data**: at launch the inbox will be mostly empty for most users. Make the empty state polished — it's the experience most early adopters see.
- **Runtime feature flag** — same `flags.alertsLoop` pattern as 6.10. Backend endpoints can be unguarded (no driver client calls them when flag is off).
- **Migration applied manually per project memory** (`project_staging_predeploy_broken`).
- **Re-using existing notifications.controller vs new alerts.controller**: choose based on which keeps the code simpler. The current `notifications.controller` is just prefs (GET/PATCH); spinning up a parallel `alerts.controller` for inbox endpoints reads cleaner. Don't merge them under a single controller unless there's a clear benefit.
- **`alert_type` as string vs enum**: the spec deliberately keeps it as a string column (not a Prisma enum) so 6.1/6.2/6.5 can add new types via additive code change without schema migrations. Centralise the known values in a TS const + i18n key map; treat unknown values gracefully in the UI (fall through to body text).
- **Don't backfill historical pushes** — the small handful of pushes 6.3-lite has sent in prod aren't in the DB. Accept the gap; drivers see only alerts sent from this story onward.
