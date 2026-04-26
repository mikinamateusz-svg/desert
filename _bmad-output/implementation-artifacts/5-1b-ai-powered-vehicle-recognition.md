# Story 5.1b — AI-Powered Vehicle Recognition

**Epic:** 5 (Personal Analytics)
**Status:** deferred-end-of-epic
**Created:** 2026-04-26 (split from original 5.1)
**Depends on:**
- Story 5.1 (Vehicle CRUD foundation — schema, service, controller, mobile setup screen)
- Story 5.1a (Model Evaluation — picks the model + confidence threshold this story uses)

---

## Overview

Adds a photo entry path to the existing vehicle setup flow. Driver takes a photo of their car (or picks from gallery) → backend runs Claude vision against it → returns a make/model/year suggestion if confidence ≥ threshold → driver confirms or falls through to manual entry.

This is **purely additive UX** — story 5.1's manual cascading dropdown remains the primary path. Recognition is a "happy-path shortcut" for the common case.

---

## Acceptance Criteria (placeholder — refine when activated, after 5.1a recommendation)

**AC1 — Three entry paths offered (extended from 5.1)**
**Given** a driver opens vehicle setup
**Then** they see three options: take photo, choose from gallery, **or** enter manually (5.1's existing path)

**AC2 — Photo recognition**
**Given** a driver takes a photo or uploads from gallery
**When** the image is submitted to the chosen Claude vision model (per 5.1a recommendation)
**Then** the model identifies the most likely make/model/year and presents it as a suggestion with a confidence indicator
**And** the driver can confirm the suggestion or dismiss it and select manually

**AC3 — Low-confidence silent fallback**
**Given** Claude vision cannot identify the car with confidence ≥ threshold (per 5.1a)
**When** recognition fails or confidence is low
**Then** the driver is taken directly to manual entry with no error shown — the suggestion step is silently skipped

**AC4 — Spend tracking**
**Given** vision recognition is fired
**When** a call completes
**Then** spend is tracked in Redis key `vehicle:vision:spend:{YYYY-MM-DD}` with 48h TTL (mirrors `OcrSpendService`)
**And** if daily spend exceeds `VEHICLE_VISION_DAILY_CAP_USD` (default $5), a `[OPS-ALERT]` is logged once per day

**AC5 — Tests**
**Given** the test suite
**When** new tests are added for `VehicleRecognitionService`
**Then** they cover: returns null when API confidence < threshold; returns structured result when ≥ threshold; handles Anthropic API errors gracefully (returns null, does not throw); spend is recorded in Redis; alert fires on cap breach

---

## Tasks / Subtasks (placeholder)

- [ ] T1: `VehicleRecognitionService` — Claude vision call using model from 5.1a recommendation
- [ ] T2: `POST /v1/me/vehicles/recognize` endpoint — multipart upload, returns suggestion or null
- [ ] T3: Mobile vehicle-setup.tsx — add photo entry path (camera + gallery) → upload → suggestion card → confirm/reject
- [ ] T4: Mobile i18n — add recognition-flow strings (recognising, suggestion title, confirm/reject buttons, etc.)
- [ ] T5: Tests — recognition service spec
- [ ] T6: Update story 5.1's spec to cross-reference (recognition path now lives in 5.1b)

---

## Open Questions (resolve before activating)

- **Will the suggestion card show year_from-year_to or just a single year?** Depends on confidence — high-confidence single year, mid-confidence range. UX detail to refine.
- **Should we cache recognition results by image hash to avoid re-paying for the same photo on retry?** Probably yes — small Redis cache keyed by SHA-256 of the photo, 24h TTL.
- **What's the right confidence threshold?** TBD — comes from 5.1a's recommendation. Original spec used 0.6; might be higher depending on model accuracy.

---

## Cost Estimate (rough, depends on 5.1a outcome)

Assuming Sonnet 4.6 wins 5.1a and 1000 recognitions/month at MVP scale:
- 1000 × $0.0009 = **~$1/month**

If Opus 4.7 wins (more accuracy, more cost):
- 1000 × $0.0045 = **~$5/month**

If Haiku 4.5 wins (least cost):
- 1000 × $0.00024 = **~$0.25/month**

Spend cap protects against runaway cost via the $5/day default.

---

## Why deferred to end of epic

- Depends on 5.1a recommendation
- Story 5.1's manual entry path is sufficient for MVP onboarding
- Recognition is "nice to have" UX speed-up, not core functionality
- Photo capture infrastructure (camera + gallery picker) already exists for Stories 3.x (price-board photos), so the mobile addition is small when activated

---

## References

- Story 5.1 (vehicle CRUD + manual setup screen — this story extends it)
- Story 5.1a (provides the model + confidence threshold)
- `apps/api/src/ocr/ocr.service.ts` — Claude vision call pattern
- `apps/api/src/photo/ocr-spend.service.ts` — Redis-based per-day spend tracking pattern
- Original 5.1 spec (now archived in git history at `5-1-vehicle-setup-car-recognition.md` pre-rename)
