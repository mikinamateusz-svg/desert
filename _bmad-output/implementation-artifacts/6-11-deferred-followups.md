# Story 6.11 — Deferred Follow-ups

These items surfaced during the bmad-code-review on **2026-05-09**. Each is either a pre-existing pattern not caused by 6.11, low-priority polish, or a follow-up too big to fold into this story. The 16 inline patches (P1-P16, minus P5 noted below) were applied in the same commit; this document captures everything else.

---

## Deferred items

### Per-user throttle tracker (was P5; reclassified to defer)
The new `GET /v1/alerts` endpoint inherits the global per-IP throttler. Behind a NAT, multiple users contend for the same 60/min bucket. Implementing a per-user tracker requires subclassing `ThrottlerGuard` at the module level — affects every throttled endpoint in the app, not just the inbox.

**How to apply:** add a custom `UserAwareThrottlerGuard extends ThrottlerGuard { protected getTracker(req) { return req.user?.id ?? req.ip } }` and swap it in `app.module.ts`. Cross-cutting, defer to an ops-readiness story or fold into the rate-limiting hardening pass.

### Dedicated lightweight `/v1/alerts/unread-count` endpoint
The bell's auto-refresh hook calls `apiGetAlerts(token, 1, 1)` — fetches a 1-row page just to read the `unread_count` aggregate. The list endpoint runs `findMany + count + count` even for `limit=1`, doing two unnecessary count queries on every foreground tick. At launch volumes (<100 alerts per user) the cost is negligible; revisit if the alerts loop scales.

**How to apply:** new `GET /v1/alerts/unread-count` returning `{ unread_count: number }`, swap the bell to call it. ~30 min dev.

### `alert_type` shared TypeScript constant + i18n key map
The schema column is intentionally free-form text so 6.1/6.2/6.5 can add new types without migrations. Spec recommends "centralise known values in a TS const + i18n key map; treat unknown values gracefully in the UI." We ship two known types (`price_rise`, `premium_expiring_warning`) hard-coded as string literals in two services; mobile renders by trusting `row.title`/`row.body` and ignores `alert_type` entirely. Worth introducing the const before the third type lands.

**How to apply:** add `packages/types/src/alertTypes.ts` exporting the union + a TYPE_TO_I18N_KEY map. Extract literals from services. Defer to first-of-{6.1,6.2,6.5}.

### `DriverAlert.payload` size cap / schema validation
JSONB column is unbounded. Currently writers are internal services with bounded payloads (`signalTypes` is a small string[]; expiring warnings carry only a deepLink). Future stories could add user-controlled or larger fields. No max-bytes guard, no per-type schema. Defensive concern, not blocking.

**How to apply:** add a Postgres CHECK constraint on `pg_column_size("payload") < 4096` and per-type Zod schemas in services. ~1h dev. Defer.

### Locale staleness in inbox titles/bodies
`PriceRiseAlertService` writes English `PUSH_TITLE` / `PUSH_BODY` to the DriverAlert row regardless of the user's locale (the existing 6.3-lite push has no locale-aware sending). `PremiumExpiryWarningService` uses Polish strings for the same reason. The inbox renders these stored strings as-is, so a user who switches device language after receiving the alert sees the original-language title/body.

**How to apply:** redesign push composition to use i18n keys + recipient locale (requires a `locale` field on `User` or `NotificationPreference`). Cross-cutting; defer to an i18n-hardening story.

### Controller-layer integration tests for the inbox
`alerts-inbox.service.spec.ts` covers service-level unit tests. Missing: auth-guard behaviour, throttle enforcement, route-order correctness (`/read-all` literal before `/:id/read` parameterised), query-param edge cases via the HTTP layer. Same pattern gap as most other Nest controllers in the repo.

**How to apply:** add Nest `Test.createTestingModule` end-to-end controller specs with a real or in-memory `request(app.getHttpServer())`. ~1h dev. Defer to the test-coverage hardening pass.

### Relative-time auto-refresh in the inbox
`formatRelativeTime` snapshots `Date.now()` at render time. A row showing "2 min ago" stays "2 min ago" until the FlatList re-renders for an unrelated reason. Long-lived sessions accumulate stale labels.

**How to apply:** add a `setInterval` clock-tick in the inbox component (1-minute cadence) that triggers a re-render. Cheap. Same family as the bell-icon stale-state defer from 6.10.

### `DriverAlert` retention policy
No archival/cleanup worker. Every push creates a row; with 10K active users and weekly alerts, ~500K rows/year. Storage is cheap on Neon, the partial unread index keeps the unread-count query fast, but eventually we'll want a TTL or rolling cap.

**How to apply:** new daily worker `DriverAlertCleanupWorker` that deletes rows older than N days (12 months?). Defer to ops-readiness story.

