# Story 5.10: Receipt OCR Contribution Path + Spend-Log Bootstrap

Status: ready-for-dev

**Amended 2026-05-15** during pre-dev scope alignment. Five decisions locked:
1. OCR model: **Gemini Flash** for receipts. (Original intent had also included a "pump migration to Flash" — codebase audit on 2026-05-15 found pump-meter OCR was already migrated to Gemini Flash on 2026-05-02. No migration work needed. Price-board OCR (Story 3.5) remains on Gemini 2.5 Pro deliberately — out of scope for this story.)
2. Schema: **single `Submission.source` value `OCR_RECEIPT`**, separation by table — Submission carries pre-discount unit price as standard `price_data`; Fillup gets two new fields (`pre_discount_unit_price_pln`, `post_discount_total_pln`).
3. Sequencing: **benchmark harness first** — build a standalone OCR PoC script; founder collects 20-30 receipts over ~1 week of normal driving; run benchmark; gate full implementation on ≥85% per-field accuracy.
4. Cross-validation (AC4): **ship in MVP** — 10-min window, 5% tolerance, mismatch flagged to admin review queue.
5. Receipt collection: **founder collects over the next week**; benchmark gated on receipts arriving.

**No shared `GeminiVisionService` refactor in this story.** The receipt OCR service follows the existing pattern (`fillup-ocr.service.ts`, `odometer-ocr.service.ts`) — direct Gemini call with the shared `OcrSpendService` for spend tracking. A future consolidation story can extract the shared client once the receipt path is field-tested.

**Trigger:** 2026-05-10 — four-pillar positioning lock-in. Pillar 1 (photo-verified data) and Pillar 3 (integrated spend log) require closing the gap with Fuelio (the closest competitor, recently added receipt OCR for fillup tracking). Receipts also unlock a unique double-tagged data contribution: pre-discount unit price feeds the public market price feed alongside price-board / pump submissions, while post-discount total feeds the personal spend log only — discount-driven prices never pollute aggregate market data. Founder migrating from Fuelio (or any fillup tracker) must experience no degradation of personal-tracking capability after switching to litro.

**Phase:** 1 (pre-launch). Wrap mobile capture-flow entry point in `flags.receiptOcr` (new flag) per `feedback_feature_flags.md` — default off on prod until accuracy validated; default on for staging.

**Coupled stories:**
- **Already shipped:** 5.0 (Regional benchmark price calculation), 5.1 (Vehicle setup)
- **Already shipped, pattern to mirror:** 5.2 (Pump-meter OCR fillup recording) — `fillup-ocr.service.ts` is the closest reference for the receipt service; same Gemini Flash client + OcrSpendService spend tracking + zod-validated extraction shape
- **Already shipped, pattern to mirror:** 5.4 (Odometer OCR) — `odometer-ocr.service.ts` has the same call-site shape
- **Already shipped:** 3.5 (Price-board OCR) — different model (Gemini 2.5 Pro), out of scope
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

The OCR model is **Gemini Flash** (amended 2026-05-15 — see decision 1 above). Decision criterion: ≥85% per-field accuracy on a 20-30 receipt benchmark across major chains (Orlen, Lotos, BP, Shell, Circle K) and a few independents — Mateusz to collect during normal driving over the week of 2026-05-15 → 2026-05-22.

If Gemini Flash misses the ≥85% bar:
- Drop back to Sonnet 4.6 for receipts (matches the original pump-meter choice from 5.2 PoC).
- Pump migration is then deferred; pump stays on Sonnet.
- A separate 5.11 story can revisit consolidation after we have field data on which model wins.

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

Three phases per amendment decision 3 — **benchmark gates the build.**

### Phase A — Benchmark harness (no receipts yet)

