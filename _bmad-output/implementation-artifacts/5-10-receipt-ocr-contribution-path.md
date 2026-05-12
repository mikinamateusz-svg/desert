# Story 5.10: Receipt OCR Contribution Path + Spend-Log Bootstrap

Status: ready-for-dev

**Trigger:** 2026-05-10 — four-pillar positioning lock-in. Pillar 1 (photo-verified data) and Pillar 3 (integrated spend log) require closing the gap with Fuelio (the closest competitor, recently added receipt OCR for fillup tracking). Receipts also unlock a unique double-tagged data contribution: pre-discount unit price feeds the public market price feed alongside price-board / pump submissions, while post-discount total feeds the personal spend log only — discount-driven prices never pollute aggregate market data. Founder migrating from Fuelio (or any fillup tracker) must experience no degradation of personal-tracking capability after switching to litro.

**Phase:** 1 (pre-launch). Wrap mobile capture-flow entry point in `flags.receiptOcr` (new flag) per `feedback_feature_flags.md` — default off on prod until accuracy validated; default on for staging.

**Coupled stories:**
- **Already shipped:** 5.0 (Regional benchmark price calculation), 5.1 (Vehicle setup), 5.2 (Pump-meter OCR fillup recording) — receipt OCR sits adjacent to pump OCR in the Capture flow
- **Already shipped:** 3.5 (OCR price extraction) — receipt OCR reuses the OCR pipeline pattern but with a different prompt
- **Adjacent:** PRD FR76, FR77, FR78 added 2026-05-10 — this story is the implementation

---

## Story

As a **driver who keeps fuel receipts**,
I want to photograph a receipt to record a fillup,
so that I can track my fuel spending automatically without manually entering volume / cost / fuel type.

As an **operator**,
I want receipt-extracted unit prices to feed the public market data alongside other photo-verified sources,
so that the public price feed grows from three independent capture surfaces (price board + pump display + receipt) — but the post-discount total stays in the personal spend log only, so loyalty discounts and fleet rebates don't skew aggregate market prices.

### Why

- **Closes the migration gap from Fuelio** — drivers switching from a fillup tracker need parity on receipt-based fillup logging. Without this, the spend-log positioning pillar feels weaker than the competitor they're leaving.
- **Bootstraps personal spend log faster** — historical receipts (kept in physical wallets / phone galleries) can be batch-imported, so the spend log isn't empty for the first month.
- **Double-tagged data extraction** — receipts show both pre-discount unit price (zł/L) and post-discount total separately. Tagging at ingest preserves both: market feed gets unit price (clean signal); personal log gets total (reflects what the user actually paid).
- **Three independent OCR capture surfaces (price board + pump + receipt)** = three-way cross-validation when all three are available, hardening Pillar 1 (photo-verified data quality) into a real moat.

---

## Acceptance Criteria

**AC1 — Receipt capture flow in mobile app:**
Given a driver in the Capture flow,
When they choose "Receipt" as the capture source (alongside existing Price Board / Pump options),
Then they're prompted to photograph a fuel receipt,
And the camera-only capture rules from existing OCR flows apply (no gallery upload at MVP, EXIF/GPS validation),
And the user receives the standard "Thank you" confirmation immediately on submission, with async processing behind the scenes (per FR12 in PRD).

**AC2 — OCR pipeline extracts five fields from receipt:**
Given a successfully captured receipt photo,
When the backend OCR pipeline processes it,
Then the following fields are extracted (any may be null if not present/legible on receipt):

- `pre_discount_unit_price_per_litre` (zł/L) — the displayed unit price before any loyalty / fleet discounts applied
- `post_discount_total` (zł) — the final amount paid by the customer
- `dispensed_volume_litres` (L)
- `fuel_type` (one of `PB_95 | PB_98 | ON | ON_PREMIUM | LPG`, matching existing fuel taxonomy)
- `station_name` (string — used as a hint for station matching alongside GPS, NOT as the primary match signal)

