# Story 2.18 — Deferred Follow-ups

These items surfaced during the bmad-code-review on **2026-05-13**. The 6 `patch` findings (P1-P6) were applied in the same commit; this document captures everything else.

---

## Deferred items

### Fillup writes to PriceHistory, not Submission → fillup propagation is effectively a no-op for IDW value
The K-nearest SQL only reads `Submission` table. Fillup-recorded prices live in `PriceHistory` (source=`'community'`). When a fillup advances a community price for station X, the next K-nearest run for neighbours of X reads the SAME stale Submission data — the new fillup price doesn't enter the IDW. The fillup propagation hook still serves a useful purpose (recompute clears stale `isFromStaleInput` flags from neighbours' cache, refreshes `referenceStationCount` if the neighbour set changed) but doesn't change the midpoint.

**How to apply:** Extend `computeCommunityGridEstimate`'s SQL to UNION `Submission.price_data`-derived rows with `PriceHistory` community rows (latest per station × fuel). Same effect for admin-override rows in PriceHistory. Single SQL rewrite; preserves the same shape. ~1h dev.

### Sequential per-fuel DB round-trips
`computeEstimatesForStations` awaits `computeCommunityGridEstimate` serially per (station × fuel). 50-station Łódź viewport × 3 estimable fuels = 150 serial PostGIS round-trips per fetch. Add `Promise.all` per station (parallel fuels) or batch the K-nearest across (station × fuel) in one query.

**How to apply:** Cheapest win: `Promise.all(ESTIMABLE_FUEL_TYPES.map(ft => computeCommunityGridEstimate(...)))` per station. Still serial across stations to keep connection-pool pressure bounded. ~30 min dev. Defer until soft-launch telemetry shows real latency.

### Cache race in `propagateToNearbyStations` (lost-update under concurrent writes)
Two near-simultaneous propagations to the same neighbour read-modify-write the same cache key without WATCH/MULTI. Last writer wins, but interleavings can drop one fuel's update. AC5 explicitly accepts best-effort, so this is documented rather than fixed.

**How to apply:** Switch from `priceCache.set` to a Redis WATCH-based optimistic compare-and-swap (or a per-station lock around the read-modify-write). Adds ops complexity not warranted for MVP.

### `ENABLE_RACK_FORMULA_FALLBACK` env-flag not runtime-toggleable in tests
The flag is captured at module load via `const`. Jest can't toggle it after construction. The placeholder test only asserts env var assignment — the actual fallback path has no real CI coverage. Acceptable for an env-driven safety net the operator toggles at deploy time.

**How to apply:** If the flag-on regime needs real test coverage, refactor to read `process.env` at method-call time (or inject the flag via constructor). Minor risk vs added flexibility.

### Read-path overwrite of propagation-derived stalenessFlags
2.17 P2 patch re-applies `stalenessFlags` on every request from the live rack-stale lookup. When a station has rack-stale fuels, the read path overwrites the cached `stalenessFlags` field, losing any propagation-derived `isFromStaleInput` flags from AC8. Symptom: a neighbour that inherited stale via propagation loses the indicator if the neighbour itself has other rack-stale fuels.

**How to apply:** Rework `applyStalenessFlags` in `price.service.ts` to OR-merge with `row.stalenessFlags` (cached propagation-derived flags + live rack-stale signal) instead of overwriting. Cross-cuts 2.17 + 2.18 — risky as a 2.18 side-effect. Pre-launch coverage gap.

### Mobile aggregate "min K" copy demotes high-confidence fuels
`StationDetailSheet` aggregates source-line copy across all estimated fuels: if any fuel is K=1, the entire sheet shows "orientacyjnie, 1 stacja w pobliżu" — even if other estimated fuels are K=5 (high confidence). Spec T6 suggested per-row copy; implementation collapsed to aggregate.

**How to apply:** Refactor the source-line rendering to per-row (each estimated fuel row gets its own confidence-aware copy). Bigger UX change; defer until after soft-launch validates the aggregate-copy UX in the field.

### `updatedAt` set to `now()` on merged propagation row
`propagateToNearbyStations` writes `updatedAt: new Date()` on the merged row even though only one fuel changed. Downstream consumers reading `updatedAt` as "this whole station's data is fresh" will be misled — the only fresh thing is the recomputed estimate.

**How to apply:** Move to per-fuel timestamps (`updatedAtPerFuel: Record<fuel, Date>`) or accept that `updatedAt` reflects the most recent touch. Either is invasive; defer.

### No price sanity-band on IDW inputs
A typo'd `price_data` row (e.g., `65.0` instead of `6.50`) is silently treated as a real price; one bad row poisons K-1 other stations' estimates eagerly. Defense-in-depth: reject neighbour prices outside `[2.0, 12.0]` PLN/l before they enter the IDW.

