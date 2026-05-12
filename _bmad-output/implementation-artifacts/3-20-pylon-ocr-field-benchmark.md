# Story 3.20: Pylon OCR Field Accuracy Benchmark

Status: ready-for-dev

**Trigger:** 2026-05-10 — four-pillar positioning lock-in. Pillar 1 (photo-verified data quality) is load-bearing for the entire differentiation story. The earlier OCR PoC (Stories 3.x family — synthetic + 10 real-world Łódź photos) showed Claude Vision Haiku reads price boards at 100% on photos where a price board is visible. **But the sample size is small, and "field conditions" includes weather (rain, snow, fog), glare, distance, angle, time-of-day, partial occlusion, and stylistic variation across chains.** Before launch and before the marketing campaign leans on the photo-verified positioning, we need a proper field benchmark to confirm ≥85% real-world accuracy. If the benchmark fails, Pillar 1 needs repositioning around receipt + pump OCR (clean printed text, validated) with pylons treated as best-effort secondary contribution.

**Phase:** 1 (pre-launch). **Blocking** for any external marketing copy that promises "verified prices" — that promise is only safe if accuracy holds.

**Coupled stories:**
- **Already shipped:** 3.5 (OCR price extraction), 3.x family (capture flow + OCR pipeline)
- **Already validated:** prior PoC artifacts in `_bmad-output/research/` and `_bmad-output/analysis/results/`
- **Adjacent:** Story 6.13 (premium → price alerts rename) — unrelated mechanically but both are positioning prerequisites
- **Adjacent:** PRD risk register entry "Pylon OCR field accuracy below 85% threshold" — this story closes the risk

---

## Story

As an **operator about to commit to the photo-verified positioning publicly**,
I want a rigorous field benchmark of pylon-OCR accuracy across realistic capture conditions,
so that we can either confidently lean on Pillar 1 in marketing OR pivot to a narrower claim before launch.

### Why

- **Marketing claim must hold up.** "Real prices, no fakes" is the headline differentiator. If 30% of pylon photos misread, the trust positioning collapses on first negative review.
- **Existing PoC is too small** — 10 field photos, all from one founder, in stationary conditions. Production users will shoot from cars, in rain, at night, with glare, from awkward angles, partially obscured by signage.
- **Decision gate** — if benchmark passes (≥85% per-field accuracy), full positioning lock-in proceeds. If it fails, Pillar 1 reframes to "receipts + pumps verified" (clean printed text, already validated at 100%) with pylons as best-effort.
- **Cost is bounded.** This is a measurement story, not a feature story. ~50-100 photos, OCR call per photo, a small benchmark report.

---

## Acceptance Criteria

**AC1 — Photo collection plan:**
Given the launch geography is Łódź + surrounding towns,
When this story executes,
Then the benchmark photo set includes:

- **Minimum 50 pylon photos** across at least 5 distinct stations per major chain (Orlen, Lotos, BP, Shell, Circle K, MOYA) plus several independents → ~50-80 photos total
- **Varied conditions:**
  - Daytime, golden hour, dusk, night (4 light conditions)
  - Clear / overcast / rain / snow / fog (weather mix realistic for PL)
  - Straight-on / angled (15°, 30°, 45°) / extreme angle (60°+)
  - Distance: close (<5m) / medium (5-15m) / far (15-30m)
  - Glare on / off the surface
  - Partially obstructed (pump, signage, vehicle in foreground)
  - Different pylon styles (analog dials, LED 7-segment, digital LCD, hybrid)

- **Geographic spread:** primarily Łódź metro (matches launch geography) + a handful from neighbouring towns and one motorway MOP for variety
- **Provenance:** Mateusz can shoot most personally over 2-3 weeks of normal driving; supplement with cycling rides if needed (per `project_alpha_field_test_2026_04_21.md` pattern)

**AC2 — OCR pipeline + ground truth labelling:**
Given the photo set is collected,
When each photo is run through the existing Haiku-tier pylon OCR pipeline,
Then the OCR output is recorded alongside human-labelled ground truth for each photo:

- Per fuel type visible on the pylon: actual price (zł/L)
- Whether the photo *could* have produced an accurate read by a human (some photos are unreadable even by humans — those count as user-error not OCR-error in the analysis)

**AC3 — Accuracy metrics computed:**
Given OCR output + ground truth pairs,
When the analysis runs,
Then the following metrics are computed and reported:

- **Per-field accuracy** (% of fuel-price reads correct ±0.5 gr/L) — overall and broken down by:
  - Light condition
  - Weather
  - Angle / distance
  - Pylon style
  - Chain
- **False-positive rate:** % of photos where OCR returned a confidently wrong number (vs. correctly returning null / abstaining)
- **Abstention rate:** % of photos OCR correctly refused to read (better than hallucinating)
- **Failure mode breakdown:** what causes the bulk of misreads — angle? glare? specific pylon style?

**AC4 — Decision criteria documented:**
Given the metrics from AC3,
When the report is finalised,
Then it includes a clear decision recommendation:

