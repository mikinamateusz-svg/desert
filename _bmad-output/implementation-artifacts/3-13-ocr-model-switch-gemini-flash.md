# Story 3.13 — OCR Model Switch: Gemini 2.5 Flash

## Summary

Replaced Claude Haiku 4.5 with Gemini 2.5 Flash for fuel-price OCR extraction after
a structured benchmark POC showed Flash delivers 3× better accuracy at 5× lower cost.

---

## Background

The original OCR model (Claude Haiku 4.5) was chosen for Story 3.5 as the cheapest
available Claude vision model. Field testing during the 2026-04-21 alpha revealed that
the majority of user submissions were ending up shadow-rejected, with the primary
driver being low OCR confidence or badly extracted prices. The admin review queue
(Story 4.6) surfaced many submissions where Haiku had hallucinated prices, swapped
fuel types, or completely misread a clear price board.

This prompted a formal benchmark before switching models blindly.

---

## POC Methodology

**Corpus**: 54 photos collected during alpha field testing. Each photo was manually
labeled with ground-truth prices by the developer. Labels are stored in the
`ResearchPhoto` table (`ground_truth_label` JSON column, set via `label.mjs`).

**Evaluation script**: `_bmad-output/analysis/run-benchmark.mjs` — fetches labeled
photos from the prod API, runs each through all candidate models in parallel, writes
results to a timestamped CSV.

**Analysis script**: `_bmad-output/analysis/analyse-benchmark.mjs` — reads the CSV
and produces a Markdown report with per-model accuracy, MAE, latency, cost, and
per-photo detail.

**Tolerance**: prices within ±0.005 PLN/l counted as exact match (rounding artefact).

**Models tested** (all used the same production OCR prompt verbatim):

| Model | Provider | Input $/M | Output $/M |
|---|---|---|---|
| claude-haiku-4-5 | Anthropic | $1.00 | $5.00 |
| claude-sonnet-4-6 | Anthropic | $3.00 | $15.00 |
| gemini-2.5-flash-lite | Google | $0.10 | $0.40 |
| gemini-2.5-flash | Google | $0.30 | $2.50 |
| gemini-2.5-pro | Google | $1.25 | $10.00 |

**Benchmark runs**: 3 runs on 2026-04-27, 2026-04-28, 2026-04-29. Final run used
10 photos (Gemini free-tier RPD quota constrained full-corpus run).

---

## Results (final run — 2026-04-29)

| Model | Accuracy | MAE | Avg latency | Cost/photo | Cost/correct fuel |
|---|---|---|---|---|---|
| **Haiku 4.5** *(baseline)* | 27.5% (11/40) | 0.909 PLN/l | 2,661 ms | $0.00277 | $0.00252 |
| **Gemini Flash-Lite** | 75.0% (30/40) | 0.327 PLN/l | 10,771 ms | $0.00013 | $0.00004 |
| **Gemini Flash** | 85.7% (30/35) | 0.036 PLN/l | 6,089 ms | $0.00058 | $0.00017 |
| **Sonnet 4.6** | 90.0% (36/40) | 0.064 PLN/l | 3,762 ms | $0.00829 | $0.00230 |
| **Gemini Pro** | — | — | — | — | — (429 free-tier) |

**Key observations:**
- Haiku 4.5 is unacceptable: 27.5% accuracy, large systematic errors (often swaps
  fuel types entirely — e.g. LPG price in the PB_95 slot).
- Gemini Flash matches Sonnet within 4.3pp at 14× lower cost.
- Gemini Flash failures are concentrated in PB_98 and ON_PREMIUM on cluttered boards —
  the same photos where Sonnet also struggles. The existing price validation rules
  (Story 4.24 cross-fuel ordering) catch most of these as shadow_rejected for admin review.
- Gemini Flash-Lite: 75% accuracy but 10.7s average latency (unacceptably slow) and
  more frequent fuel-type mismatches.
- Gemini Pro hit free-tier 429 on every photo — not usable without paid billing.

**Decision**: switch to `gemini-2.5-flash`.

---

## Implementation

### Changed files

**`apps/api/src/ocr/ocr.service.ts`**
- Removed `@anthropic-ai/sdk` dependency.
- Added `GeminiResponse` type for the REST response shape.
- `OcrService` now reads `GEMINI_API_KEY` from config (via `ConfigService.getOrThrow`).
- `extractPrices()` calls `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  with `responseMimeType: 'application/json'` and `temperature: 0.0`.
- Error handling preserved: non-retriable 4xx → confidence 0.0 + no throw;
  429 / 5xx / network error → throw for BullMQ retry.
- Token counts mapped from `usageMetadata.promptTokenCount` / `candidatesTokenCount`.

**`apps/api/src/photo/ocr-spend.service.ts`**
- Updated pricing constants: $0.30/M input, $2.50/M output (Gemini 2.5 Flash).

**`apps/api/.env.example`**
- Added `GEMINI_API_KEY` entry with instructions.
- Updated `ANTHROPIC_API_KEY` comment to note it is now used only for logo recognition.

### Not changed

**`apps/api/src/logo/logo.service.ts`** — still uses Claude Haiku 4.5. Logo recognition
was not part of this benchmark; the model choice there is separate. `ANTHROPIC_API_KEY`
remains required for logo recognition.

**`apps/api/src/photo/ocr-spend.service.ts`** cost-cap logic — unchanged. The daily
spend cap still applies; the lower per-photo cost means the same cap covers ~14× more
photos than before.

---

## Deployment notes

`GEMINI_API_KEY` must be added to the Railway `desert-api` Variables before deploying.
Get the key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

The Gemini free tier (used for benchmarking) has 5 RPM / 20 RPD limits. Production
will use a paid API key — rate limits are much higher and quota resets don't apply.

---

## Acceptance criteria

- [ ] OCR pipeline processes a new submission end-to-end using Gemini Flash (verify in
      Railway logs: no `Anthropic` client reference, Gemini URL visible).
- [ ] `OcrResult.input_tokens` / `output_tokens` are non-zero (spend tracking intact).
- [ ] Daily spend counter increments correctly after a submission is processed.
- [ ] A low-quality photo (no price board) returns `confidence_score: 0.0` and routes
      to shadow_rejected via the existing low_confidence path.
