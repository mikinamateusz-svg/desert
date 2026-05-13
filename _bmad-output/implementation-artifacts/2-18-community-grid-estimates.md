# Story 2.18: Community-Grid Estimates (K-Nearest Spatial Interpolation)

Status: review

**Trigger:** 2026-05-09 — pre-launch design pass on the volatile-pricing problem. With 50 stations to be seeded in Łódź on day -1 of launch, those verified reports form a meaningful spatial grid; the remaining ~50-100 unseeded stations should derive their estimates from nearby community reports rather than the existing rack-formula. The current `EstimatedPriceService` ([estimated-price.service.ts](apps/api/src/price/estimated-price.service.ts)) computes estimates as `rack_price + voivodeship_margin + station_type + brand + border + settlement_tier modifiers` — dynamic on the rack input but blind to actual community prices. Operator feedback: rack-formula estimates diverge meaningfully from reported prices, especially at city level where voivodeship-average can't capture hyperlocal patterns.

This story replaces the rack-formula path with **K-nearest spatial interpolation** weighted by inverse distance and brand similarity. The rack-formula stays in the codebase for any backend uses (validation rule constraints, etc.) but is no longer used as a UI estimate path.

**Phase:** 1 (pre-launch). Companion to 2.17 (dynamic freshness UI). Both ship as the "honest map" launch posture.

**Coupled stories already shipped:**
- 2.5 — Station Detail Screen (consumer of `StationPriceRow`).
- 2.6 — Existing time-based freshness display.
- 2.9 — Redis Price Cache (the surface this story will hook eager-recompute into).
- 2.12 — Rack-Derived Estimated Price Range (the path being replaced for UI; underlying logic kept for non-UI uses).

**Coupled stories still spec-only / shipping alongside:**
- 2.17 — Dynamic Freshness UI. Provides the staleness flag that 2.18 must honour (AC8 — staleness propagation).

---

## Story

As a **driver looking at the map**,
I want estimates for stations without verified prices to be derived from nearby verified ones — not from a regional formula that may be off — and to know honestly when an estimate is sketchy because there's only one neighbour to base it on,
so that the map reflects what real people are actually paying around me, not a generic regional model.

### Why

In the current system, an estimate for a station with no community submission is computed as:

```
estimate = rack_price + voivodeship_margin + station_type_modifier
         + brand_modifier + border_zone_modifier + settlement_tier_modifier
```

Each modifier is a static constant. This produces stable but inaccurate estimates when actual prices in a neighbourhood drift from the regional formula's assumptions — and operator field-checks indicate they do drift (sometimes by 0.20+ PLN/l).

With 50 verified stations seeded in Łódź at launch, every unseeded station has multiple verified neighbours within 10 km. We can compute estimates by **inverse-distance-weighted average** of those neighbours, with a same-brand boost (Orlen-near-Orlen is a tighter signal than Orlen-near-BP). This:

- Captures actual local price patterns (highway-corridor markup, downtown premium, brand-tier distinctions) automatically.
- Self-corrects: as more verified prices flow in, estimates update naturally with no formula tuning.
- Honest about uncertainty: low-confidence estimates (1-2 nearby verified) get wider price bands, signalling don't-trust-this-one-too-much.
- Inherits staleness: when neighbours' verified prices age into stale, the estimates derived from them age too (per 2.17's propagation rule).

Below a confidence threshold (no neighbours within 10km), the station shows **no price** — clean "we don't know" UX matching the operator's "clear current estimates from the map entirely" instinct.

---

## Acceptance Criteria