The OCR model used must be at least Sonnet-tier (Haiku has shown insufficient accuracy on multi-line printed receipts in past PoC work; revisit during the implementation PoC). Decision criterion: ≥85% per-field accuracy on a 30-receipt benchmark across major chains (Orlen, Lotos, BP, Shell, Circle K) and a few independents — Mateusz to provide receipts.

**AC3 — Provenance tagging at ingest:**
Given a receipt-OCR data record,
When the price-extraction pipeline persists the result,
Then `pre_discount_unit_price_per_litre` is tagged `source = 'ocr:receipt:pre_discount'` and routed into the public market price-history table alongside price-board and pump-display submissions,
And `post_discount_total` is tagged `source = 'ocr:receipt:post_discount'` and routed ONLY into the user's personal fillup log,
And the post-discount total is NEVER aggregated into the public price feed under any circumstances (this is a hard pipeline invariant — covered by a unit test).

**AC4 — Cross-validation against pump OCR (when both available):**
Given a user submits both a pump-display photo AND a receipt photo for the same fillup within a short window (e.g. 10 minutes),
When both are OCR'd,
Then the pipeline cross-validates: pump_paid_unit_price ≈ receipt_post_discount_total / receipt_volume (within 5% tolerance to allow for rounding / minor cents),
And mismatches are flagged for ops review (existing low-confidence review queue in admin app handles this),
And matched pairs are linked at the database level so analytics can later compute per-source agreement rates.

**AC5 — Batch historical receipt import:**
Given a driver who has previously kept physical or photo'd receipts,
When they trigger the "Import historical receipts" flow (one-tap entry from Spend Log screen),
Then they can capture or select multiple receipts in sequence (this is the ONE exception to camera-only — historical batch import allows gallery selection because by definition the user is bringing prior photos),
And each receipt gets a separate OCR + persist cycle,
And the resulting fillups are clearly marked as "historical" / "imported" in the spend log (different visual treatment from real-time captures),
And imported fillups DO feed the spend log but DO NOT feed the public market price feed (gallery photos can be reposts; we accept the historical data on trust for personal use only).

**AC6 — UI surfacing in Capture flow:**
Given the existing Capture flow (Story 5.2 introduced pump-meter OCR alongside price-board OCR),
When this story ships,
Then the Capture flow shows three options: Price board / Pump display / Receipt,
And iconography for each is distinct,
And the user can switch between them within a single capture session (e.g. shoot the price board, then the pump, then the receipt, in any order, with all linked to the same fillup record).

**AC7 — Spend log integration:**
Given a successfully OCR'd receipt with all five fields extracted,
When it is persisted,
Then it appears in the user's personal fillup history (Story 5.x family) with the post-discount total as the headline cost,
And the savings calculation (vs. local average) uses the post-discount total (real money paid),
And the consumption (l/100km) calculation uses the dispensed volume + odometer pairing if available.

**AC8 — Privacy considerations:**
Given receipts often contain PII or quasi-PII (loyalty card number, fleet card identifier, last 4 of payment card, sometimes name),
When the OCR pipeline processes a receipt,
Then it extracts ONLY the five specified fields and discards everything else from the structured output,
And the original photo is retained per the existing 30-day photo retention policy (`project_photo_retention.md`),
And the privacy policy + terms are reviewed for any necessary update mentioning receipt capture (likely covered by existing photo capture clauses, but legal review per `feedback_legal_docs_update.md`).

---

## Tasks / Subtasks

- [ ] **T1: OCR prompt + pipeline for receipts**
  - [ ] 1.1 Add new OCR prompt template in `apps/api/src/ocr/ocr.service.ts` (or sibling) tuned for fuel receipts — extract the five fields, ignore PII
  - [ ] 1.2 Pick OCR model — start with Sonnet 4.6 (proven for pump-meter OCR per Story 5.2 PoC); validate Haiku as cost-saver if accuracy holds
  - [ ] 1.3 Implement field-level confidence scoring; route low-confidence to ops review queue

