# Story 5.1a — Vehicle Recognition Model Evaluation

**Epic:** 5 (Personal Analytics)
**Status:** deferred-end-of-epic
**Created:** 2026-04-26 (split from original 5.1)
**Prerequisite for:** Story 5.1b (AI-Powered Vehicle Recognition)

---

## Overview

Story 5.1 ships a dictionary-based vehicle setup (manual cascading dropdown). Story 5.1b layers AI photo recognition on top of it. **This story decides which Claude vision model to use for 5.1b** by running each candidate against a labeled corpus of Polish car photos and comparing accuracy + cost.

Without this story, the model choice in 5.1b would be a guess. With it, the choice is empirical and defensible.

---

## Acceptance Criteria (placeholder — refine when activated)

**AC1 — Labeled corpus exists**
**Given** ≥30 car photos representative of Polish-market vehicles (varying lighting, angles, partial views, badges visible/hidden)
**When** the corpus is assembled
**Then** each photo has a ground-truth label: make, model, year_from, year_to, plus a notes field for edge cases (badge hidden, partial view, etc.)
**And** the corpus is checked into the repo at `_bmad-output/research/vehicle-recognition-corpus/` as JSON + image files (or referenced cloud storage if size makes git-storage impractical)

**AC2 — Each candidate model is evaluated against the corpus**
**Given** the candidates: Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
**When** the eval script runs each model against every photo in the corpus
**Then** for each (model × photo) it records: predicted make/model/year, confidence, input/output tokens, cost
**And** results are saved to `_bmad-output/research/vehicle-recognition-results.json`

**AC3 — Comparison report produced**
**Given** the per-call results from AC2
**When** the report is generated
**Then** it shows accuracy metrics by model:
- make hit rate (predicted make == ground truth)
- model hit rate (make + model == ground truth)
- year-range hit rate (predicted year_from ≤ actual ≤ predicted year_to)
- mean confidence on hits vs. misses
- mean cost per call
- p50/p95 latency
**And** it identifies a recommended (model, confidence threshold) pair

**AC4 — Decision committed to repo**
**Given** the report
**When** the recommendation is approved by ops
**Then** the chosen `(model, confidence_threshold)` pair is documented in this story file's Completion Notes
**And** Story 5.1b uses those values when implemented

---

## Tasks / Subtasks (placeholder)

- [ ] T1: Photo corpus collection
- [ ] T2: Ground-truth labeling tool / process
- [ ] T3: Evaluation script — runs each model against corpus, saves per-call results
- [ ] T4: Comparison report generator
- [ ] T5: Recommendation write-up

---

## Open Questions (resolve before activating)

- **Where do the photos come from?** Options: (a) crowdsource from alpha users with explicit consent, (b) public Polish car forums (legal review needed for content reuse), (c) staged shoots of cars in Mateusz's neighbourhood, (d) public-domain image sources (Wikimedia Commons has many car photos).
- **How many photos is "enough"?** ≥30 minimum; ideally ≥50 for statistical significance per fuel/body type breakdown.
- **Single corpus or stratified?** Should we segment by photo quality (clear/partial/poor) and report accuracy per segment?

---

## Cost Estimate (rough)

50 photos × 3 models × ~600 tokens per call:
- Opus 4.7: 50 × 3 × $0.0045 ≈ **$0.68**
- Sonnet 4.6: 50 × 3 × $0.0009 ≈ **$0.14**
- Haiku 4.5: 50 × 3 × $0.00024 ≈ **$0.04**
- **Total: ~$1 for the entire eval run**

Negligible cost. The cost question is human time to label photos (~2-3h for 50).

---

## Why deferred to end of epic

- Needs real photo data — best collected during alpha when actual users (or Mateusz on bike rides) can contribute
- Story 5.2-5.7 do not depend on it (they consume vehicle records, not the photo path)
- Story 5.1b (AI recognition) is purely additive UX — not blocking adoption

---

## References

- Story 5.1 (vehicle CRUD foundation)
- Story 5.1b (consumer of this story's recommendation)
- `apps/api/src/ocr/ocr.service.ts` — existing Claude vision call pattern (for OCR, similar shape)
- `apps/api/src/photo/ocr-spend.service.ts` — Redis-based per-day spend tracking pattern
