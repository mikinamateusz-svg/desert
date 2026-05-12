# Story 6.12: Phase 1 Alert Cut — Promote Price-Drop UX

**Status:** needs-rework

> **⚠️ NEEDS REWORK 2026-05-10:** Same naming issue as Story 6.10 — references *"premium alerts"* throughout. Mechanic and decisions are correct; only naming changes. Covered by coordinated rename in Story 6.13.

**Status (historical):** ready-for-dev (this artifact + implementation in same session)
**Date:** 2026-05-09
**Trigger:** scope sanity-check before launch — Phase 1 alerts must deliver on the contribution loop's promise

---

## Why

Welcome Carousel Card 5 promises premium alerts as the reward for verified photos. With the current Phase 1 surface (6.3-lite predictive rise + 6.10 contribution loop + 6.11 inbox), the only alert that actually fires for an active-premium user is a generic country-wide ORLEN-rack push — sparse cadence (~1-2× per month), no station, no geography. The bell badge stays at 0 for most of the 30-day window.

Story 6.1 (price-drop alerts) shipped to backend today. Adding it to Phase 1 turns the bell into something users see fire regularly with concrete, actionable content (*"PB95 spadło do 6,14 zł/L na Circle K, 2,3 km od Ciebie"*). Backend is ready, the alert lands in the 6.11 inbox automatically, the only missing piece is exposing the user-facing prefs.

Story 6.4 (alert prefs panel) also shipped today but its UI is mixed Phase 1 / Phase 2 — the Price Rise section toggles 6.2 and 6.3-full (neither shipped) and the Monthly Summary toggle controls 6.5 (not shipped). Showing all three sections in production would surface dead toggles.

This story is the **glue cut**: promote 6.1 + the Price Drop section of 6.4 to Phase 1, hide the rest behind `flags.phase2`, set sensible defaults so users get drops without configuring, flip the production flags accordingly, and update the Card 5 copy to match the new reality.

---

## Acceptance Criteria

**AC1 — Migration flips defaults to ship drop alerts on by default for premium-active users.**
Given a fresh `NotificationPreference` row,
When the migration runs,
Then `price_drop_enabled` defaults to `true`,
And `price_drop_fuel_types` defaults to `['PB_95']` (most-common PL fuel; user can broaden in prefs),
And existing rows with `price_drop_enabled = false` AND `price_drop_fuel_types = '{}'` are backfilled to the new defaults (single UPDATE; safe because the prior UI was Phase 2-gated and no production user has set these explicitly).

The Schema's `@default(...)` directives are updated to match, so future Prisma client regenerations don't drift.

**AC2 — `flags.phase2` gates Section 2 and Section 3 of the prefs panel.**
Given a user opens `/(app)/notifications`,
When `flags.phase2` is false,
Then Section 1 (Price Drop Alerts) renders in full,
And Section 2 (Price Rise Alerts — community + predictive toggles backed by 6.2 / 6.3-full) is hidden,
And Section 3 (Monthly Summary toggle backed by 6.5) is hidden.

When `flags.phase2` is true (preview-phase2 / dev), all three sections render as before — no regression for QA builds.

