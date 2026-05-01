# Vision-model research analysis

Tooling that lives outside the deployed apps and doesn't ship to production.
Used for evaluating vision-model candidates against the labeled `ResearchPhoto` corpus — currently covers two tasks:

1. **OCR** — extract fuel prices from a price-board photo (Story 3.5, currently Gemini Flash in production).
2. **Logo recognition** — identify the fuel-station brand from any in-frame logos / signage (Story 3.6, currently Claude Haiku in production).

## Files

| File | Purpose |
|---|---|
| `label.mjs` | Interactive CLI — walks through unlabeled `ResearchPhoto` rows, opens each in your browser, prompts for the actual prices on the sign, PATCHes labels back. |
| `run-benchmark.mjs` | OCR benchmark — pulls labeled photos, runs each through Haiku 4.5 / Sonnet 4.6 / Gemini Flash-Lite / Flash / Pro, dumps results to `data/runs-<ts>.csv`. |
| `analyse-benchmark.mjs` | OCR analyser — per-fuel accuracy, mean abs price error, cost-per-correct → Markdown summary in `results/`. |
| `run-logo-benchmark.mjs` | **Logo benchmark** — same harness, runs each photo with the production `LOGO_PROMPT`. Brand ground truth derived from `station_name` via in-script normalisation (independent / unmapped stations are skipped). Output to `data/logo-runs-<ts>.csv`. |
| `analyse-logo-benchmark.mjs` | **Logo analyser** — headline accuracy, confidence calibration, per-brand accuracy, confusion matrix, cost / latency → Markdown summary in `results/`. |

## Prerequisites

- Node 20+ (uses built-in `fetch` and `readline/promises`)
- Repo-root `.env.local` containing:
  ```
  GEMINI_API_KEY=AIza...           # required for the benchmark runner
  API_URL=https://...              # optional, defaults to production
  ADMIN_EMAIL=mikinamateusz@...    # optional, prompts if missing
  ADMIN_PASSWORD=...                # optional, prompts if missing
  ```
- An admin account in production (login is via email + password)

## Workflow — OCR benchmark

1. Take photos in the field. Pipeline retains them (when `PHOTO_RESEARCH_RETENTION_DAYS=30` is set on the API service).
2. **Label** each photo with the actual prices off the sign:
   ```
   node _bmad-output/analysis/label.mjs
   ```
3. Once you have ~10–30 labeled photos, run the benchmark:
   ```
   node _bmad-output/analysis/run-benchmark.mjs
   node _bmad-output/analysis/analyse-benchmark.mjs
   ```
4. Read the Markdown summary, decide whether to switch OCR models in production.

## Workflow — Logo benchmark

Reuses the **same** corpus as the OCR benchmark — every price-board photo also captures the canopy / signage / attendant in frame most of the time. Brand ground truth is derived from `station_name` via in-script normalisation (Orlen / BP / Shell / Lotos / Circle K / Amic / Moya / Huzar / Auchan / Carrefour); rows that don't unambiguously map to one of those 10 known brands are skipped.

1. Make sure you have labeled photos (the OCR `label.mjs` step above also seeds this benchmark — `actual_prices` doesn't need to be filled for logo work, but `final_status: 'verified'` does).
2. Run the benchmark:
   ```
   node _bmad-output/analysis/run-logo-benchmark.mjs
   node _bmad-output/analysis/analyse-logo-benchmark.mjs
   ```
3. The runner prints a brand distribution before burning quota — abort if the corpus is too skewed (e.g. 19 Orlens vs 1 BP doesn't tell you much about Gemini's BP recognition).
4. Read the Markdown report. The "Confidence calibration" section is the most important for production decisions: high-confidence wrongs directly drive false-positive shadow-bans in the photo pipeline.

## Notes

- `.env.local` is gitignored. Don't commit credentials.
- `label.mjs` is safe to abort at any time (Ctrl-C or type `abandon` at any prompt). Re-runs pick up where you left off — already-labeled rows are filtered server-side.
- "No prices on sign" (e.g. a test photo from home) can be recorded by leaving every fuel blank and choosing `(e)mpty-label` at the final prompt — keeps it from re-appearing as unlabeled.