### `onEndReachedThreshold: 0.4` may fire eagerly on short lists
Pre-mature `onEndReached` triggers when the user has scrolled 40% from the end. On a list of 5-10 rows the threshold can fire on initial render. The `loadingMore || !hasMore` guard prevents a doomed fetch (after P10's `hasMore: false` default), but the threshold is worth tuning if real-world reports show it firing too aggressively.

**How to apply:** lower to `0.2` after first user feedback. Not blocking.

### Per-recipient sequential `driverAlert.create` could bottleneck at scale
`PriceRiseAlertService` and `PremiumExpiryWarningService` await each create serially. With 100 opted-in users and a 10ms-per-insert RTT, that's a 1s pre-flight before any push fires. At launch (a handful of opted-in users) negligible.

**How to apply:** swap to `Promise.allSettled(preferences.map(...))` once recipient counts cross ~50. Trivial change.

### `apiGetAlerts` non-2xx throws plain `Error`
Other mobile API helpers in the repo follow the same pattern — generic `Error` with status in the message, no typed `ApiError` / `AuthError` for refresh-flow integration. The inbox's `loadPage` catch-all swallows everything to keep the UI responsive; an expired-token 401 won't trigger the auth refresh.

**How to apply:** introduce a typed `ApiError` in `apps/mobile/src/api/` and standardise across all helpers. Cross-cutting; defer to an API-client refactor. (Note: `apiMarkAlertRead` was given a typed `AlertsApiError` in 6.11 P8 because the inbox specifically needs to branch on 404. The wider rollout stays deferred.)

### `Translations` type for compile-time i18n key coverage
Same gap deferred from 6.10. Mobile locale files are plain object literals; `Translations` type doesn't exist, so AC11 ("missing keys cause CI type-check to fail") is currently enforced by manual diff diligence rather than the type system.

**How to apply:** generate a type from the canonical PL locale and constrain `en.ts` / `uk.ts` to match. Cross-cutting i18n-hardening story.

### Bell hook re-fetch on `/alerts` screen mount (T10/AC9 deviation)
Spec T10 review note says "Hook should re-fetch on screen-mount, not just on app foreground." Implementation only fetches on mount (of the bell) + on `AppState 'active'`. The inbox screen's own fetch pushes the count via `setAlertsUnreadCount` so the badge stays coherent in practice — meeting AC10's outcome — but the hook itself doesn't subscribe to navigation focus.

**How to apply:** add a `useFocusEffect` integration in the bell to refetch when the parent screen regains focus. Minor; likely not worth doing until a real-world scenario surfaces a stale-badge complaint.

### T2 strict transaction wrapping
Spec T2 wording: "Insert a `DriverAlert` row inside a transaction. On commit, send the Expo push." Implementation does serial `await create()` → assemble messages → `sendInChunks()`. The serial await is functionally equivalent to the spec's atomic intent (no orphan pushes), but the literal `prisma.$transaction` boundary isn't there. Closes the gap if a stricter reader pushes back.

**How to apply:** wrap the create in `await this.prisma.$transaction(async (tx) => tx.driverAlert.create({...}))`. Cosmetic — the surrounding `try/catch` already gives the same observable behaviour. Defer unless the spec is amended to require it.

---

## Triage record

This list captures the `defer` and `bad_spec` buckets from the 6-11 bmad-code-review. The `patch` bucket (P1-P16, applied in the same commit):

- **P1** — `markRead` switched to atomic `updateMany` claim with disambiguating `findFirst` fallback; eliminates the concurrent-tap race
- **P2** — `MAX_PAGE = 10_000` clamp on the inbox `?page` parameter
- **P3** — `clampInt` helper replaces `parseInt(x) || fallback` so `?limit=0` clamps to 1 instead of silently becoming 20
- **P4** — `recordAlertedTypes` now skipped when 100% of `DriverAlert.create` calls failed (matches `PremiumExpiryWarningService`'s policy — DB outage shouldn't suppress retries)
- **P5** — *deferred* (per-user throttle tracker; module-level surgery, see top of this doc)
- **P6** — partial index `WHERE read_at IS NULL` instead of full `(user_id, read_at)`; schema.prisma updated to not regenerate the dropped index
- **P7** — symmetric `incrementAlertsUnreadCount` helper; rollback no longer reads stale closure value
- **P8** — `AlertsApiError` typed surface; inbox removes the row on 404 instead of looping infinite re-tap
- **P9** — `loadError` state + retry button; empty-state copy no longer masquerades for fetch failure
- **P10** — `hasMore` defaults `false`; only flipped true by a successful response
- **P11** — de-dupe on merge in `loadPage` so pagination races / new-row-during-scroll don't produce duplicate React keys
- **P12** — mark-all rollback restores full snapshot (items + unread count) instead of refetching page 1 and dropping pages 2..N
- **P13** — `cancelledRef` threaded into `loadPage`; setStates after unmount skipped
- **P14** — explicit negative-diff branch in `formatRelativeTime`; future timestamps no longer silently coalesce to "just now"
- **P15** — `Alert.alert(t('alerts.inbox.markedAllReadToast'))` wired on successful mark-all-read
- **P16** — comment fix in `useAlertsUnreadCountAutoRefresh` clarifying flag-off behaviour writes 0 to the store

The `bad_spec` bucket (S1: payload field shape) was applied by amending the spec inline — `signalTypes` (plural) and `fuelTypes` removed, since the existing `SignalType` enum already encodes both source and fuel type. The `reject` bucket (9 items: missing `@UseGuards` despite app-level globals, mock-leak claims, CASCADE-vs-soft-delete, EN plural CLDR rules, sensible deviation flags on throttle/limit/date-fns) was discarded as noise.
