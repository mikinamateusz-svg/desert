# Story 6.10 — Deferred Follow-ups

These items surfaced during the bmad-code-review on **2026-05-09**. Each is either a pre-existing pattern not caused by 6.10, low-priority polish, or a follow-up too big to fold into this story.

---

## Deferred items

### Test coverage gap for new services
- **`PremiumAlertsService.extendForUser`** has no dedicated unit tests. Idempotency (MAX semantics never going backward), happy path, and error swallow behaviour are all unverified at the unit level. The existing call-site tests (admin-submissions / photo-pipeline specs) only mock the service.
- **`PremiumExpiryWarningService.sendExpiryWarnings`** — no tests for the candidate query, dedup behaviour, or audit-log writes.
- **`bellState()` pure helper** — boundary cases (exactly-now, exactly-3d, NaN, negative offset) deserve unit tests.

**How to apply**: in a follow-up dev pass, add `*.spec.ts` files for the three above. ~1-2h dev. Worth doing before the next story that touches the alerts loop.

### `Translations` type definition for mobile i18n
The 6.10 spec called for "missing keys cause CI type-check to fail" via a `Translations` type. The mobile codebase doesn't currently have such a type — locale files are plain object literals. Adding it requires generating a type from one of the locale files (typically the canonical PL) and constraining `en.ts` / `uk.ts` to match. Not specific to 6.10 — affects all i18n stories.

**How to apply**: cross-cutting work; defer to a dedicated i18n-hardening story or fold into the next major locale change. Pre-existing pattern.

### Worker concurrency control for multi-instance deploys
`PremiumExpiryWarningWorker` uses BullMQ default concurrency. In a multi-instance API deploy, two pods could both pick up the daily fire and race to send pushes before the dedup keys land — risking duplicate warnings to every eligible user. Same pattern as the existing `PriceRiseAlertWorker` and `OrlenIngestionWorker`; not new with 6.10.

**How to apply**: before scaling beyond the current single-instance Railway deploy, add `concurrency: 1` to all BullMQ workers. Or use a Redis advisory lock. Cross-cutting, defer to ops-readiness story.

### Bell-icon stale state for sessions straddling expiry
The bell icon doesn't have an internal `setInterval` to re-render purely due to time passing. A long-lived session crossing the expiry boundary will show stale `expiring` state until the next `usePremiumAlertsStatus` refetch (app foreground). At launch scale this is an edge case nobody will hit; revisit if real-world reports come in.

**How to apply**: add a `setInterval` clock-tick in the hook (1-minute cadence) that re-evaluates state without a network call. Cheap.

### Existing opted-in users lose alerts at deploy
Pre-6.10 users with `sharp_rise: true` were receiving price-rise pushes; post-deploy they'll silently stop until they earn premium via a verified contribution. Spec explicitly chose no-backfill. Worth a one-time outreach — push or email — explaining the change. Not a code task.

**How to apply**: marketing / comms. Mention the new contribution loop in a launch announcement. Coordinate with launch campaign work (Topic 4).

### `PriceRiseAlertWorker` separate Redis connections
Pre-existing pattern in BullMQ workers (Queue + Worker on shared connection). Same `D4 (2.8)` deferred item from prior reviews. 6.10's `PremiumExpiryWarningWorker` follows the same pattern.

**How to apply**: rolled up into the multi-instance ops-readiness story above.

### Bell icon position vs spec wording
Spec said "alongside `topBarHeight`" (`insets.top + 44`). Implementation uses `topInset + 12` — visually in the top-right chrome area but technically above the top-bar centre line. Reviewer flagged as a minor deviation. No functional impact; matches typical iOS/Android top-corner icon positioning.

**How to apply**: consider re-positioning to `topInset + 14` after first user feedback if it feels too high. Not blocking.

### `getAlertsStatus` doesn't trigger refetch after submission verify
The hook refetches on `AppState.active`, but if a user submits a photo, stays on the activity screen, and the verification lands while the app is still foregrounded, the bell icon won't refresh until the next foreground event. Acceptable at current cadence — verifications take seconds and most users will navigate away to the map after submission, naturally triggering the foreground refetch. If real-world feedback shows users sitting on activity for verifications, expose a `refetch()` and call from the activity-screen `useFocusEffect`.

**How to apply**: small follow-up. Hook already exposes `refetch`; just need to wire from a `useFocusEffect` hook in `activity.tsx`.

### Worker schedule timezone documentation
Spec said "09:00 UTC". Implementation uses `Europe/Warsaw` (line in `premium-expiry-warning.worker.ts`) — chosen for the matching morning-commute argument. Functionally fine but spec deviation.

**How to apply**: amend the spec to acknowledge Warsaw is the operative timezone. Already implicit in the comment on the worker; making it explicit in the spec doc closes the loop.

---

## Triage record

