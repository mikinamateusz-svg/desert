# Story 6.13: Premium → Price Alerts Rename (DB + Code + i18n)

Status: ready-for-dev

**Trigger:** 2026-05-10 — four-pillar positioning lock-in retired the "premium alerts" framing. Alerts are core to the product, gated by contribution but never paid. "Premium" implies a paid tier — wrong signal at every customer-facing surface. The mechanic introduced in Story 6.10 (verified photo → 30-day alert window → renew) is correct; only the NAMES change. This story carries the coordinated rework across DB, backend services, mobile, and i18n so the rename lands atomically without leaving stale references.

**Phase:** 1 (pre-launch). Must land before any consumer-facing materials (App Store listing, marketing creative, web hero) reference the alerts feature. Wrap UI changes in the existing `flags.alertsLoop` runtime flag — same gate Story 6.10 used.

**Coupled stories:**
- **Affects (must rework):** 6.10 (Contribution-Gated Price Alerts), 6.11 (Alerts Inbox), 1.14 (Welcome Carousel — already amended 2026-05-10)
- **Dependencies:** none — purely a rename + migration story; no new behaviour

---

## Story

As an **operator**,
I want the alerts feature renamed across DB, code, and copy from "premium alerts" to "price alerts",
so that consumer-facing language (in-app, App Store, ads, website) reflects that alerts are core and free, not a paid tier.

As a **driver**,
I should never see "premium" in connection with alerts after launch; only "alerty cenowe" (PL) / "price alerts" (EN) / "цінові сповіщення" (UK).

### Why

Per the four-pillar positioning locked 2026-05-10 (see `project_litro_positioning.md`), alerts are one of the four pillars and a core differentiator vs. competitors. Calling them "premium" implies a paid tier and conflicts with the marketing posture (free for everyone, gated only by a verified photo contribution). The earlier framing (defended in Story 6.10 line 35) has been reversed by founder decision; this story closes the gap.

The rename is invasive (DB column + backend services + mobile components + ~30 i18n strings + spec files) but additive in behaviour: no AC of Story 6.10 changes, no user-facing flow changes. A single coordinated story prevents drift between renamed and un-renamed surfaces.

---

## Acceptance Criteria

**AC1 — Database migration: `User.premium_alerts_active_until` → `alerts_active_until`:**
Given the existing `User.premium_alerts_active_until TIMESTAMP(3) NULL` column,
When migration `2026XXXX000000_rename_premium_alerts_to_alerts` runs,
Then the column is renamed to `alerts_active_until` with all existing values preserved,
And any indexes referencing the old column name are renamed accordingly,
And the constant `PREMIUM_ALERT_WINDOW_DAYS` (in backend code) is renamed to `ALERT_WINDOW_DAYS` with the same value (30).

The migration is non-destructive — pure rename. No data backfill needed.

**AC2 — Backend service rename:**
Given the existing alert services and worker,
When this story ships,
Then files and class names are renamed:

| Before | After |
|---|---|
| `apps/api/src/alert/premium-alerts.service.ts` | `apps/api/src/alert/alerts-activation.service.ts` |
| `class PremiumAlertsService` | `class AlertsActivationService` |
| `apps/api/src/alert/premium-expiry-warning.service.ts` | `apps/api/src/alert/alerts-expiry-warning.service.ts` |
| `class PremiumExpiryWarningService` | `class AlertsExpiryWarningService` |
| `apps/api/src/alert/premium-expiry-warning.worker.ts` | `apps/api/src/alert/alerts-expiry-warning.worker.ts` |
| `class PremiumExpiryWarningWorker` | `class AlertsExpiryWarningWorker` |
| Method `extendForUser` | unchanged (already neutral) |
| Push notification dedup key `premium_expiring_warning:{user_id}` | `alerts_expiring_warning:{user_id}` |

All imports across the codebase are updated to reflect the new names. NestJS module wiring (`alert.module.ts`) updates to register the renamed providers.

**AC3 — API response field rename:**
Given the `GET /v1/users/me` endpoint currently returns `{ premium_alerts_active_until: string | null }`,
When this story ships,
Then the response field is renamed to `alerts_active_until`,
And mobile clients consume the new field,
And no backwards-compat shim is added (this is pre-launch; no production clients yet).

**AC4 — Mobile component rename:**
Given the existing mobile alert UI components,
When this story ships,
Then files and component names are renamed:

| Before | After |
|---|---|
| `apps/mobile/src/components/alerts/PremiumActiveBanner.tsx` | `apps/mobile/src/components/alerts/AlertsActiveBanner.tsx` |
| `apps/mobile/src/hooks/usePremiumAlertsStatus.ts` | `apps/mobile/src/hooks/useAlertsStatus.ts` |
| Type `PremiumAlertsState` | `AlertsState` |
| Function `apiGetPremiumAlertsStatus` (in `apps/mobile/src/api/alerts.ts`) | `apiGetAlertsStatus` |
| Property `premium_alerts_active_until` (response shape) | `alerts_active_until` |