- [ ] **T1: Standalone OCR PoC script for receipts**
  - [ ] 1.1 New script `apps/api/scripts/receipt-ocr-benchmark.mjs` — reads N JPEG/PNG files from a folder, calls Gemini Flash with the receipt prompt, prints per-image extraction + per-field accuracy vs a ground-truth JSON file the user provides alongside the images
  - [ ] 1.2 Prompt: extract `pre_discount_unit_price_per_litre`, `post_discount_total`, `dispensed_volume_litres`, `fuel_type`, `station_name`. Explicitly discard PII (loyalty card numbers, payment card digits, names).
  - [ ] 1.3 Output: CSV + Markdown summary written to `_bmad-output/analysis/results/receipt-ocr-{timestamp}.{csv,md}` — per-field accuracy %, false-positive rate, abstention rate, failure-mode breakdown
  - [ ] 1.4 Cost ledger: log token usage per image; sum at end; compare to predicted cost
  - [ ] 1.5 No mobile, no schema, no UI — script only. **Spend cap: ~$0.15 for 30 receipts at Gemini Flash rates** (per `feedback_paid_api_quotas.md` pre-cost discipline).

### Phase B — Run benchmark (when receipts arrive)

- [ ] **T2: Run + interpret benchmark**
  - [ ] 2.1 User collects 20-30 fuel receipts during ~1 week of normal driving, mixed across Orlen / Lotos / BP / Shell / Circle K + a few independents. Photos via phone.
  - [ ] 2.2 User drops the photos + ground-truth JSON (one entry per receipt: actual values for the 5 fields) into a folder we agree on.
  - [ ] 2.3 Run the harness from T1. Read the results.
  - [ ] 2.4 **Gate:** ≥85% per-field accuracy across the 5 fields → proceed to Phase C. <85% → reposition (drop public-feed integration, keep spend-log only; or fall back to Sonnet 4.6 and defer pump migration).

### Phase C — Full build (only if Phase B passes)

- [ ] **T3: ReceiptOcrService**
  - [ ] 3.1 New `apps/api/src/receipt/receipt-ocr.service.ts` — direct Gemini Flash call mirroring `fillup-ocr.service.ts` (Story 5.2) and `odometer-ocr.service.ts` (Story 5.4). Same `OcrSpendService` integration for shared spend tracking. Same 10s timeout. Same fail-soft return type (`{ fields: ReceiptFields | null; confidence: number }`).
  - [ ] 3.2 Receipt prompt (lifted from Phase A harness, post-tuning): extract the five fields, discard PII.
  - [ ] 3.3 Zod schema for the extracted shape; runtime validation; fail-soft on schema mismatch.
  - [ ] 3.4 Field-level confidence scoring; low-confidence (per-field <0.6) flagged to admin queue.

- [ ] **T4: Database schema additions**
  - [ ] 4.1 Add `OCR_RECEIPT` to the `Submission.source` enum (single value — per amendment decision 2)
  - [ ] 4.2 Add two fields to `Fillup` model:
    - `pre_discount_unit_price_pln: Float?` (null when not derivable from receipt)
    - `post_discount_total_pln: Float?` (null when not present on receipt)
  - [ ] 4.3 Migration in `packages/db/prisma/migrations/`
  - [ ] 4.4 Existing pump-flow Fillup writes leave both new columns null; only the receipt flow populates them. The public-feed query continues to read from `Submission.price_data` (unchanged); the personal log can render either `price_per_litre_pln` (existing) OR `post_discount_total_pln` (new) when the row originates from a receipt.

- [ ] **T5: Receipt submission flow (backend)**
  - [ ] 5.1 New `POST /v1/submissions/receipt` endpoint — multipart photo upload, creates `Submission` with `source: 'OCR_RECEIPT'`, enqueues BullMQ `receipt-ocr` job
  - [ ] 5.2 `ReceiptOcrWorker` consumes the queue, calls `ReceiptOcrService.extract()`, persists the five fields to a new `Receipt` table (or denormalises onto Submission — TBD during implementation), creates the matching `Fillup` row with both pre/post fields populated
  - [ ] 5.3 The pre-discount unit price flows into `Submission.price_data` like other OCR sources — the public price feed sees it via the same query path
  - [ ] 5.4 **Hard invariant test**: a unit spec asserts that `Submission.price_data` for a receipt-sourced row contains ONLY the pre-discount unit price, NEVER the post-discount total