This list captures the `defer` bucket from the 6-10 bmad-code-review. The `patch` bucket (P1–P9: confirm-modal activate-vs-extend conditional copy + NEW_DATE, AdminAuditLog writes for warning pushes, dedup key prefix rename to spec, flags.alertsLoop default-off semantics, LAST_SEEN_KEY per-user namespacing, exclude soft-deleted users from recipient queries, rate-limit `/alerts-status`, partial index on `premium_alerts_active_until`, NaN guards in bellState) was applied in the same commit. The `bad_spec` bucket flagged the worker timezone (UTC vs Warsaw) and AC8 conditional copy wording — both fixed by patching the implementation, not amending the spec. The `reject` bucket (migration timestamp post-dating, build-time `AUTO_DISMISS_MS` constant) was discarded as noise.

---

## Re-surfaced during 6.13 code review (2026-05-12)

The 6.13 rename review re-flagged a set of pre-existing 6.10 design points that 6.13 did not introduce or modify but that the new reviewers caught independently. Logging here so they don't get lost a second time. None are blockers; all are inherited design choices.

### `extendForUser` swallows DB errors as warn-only
The service writes via raw `$executeRaw` and logs a `warn` on failure without retry, dead-letter, or metric. Pre-existing 6.10 "best-effort" design (next verified submission catches up). Worth at least a counter increment + structured error log if alerts-loop traction grows.

### Raw SQL casts `${newUntil}::timestamp` instead of `::timestamptz`
The Prisma column is `DateTime` (which Prisma maps to `timestamp(3)` without time zone, per the original `add_user_premium_alerts_active_until` migration). The cast is technically consistent with the column type — but it relies on session `TimeZone` being UTC for the JS-Date round trip to be lossless. Worth a fixture test that asserts the stored value matches NOW + 30d ± 1s regardless of session TZ.

### `extendForUser` doesn't check row-count
A typo in `userId`, a deleted user (the service doesn't filter `deleted_at: null` — only the warning service does), or a missing row all silently succeed with zero updates. Counter + log on `affectedRows === 0` would surface the failure shape.

### `PUSH_TITLE` / `PUSH_BODY` hardcoded in Polish
The service hardcodes Polish copy for the expiry-warning push. EN/UK users with `sharp_rise: true` receive Polish push. Pre-existing 6.10 — the warning is the only push surface that doesn't go through i18n. Resolve via `user.preferred_language` lookup + server-side i18n table when the user surface grows beyond PL.

### DriverAlert insert before push; dedup write after push
Current ordering is: write DriverAlert row → send Expo push chunk → set dedup key. A push failure mid-chunk leaves users with an inbox row but no push, and the worker re-processes them on the next tick (no dedup yet) — producing a *second* DriverAlert row from the same event. Spec'd at 6.10; worth a "lease then act" rewrite eventually.

### Worker's blocking ioredis has no `.on('error')` handler
Unhandled `error` events on ioredis crash the Node process. Combined with `maxRetriesPerRequest: null` (correct for BullMQ blocking commands) the worker will retry forever silently if Redis is partitioned, then die hard on the next emitted error. Pre-existing across all hardening-2 workers — fold into the redis-pipelining observability story (memory `project_redis_pipelining_observability.md`).

### `attempts: 2` with flat 30-min backoff for daily cron
A transient Redis blip → one retry 30 min later → if both fail, the day's nudges are lost with no escalation. Pre-existing 6.10. Worth bumping to `attempts: 4` with exponential backoff once alerts-loop is past launch-week.

### `bellState` not periodically re-evaluated while foregrounded
The hook refetches on app foreground; a long-lived session crossing the expiry boundary mid-foreground shows stale `expiring` for up to one foreground cycle. Same finding as the original 6.10 deferred list. Cheap fix: 1-minute `setInterval` in the hook.

### `AdminAuditLog.admin_user_id` stores push-recipient userId
Schema abuse — the column semantically means "admin who took an action", not "user the action targeted". Pre-existing 6.10 workaround acknowledged in code comments. Any analytics or RBAC query that groups by admin will incorrectly count push recipients as admin actors. Proper fix is a new `SystemAuditLog` table or a nullable `actor_admin_id` + `target_user_id` split.

### `useAlertsStatus` collapses 401/403 to "no active window"
A stale token causes the bell to silently flip to inactive even if the user has an active window. Pre-existing 6.10 hook design. Surface differently from the empty-state — at least a one-time refresh-token attempt before falling back.

### Multi-pod race on BullMQ repeatable-job add
Two API replicas booting in parallel both call `queue.add(..., { jobId: 'alerts-expiry-warning-daily', repeat })`. BullMQ dedupes by jobId so the second add is a no-op, but the race window is real. Currently safe per `project_cron_worker_multipod.md` — single-replica MVP — but must be gated by `WORKER_ENABLED` env before scaling.