**AC3 — Phase 1 sharp-rise opt-out toggle.**
Given `flags.phase2` is false (so Section 2's rich rise controls are hidden),
When the user opens `/(app)/notifications` with permissions granted,
Then a single Section "Sudden price-rise alerts" renders with one toggle bound to the legacy `sharp_rise` column,
And toggling it off prevents 6.3-lite (the predictive rise alerts via ORLEN rack signal) from firing for that user,
And the section is hidden when `flags.phase2` is true (the rich Section 2 above already covers rise alerts in Phase 2 builds).

**AC4 — Welcome Carousel Card 5 copy reflects both alert directions.**
Given a user reaches Card 5 of the welcome carousel,
When the card renders in PL / EN / UK,
Then the body mentions BOTH price drops in their area AND predictive rise warnings,
And the "+30 dni" badge / reward framing remains unchanged.

**AC5 — Production EAS profile enables the alerts loop.**
Given the production EAS build profile in `apps/mobile/eas.json`,
When the next prod build is cut,
Then `EXPO_PUBLIC_ALERTS_LOOP` is `'true'` (was `'false'`),
And `EXPO_PUBLIC_PHASE_2` remains `'false'` (Phase 2 surface stays dark),
And the `preview` profile mirrors production (`alertsLoop=true`, `phase2=false`).

The `preview-phase2` profile retains both flags `'true'` for full-feature QA builds.

**AC6 — No regression in type-check / lint / tests.**
`pnpm -r type-check` clean, `pnpm -r lint` 0 errors, API tests pass, mobile tests pass.

---

## Non-Goals

- **No new alert types.** 6.2 (community-confirmed rise) and 6.3-full (Brent + ORLEN combined predictive rise) stay Phase 2.
- **No 6.5 (monthly summary) work.** Toggle stays hidden in Phase 1 production.
- **No fuel-type defaulting from fillup history.** The Story 6.4 spec deferred this; we ship a static `['PB_95']` default and let users add more in prefs.
- **No analytics / engagement metrics for the new surface.** Phase 2.

---

## Implementation Notes

### Migration sequence

1. Modify the existing schema `NotificationPreference` model — change `@default(false)` → `@default(true)` for `price_drop_enabled`, change `@default([])` → `@default(["PB_95"])` for `price_drop_fuel_types`.
2. New SQL migration `20260512000000_phase1_alert_default_flips`:
   ```sql
   ALTER TABLE "NotificationPreference"
     ALTER COLUMN "price_drop_enabled" SET DEFAULT true;
   ALTER TABLE "NotificationPreference"
     ALTER COLUMN "price_drop_fuel_types" SET DEFAULT ARRAY['PB_95'];

   UPDATE "NotificationPreference"
   SET "price_drop_enabled" = true
   WHERE "price_drop_enabled" = false;

   UPDATE "NotificationPreference"
   SET "price_drop_fuel_types" = ARRAY['PB_95']
   WHERE "price_drop_fuel_types" = '{}';
   ```
3. Apply manually to staging + prod per `project_staging_predeploy_broken` memory.

### Mobile UI

- Add three new i18n keys per locale: `notifications.sections.priceRiseSimple`, `notifications.sharpRiseLabel`, `notifications.sharpRiseSubLabel`.
- Wrap Section 2 (Price Rise) and Section 3 (Monthly Summary) inside `{flags.phase2 && (...)}` blocks.
- Insert a new "Phase 1 sharp-rise" section conditionally rendered when `!flags.phase2`.

### EAS profiles

- `production` — flip `EXPO_PUBLIC_ALERTS_LOOP` from `'false'` to `'true'`.
- `preview` — same flip (preview is the friends-and-family beta target; should match what real users see).
- `preview-phase2` and `development` — no change (already permissive).

### Welcome Carousel copy

- PL Card 5 body — current: *"…uprzedzimy Cię, gdy ceny mają wzrosnąć."* → *"…uprzedzimy Cię o spadkach na pobliskich stacjach i o nadchodzących wzrostach cen."* (or similar; keep concise).
- EN/UK mirror.

### What we DO NOT change

- `LitroLogo.tsx` (the wordmark with the gauge dial) — separate logo work in the design track.
- Any backend service code — 6.1 / 6.3-lite already work as-is; only their inputs (the prefs columns) are being default-flipped.
- The 6.4 panel structure beyond conditional rendering — Section 1's rich controls (mode picker, target price, fuel-type chips, radius) all remain.

---

## Dev Tasks

- [ ] Schema + migration (defaults flip + backfill)
- [ ] notifications.tsx — phase2 gating + Phase 1 sharp_rise toggle
- [ ] i18n keys (PL/EN/UK)
- [ ] Welcome Carousel Card 5 copy update (PL/EN/UK)
- [ ] eas.json — production + preview alertsLoop=true
- [ ] Audit all `flags.phase2` / `flags.alertsLoop` call sites for launch consistency
- [ ] Verify: type-check + lint + API tests + mobile tests
- [ ] Commit + push main → prod, apply migration manually