- [ ] **T2: Database schema additions**
  - [ ] 2.1 Add `Submission.source` enum value for receipt OCR (`OCR_RECEIPT_PRE_DISCOUNT`, `OCR_RECEIPT_POST_DISCOUNT` — or single `OCR_RECEIPT` with internal split)
  - [ ] 2.2 Add `Fillup` table fields if needed for post-discount total separation (or reuse existing fields)
  - [ ] 2.3 Migration

- [ ] **T3: Mobile Capture flow UI**
  - [ ] 3.1 Add "Receipt" option to capture mode picker
  - [ ] 3.2 Wire to OCR endpoint with the new source type
  - [ ] 3.3 Confirmation screen reuses existing "Thank you" pattern

- [ ] **T4: Batch historical import flow**
  - [ ] 4.1 New screen accessible from Spend Log: "Import historical receipts"
  - [ ] 4.2 Allow gallery selection (exception to camera-only — gated to this flow only)
  - [ ] 4.3 Mark imported fillups visually distinct in the log

- [ ] **T5: Cross-validation logic**
  - [ ] 5.1 When pump + receipt OCR both present for same user within 10 minutes, link records
  - [ ] 5.2 Compute price-per-litre from receipt (total / volume), compare to pump-displayed unit price
  - [ ] 5.3 Flag mismatches >5% to admin review queue

- [ ] **T6: Tests**
  - [ ] 6.1 Unit test: post-discount total never enters public price feed (hard pipeline invariant)
  - [ ] 6.2 Unit test: OCR field extraction with mock receipts
  - [ ] 6.3 Integration test: full capture → OCR → persist → spend log appearance
  - [ ] 6.4 Mobile component tests for the new capture mode picker entry

- [ ] **T7: Validation**
  - [ ] 7.1 30-receipt benchmark in PoC mode before full rollout (Mateusz to provide receipts; ≥85% per-field accuracy required)
  - [ ] 7.2 OCR cost estimate: receipts × cost-per-call (per `feedback_paid_api_quotas.md`); confirm fits within `project_ocr_spend_cap.md` cap
  - [ ] 7.3 Privacy / legal review per `feedback_legal_docs_update.md`
  - [ ] 7.4 `pnpm -r type-check` + `pnpm -r lint` clean
  - [ ] 7.5 Run `bmad-code-review` per `feedback_code_review.md`

---

## Out of Scope

- **Pylon-OCR field accuracy benchmark** — separate Story 3.20.
- **Premium → price alerts rename** — separate Story 6.13.
- **Welcome carousel rewrite** — Story 1.14 (amended).
- **OCR model architecture refactor** — `project_vision_model_refactor.md` notes a future shared `GeminiVisionService`; not blocking this story but worth coordinating if landed concurrently.
- **Email/PDF receipt ingestion** (e.g. fleet-card emailed receipts) — useful for fleet customers but out of scope for B2C launch. Log as Phase 2 / fleet epic.

---

## Dev Notes

- **OCR cost concern:** Sonnet-tier per call vs. Haiku — pump OCR (Story 5.2) chose Sonnet for accuracy. Receipt OCR is a similar problem (multi-line printed text). Likely Sonnet. ~$0.015/image × N receipts/day. Monitor under `project_ocr_spend_cap.md` cap; the cap should accommodate it but stay vigilant during ramp.
- **Receipts vary by chain.** Orlen receipts ≠ Lotos ≠ BP ≠ Shell ≠ Circle K formats. The OCR prompt should be format-agnostic and rely on field semantics (look for "zł/L", "Total", "Cena za litr", etc.). The PoC benchmark must cover this variation.
- **Post-discount total can differ from unit price × volume** — loyalty discount, voucher, fleet card. The OCR must extract them as independent fields, not derive one from the other.
- **Privacy gotchas on receipts:** loyalty card numbers, payment card last 4, sometimes names on fleet cards. The OCR prompt explicitly discards these — confirm in pipeline that no PII other than the five fields is logged anywhere.

- **Feature flag (`flags.receiptOcr`):** wraps the mobile capture-mode picker entry + the historical-import flow + any settings toggle. Backend pipeline accepts receipt submissions regardless of flag (additive); UI gates it.

- **Per `feedback_commit_messages.md`:** include "5.10" in commit message.