- [ ] **T6: Cross-validation linker (AC4 — in scope per amendment decision 4)**
  - [ ] 6.1 New `apps/api/src/receipt/receipt-pump-linker.service.ts` — when a receipt OR pump submission is created, look up the other type for the same user within ±10 minutes
  - [ ] 6.2 Link via a new `FillupSource` join table OR a nullable `linked_fillup_id` on Fillup (TBD during impl — second is simpler)
  - [ ] 6.3 Compute (receipt_total / receipt_volume) vs pump_unit_price; if |delta| > 5% of pump_unit_price, write a `ReceiptPumpMismatch` admin-queue entry (reuse existing admin review queue infra)
  - [ ] 6.4 Matched pairs are kept linked even when not flagged — supports later analytics on per-source agreement rate

- [ ] **T7: Mobile Capture flow UI**
  - [ ] 7.1 Add third option ("Receipt") to the existing 2-option capture-mode picker from Story 5.2
  - [ ] 7.2 Distinct iconography for Price board / Pump display / Receipt
  - [ ] 7.3 Within a single capture session, user can sequence multiple captures (price board → pump → receipt in any order) linked to the same Fillup. UI handles the linking; backend trusts the client's `fillup_session_id`.
  - [ ] 7.4 Standard "Thank you" confirmation immediately, async processing behind (AC1 / FR12)
  - [ ] 7.5 Gated behind `flags.receiptOcr` (new flag — staging on, prod off until benchmark+launch decision)

- [ ] **T8: Batch historical import flow**
  - [ ] 8.1 New screen at `/(app)/import-receipts` accessible from Log tab
  - [ ] 8.2 Multi-select gallery picker — the ONE exception to camera-only (AC5)
  - [ ] 8.3 Each selected photo gets its own OCR + persist cycle. Sequential to avoid spend-cap thrashing.
  - [ ] 8.4 Fillups created from historical import are marked `imported: true` (new bool on Fillup) — visually distinct in the spend log (e.g. greyed-out date badge)
  - [ ] 8.5 **Imported fillups feed Fillup ONLY** — NEVER Submission (per AC5). The OCR service has a branch on `source: 'historical_import'` that skips the Submission insert.

- [ ] **T9: i18n (PL/EN/UK)**
  - [ ] 9.1 Capture mode picker: third option label, accessibility labels
  - [ ] 9.2 Receipt-specific copy on confirmation screen, history-import screen, "imported" badge
  - [ ] 9.3 Admin review queue strings for the new mismatch type

- [ ] **T10: Tests**
  - [ ] 10.1 Unit test: post-discount total never enters public price feed (hard pipeline invariant — T5.4 in code)
  - [ ] 10.2 Unit test: `ReceiptOcrService.extract` happy path (mocked Gemini response → expected 5 fields)
  - [ ] 10.3 Unit test: `ReceiptOcrService.extract` handles null fields gracefully
  - [ ] 10.4 Unit test: `ReceiptPumpLinker` 10-min window, 5% tolerance, mismatch flag write
  - [ ] 10.5 Unit test: historical-import branch creates Fillup but NOT Submission
  - [ ] 10.6 Integration test: full receipt capture → OCR worker → Submission + Fillup rows present, price_data has only pre-discount
  - [ ] 10.7 Mobile pure-helper tests for any new utility logic (capture-mode picker is component-level — no test, consistent with repo pattern)

- [ ] **T11: Validation**
  - [ ] 11.1 OCR cost estimate logged in story commit: rough 30 receipts × Gemini Flash = ~$0.15 for the benchmark; runtime estimate per fill-up at expected volume (need to fits within `project_ocr_spend_cap.md` cap)
  - [ ] 11.2 Privacy / legal review per `feedback_legal_docs_update.md` — does existing photo-capture clause in the privacy policy cover receipts? Likely yes but flag for explicit review.
  - [ ] 11.3 `pnpm -r type-check` + `pnpm -r lint` clean
  - [ ] 11.4 Run `bmad-code-review` per `feedback_code_review.md`
  - [ ] 11.5 Manual smoke: capture price board → pump → receipt in one session; verify all three link to the same Fillup; verify the cross-validation flag fires correctly when receipt total/volume diverges >5% from pump-displayed unit price

---

## Out of Scope

