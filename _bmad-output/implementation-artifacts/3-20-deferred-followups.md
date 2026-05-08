# Story 3.20 — Deferred Follow-ups

These items surfaced during the bmad-code-review of story 3.20 (capture shutter gate + telemetry) on **2026-05-08**. Each is either a pre-existing pattern not caused by 3.20, or a low-priority polish item logged for future iteration.

---

## Cross-story dependency

- **AC8 disclaimer line on confirm.tsx** — explicitly defers to **Story 6.10**. The disclaimer text *"Tylko zweryfikowane zdjęcia przedłużają alerty"* references the alerts-loop line that 6.10 introduces (conditional on `premium_alerts_active_until`). Adding the disclaimer alone (without the alerts-loop line) would be confusing — users would see "verified photos extend alerts" without prior context for what alerts are. Both 3.20 and 6.10 specs cross-reference each other; 6.10's AC8 owns the final implementation. **No action in 3.20.**

## Pre-existing patterns surfaced

- **`useLocation` hook lifetime tied to first import, not capture screen.** The hook is mounted in the parent layout; `firstFixAtMs` semantics are now anchored to "acquisition windows" via `resetFirstFix()` rather than hook mount/remount, which is the correct fix. No need to rebuild the hook lifecycle.
- **Generic `yes` / `no` translation keys placed in `review` namespace.** Borderline scope creep but the keys are scoped narrowly enough; if other namespaces need the same, lift to `common` later.
- **No idempotency key on `Submission.create`.** Network retries could theoretically duplicate rows (with same telemetry). Pre-existing risk, not 3.20-specific. The mobile queue's `markSuccess` deletes the entry after upload, so duplicate uploads from THIS client are guarded; cross-client doesn't apply (single user owns the submission).
- **`FlaggedSubmissionDetail` interface duplicated between `apps/api/src/admin/admin-submissions.service.ts` and `apps/admin/lib/types.ts`.** Pre-3.20 pattern. Lifting to `@desert/types` is a cross-cutting cleanup — defer.
- **Indicator block predicate `submission.gps_acquired_at_capture != null || …` open-coded.** A 4-field check is small; abstracting into a helper is overengineering at this point.

## Low-priority polish

- **Indicator copy reuses existing `gpsLocating` ("Matching station…") rather than the spec-literal "Locating...".** Functionally equivalent; copy review is its own pass.
- **`captureButtonOverride` style relies on amber border colour alone for state communication.** The complementary indicator copy + ⚠ glyph mitigates this; full WCAG 1.4.1 compliance would require a non-colour signal on the button itself (e.g., a small icon overlay). Defer.
- **No remote-config / feature-flag for `GPS_GATE_TIMEOUT_MS = 6000`.** Tuning requires a code change + app store rollout. Worth a remote-config story if launch data shows the value needs frequent adjustment.
- **`gps_acquisition_ms = 0` displayed as `"0 ms"` may look weird** (vs `"—"` for null). Cosmetic. Acceptable.
- **`nearby_stations_count = 99` is ambiguous between "exactly 99" and "≥99".** The mobile cap is at 99; if a sentinel is needed later, switch to `100` or `null`. No real-world impact at current radius.
- **`telemetry_json` blob versioning.** If the JSON shape changes in a future story, old queue rows still contain the old shape. Minor; pre-3.20 rows have no telemetry at all so the upload code already tolerates "no fields" gracefully. Add a `version` field if the shape ever evolves non-additively.
- **Mobile SQLite migration framework absent.** Stacking idempotent ALTER TABLEs works at this scale; if schema evolution accelerates, introduce a proper version-tracking approach (`PRAGMA user_version`).

## Test gaps

- **AC7 regression test (null-GPS → no_gps_coordinates routing).** The behaviour is pre-existing per spec, but no test in the diff explicitly asserts it. Worth adding when next touching the photo-pipeline routing logic.
- **`gpsAcquisitionMs` calc edge cases** — no unit test for the `Math.max(0, ...)` clamp at the mobile capture boundary. The defence-in-depth nature is acknowledged in code comments; a test would tighten the contract. Defer.

## Out-of-scope explicitly noted

- **Retroactive station picker** — Story 3.21 (deferrable, build only after 3.20 telemetry justifies the rate).
- **Aggregate metrics dashboard** — optional follow-up per spec; build only if per-submission firehose detail isn't enough.
- **Pre-emptive GPS warm-up on home screen** — explicitly deferred in spec.

---

## Triage record

This list captures the `defer` bucket from the 3-20 bmad-code-review. The `patch` bucket (P2: firstFixAtMs reset on focus + Math.max(0) clamp; P3: spinner alongside locating indicator; P4: warning glyph on override; P5: field-specific int clamps; P6: narrower SQLite ALTER catch) was applied in the same commit. The `bad_spec` bucket triggered the AC8 deferral note above. The `reject` bucket was discarded as noise (over-skeptical false positives, by-design behaviours, cross-cutting pre-existing patterns).