**AC1 — K-nearest IDW interpolation replaces rack-formula in the standard path:**
Given a station × fuel pair where no verified community price exists for the station × fuel,
When the price is computed for the API response,
Then the new path is taken:
1. Find verified prices for the same fuel within 10 km of the station — up to 5 nearest neighbours (by haversine distance against `Station.location`'s PostGIS geography point).
2. Apply inverse-distance weighting: each neighbour's weight is `1 / max(distance_meters, 100)` (the floor prevents division-by-near-zero for nearly-overlapping stations).
3. Apply same-brand boost: if a neighbour's `brand` matches the target station's `brand`, multiply weight by 2.0. (Mismatching or null-brand → weight unchanged.)
4. Compute weighted-average midpoint.
5. Return the midpoint as `prices[fuelType]`, with the price band (`priceRange.low/high`) computed per AC2.

The rack-formula `computeMidpoint` is **not** invoked in this path. It's reserved for the deep-fallback case (AC4).

**AC2 — Confidence tiers map to price-band width:**
Given a station × fuel computed via AC1,
When the price band is set,
Then the confidence tier is determined by the K count actually used:

| K used | Tier | Band width (`±PLN/l from midpoint`) |
|---|---|---|
| 5 | high | ±0.05 |
| 3-4 | high | ±0.05 |
| 2 | medium | ±0.15 |
| 1 | low | ±0.30 |

(High at K≥3 because three neighbours produce reasonably stable means; medium at K=2 because pair-averages are noisier; low at K=1 because no averaging occurred — the midpoint is just the nearest neighbour's price.)

**AC3 — Reference station count surfaced in API response:**
Given a station × fuel computed via AC1,
When the response is built,
Then the per-fuel field `referenceStationCount: Record<fuel, number>` reflects the K used to compute the estimate (so the mobile detail-sheet can render the source-line copy with the count),
And for verified-by-this-station prices, the field is omitted or set to a sentinel (e.g., `0` meaning "not estimated, this is the actual price"),
And the existing `sources[fuel]` (`'community' | 'admin_override' | 'seeded'`) and `estimateLabel[fuel]` (`'estimated' | 'market_estimate'`) values continue to render correctly — but `seeded` now means "community-grid-derived" not "rack-formula-derived".

**AC4 — Deep-fallback to rack-formula only at K=0:**
Given a station × fuel where K=0 verified neighbours exist within 10 km,
When the API computes the response,
Then the price for that fuel is **not returned** at all (treat as if there's no data),
And the mobile UI renders this as a `nodata` pin (existing grey placeholder per `priceColor: 'nodata'`),
And the detail-sheet shows "no price data available" copy for that fuel.

**Optional safety net:** the rack-formula path may be retained behind a backend feature flag (e.g., `ENABLE_RACK_FORMULA_FALLBACK=false`) so we can revive it if the K=0 case proves more common than expected post-launch. Default off; the UI sees no price.

**AC5 — Eager recompute on submission:**
Given a verified community price lands for station A × fuel F (via photo pipeline reaching `verified` status, admin approve, or fillup-logged),
When the existing cache invalidation flow runs (`PriceCacheService.setAtomic` or `invalidate`),
Then **additionally**:
1. Find all stations within 10 km of A that don't have a verified price for F.
2. Recompute their F estimates using the new neighbour set (which now includes A).
3. Update each affected station's cached `StationPriceRow` to reflect the new estimate.

This bounds the ripple to at most ~50 cache writes per submission (10km radius in central Łódź), each a fast PostGIS query + arithmetic. Best-effort: if a single recompute fails, log and continue — don't block the original submission's verification flow.

**AC6 — Lazy fallback at fetch time (cache miss):**
Given a map fetch requests a station whose cached entry is missing or expired,
When the price service builds the response,
Then it computes the estimate via AC1 on-demand,
And caches the result via the standard `PriceCacheService.set` flow,
And returns the result.

(This is the fallback path. The eager recompute in AC5 keeps cache pre-warmed; this path catches the edge cases — TTL expiry, cold cache after restart.)

**AC7 — Same-fuel propagation, not whole-station:**
Given a verified PB95 price lands for station A,
When AC5's recompute fires,
Then only PB95 estimates for nearby stations are recomputed,
And ON / LPG / etc. estimates are untouched (they didn't get new data).

Per-fuel-per-station is the granularity throughout. A station might have PB95 with 5 neighbours → high confidence, ON with 1 neighbour → low confidence — these coexist on one station.

**AC8 — Staleness propagation from input neighbours:**
Given a station × fuel estimate is computed via AC1 from K nearby verified prices,
When any of those K input prices have a non-null `StationFuelStaleness` for the same fuel (the per-2.17 staleness flag),
Then the resulting estimate's `stalenessFlags[fuel]` is also set to `true`,
And the mobile UI applies the stale visual treatment from 2.17 (grey dot on pin + warning tooltip on detail).

The estimate itself is "as fresh as its weakest input". A single stale neighbour out of 5 demotes the whole estimate.

**AC9 — Rack-formula deep-fallback can be deleted from the UI path:**
Given the existing `EstimatedPriceService.computeMidpoint` (rack-formula) is no longer reached for production map traffic,
When the API runs,
Then no `seeded` `'market_estimate'` entries with rack-derived midpoints flow to mobile,
And the function itself stays in the codebase for non-UI uses (price-validation rules use rack as a sanity-check input independently),
And the existing tests for `computeMidpoint` continue to pass (they exercise the function directly, not via the UI path).

If AC4's optional safety-net flag is configured, this AC is conditional on the flag being off (default).

**AC10 — `StationFuelStaleness` invalidation triggers AC5 recompute:**
Given a `StationFuelStaleness` row is created (Orlen rack moves and the staleness-detection worker creates rows for affected stations × fuels),
When the price cache for those stations is invalidated (per 2.17 AC6),
Then the next fetch lazy-recomputes per AC6,
And the recomputed estimate carries the inherited stale flag from AC8,
And no separate "rack-driven recompute" event is needed (rack moving doesn't change the *interpolation result* — community-grid estimates are derived from neighbours, not rack — but it does change which neighbours are stale, so propagation re-evaluates correctly).

**AC11 — i18n for new copy:**
Given new copy strings for confidence-aware source-line text:

| Confidence | PL canonical |
|---|---|
| High (K≥3) | *"Szacowana cena (na podstawie {{count}} stacji w pobliżu)"* |
| Medium (K=2) | *"Szacowana cena (na podstawie {{count}} stacji w pobliżu)"* |
| Low (K=1) | *"Szacowana cena (orientacyjnie, 1 stacja w pobliżu)"* |

When mobile renders the detail sheet, the right variant is chosen based on `referenceStationCount`,
And EN / UK translations are present in the i18n type definitions, type-check fails on missing keys.

**AC12 — Verified-only filter (forward-compat):**
Given a future map filter "verified prices only" exists,
When the user toggles it on,
Then estimates of any confidence are strictly hidden — no "show low-confidence as faded" middle ground,
And the pins for stations without verified prices show as `nodata` (grey placeholder).

(No filter exists today; this AC documents the contract for when it lands.)

---

## Tasks

### Backend (T1–T4)

**T1 — Spatial interpolation method:**
- New method on `EstimatedPriceService`: `computeCommunityGridEstimate(stationId, fuel)`. Steps per AC1.
- PostGIS query: `ST_DWithin` with 10km radius, ordered by `ST_Distance` ASC, LIMIT 5. Plus a `WHERE` to exclude the target station itself and only include rows with verified prices for the requested fuel.
- IDW math: weighted sum / total weight. Round midpoint to 2 decimal places.
- Per-fuel band-width selection per AC2.
- Return shape: `{ midpoint, range: {low, high}, referenceStationCount, isFromStaleInput: boolean }` (last field for AC8).
- Handle K=0: return `null` (caller treats as "no data" per AC4).

**T2 — Replace rack-formula path in `computeEstimatesForStations`:**
- Modify the existing `computeEstimatesForStations` ([estimated-price.service.ts:115](apps/api/src/price/estimated-price.service.ts#L115)) — when iterating stations and a fuel is uncovered:
  - Call `computeCommunityGridEstimate(station.id, fuel)` first.
  - On non-null result: populate `prices`, `priceRanges`, `sources`, `estimateLabel`, `referenceStationCount`, `stalenessFlags` accordingly.
  - On null result (K=0): leave the fuel out of the response entirely (deep fallback per AC4).
  - **Do not call `computeMidpoint` (rack-formula) in the standard path.** It stays defined in the service for other callers (validation rules etc.) but is unused for UI.
- Optional: gate the deep-fallback on a `process.env.ENABLE_RACK_FORMULA_FALLBACK === 'true'` flag (AC4 safety-net). Default false. If on, fall through to existing rack-formula on K=0.

**T3 — Eager recompute hook on submission events:**
- New method `EstimatedPriceService.propagateToNearbyStations(stationId, fuel)`:
  1. Query stations within 10km of `stationId` that don't have verified `fuel` prices.
  2. For each, recompute via T1 method.
  3. Update each cache via `PriceCacheService.set`.
  4. Per-station error isolation: try/catch each, log on failure, don't break the loop.
- Hook the call from:
  - `photo-pipeline.worker.ts` after the existing post-verify `setAtomic` call.
  - `admin-submissions.service.ts` after the existing approve flow's cache rewrite.
  - `fillup.service.ts` after the existing cache rewrite.
- Async fire-and-forget (the original submission flow doesn't wait for propagation to complete — which is fine; the lazy fallback in AC6 catches anything missed).

**T4 — Tests:**
- IDW math: golden tests with hand-computed expected values for K=1, K=3, K=5, K=5-with-brand-boost, K=0 → null.
- Distance floor: two stations 50m apart shouldn't blow up the weight calculation; ≥ K=2 with one at distance 0 should still produce sensible results.
- K=0 case: returns null; no fallback in standard path.
- Eager recompute: when a submission lands, the right N nearby stations get their caches rewritten.
- Staleness propagation: estimate carries stale flag if any input is flagged.
- Existing tests for `computeMidpoint` (rack-formula) continue to pass — function unchanged.

### Mobile (T5–T7)

**T5 — Read `referenceStationCount` from API:**
- Update `StationPriceRow` type definition (mobile-side) to include `referenceStationCount: Record<fuel, number>` (optional or sentinel-zero per AC3).
- Wire through any zod-style validators if used (won't be — JSON additive).

**T6 — Detail-sheet source-line copy:**
- In `StationDetailSheet`, when rendering an estimated fuel row, branch the source-line copy by confidence:
  - K=0 → row not rendered (pin shows nodata; AC4)
  - K=1 → low-confidence copy (AC11)
  - K≥2 → standard count-based copy (AC11)
- Confidence is derived from `referenceStationCount[fuel]` mobile-side; thresholds match AC2.

**T7 — Wider price band for low-confidence estimates:**
- The existing band rendering uses `priceRange.low/high` from the API. Backend returns wider band for lower confidence per AC2; mobile renders as-is.
- If the existing detail-sheet rounds prices visually, ensure the rounded display preserves the asymmetry (e.g., low confidence "5.80–6.40" not "5.85–6.35").

### i18n (T8)

**T8 — Translations + type updates:**
- New keys in PL/EN/UK:
  - `estimate.sourceWithCount` — *"Szacowana cena (na podstawie {{count}} stacji w pobliżu)"* (count plural-aware via i18next interpolation)
  - `estimate.sourceLowConfidence` — *"Szacowana cena (orientacyjnie, 1 stacja w pobliżu)"*
- Existing `freshness.estimated` etc. may need touching depending on what 2.17 left in place.
- Type-check verifies all keys present.

### Code review (T9)

**T9 — Run `bmad-code-review` after dev complete.** Focus areas:
- T1 PostGIS query plan: gist index on `Station.location`? Verify before assuming sub-100ms latency.
- T1 distance floor (`max(distance, 100)`): right magnitude? Two stations 50m apart shouldn't have weight 1/50 (large) vs weight 1/100 (smaller); the floor preserves "very close ≈ same neighbourhood".
- T1 brand boost = 2.0 — overweight matter? Could a same-brand neighbour 8km away dominate three different-brand neighbours 1km away? Sketch the worst case; tune if it inverts intuition.
- T2 deep-fallback: confirm rack-formula isn't accidentally still flowing through. Grep for `computeMidpoint` call sites and verify only price-validation rules remain.
- T3 propagation queue: what if 50 submissions land in 1 second (seeding sprint scenario)? 50 × 50 = 2500 cache writes serialized. Acceptable, but worth a quick benchmark.
- T3 staleness propagation: when a propagation fires, does it correctly read the staleness flags of input neighbours via the same fetch path? Easy to miss; add a test.
- AC8: when an estimate's input is stale, does the propagated estimate carry the flag through cache reads correctly?
- T6: empty K=0 case — does the fuel row simply not render, or does it render as "no data"? Should be the former; verify no leftover empty-row display.

---

## Out of Scope

- **Predictive trend ("this station is typically cheap")** — explicit Epic 16 territory.
- **Per-fuel-type confidence band tuning** — single set of tier thresholds across all fuels. If LPG needs different band widths than PB_95, revisit.
- **Pin confidence variants** — explicitly kept off the pin per design discussion. Confidence lives only in the detail sheet.
- **Cross-voivodeship neighbour search** — 10km radius is geographic; if it crosses voivodeship boundaries that's fine. We're not adding a "same voivodeship only" filter.
- **Time-decay of older verified prices** — the current freshness band (2.17) handles this. We don't additionally weight estimates by neighbour-recency beyond the staleness propagation flag.
- **A priori confidence calibration tests against ground truth** — we don't have a ground-truth dataset. The bands (±0.05 / ±0.15 / ±0.30) are educated guesses. Tune post-launch from observed real-vs-estimated divergence in the 50-seeded-then-verified-again pattern.
- **Removing `EstimatedPriceService.computeMidpoint` and rack-formula constants from the codebase** — keep them; price-validation rules may use rack as a sanity-check input. Just don't route UI through them.
- **Performance optimisation for cities with thousands of stations** — Łódź at 50-150 is the launch context. Larger markets would benefit from spatial index tuning + recompute batching, but those are post-launch concerns.

---

## Notes for the implementer

- **Read 2.17 first.** This story depends on the staleness flag being plumbed through the price API (`stalenessFlags` field). 2.17 is the prerequisite. They can be developed in parallel but 2.18 can't be tested end-to-end until 2.17's API change lands.
- **The IDW weight formula**: `w_i = (sameBrand ? 2.0 : 1.0) / max(distance_m, 100)`. Estimate = `Σ(w_i × price_i) / Σ(w_i)`. Round to 2 decimal places.
- **The 100m distance floor** prevents two stations on opposite sides of a road (3.19 disambiguation context) from blowing up the weight on each other.
- **No new schema.** The `StationFuelStaleness` table from 2.8 is the only stale-state surface. No new tables / columns needed.
- **No migration needed.**
- **Eager recompute is per-fuel.** A new PB95 submission propagates PB95 estimates; ON / LPG / etc. are untouched.
- **The K=0 → no data outcome** is the user's explicit preference ("we can go for no data"). Don't quietly fall through to rack-formula even though the function exists.
- **Cache key namespace stays the same.** `StationPriceRow` cached values just have richer payloads; existing `getMany` callers continue to work.
- **The `referenceStationCount` field is optional in API; sentinel `0` or `undefined` are interpreted by mobile as "not an estimate" (i.e., this is actual community data).**
