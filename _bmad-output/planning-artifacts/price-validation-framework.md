# Price Validation Framework — Design Doc

**Status:** ready-for-dev (Phase 1)
**Last updated:** 2026-04-24
**Context:** Day-2 alpha test (2026-04-23) surfaced that OCR frequently swaps or confuses fuel-type labels on multi-fuel pylon signs, producing plausible-looking but wrong prices that pass current Tier 1 / Tier 3 validation and pollute the public price cache. We need a data-driven sanity layer that catches these errors before they reach verified state.

---

## Problem statement

The existing `PriceValidationService` does two things:

- **Tier 1** — reject if a submitted price diverges >20% from the station's historical median for that fuel. Good for stable stations, useless on new stations with no history.
- **Tier 3** — absolute static band per fuel (e.g. PB 95 ∈ [3, 10]). Catches only wildly-wrong values.

Neither catches the common OCR failure mode: **fuel-type label-swapping within a single pylon**. OCR reads the numbers correctly but assigns them to the wrong rows — e.g. PB 95's price is tagged as ON, ON's as PB 95. Both resulting values are plausible, Tier 3 absolute band doesn't fire, Tier 1 has no history to compare against → submission verifies with wrong prices → map shows wrong prices.

We need a middle tier that asks: "given current market reference data, does each reported fuel price fall within a plausible retail range for that specific fuel *today*?"

---

## Design principles