- **Pylon-OCR field accuracy benchmark** — separate Story 3.20.
- **Premium → price alerts rename** — separate Story 6.13.
- **Welcome carousel rewrite** — Story 1.14 (amended).
- **OCR model architecture refactor** — `project_vision_model_refactor.md` notes a future shared `GeminiVisionService`; not blocking this story but worth coordinating if landed concurrently.
- **Email/PDF receipt ingestion** (e.g. fleet-card emailed receipts) — useful for fleet customers but out of scope for B2C launch. Log as Phase 2 / fleet epic.

---

## Dev Notes

- **OCR model (amended 2026-05-15):** Gemini Flash per amendment decision 1. Cost ≈ $0.005 per image (cheap). Per `project_ocr_spend_cap.md`, runtime cost stays well within the cap even at 1000 fill-ups/day. Receipt service mirrors the existing pump and odometer services as standalone Gemini callers — a future consolidation story can extract a shared `GeminiVisionService` once three call sites are field-validated.
- **Receipts vary by chain.** Orlen receipts ≠ Lotos ≠ BP ≠ Shell ≠ Circle K formats. The OCR prompt is format-agnostic and relies on field semantics (look for "zł/L", "Total", "Cena za litr", etc.). The Phase A benchmark must cover this variation.
- **Post-discount total can differ from unit price × volume** — loyalty discount, voucher, fleet card. The OCR extracts them as independent fields, never derives one from the other. The `Fillup.pre_discount_unit_price_pln` and `Fillup.post_discount_total_pln` are intentionally separate columns to preserve both signals.
- **Privacy gotchas on receipts:** loyalty card numbers, payment card last 4, sometimes names on fleet cards. The OCR prompt explicitly discards these — confirm in pipeline that no PII other than the five fields is logged anywhere.

- **Schema rationale (amended 2026-05-15):** single `OCR_RECEIPT` source value, separation by table. The public price feed (`StationPrice`) is hydrated from `Submission.price_data` — receipt submissions write only the pre-discount unit price there. The personal log is hydrated from `Fillup` — receipt fillups carry both pre-discount unit price AND post-discount total. **The hard invariant (AC3): `Submission.price_data` for a receipt-source row contains only the pre-discount unit price.** Enforced by a unit test (T10.1) and by the receipt-OCR service code path (only pre-discount is passed to `submission.create`).

- **Cross-validation linker (T6 — amendment decision 4):** the 10-min window is generous (typical fillup transaction is <2 min between pump start and receipt print). The 5% tolerance accommodates rounding (PL grosz-level precision) + rare cases where the printed unit price on the receipt is rounded. Mismatches >5% are far more likely to be OCR errors than real divergences — admin review handles both.

- **Feature flag (`flags.receiptOcr`):** wraps the mobile capture-mode picker entry + the historical-import flow + any settings toggle. Backend pipeline accepts receipt submissions regardless of flag (additive); UI gates it. Staging on, prod off until the Phase B benchmark passes AND the founder has manually exercised the cross-validation flow.

- **Per `feedback_commit_messages.md`:** include "5.10" in commit message.

- **Per `feedback_paid_api_quotas.md`:** Phase A benchmark cost pre-cleared (~$0.15 for 30 receipts at Gemini Flash rates). Phase C runtime cost monitored via `project_ocr_spend_cap.md` hard cap.

- **Reused vs new:**
  - **Reuse:** existing OCR pipeline pattern (submission → BullMQ → worker → extract → persist) from Stories 3.5 / 5.2 / 5.4; mobile capture flow shell from 5.2 (just adds a third tile); admin review queue from 3.16; `OcrSpendService` for shared daily cap tracking; the existing Gemini Flash fetch pattern (no shared client — see Dev Notes above).
  - **New:** `ReceiptOcrService`, `ReceiptPumpLinker`, receipt prompt + schema, two new Fillup columns, `OCR_RECEIPT` source value, capture-mode third tile, batch historical-import screen.
  - **Not building:** email/PDF receipt ingestion (B2C launch out of scope; fleet epic later), real-time receipt fraud detection (Phase 2), per-chain prompt tuning (let Gemini Flash handle format variance), shared `GeminiVisionService` consolidation (deferred to a separate refactor story once receipt path is field-tested), pump migration (codebase audit confirmed pump is already on Flash).
