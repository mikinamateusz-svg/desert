# Story 2.17 — Deferred Follow-ups

These items surfaced during the bmad-code-review on **2026-05-13**. The three `patch` findings (P1 DTO/controller propagation, P2 cache-hit re-application, P3 DEL chunking) were applied in the same commit; this document captures the rest.

---

## Deferred items

### Per-fuel `FreshnessIndicator` driven by aggregate band
[`StationDetailSheet.tsx`](apps/mobile/src/components/StationDetailSheet.tsx) passes a single aggregate `band` (computed from `hasAnyStaleFuel`) to every per-fuel `<FreshnessIndicator>` row. A fuel that's individually NOT rack-stale renders the stale-band dot if any other fuel at the station is stale.

**How to apply:** thread per-fuel staleness into `<FreshnessIndicator>` (new prop `isStale?: boolean`) and compute band per row. Mostly a prop-plumbing change; ~30 min dev. UX consistency, not load-bearing — the aggregate behaviour over-warns rather than under-warns.

### `FreshnessIndicator` a11y label uses short `mayBeOutdated` copy when rack-stale
The dot's accessibilityLabel is `t('freshness.mayBeOutdated') + '. ' + updatedAt`. When the band resolves to stale via the rack-event override (not time), the label says "Price may be outdated" paired with a very recent timestamp — misleading without a "rack moved" qualifier. Pre-2.17 the short copy was designed for time-stale only.

**How to apply:** detect the override case in `FreshnessIndicator` (would require either the prop above or a new `cause: 'time' | 'rack'` discriminator) and branch the a11y label. Defer until the per-fuel rework above lands.

### StationPin grey-dot vs rotated teardrop geometry
[`StationPin.tsx`](apps/mobile/src/components/map/StationPin.tsx) anchors the 8×8 stale dot at `position: absolute, top: 0, right: 0` of the container View. The teardrop child is rotated −45° so its visible top-right corner sits roughly at `(size, size*0.207)` relative to container origin — the dot floats above the visible pin edge in empty space.

**How to apply:** offset the dot inward (e.g. `top: 4, right: 4`) so it overlays the visible card body. Needs on-device visual QA across the regular and selected pin sizes; tune until it reads as "anchored to the pin". ~15 min dev + visual iteration.

### `setVerifiedPrice` doesn't fold staleness flags before `setAtomic`
The OCR pipeline / admin / fillup paths call `priceService.setVerifiedPrice(stationId, priceRow)` with a `priceRow` that has no `stalenessFlags`. The cache then briefly holds a row with no flags. With P2 (cache-hit re-application) landed, the read path always re-applies flags from the lookup table so this is no longer a correctness issue — but the cached payload is inconsistent with what's served, which could confuse anyone reading the cache directly for debugging.

**How to apply:** fold `applyStalenessFlags` into `setVerifiedPrice` before the `setAtomic` call. Requires injecting `StalenessDetectionService` into `PriceService` only where it's already injected (already done). One-line fix. Defer because the read path is correct.

### `clearStaleFlag` / direct `stationFuelStaleness.deleteMany` paths lack cache invalidation
The fillup path at [`fillup.service.ts:305`](apps/api/src/fillup/fillup.service.ts#L305) clears staleness via `prisma.stationFuelStaleness.deleteMany` directly, bypassing both `clearStaleFlag` and the cache invalidation hook on the staleness-detection service. With P2 (always-re-apply flags) landed, this is no longer a correctness issue — fresh requests always read current staleness state regardless of cache contents. Was a real concern before P2.

**How to apply:** if we ever revert P2 (e.g. for perf reasons), add the same `redis.del(\`${PRICE_CACHE_KEY_PREFIX}${stationId}\`).catch(...)` to all three call sites: `clearStaleFlag`, the fillup `deleteMany`, and any other ad-hoc cleanup paths.

### Sequential staleness lookup in Redis-failure fallback path
The `catch (err)` branch in `findPricesInArea` awaits `findPricesByStationIds(stationIds)` then `getStaleFuelsForStations(stationIds)` sequentially. Two independent Prisma queries that could `Promise.all` for marginal latency wins on Redis-outage scenarios.

**How to apply:** `await Promise.all([this.findPricesByStationIds(stationIds), this.stalenessService.getStaleFuelsForStations(stationIds)])`. Trivial change; defer since the path is already a degraded mode.

### Cache deploy-window degradation (rows written pre-2.17 lack `stalenessFlags`)
With P2 landed this is moot — every request re-applies flags from the lookup table regardless of what's in the cache entry. Worth noting in case anyone investigates "why does the cache row not have stalenessFlags after deploy".

### `i18n` key casing inconsistency
New key `freshness.maybeOutdatedSimple` uses lowercase "maybe"; existing `freshness.mayBeOutdated` is camelCased "mayBe". Cosmetic; no lint rule enforces convention.

**How to apply:** rename one to match the other in a dedicated i18n cleanup pass (would need a sweep across all locales + consumers).

### PL/UK tooltip wrapping on narrow screens
The new tooltip copy includes an en-dash + period (PL: `'Cena może być nieaktualna — zweryfikuj, jeśli możesz.'`). PL strings are notoriously longer than EN; visual QA on 360-dp devices not yet performed.

**How to apply:** check the StationDetailSheet tooltip layout on a small Android device after the next deploy. Tune the copy or break to two lines if wrapping looks awkward.

---

## Triage record

This list captures the `defer` bucket from the 2-17 bmad-code-review. The `patch` bucket (P1–P3) was applied in the same commit:
- **P1** — `StationPriceDto` + controller mapping propagate `stalenessFlags`. WITHOUT THIS the entire mobile-side work was dead — controller silently dropped the field even though service + cache stored it correctly.
- **P2** — `applyStalenessFlags` re-applied to the combined `communityPrices` array (cache hits + DB misses) before `appendEstimated`. Eliminates the correctness dependency on the cache-invalidation hook — the hook is now a freshness optimisation, not load-bearing.
- **P3** — `redis.del(...keys)` chunked at 500 per call to stay under ioredis / Upstash limits when rack-detection flags an entire fuel's worth of stations (~7k at MVP scale).

The `reject` bucket: claimed `STALE_FLAG_TTL_MS` doesn't exist (it does, at line 115 pre-diff), claimed AC1 "false for no-submission stations" is misimplemented (correctly handled — no row in `communityPrices` ≡ no flags emitted, which is the spec contract), dead `rows.length > 0` defensive guard (intentional), DTO has no zod runtime validation (acknowledged in AC8), brittle `setImmediate` test (acceptable for fire-and-forget assertion), `mergeFlags` edge cases (math works out per analysis).