1. **No hardcoded fuel-to-fuel relationships.** Polish market has historically flipped (pre-2022 diesel was cheaper than PB 95; now it's the other way). Anything that looks like a rule must be data-driven and toggleable.
2. **Rules as configuration, not code.** Thresholds live in database rows, editable by an admin. Code changes should not be required to tune validation.
3. **Multiple reference sources.** Orlen rack is one signal. Over time we add POPiHN weekly reports, e-petrol.pl scrapes, GUS data. Each becomes a row in `PriceReferencePoint`; rules can consume any source.
4. **Fail-safe toward "flag for review", not "reject".** During alpha, uncertainty defaults to shadow-reject (admin can approve). Outright rejection is reserved for absolute-band safety checks (decimal-point misreads, digit errors).
5. **Per-fuel, not per-brand.** Pylon-sign photos are inherently single-brand; the OCR confusion we care about is fuel-type confusion *within* one brand. Brand-tier margin adjustments are a potential refinement, not a v1 requirement.
6. **Tight margin bands, loose absolute bands.** Absolute bands catch catastrophic OCR failures (value off by 10x). Margin bands catch ordinary label-swaps by requiring the value to fit the expected retail range for that specific fuel today.

---

## Architecture

Three-layer schema + one evaluator service.

### Layer 1: `PriceReferencePoint`

External reference data, normalized. One row per (source, fuel_type, value_type, timestamp).

```
model PriceReferencePoint {
  id           String   @id @default(uuid())
  source       String   // 'orlen_rack' | 'popihn_weekly_retail' | 'epetrol_daily_retail' | ...
  fuel_type    String   // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  value_type   String   // 'rack_net' | 'retail_mean' | 'retail_p95' | 'gov_max'
  value        Float
  unit         String   // 'PLN/l'
  as_of        DateTime // when the source says this was valid
  sample_size  Int?     // for aggregates
  metadata     Json?
  recorded_at  DateTime @default(now())

  @@index([source, fuel_type, as_of(sort: Desc)])
  @@index([fuel_type, value_type, as_of(sort: Desc)])
}
```

One ingestion worker per source writes here. Rules query the most recent point within `max_age_hours`.

### Layer 2: `PriceValidationRule`

Active validation rules. Each row is one rule.

```
model PriceValidationRule {
  id           String   @id @default(uuid())
  rule_type    String   // 'absolute_band' | 'relative_to_reference' | 'cross_fuel_delta' (future)
  applies_to   String   // fuel_type or '*'
  parameters   Json
  action       String   // 'reject' | 'shadow_reject' | 'flag' | 'log_only'
  reason_code  String   // human-readable id e.g. 'pb95_outside_rack_band'
  enabled      Boolean  @default(true)
  notes        String?
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
}
```

**Rule types and their parameters:**

```jsonc
// absolute_band — fuel-specific static sanity envelope
{
  rule_type: "absolute_band",
  applies_to: "PB_95",
  parameters: { min: 3.50, max: 10.00 },
  action: "reject",
  reason_code: "pb95_absolute_band"
}

// relative_to_reference — retail = reference × vat_multiplier + margin
{
  rule_type: "relative_to_reference",
  applies_to: "PB_95",
  parameters: {
    source: "orlen_rack",
    value_type: "rack_net",
    vat_multiplier: 1.23,           // configurable via SystemConfig (see below)
    margin_min: 0.15,
    margin_max: 0.80,
    max_age_hours: 72               // skip rule if reference older than this
  },
  action: "shadow_reject",
  reason_code: "pb95_outside_rack_band"
}

// cross_fuel_delta — DEFERRED for v1 (promo-pricing noise risk, see Decisions §9)
```

### Layer 3: `SystemConfig`

Runtime config that affects rule evaluation. Admin-editable.

```
model SystemConfig {
  key         String   @id   // e.g. 'vat_multiplier', 'rule_evaluation_enabled'
  value       String        // stringified — parse per key
  description String?
  updated_at  DateTime @updatedAt
}
```

Initial row: `vat_multiplier` = `"1.23"`. When Ministry of Finance sets the reduced 8% rate, admin flips to `"1.08"` via endpoint. Rules reading `vat_multiplier` from their parameters can optionally delegate to config lookup.

### Evaluator

`PriceValidationRuleEvaluator.evaluate(submissionPrices, stationId)` returns structured outcome:

```ts
{
  perFuel: {
    PB_95: { passed: true,  rulesFired: [] },
    ON:    { passed: false, rulesFired: [
      { rule_id, reason_code: 'on_outside_rack_band', action: 'shadow_reject' }
    ]},
  },
  overall: 'shadow_reject',  // worst action across all fuels
  softFlags: [...]           // 'flag' action entries for telemetry
}
```

Integration: `runPriceValidationAndUpdate` in `photo-pipeline.worker.ts` calls the evaluator after Tier 1 / Tier 3 checks. Hard `reject` → submission rejected, photo deleted (via existing `rejectSubmission`). `shadow_reject` → status `shadow_rejected` with `flag_reason` from the first fired rule's reason_code. `flag` and `log_only` → recorded for analytics but don't change submission flow.

---

## Reference data sources

| Source | Access | Cost | v1? |
|---|---|---|---|
| **Orlen rack** | `orlenpaliwa.com.pl` feed, already ingested daily | Free | ✅ repoint existing ingestion |
| **e-petrol.pl** retail + wholesale | Web scrape | Free | Phase 2 |
| **cenypaliw.fyi** daily retail avg | Web scrape | Free | Phase 2 |
| **POPiHN weekly** | PDF reports | Some free, some paid | Future |
| **GUS monthly** | Public data | Free, slow | Future |
| **Government max prices** | Hard ceiling (`gov_max`) | Regulatory | Future |

Start minimal: Orlen rack for v1. Add e-petrol in Phase 2 to give rules multiple signals to cross-check against.

---

## Rule evaluator flow

Pseudocode:

```
function evaluate(prices, stationId):
  activeRules = db.query(PriceValidationRule where enabled)
  referenceIndex = db.query(most recent PriceReferencePoint per (source, fuel, value_type))
  vatMultiplier = SystemConfig.get('vat_multiplier')

  perFuel = {}
  for each { fuel_type, price } in prices:
    perFuel[fuel_type] = { passed: true, rulesFired: [] }
    for each rule in activeRules where rule.applies_to == fuel_type or '*':
      outcome = applyRule(rule, fuel_type, price, referenceIndex, vatMultiplier)
      if outcome.fired:
        perFuel[fuel_type].rulesFired.push(outcome)
        if outcome.action in ('reject', 'shadow_reject'):
          perFuel[fuel_type].passed = false

  overall = worstAction(perFuel)  // reject > shadow_reject > flag > log_only > passed
  return { perFuel, overall, softFlags }
```

Rule-type-specific `applyRule` implementations:

- **absolute_band**: fires if `price < min || price > max`
- **relative_to_reference**: computes `center = reference.value × vat_multiplier`; fires if `price < center + margin_min || price > center + margin_max`. Skips silently if no reference within `max_age_hours`.

---

## Key decisions made

With rationale from our design conversation.

### 1. Drop cross-fuel rules in v1

**Why:** Polish promo pricing is pervasive — Shell V-Power priced at FuelSave daily 14:00–18:00, BP Ultimate 98 at standard price Thu-Sun, MOL premium discounts via points. These programs change every 6-8 weeks. A cross-fuel rule like "PB 98 ≥ PB 95" would either fire constantly during promo hours (noise) or require a `PromoWindow` table that needs manual refresh every 6 weeks (maintenance tax).
**How to apply:** No rules in v1 that compare fuels against each other. If we later observe OCR fuel-swap patterns the rack-relative bands don't catch, we can add cross-fuel rules as `flag`-only (not reject).

### 2. VAT multiplier is 1.23 by default, admin-switchable

**Why:** Polish fuel VAT is 23%. The current 8% reduced rate (active mid-2026) is a temporary Ministry of Finance override. Default must reflect normal market conditions.
**How to apply:** `SystemConfig.vat_multiplier = "1.23"`. Admin flips to `"1.08"` while reduced rate is active. Rules can also hardcode their own value if needed (parameters take precedence over config).

### 3. Shadow-reject during alpha, not outright reject (except absolute bands)

**Why:** Alpha is about measuring which submissions the framework catches correctly. Outright rejection = photo deleted, signal lost. Shadow-reject = photo retained in the admin review queue, we can label them as ground truth and tune thresholds.
**How to apply:** Every `relative_to_reference` rule starts as `action: "shadow_reject"`. Only `absolute_band` rules use `"reject"` — they catch catastrophic errors that are 100% OCR failures, no ambiguity.

### 4. Per-fuel evaluation, not whole-submission

**Why:** If PB 95 and LPG pass but ON fails the band check, we can still publish PB 95 and LPG to the cache. All-or-nothing rejection loses good data.
**How to apply:** Evaluator emits per-fuel outcomes. `runPriceValidationAndUpdate` publishes only the fuels that passed; failed fuels are excluded from `setVerifiedPrice`. If all fuels fail, whole submission → shadow_rejected.

### 5. Margin bands start at 0.15–0.80 PLN/l for PB 95/PB 98/ON/ON+, 0.00–0.60 for LPG

**Why:** Research into Polish retail market shows typical station margin over `rack_net × 1.23` is in the 0.30–0.80 PLN/l range. Discount stations run lower, premium brands higher. Width = 0.65 PLN/l is a loose but realistic starting point. Verified today: `rack_pb95 × 1.23 + [0.15, 0.80] = [6.65, 7.30]`, actual national average 6.66 — fits.
**How to apply:** Seeded into rules as parameters. Tuned empirically once Phase 2 stats are available.

### 6. No per-brand or per-station-tier bands in v1

**Why:** Pylon photos are single-brand; the OCR confusion we care about is fuel-to-fuel, not brand-to-brand. Brand-aware margins are a refinement if analysis later shows major-brand stations cluster far above discount-brand stations.
**How to apply:** Rules only key on `fuel_type`, not on `station.brand` or `station.station_type`. Revisit after stats work.

### 7. Absolute bands always active as safety net

**Why:** Framework rules depend on reference data being fresh. If Orlen ingestion has been broken for a week, `relative_to_reference` rules skip silently. Absolute bands are the "no matter what, this value is impossible" safety check for decimal-point errors.
**How to apply:** Seeded `absolute_band` rules with wide ranges: PB 95 ∈ [3.50, 10.00], PB 98 ∈ [3.50, 11.00], ON ∈ [3.50, 10.00], ON+ ∈ [3.50, 11.00], LPG ∈ [1.00, 5.00]. Action: `reject` (rare, unambiguous, delete photo).

### 8. Stack ranking as an insight, not a rule

**Why:** At any given time, the reference data lets us compute expected centers per fuel. That induces an implicit rank order (e.g. today: LPG < PB 95 < ON < PB 98 < ON+). This is useful analytically — if OCR labels make no sense given the rank, something's off — but we don't need a separate "rank order" rule. The existing `relative_to_reference` bands already express the individual expectations that yield the rank.
**How to apply:** Framework doesn't encode rank separately. Analytics dashboard (Phase 3) can visualize rank violations as a metric without making them a rejection cause.

### 9. No photo realignment in v1 production flow — but instrument for alpha evaluation

**Why:** Realignment (permute OCR labels to best fit bands) can rescue partial-read cases but risks confidently producing wrong data when OCR didn't read all fuels. During alpha we want uncertainty preserved — shadow-reject + admin review gives us ground truth. But we also want to *measure* how often realignment *would have* helped, so we can decide whether v2 ships the mechanism.
**How to apply:** See §Experimental below. Realignment runs in shadow mode during alpha — its proposal is logged on the `ResearchPhoto` row alongside the original OCR output. Comparisons require labeled ground truth (retention + admin PATCH endpoint).

---

## Experimental — OCR realignment in alpha shadow mode

**Goal:** quantify whether permutation-based realignment of OCR output would improve accuracy, without affecting v1 production outcomes.

**Mechanism:**

1. OCR prompt extended to return an optional `unlabeled_candidates` array alongside `prices`. Example:
   ```jsonc
   {
     "prices": [{ "fuel_type": "PB_95", "price_per_litre": 6.29 }],
     "unlabeled_candidates": [6.59, 6.79, 3.09],
     "confidence_score": 0.82
   }
   ```
2. `RealignmentService.propose(prices, candidates, referenceBands)` tries assignments of fuel_types to values (both labeled + unlabeled). Returns either a new `[{fuel, price}]` set (if one permutation fits all bands better than the original) or `null` (no confident reassignment).
3. Result stored on `ResearchPhoto` as a new field `realignment_proposal Json?`.
4. When admin labels `actual_prices`, the stored labeled truth, original OCR, and realignment proposal can be compared.
5. Offline analysis (hybrid notebook) computes:
   - Disagreement rate (realignment proposal differs from original OCR)
   - Correctness when they disagree (which matches ground truth more often?)
   - False-alignment rate (realignment proposes a swap, but ground truth says original was correct)

**Decision gate for v2:** promote realignment to production flow only if disagreement-correct-rate > 70% AND false-alignment-rate < 5%. Specific thresholds adjustable after seeing the corpus.

**Phase:** ships alongside Phase 2 (after retention is producing photos to compare against).

---

## Refinements queue (deferred)

In rough priority order. Each could become its own mini-story once we have data to justify it.

1. **Promo windows** — current promos as of 2026-04:
   - Shell V-Power 95/Diesel at FuelSave price: daily 14:00–18:00, until 2026-06-25
   - BP Ultimate 98 at 30 gr/l discount: Thu–Sun, until 2026-05-05
   - MOL premium discounts via points: ongoing
   Implement if/when we re-introduce cross-fuel rules. Schema sketch: `PromoWindow { chain, rule_override, day_of_week, hour_start, hour_end, expires_at }`. Periodic refresh cadence: every 6 weeks.

2. **Realignment in production** — ship mechanism per §Experimental, graduate from shadow mode if alpha data justifies it.

3. **Per-brand margin adjustments** — if stats show major-brand stations cluster > 0.30 PLN/l above discount-brand retail baseline, add brand-aware bands. Requires `station.brand` in the rule evaluator lookup.

4. **Per-station-tier margin adjustments** — highway vs city vs rural. Uses `station.settlement_tier` (already populated).

5. **Station-level history bands** (Tier 1 replacement) — per-station, per-fuel rolling median + MAD once we have ≥10 verified submissions per station. Tighter than national rack bands for stable stations.

6. **Circle K miles / miles+ fuel variants** — if OCR consistently mis-labels these, add a brand-aware fuel-type remapping table. Currently ignored, accepting some noise.

7. **Periodic promo refresh job** — monthly cron that reads the current promo landscape and notifies admin if stored `PromoWindow` rows need updating. Could be as simple as a checklist email.

8. **Automated rule tuning** — once we have enough labeled data, a background job could propose tightening or widening rule params based on recent false-positive / false-negative rates.

9. **VAT rate auto-flip** — scrape Ministry of Finance announcements or regulatory RSS feeds. Low priority — the event is rare (twice in ~4 years) and the fix is one admin click.

10. **e-petrol + cenypaliw.fyi scrapers** — Phase 2 work. Adds second reference source, improves band confidence.

---

## Implementation phases

### Phase 1 (this PR, ~1 day)

**Ships:**
- Schema: `PriceReferencePoint`, `PriceValidationRule`, `SystemConfig`
- Migration + Prisma regenerate
- Hardcoded absolute-band tripwire in `priceValidationService` (fires immediately, independent of rule framework)
- Orlen rack ingestion repointed to write `PriceReferencePoint`
- `PriceValidationRuleEvaluator` service (skeleton, reads rules from DB)
- Two seeded rules: per-fuel absolute bands (mirrors tripwire, expressed in framework), per-fuel `relative_to_reference` with rack + VAT 1.23 + margin band
- Admin REST endpoints: GET/POST/PATCH/DELETE rules, GET/PATCH system-config
- Back-test endpoint: replay last N verified submissions against rule X, report outcome without mutation
- Tests: unit tests on evaluator + rule types + config flip; integration test on pipeline integration

**Doesn't ship:** scrapers, realignment, admin UI, stats notebook. All Phase 2+.

### Phase 2 (~2-3 days, after retention yields photos)

**Ships:**
- e-petrol.pl scraper worker (retail by voivodeship + wholesale time series)
- Historical data import script — 2 years of Orlen rack + e-petrol retail into `PriceReferencePoint`
- Hybrid analysis workflow: Node export script → CSV in `_bmad-output/analysis/data/`; Jupyter notebook in `_bmad-output/analysis/notebooks/` → PNG plots committed
- OCR prompt extension for `unlabeled_candidates`
- `RealignmentService` in shadow mode — proposal stored on `ResearchPhoto`
- Initial empirical rule param re-tuning based on analysis output

### Phase 3 (ongoing, alpha → beta)

**Ships:**
- Admin UI page for rule CRUD + back-testing + what-if simulation
- Analytics dashboard: rule fire rate, shadow queue depth, rank-order violation count, realignment disagreement rate
- Decision on v2 realignment production graduation (based on data from Phase 2 experiment)
- Additional refinements from the queue, prioritized by observed signal

---

## Testing strategy

- **Unit:** each rule type gets its own `.spec.ts` covering in-band, edge-of-band, out-of-band, reference-too-old, and config-overridden cases.
- **Integration:** pipeline test — stub reference data, run submission through pipeline, assert correct terminal state for each rule outcome.
- **Back-test:** the `/admin/rules/:id/backtest` endpoint itself becomes a testing tool. Seed a few historical submissions in test DB, run the endpoint, assert expected hit counts.
- **Real-data validation:** once Phase 2 retention + labeling produces ≥30 ground-truth labeled samples, run each active rule against them in the notebook and compute precision/recall. Tighten rules where recall is too low; loosen where precision is too low.

---

## Success criteria

- **Phase 1:** zero submissions verified with prices outside the absolute-band envelope. Rule framework operational with at least 5 seeded rules. Back-test endpoint functional.
- **Phase 2:** labeled corpus of ≥30 samples exists; rules re-tuned based on empirical distributions; realignment experimental mechanism live with proposals being recorded.
- **Phase 3:** admin can tune rules without developer involvement; realignment v2 decision is data-driven, not opinion-driven.

---

## References

- [ORLEN wholesale fuel prices](https://www.orlen.pl/pl/dla-biznesu/hurtowe-ceny-paliw)
- [cenypaliw.fyi — live retail aggregator](https://cenypaliw.fyi/)
- [e-petrol.pl — domestic wholesale + retail market](https://www.e-petrol.pl/)
- [POPiHN — Polish Oil Industry and Trade Organization](https://popihn.pl/)
- Research conversation log: this design doc is the outcome of the 2026-04-23/24 design discussion between Mateusz + assistant.
- Related specs:
  - `_bmad-output/implementation-artifacts/3-12-activity-screen-polish.md` — activity screen v1 (downstream of the clean-data goal)
  - `apps/api/src/research/` — photo retention + admin research endpoints (Phase 2 prerequisite)
