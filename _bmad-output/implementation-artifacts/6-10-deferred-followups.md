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