- ✅ **Pass (≥85% per-field overall, ≥75% in worst-condition bucket):** photo-verified positioning is safe; proceed with marketing campaign as planned. Pillar 1 confirmed.
- ⚠️ **Conditional (75-85% overall, OR ≥85% overall but <60% in any common condition):** ship with caveats — UX guidance to users on shooting (close-up, straight-on); pylon-OCR remains primary contribution path but trust banner mentions "we verify what we can read" honestly.
- ❌ **Fail (<75% overall):** reposition Pillar 1 around receipts + pumps. Pylon-OCR is best-effort secondary. Marketing copy adjusted accordingly.

The recommendation is the deliverable. Mateusz makes the final call on which path to take but must have data to ground it.

**AC5 — Cost containment:**
Given OCR calls cost money (per `feedback_paid_api_quotas.md` and `project_ocr_spend_cap.md`),
When the benchmark runs,
Then the total OCR cost is calculated upfront and confirmed against the spend cap before execution,
And the benchmark uses the production-recommended model (Claude Haiku 4.5 — cheapest viable per existing PoC),
And no surprise spend is incurred (50-80 photos × ~$0.0009 = under $0.10 — negligible, but the principle holds).

**AC6 — Re-runnable benchmark harness:**
Given OCR models and pricing change over time,
When this story ships,
Then the photo set + ground truth + analysis script are committed to `_bmad-output/research/pylon-ocr-benchmark/` so the benchmark can be re-run later (e.g. after Gemini Flash validation per `project_ocr_benchmark_partial_retry.md`, or after a model upgrade).

The harness can be a simple script (Python or Node) that takes the photo directory + ground truth CSV and produces the metrics report.

---

## Tasks / Subtasks

- [ ] **T1: Photo collection (founder)**
  - [ ] 1.1 Plan: spreadsheet of target stations × conditions to shoot
  - [ ] 1.2 Founder shoots 50-80 photos over 2-3 weeks, normal driving + targeted detours where needed
  - [ ] 1.3 Each photo logged with metadata: station, datetime, weather, light, angle estimate, distance estimate

- [ ] **T2: Ground truth labelling**
  - [ ] 2.1 For each photo: human-record the actual prices visible (per fuel type)
  - [ ] 2.2 Tag each photo with whether human-readable (some won't be)
  - [ ] 2.3 Store in CSV alongside photo set

- [ ] **T3: Analysis script**
  - [ ] 3.1 Script reads photos + ground-truth CSV
  - [ ] 3.2 Calls existing Haiku OCR endpoint (or local equivalent) per photo
  - [ ] 3.3 Compares OCR output to ground truth per field
  - [ ] 3.4 Computes overall + per-condition accuracy
  - [ ] 3.5 Outputs Markdown report

- [ ] **T4: Report + recommendation**
  - [ ] 4.1 Run the analysis
  - [ ] 4.2 Write the report to `_bmad-output/analysis/results/pylon-ocr-benchmark-{date}.md`
  - [ ] 4.3 Include the recommendation per AC4

- [ ] **T5: Decision + downstream actions**
  - [ ] 5.1 Mateusz reviews the report and locks the call
  - [ ] 5.2 If pass → proceed with marketing campaign per `epic-15`
  - [ ] 5.3 If conditional → update mobile UX guidance, soft-launch creative
  - [ ] 5.4 If fail → reposition Pillar 1 in PRD + pitches + welcome carousel; revisit positioning overall

- [ ] **T6: Commit benchmark harness**
  - [ ] 6.1 Photo set + ground truth + script committed to `_bmad-output/research/pylon-ocr-benchmark/`
  - [ ] 6.2 README documenting how to re-run later
  - [ ] 6.3 Decision report committed to `_bmad-output/analysis/results/`

---

## Out of Scope

- **Receipt OCR benchmark** — Story 5.10 covers receipts; receipts and pylons are different OCR problems (printed text vs. weather-faded LED).
- **Pump-display OCR benchmark** — already done per Story 5.2 (Sonnet 4.6 validated). Not re-running.
- **OCR model swap to Gemini Flash** — separate concern, tracked via `project_ocr_benchmark_partial_retry.md`. This story benches the *current production model* (Haiku 4.5).
- **Production retraining or fine-tuning** — out of scope; we're using off-the-shelf vision models.

---

## Dev Notes

- **This is a measurement story, not a feature story.** No new code surfaces in production. The deliverable is the report + the decision.
- **Schedule realistically.** Founder shooting 50-80 photos opportunistically takes 2-3 weeks if not rushed. Don't compress this — rushed photo collection = biased sample = worthless benchmark.
- **Be honest about results.** If the benchmark fails, the worst possible response is to spin the numbers. Reposition cleanly. Pillar 1 around receipts + pumps still works.
- **The downstream consequences of the result are large.** Pass = full marketing campaign with photo-verified messaging. Fail = positioning rewrite + pillar 1 narrowed. Make the decision criteria visible to Mateusz before he sees the numbers, so the call is principled not ad-hoc.

- **Per `feedback_commit_messages.md`:** include "3.20" in commit message.