**How to apply:** Add the `[2.0, 12.0]` band check in the JS-side filter (`validRows.filter(...)`) alongside the `Number.isFinite` guard. ~5 min dev. Defer pending whether real OCR errors are creating bad rows.

### No propagation idempotency / debounce / multi-source coordination
Three call sites (photo pipeline, admin approve, fillup) each fire `propagateEstimatesToNearbyStations` independently. Burst scenarios (admin batch approve, photo pipeline retries) cause cascading thundering-herd writes with no de-dup. Multi-pod workers would compound this.

**How to apply:** Coalesce per (origin, fuel) on a short debounce window via a Redis SET NX EX lock. Or move propagation to a dedicated BullMQ queue with concurrency=1 per fuel. Significant architectural change.

### `restorePreviousPrices` (submission rollback) doesn't fire propagation
When a verified submission is rolled back (e.g. user-flagged-wrong path), the station's verified state changes but no propagation fires. Neighbour caches keep estimates derived from the now-deleted submission until 24h TTL.

**How to apply:** After successful rollback, fire `propagateEstimatesToNearbyStations` per restored/previously-verified fuel. ~15 min dev.

### Explain modal copy still says "wholesale market data"
`StationDetailSheet`'s explain modal uses `freshness.marketEstimateExplain` ("This range is based on current wholesale market data"). For the community-grid path the copy should branch to something like "This range is based on prices from nearby drivers."

**How to apply:** Add `estimate.explainCommunityGrid` key + branch the explain-modal copy on whether `referenceStationCount` is present. ~15 min dev.

### `computeEstimatesForStations` community-row branch may carry stale `referenceStationCount`
The `appendEstimated` community-only branch returns the cached community row as-is. If the cache entry was previously populated with `referenceStationCount` (when the fuel was estimated) but is now community-priced, the count persists. Mobile sees `referenceStationCount` alongside a community price — confusing if any consumer reads it without checking `sources`.

**How to apply:** Strip `referenceStationCount` entries for fuels whose `sources[fuel] === 'community'` before returning. Defensive cleanup; defer.

---

## Triage record

This list captures the `defer` bucket from the 2-18 bmad-code-review. The `patch` bucket (P1-P6) was applied in the same commit:
- **P1** — Swap propagation/staleness-clear order in photo-pipeline + admin approve flows. Critical: propagation was running BEFORE the origin's staleness was cleared, so K-nearest for neighbours saw the just-verified origin as still rack-stale (via AC8 input-staleness propagation) and stamped neighbour estimates with `isFromStaleInput=true`.
- **P2** — Guard against NULL / NaN price_litre from the JSON cast. SQL adds `IS NOT NULL` filter; JS adds `Number.isFinite` filter on `validRows`. One malformed row would otherwise propagate `NaN` through the entire IDW midpoint.
- **P3** — i18next plural forms (`_one`/`_few`/`_many`) on `estimate.sourceWithCount` across en/pl/uk. PL was emitting "3 stacji" (genitive) where "3 stacje" (nominative) is required.
- **P4** — `DISTINCT ON` non-deterministic tie-break fixed via `, sub.id DESC` in ORDER BY. Two submissions with identical `created_at` could otherwise flap between prices on consecutive requests.
- **P5** — Same-brand boost case-insensitive via `.toLowerCase()` on both target and neighbour brands. Real-world brand strings (mix of `"Orlen"` / `"orlen"` / `"ORLEN"`) could otherwise silently never trigger the boost.
- **P6** — Target station with NULL location → distinct early-return + warn log, so the K=0 outcome is distinguishable from "we have no neighbours" in ops triage.

The `reject` bucket:
- "DISTINCT ON picks latest sub then filters fuel" — verified correct (WHERE evaluates before DISTINCT ON in PG semantics)
- "Module circular dep" — verified one-way: PriceModule → MarketSignalModule, FillupModule → PriceModule, no back-edge
- "CONFIDENCE_BAND_PLN[5] fallback dead code" — defensive, fine
- "Test K=1 midpoint exact-equality 6.50" — pre-rounded inputs, not load-bearing
- "Mobile `Partial<Record<FuelType, number>>` vs server `Record<string, number>`" — backend-controlled types, acceptable
- "Confidence-band fallback dead code at K=0" — guarded by K=0 → null elsewhere, defensive
- "Multi-pod worker firing" — pre-existing concern shape, single-replica MVP safe
- "Explain modal calls it 'wholesale market data'" — copy update is the proper fix per defer list above; not a 2.18 bug
- "No time-decay of older verified prices" — explicitly out of scope per spec ("the current freshness band 2.17 handles this")
- "No trust-weighting in K-nearest weights" — out of scope per spec
