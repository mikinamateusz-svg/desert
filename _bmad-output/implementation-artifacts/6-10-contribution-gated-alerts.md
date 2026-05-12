# Story 6.10: Contribution-Gated Price Alerts + Bell + Status

Status: needs-rework

> **⚠️ NEEDS REWORK 2026-05-10:** This story's MECHANIC remains correct (verified photo → 30-day alert window → renew). The NAMING is wrong throughout — "premium alerts" framing has been retired per four-pillar positioning lock-in (see `project_litro_positioning.md`). Alerts are core to the product, gated by contribution but never paid; "premium" implies a paid tier, which is not the model. **Story 6.13 (Premium → Price Alerts Rename)** carries the coordinated rework: DB column rename, service rename, component rename, ~30 i18n strings, this spec rename, line 35 rationale rewrite. Do NOT undo Story 6.10's behaviour — only the names change. PL canonical: *alerty cenowe*; EN: *price alerts*; UK: *цінові сповіщення*.

Status (historical): ready-for-dev

**Trigger:** 2026-05-08 — soft-launch engagement design. Today's `PriceRiseAlertService` (Story 6.3 lite, commit `afd6391`) sends pushes to *every* opted-in driver regardless of whether they contribute photos. Operator wants to use alerts as a reward loop: drivers who submit a photo "earn" a 30-day premium-alert window. Reinforces submission behaviour without taking anything away from drivers who don't (basic alerts — when we add them later — stay universal).

**Phase:** **1 (launch-week engagement loop)** — promoted from Phase 2 on 2026-05-08. The alerts loop is the primary carrot for first-week contributors and is needed at launch to feed the data flywheel. Wrap the user-visible surface in a per-feature runtime flag (e.g. `flags.alertsLoop`) per project memory `feedback_feature_flags.md` — default off on prod until marketing campaign launches, default on for staging. Backend gating is additive and lives behind the mobile flag's entry points.

**Coupled stories already shipped:**
- 6.3 (lite) — `PriceRiseAlertService` is the target alert this story gates.
- 6.0 (Orlen rack ingestion) — produces `MarketSignal` rows the alert service consumes.

**Coupled stories still spec-only (relevant adjacencies):**
- 6.4 (Alert Preferences & Settings Panel) — full prefs panel. This story does a *minimal* relocation of the existing basic prefs UI to a stable home; 6.4 will rebuild that surface properly later.
- 6.11 (Alerts inbox) — adds the inbox section + read/unread badge logic. Built on the alerts-screen frame this story sets up.

---

## Story

As a **driver**,
I want my premium alerts to activate (or extend) when I submit a verified photo, with a clear status indicator so I always know when they expire and how to extend them,
so that I get a reason to keep contributing photos and a fair shake when I do.

As an **operator**,
I want the rare attention currency of push notifications to flow only to drivers who help us maintain data freshness,
so that the cost-to-value ratio of pushes stays sane and we don't burn engagement on free-riders.

### Why

Push notifications are one of the highest-value attention surfaces in a mobile app. Today every driver who toggles them on receives them, regardless of whether they contribute. That's generous in a vacuum but doesn't reinforce the behaviour we need most (photo submissions for data freshness). A simple loop — *contribute a verified photo → 30 days of premium alerts; expire if you don't* — turns the alert into a reciprocal reward.

Crucially: this is *additive*, not subtractive. We're not taking alerts away from drivers who already had them. We're framing alerts as a *bonus* contributors enjoy. Non-contributors still get every other app feature. A driver who never enables notifications never sees a difference.

The premium tier's value drives a tighter feedback loop than abstract appeals to civic participation, and it gives the marketing campaign a concrete "what do I get?" answer.

---

## Acceptance Criteria

**AC1 — `User.premium_alerts_active_until` column added (additive migration):**
Given the `User` table,
When the migration `20260509000000_add_user_premium_alerts_active_until` (or similar) runs,
Then a nullable `TIMESTAMP(3)` column `premium_alerts_active_until` is added,
And every existing user row has `NULL` (no backfill — premium starts only after the next verified contribution).