All imports in `apps/mobile/app/(app)/alerts.tsx`, `confirm.tsx`, `index.tsx`, `activity.tsx`, and any other consumer files are updated.

**AC5 — i18n string sweep across pl.ts / en.ts / uk.ts:**
Given the locale files contain ~30 strings using "premium" / "Premium" framing for alerts,
When this story ships,
Then every alert-related string is updated per the canonical naming:

- PL: *"alerty premium"* → *"alerty cenowe"*; *"alerty"* alone is also acceptable in shorter contexts
- EN: *"premium alerts"* → *"price alerts"*; lowercase variant where appropriate
- UK: equivalent — *"цінові сповіщення"*

Specific strings to update (non-exhaustive — the developer should grep `premium` across all three locale files and update every alert-related instance):

- `alertsExtendedBanner: 'Alerty premium aktywne do {{date}}'` → `Alerty cenowe aktywne do {{date}}`
- `bell.activeA11y`, `bell.expiringA11y`, `bell.inactiveA11y` — drop "premium"
- `signInTitle: 'Alerty premium'` → `Alerty cenowe`
- `inactiveTitle: 'Włącz alerty premium'` → `Włącz alerty cenowe`
- `activeTitle: 'Alerty premium aktywne'` → `Alerty cenowe aktywne`
- `alertsLoopActivate`, `alertsLoopExtend` — reword without "premium"
- Notification body (line ~703 EN, ~737 PL): replace *"30 days of premium alerts"* with *"30 days of price alerts"* / *"alerty cenowe na 30 dni"*

