# Epic 16: Station Intelligence & Insights *(Phase 2)*

**Status:** future — not scheduled.

**Trigger:** when we have ≥30 days of soft-launch submission data and ≥5 verified observations on a meaningful share of active stations. Until then, indicators would be too sparse to be useful.

---

## Why this epic exists

PriceHistory and Submission are append-only — every accepted price write is preserved with timestamp + source. We're already collecting the raw timeseries. The drivers' UI today only surfaces the **current** price (most recent PriceHistory row per fuel) and a freshness hint. There's no signal about whether a station is *typically* cheap or expensive, whether prices there move with the market, or whether they tend to spike at certain days/times.

Competing apps (e-petrol, AutoCentrum) don't surface this either — at least not in a meaningful "this station is cheaper than its neighbours" way. There's an opening if we can deliver it credibly.

The data is there. What's missing is the analytics layer + a UX that doesn't oversell sparse data as confident pattern detection.

---

## Stories (rough sketches — to be properly specced when the epic activates)

### 16.1 — Directional indicator on station detail screen

**Idea:** show a single-sentence label on each station's detail screen indicating whether its prices typically run below / at / above a regional benchmark.

**Pragmatic v1:**
- Backend: nightly job computes per-station median price per fuel over last 14 days; compares to `RegionalBenchmark` (already populated daily by cron for voivodeship+fuel); classifies as `below_avg | typical | above_avg`.
- Confidence gate: minimum sample threshold (e.g. ≥5 verified observations within window) — below the threshold, no label shown. Better to be silent than confidently wrong on small samples.
- Surface: detail screen badge + one-line caption (PL: "Typowo tańsza niż średnia w województwie — na podstawie 12 ostatnich zgłoszeń").
- Data shape: either new `StationPriceProfile` table (computed nightly, indexed for fast read) or computed on-demand from existing tables. Decide based on query cost at scale.

**Out of scope for v1:**
- Map pin colours (don't overload the colour budget with status semantics).
- Predictive trends ("prices here usually rise on Fridays").
- Driver-facing alerts ("station X just dropped 5%").
- Brand-cohort baseline (other Orlens vs this Orlen) — interesting but narrower utility than regional.

**Dependencies:**
- ≥30 days of soft-launch data so the cohort of stations with ≥5 obs is non-trivial.
- `RegionalBenchmark` cron stable in prod (already running).

**Risks:**
- Reputational: labelling a station "expensive" in the app could prompt complaints from owners. The confidence gate + voivodeship comparison (rather than naming-and-shaming nearest competitor) softens this.
- Sample bias: stations with active community contributors get more data, which may correlate with being already-popular / well-known. Indicator may be uneven across the map.

---

### 16.2 — Per-station price-over-time chart

**Idea:** sparkline or full chart on station detail showing price evolution per fuel over the last 30/90 days. Already supported by data shape (`PriceHistory` with index `(station_id, fuel_type, recorded_at DESC)`).

**Considerations:**
- Mixing community submissions and admin overrides on the same axis: do we differentiate visually?
- For stations with thin data: sparkline-with-gaps vs no chart.
- Privacy: don't reveal individual contributor identities via timing.

---

### 16.3 — Trend / momentum indicator

**Idea:** "prices here are dropping faster than the regional average" / "this station leads market changes by ~2 days". Lead/lag analysis against `RegionalBenchmark`.

**Considerations:**
- Statistical credibility — single-station price moves are noisy; need multi-week windows.
- Could be useful for Story 6.x notifications ("prices are dropping in your area" triggered by leading-station signals).

---

### 16.4 — Cross-station comparison filter on map / list

**Idea:** filter / sort affordance: "show only stations cheaper than regional average" or "sort by typical price relative to neighbours".

**Considerations:**
- Heaviest UX intervention in this epic; sequence after 16.1 has validated the underlying classification.

---

## Decision gates before activating this epic

1. **Data sufficiency**: ≥30 days of submissions AND ≥100 stations with ≥5 verified observations per fuel.
2. **Validation infrastructure**: existing price-validation rules catching obvious OCR errors at acceptable false-positive rate (Story 3.7+ work). If outliers leak into PriceHistory, the indicator becomes noise.
3. **User demand signal**: do drivers actually ask "which is the cheap one?" — captured via in-app feedback or analytics. If not, this epic stays deferred.

---

## Out of scope for this epic entirely

- Surge / dynamic pricing recommendations to station owners (tips into the partner-portal epic, not this one).
- Selling pricing intelligence as a B2B data product (Epic 10 territory).
- Real-time price prediction models (post-MVP, post-monetization).