**AC2 — Premium window extension on `verified` status flip:**
Given a `Submission` row whose `status` transitions to `verified` (i.e., the row's `status` was anything else immediately prior, and the post-update value is `verified`),
When the photo-pipeline finalises that transition,
Then the user's `premium_alerts_active_until` is updated to `MAX(current_value, NOW() + INTERVAL '30 days')`,
And the update is idempotent (re-running the same submission's verification doesn't pile on extra days),
And the operation is wrapped in the same transaction that flips the submission status (or, if cleaner, an event-driven follow-up — but never as a separate non-atomic write that can drift),
And no extension occurs if the user's `Submission` count is `0` after this row's transition is rolled back (defensive — should never happen in practice but makes the invariant explicit).

The 30-day constant lives in a single backend constant `PREMIUM_ALERT_WINDOW_DAYS` so 6.4 / future tuning can adjust it from one place.

**AC3 — `PriceRiseAlertService` gates recipients by active premium status:**
Given the existing `PriceRiseAlertService.sendRiseAlerts` selects opted-in users,
When it builds the recipient list,
Then it filters to users whose `premium_alerts_active_until > NOW()`,
And users with `NULL` or past-expiry `premium_alerts_active_until` are excluded — they receive no push,
And the filter is applied at the SQL level (added predicate to the existing query) — not in application memory after fetch,
And dedup keys / cost-cap accounting from 6.3 lite remain unchanged.

**AC4 — 3-day pre-expiry warning push:**
Given a user has `premium_alerts_active_until` between `NOW() + 2d` and `NOW() + 4d`,
And the user has not received a `premium_expiring_warning` push in the last 14 days,
When the daily warning worker runs (new `PremiumExpiryWarningWorker`, scheduled at 09:00 UTC),
Then a push notification is sent: title "Twoje alerty premium wygasają wkrótce" / body "Zrób zdjęcie cen paliw, aby przedłużyć alerty o kolejne 30 dni." (PL canonical; EN/UK fall through),
And the deep link routes to `/(app)/alerts`,
And a Redis dedup key `premium_expiring_warning:{user_id}` is set with 14-day TTL after sending.

The warning push is itself a premium alert and only fires for users whose premium tier is currently active — there's no scenario where a non-contributor sees this push.

**AC5 — Bell icon in map header chrome:**
Given an authenticated driver on the map screen,
When the screen renders,
Then a bell icon appears in the top-right of the chrome layer (above the map tiles, alongside `topBarHeight` from `apps/mobile/app/(app)/index.tsx:50`),
And the icon has three states driven by `premium_alerts_active_until` and `NOW()`:

| State name | Visual | Condition |
|---|---|---|
| `inactive` | Outline bell, neutral grey (`tokens.neutral.n400`) | `premium_alerts_active_until` is null OR ≤ NOW |
| `active` | Filled bell, brand colour | `premium_alerts_active_until` > NOW + 3 days |
| `expiring` | Filled bell + warning-coloured dot/exclamation badge | `NOW < premium_alerts_active_until ≤ NOW + 3 days` |

And tapping the bell in any state navigates to `/(app)/alerts`,
And the icon is not rendered when the user is unauthenticated (guest mode).

**AC6 — Status banner on `/alerts` screen:**
Given the user opens `/(app)/alerts`,
When the screen renders,
Then a status banner is the topmost element with copy that depends on the bell-icon state:

| Bell state | Banner copy (PL canonical) | CTA |
|---|---|---|
| `inactive` | *"Włącz alerty premium — zrób pierwsze zdjęcie cen paliw, aby uruchomić powiadomienia o ruchach na rynku."* | `Zrób zdjęcie` → routes to `/(app)/capture` |
| `active` | *"Alerty premium aktywne do <DATE>."* (locale-formatted date) | none |
| `expiring` | *"Alerty premium wygasają za <N> dni — zrób zdjęcie, aby przedłużyć o 30 dni."* | `Zrób zdjęcie` → routes to `/(app)/capture` |

EN/UK translations follow the same structure.

**AC7 — Existing prefs UI relocated out of `/alerts`:**
Given the current `apps/mobile/app/(app)/alerts.tsx` houses notification permission flow + per-type prefs toggles,
When this story ships,
Then the prefs UI is moved to a new route `/(app)/notifications` (existing component reused — minimal logic change),
And the Account screen gains a "Notifications" line item routing to `/(app)/notifications`,
And the alerts screen retains: status banner (AC6) only at this story's completion (Story 6.11 will add the inbox section between banner and… nothing else),
And the "feature gate" guard for unauthenticated users on the prefs screen continues to work as it does today.

This is a *minimal-viable relocation*. The full prefs-panel rebuild is Story 6.4's job; this story just moves the existing UI to a stable home so the alerts screen can become bell-tap-destination without prefs noise.

**AC8 — Thank-you / confirm modal copy update on capture flow:**
Given the post-capture confirmation flow (existing in `apps/mobile/app/(app)/confirm.tsx` or equivalent),
When the modal renders after a successful submission,
Then it includes a clear line about the alerts loop:

- If user's pre-submission `premium_alerts_active_until` was null/past: *"Po weryfikacji zdjęcia uruchomimy Twoje alerty premium na 30 dni."*
- If it was active and contribution will extend it: *"Po weryfikacji zdjęcia przedłużymy Twoje alerty premium do <NEW_DATE>."*

And a small footnote-style line follows the main message: *"Tylko zweryfikowane zdjęcia przedłużają alerty"* (PL canonical) — visually subordinate (smaller / italic / muted), to set honest expectation that a rejected submission (no station match, blur, etc.) won't move the date forward.

The copy is conditional on whether this contribution will *activate* or *extend*. NEW_DATE is computed client-side from `MAX(current_active_until, NOW + 30d)`. PL canonical; copy review is its own pass — the AC just specifies the slot exists and the conditional structure.

(*Note: the disclaimer line is also called out by Story 3.20 AC8. Whichever story ships first owns the copy; the other should verify the line is present and consistent.*)

**AC9 — Activity-screen confirmation banner on first verified-after-submission view:**
Given the user submits a photo and it eventually transitions to `verified`,
When the user next opens the activity screen,
Then a one-time, dismissible banner appears at the top of the activity list: *"Alerty premium aktywne do <DATE>"* (or extended-to date),
And the banner is dismissible via a close button OR auto-dismisses on next screen visit (whichever is simpler — favour auto-dismiss if state-tracking is heavier),
And the banner does not re-appear for the same submission verification event.

Implementation hint: a `last_seen_premium_alerts_active_until` AsyncStorage key on the mobile client. When the activity screen loads, compare `user.premium_alerts_active_until` against the stored value; if newer, show banner and update storage.

**AC10 — i18n coverage:**
Given the new copy across AC4 / AC6 / AC7 / AC8 / AC9,
When mobile renders,
Then PL is canonical and complete; EN/UK are translated and present in the `Translations` type,
And missing keys (silent runtime failure risk) cause CI type-check to fail.

**AC11 — Per-feature runtime flag wrap:**
Given the project convention `feedback_feature_flags.md` (user-facing changes ship behind a feature flag; default off on prod, on for staging),
When the bell icon, alerts-screen banner, capture-modal copy, activity banner, and Account "Notifications" link render,
Then they are gated by a per-feature runtime flag (e.g. `flags.alertsLoop`),
And the prod build with the flag off shows none of these affordances,
And staging builds with the flag on expose the full surface,
And the flag is intended to flip on for prod at the marketing-campaign launch moment — not before.

Backend (gating predicate, warning worker, premium-window updates) is **not** flag-gated — additive and harmless to ship dark; until the mobile flag flips, no client surfaces the feature so backend code is dormant in practice.

---

## Tasks

### Backend (T1–T4)

**T1 — Schema + migration:**
- Add `premium_alerts_active_until DateTime?` to `User` in `packages/db/prisma/schema.prisma`.
- Migration `20260509000000_add_user_premium_alerts_active_until` (or next available timestamp) — single `ALTER TABLE` adding the column. No backfill.
- `PREMIUM_ALERT_WINDOW_DAYS = 30` constant in a shared API const file.

**T2 — Premium-window extension on `verified` flip:**
- Locate the path that flips a submission to `status: 'verified'` — likely in `photo-pipeline.worker.ts` or `submissions.service.ts`. There may be more than one entry point (admin approve, automatic verify); audit and make extension fire from each.
- Compute `newUntil = max(currentUserValue, NOW + 30d)`. SQL form: `GREATEST(COALESCE("premium_alerts_active_until", NOW()), NOW() + INTERVAL '30 days')`.
- Wrap in the same transaction as the status flip where possible. If the existing flip is in a separate boundary, factor a small helper `extendPremiumAlertsForUser(userId)` and call it post-flip in the same async sequence.
- Idempotency: re-running on an already-verified submission should be a no-op (`MAX` math handles this — the value never goes backward).

**T3 — Recipient gating in `PriceRiseAlertService`:**
- Modify the SQL query that selects recipients to add the predicate `premium_alerts_active_until > NOW()`.
- Update tests: existing recipient-count assertions need to seed `premium_alerts_active_until` for opted-in users that should receive the push.
- No change to dedup logic, cost-cap accounting, or the "send within 2h of signal" window.

**T4 — `PremiumExpiryWarningWorker`:**
- New worker scheduled daily at 09:00 UTC (matches Polish morning when most drivers commute).
- Query: `User WHERE premium_alerts_active_until BETWEEN NOW + 2d AND NOW + 4d AND notification_token IS NOT NULL` (re-use whichever push-token field exists).
- For each user, check Redis key `premium_expiring_warning:{user_id}` — skip if set.
- Send Expo push via the existing `IExpoPushClient`. Dedup key `premium_expiring_warning:{user_id}` with 14-day TTL.
- Audit log row per send (`AdminAuditLog` admin_user_id = system, action = `PREMIUM_EXPIRING_WARNING_SENT`, notes JSON includes user_id and active_until).
- Error handling: per-user push failures don't block the batch (try/catch each, log and continue).

### Mobile UI (T5–T9)

**T5 — `BellAlertIcon` component + map header wiring:**
- New component at `apps/mobile/src/components/alerts/BellAlertIcon.tsx`.
- Reads current user's `premium_alerts_active_until` from auth store / user query.
- Computes state via a pure helper `bellState(activeUntil: Date | null, now: Date): 'inactive' | 'active' | 'expiring'`.
- Renders Ionicons bell variants with token-based colours; warning badge as an overlaid 8×8 dot.
- Tap → `router.push('/(app)/alerts')`.
- Wire into `apps/mobile/app/(app)/index.tsx` map header chrome (top-right, above `topBarHeight + 16` so it doesn't collide with fuel selector / location-denied banner).
- Wrap render in `flags.alertsLoop` check.

**T6 — `/alerts` screen rebuild as status-only surface:**
- Rebuild `apps/mobile/app/(app)/alerts.tsx`:
  - Top: status banner driven by `bellState` value (copy per AC6, with action CTA where applicable).
  - Below: empty space (Story 6.11 fills with inbox).
  - **Remove**: notification permission flow, prefs toggles, FeatureGateSheet — all migrated to T7.
- Banner is a server component / static render; CTA buttons are minimal client components.
- Wrap in `flags.alertsLoop` so `/alerts` route is hidden when flag is off.

**T7 — Prefs UI relocated to `/(app)/notifications`:**
- New route file `apps/mobile/app/(app)/notifications.tsx`.
- Move the existing prefs UI from `alerts.tsx` (notification permission flow, prefs API calls, FeatureGateSheet) verbatim to the new route. No logic change.
- Update Account screen to add a "Notifications" / "Powiadomienia" line item routing to the new route (locate the Account screen's link list and slot it in alongside existing items).
- Keep the existing notification-permission re-prompt logic intact (the part that uses `apiGetSubmissions` to detect contributors).
- Wrap in `flags.alertsLoop`.

**T8 — Capture-flow thank-you modal copy:**
- Locate the post-submission confirmation (likely `apps/mobile/app/(app)/confirm.tsx` and/or a modal component in `apps/mobile/src/components/capture/`).
- Add the conditional alerts-loop line per AC8.
- Compute `newUntil = MAX(user.premium_alerts_active_until ?? Date.now(), Date.now() + 30d)` client-side; format date locale-aware.
- Wrap the new line in `flags.alertsLoop` so prod APKs with the flag off see no change.
- Copy review pass: defer to a copywriter / native-speaker review before final ship.

**T9 — Activity-screen verified-banner:**
- Add a banner component to `apps/mobile/app/(app)/activity.tsx` activity-screen list header.
- AsyncStorage key `desert:lastSeenPremiumAlertsActiveUntil`.
- On screen mount: read AsyncStorage value + current `user.premium_alerts_active_until`. If current is newer, render banner + update AsyncStorage. Banner has dismiss button (closes immediately) and auto-dismisses on next mount regardless.
- Wrap in `flags.alertsLoop`.

### i18n (T10)

**T10 — Translations + type:**
- New keys under a `premiumAlerts` block in `apps/mobile/src/i18n/locales/{pl,en,uk}.ts`:
  - `bellTooltip` (per state — inactive/active/expiring)
  - `statusBanner.{inactive,active,expiring}` with templated date / N
  - `confirmModal.activate` / `confirmModal.extend`
  - `activityBanner.activeUntil`
  - `notifications.menuItem` (Account screen line item label)
  - Warning push title + body (used by backend, but copy lives here for translator review)
- Add typing to the i18n type definition so missing keys surface at type-check.

### Code review (T11)

**T11 — Run `bmad-code-review` after dev complete.** Focus areas:
- Idempotency of T2 — does a manual admin re-approval correctly yield no extra days?
- T3 query plan — is the `premium_alerts_active_until > NOW()` predicate using an index? Add `(premium_alerts_active_until)` partial index `WHERE notification_token IS NOT NULL` if recipient queries become slow.
- T4 cron clock-skew tolerance — what if the scheduler fires at 09:01 UTC vs 08:59? The 2d–4d window is wide enough to absorb but worth confirming.
- T5 bell icon state computation — what about clock skew on the device (forward-skewed clock makes everything look expiring)? Defensive: clamp `now()` based on a server-time hint if available, else accept the device-clock answer.
- T7 link from Account screen — does it survive guest mode (where Account shows minimal content)?
- T9 AsyncStorage key — what if the user changes accounts on the same device? The banner could replay for a new user with a different `premium_alerts_active_until` history. Acceptable (rare) or worth namespacing the key by `user_id`?
- T11 i18n keys — are all new keys present in the `Translations` type and all three locales (silent runtime failure risk)?

---

## Out of Scope

- **Inbox / past alerts list / read-unread state** — Story 6.11.
- **Non-rise alerts (price drop, monthly summary, etc.)** — separate Epic 6 stories. This story gates the *one* alert that exists today.
- **Granular per-alert-type prefs** — Story 6.4.
- **Cap on accumulated premium days** (e.g., "max 60 days from rapid contributions") — defer until we see actual abuse. Each contribution still only buys 30 days from *now*; no accumulation.
- **Different windows for power contributors** (e.g., ≥5 verifications in a month → 60-day window) — defer until launch data exists.
- **Refund / restore flow** if a contribution is later un-verified by an admin — out of scope; admins can manually adjust `premium_alerts_active_until` if needed (rare).
- **In-app purchase / paid premium tier** — distinct concept, distinct epic.
- **Streak counter / gamification surfaces** — Activity screen already touches this in 3.x; no new gamification here.
- **Notification permission re-prompting tied to premium expiry** — adjacent to Story 6.6; if it lands first, this story doesn't preempt it.

---

## Notes for the implementer

- **Runtime feature flag is critical** — prod APK ships with `flags.alertsLoop = false` until the marketing-campaign launch moment per memory `feedback_feature_flags.md`; the entry points must wrap. Backend gating is dark-safe (filters recipients regardless of mobile state).
- **6.4 collision** — the prefs-panel rebuild is much larger than this story's relocation. T7 deliberately ships a minimal-viable home for the existing UI. When 6.4 lands, that route can be redesigned without breaking anything.
- **Atomic verification + extension** — if the verification path is split across worker + service, prefer event-driven decoupling over making it a single transaction at the cost of complexity. Idempotent updates (`MAX` arithmetic) are the safety net.
- **Migration applied manually per project memory** — `project_staging_predeploy_broken`. After merge, run `prisma migrate deploy` against staging then prod.
- **The single existing alert (6.3 lite price-rise) is what we're gating.** No coordination needed with other alert types — they don't exist yet.
- **The `premium_alerts_active_until` field can be exposed in the `User` profile API response** (the same endpoint mobile already calls to populate auth state). No new endpoint needed for the bell icon to read it. If the auth-store user shape doesn't currently include this field, add it there.
- **One hypothesis to validate post-launch**: does the 30-day window create a "sprint to extend" pattern where users contribute on day 28 and skip days 1-27? If yes, a tighter window (e.g. 14d) might create healthier cadence — but ship 30 first, observe.