Story 6.10 spec comments referencing "premium-alerts loop" are updated in their .ts file comments only (not in this story's scope to rewrite the spec — that's a separate edit covered by the spec amendment in Story 6.10's status block).

**Do NOT touch** the `ON_PREMIUM` fuel-type identifier or any related strings (`fuelOnPremium`, `ON Premium`, *"Diesel Premium"*, etc.) — that's a legitimate Polish "ON Premium" diesel grade product name, unrelated to the alerts feature.

**AC6 — Push notification copy:**
Given the pre-expiry warning push and the first-photo unlock delight notification,
When this story ships,
Then their copy uses non-premium framing:

- Pre-expiry warning (PL canonical): title *"Twoje alerty cenowe wygasają wkrótce"*, body *"Zrób zdjęcie cen paliw, aby przedłużyć alerty o kolejne 30 dni."*
- First-photo unlock delight (PL canonical): *"Brawo. Odblokowałeś alerty cenowe na 30 dni — uprzedzimy Cię, gdy ceny mają wzrosnąć."* (this notification doesn't yet exist in code — flag as a follow-up if not in scope, but the copy spec is locked here)

EN/UK translations follow the same pattern.

**AC7 — Test fixtures:**
Given test fixtures and mocks reference `premium_alerts_active_until`,
When this story ships,
Then all references are updated:

- `apps/api/src/auth/auth.controller.spec.ts` line 15: `premium_alerts_active_until: null` → `alerts_active_until: null`
- `apps/api/src/admin/admin-submissions.service.spec.ts`: `PremiumAlertsService` mocks and `mockPremiumAlertsExtend` references → renamed
- `apps/api/src/alert/predictive-rise-alert.service.spec.ts`: any premium references in test setup
- All tests pass: `pnpm --filter @desert/api test`, `pnpm --filter @desert/mobile test`, `pnpm -r type-check`, `pnpm -r lint` — clean.

**AC8 — Spec file rename + status normalisation:**
Given the affected spec files in `_bmad-output/implementation-artifacts/`,
When this story ships,
Then:

- Story 6.10's status field is restored to `done` (or `review` if not yet reviewed) — current temporary `needs-rework` flag is removed once this story merges
- Story 6.10's title is changed from *"Contribution-Gated Premium Alerts + Bell + Status"* to *"Contribution-Gated Price Alerts + Bell + Status"*
- Story 6.11's status is restored similarly
- Story 6.10 line 35 marketing rationale ("The premium tier's value drives a tighter feedback loop…") is rewritten to remove the "premium tier" framing — substance preserved, naming corrected

---

## Tasks / Subtasks

- [ ] **T1: Database migration**
  - [ ] 1.1 Create Prisma migration renaming `User.premium_alerts_active_until` → `alerts_active_until`
  - [ ] 1.2 Update `packages/db/prisma/schema.prisma` accordingly
  - [ ] 1.3 Verify any related indexes are renamed
  - [ ] 1.4 Test migration up + down on a clone of staging Neon DB

- [ ] **T2: Backend service + worker rename**
  - [ ] 2.1 Rename files per AC2 mapping
  - [ ] 2.2 Update `alert.module.ts` providers + imports
  - [ ] 2.3 Update all imports across the codebase (grep `PremiumAlerts` and `premium-alerts` and `premium-expiry`)
  - [ ] 2.4 Update push notification dedup key
  - [ ] 2.5 Update inline comments referencing "Story 6.10 — premium alerts" → "Story 6.10 — price alerts"

- [ ] **T3: API response field rename**
  - [ ] 3.1 Update `user.controller.ts` `getMe` (line ~71) response shape
  - [ ] 3.2 Update DTO/type definitions
  - [ ] 3.3 Update OpenAPI/swagger docs if present

- [ ] **T4: Mobile component + hook rename**
  - [ ] 4.1 Rename files per AC4 mapping
  - [ ] 4.2 Update all consumers (`alerts.tsx`, `confirm.tsx`, `index.tsx`, `activity.tsx`)
  - [ ] 4.3 Update `apps/mobile/src/api/alerts.ts` exported function name
  - [ ] 4.4 Update mobile types referencing the API response shape

- [ ] **T5: i18n sweep across pl.ts / en.ts / uk.ts**
  - [ ] 5.1 Grep `premium` in all three locale files (filter out fuel-type contexts)
  - [ ] 5.2 Update each alert-related string per AC5
  - [ ] 5.3 Verify Translations type definitions still compile (`pnpm -r type-check`)

- [ ] **T6: Spec file updates**
  - [ ] 6.1 Update Story 6.10 title + line 35 rationale + restore status (`done` or `review`)
  - [ ] 6.2 Update Story 6.11 status restoration
  - [ ] 6.3 Update sprint-status.yaml: 6.10 / 6.11 status entries refreshed; 6.13 marked done after this story ships

- [ ] **T7: Test fixtures**
  - [ ] 7.1 Update `auth.controller.spec.ts`
  - [ ] 7.2 Update `admin-submissions.service.spec.ts`
  - [ ] 7.3 Update any other `*.spec.ts` matching `premium_alerts` or `PremiumAlerts`

- [ ] **T8: Validation**
  - [ ] 8.1 `pnpm -r type-check` clean across all workspaces
  - [ ] 8.2 `pnpm -r lint` clean
  - [ ] 8.3 `pnpm --filter @desert/api test` 100% passing
  - [ ] 8.4 `pnpm --filter @desert/mobile test` 100% passing
  - [ ] 8.5 Run `bmad-code-review` per `feedback_code_review.md`
  - [ ] 8.6 Manual smoke test on staging: alerts banner displays correctly, status updates after a verified submission, copy reads "alerty cenowe" everywhere

---

## Out of Scope

- **Welcome carousel rewrite** — Story 1.14 (already amended 2026-05-10).
- **First-photo delight notification** — copy spec'd in AC6 but the notification implementation itself may not yet exist in code; if not, log as follow-up. Don't expand this story's scope to build it.
- **Behaviour changes** — none. Story 6.10's mechanic is correct; this story only renames.
- **`ON_PREMIUM` fuel type rename** — legitimate Polish diesel grade name. Do not touch.
- **Backwards compatibility** — pre-launch, no production clients on the old field name.

---

## Dev Notes

- **Critical file list to update (grep targets):**
  - Files containing `PremiumAlerts` (class/type names)
  - Files containing `premium-alerts` or `premium-expiry` (filenames + imports)
  - Files containing `premium_alerts_active_until` (DB + API + types)
  - Files containing `alerty premium`, `premium alerts`, `Premium alerts`, `Alerty premium` (i18n strings)

- **Order of operations for safest deployment:**
  1. Land DB migration on staging first; verify column rename doesn't break any read path
  2. Land backend code rename + API field rename together (atomic deploy)
  3. Land mobile rename in next mobile build (mobile reads new API field)
  4. Verify i18n strings ship with the mobile build
  5. Update spec files last (cosmetic, no runtime impact)

- **Rollback story:** if a critical bug ships, the migration is non-destructive — the column rename can be reverted via a counter-migration without data loss. The bigger risk is mobile build pinned to old API field name; release-coordinate the deploys.

- **Per `feedback_pnpm_lockfile_sync.md` and `feedback_run_lint_before_commit.md`:** run `pnpm install`, `pnpm -r type-check`, `pnpm -r lint` from repo root before commit.

- **Per `feedback_commit_messages.md`:** include "6.13" in commit message for traceability.
