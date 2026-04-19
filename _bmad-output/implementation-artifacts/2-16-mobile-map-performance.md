# Story 2.16: Mobile Map Performance — Quick Wins & Grey Pin Fix

**Epic:** 2 (Station Map & Price Discovery)
**Status:** done
**Review date:** 2026-04-15
**Origin:** Field testing 2026-04-15 (Mateusz, Tomaszów Mazowiecki area)

## Code Review Summary (2026-04-15)

Acceptance Auditor: clean (all 3 ACs implemented exactly).
Adversarial + Edge Case Hunter: 28 findings → 4 patches applied, 7 deferred, 5 rejected as noise.

### Patches Applied
- **P-1** Cache hit can be clobbered by stale in-flight fetch — `abortRef.current?.abort()` now runs before the cache-hit early return in both hooks.
- **P-2** Cross-account cache leak — `coordKey` now includes `accessToken` (or `'guest'`) as a prefix, so caches are scoped per token.
- **P-3** Empty results cached for full TTL masked transient outages — both hooks now skip `coordCache.set` (and AsyncStorage write in stations) when `data.length === 0`.
- **P-4** NaN/Infinity coords could collide on `"NaN_NaN"` key — both hooks early-return when `!Number.isFinite(center.lat) || !Number.isFinite(center.lng)`.

---

## Why

During Step 1 solo field testing, the mobile map felt noticeably slower than the web map and several station pins remained grey (no price colour) even after waiting. Diagnosis identified three independent issues; this story bundles the small fixes.

---

## Acceptance Criteria

### AC-1: Pin appearance debounce reduced

- The `setTimeout` in `handleRegionChange` (`apps/mobile/app/(app)/index.tsx`) fires after 250ms of stable map position (previously 500ms).
- Subjective: pins visibly appear faster after the user stops panning.

### AC-2: Coord-keyed cache prevents redundant network calls on pan-back

- `useNearbyStations` and `useNearbyPrices` each maintain a module-level in-memory cache keyed by `${lat.toFixed(2)}_${lng.toFixed(2)}` (~1.1km grid).
- TTL: 5 min for stations (rarely change), 2 min for prices (more volatile).
- On a cache hit the hook merges cached data into state and skips the network call entirely.
- Cache is populated after every successful network fetch.
- Cache is in-memory only (no AsyncStorage persistence) — refreshed each app launch.

### AC-3: Price colour comparison anchors on viewport, not GPS

- In `priceColorMap` (`apps/mobile/app/(app)/index.tsx`), the anchor is now `fetchCenter ?? location` (was `location ?? fetchCenter`).
- Result: when the user pans more than 20km from their GPS position, visible station pins are still included in the colour comparison population (previously they fell outside the GPS-anchored radius and rendered as `'nodata'` grey).
- When `fetchCenter` is null (before first map move), GPS `location` is still used as the anchor.

---

## Files Changed

- `apps/mobile/app/(app)/index.tsx` — debounce 500→250ms; anchor priority swap
- `apps/mobile/src/hooks/useNearbyStations.ts` — in-memory coord cache
- `apps/mobile/src/hooks/useNearbyPrices.ts` — in-memory coord cache

---

## Out of Scope (Deferred)

- **Bundled `/v1/map/nearby` endpoint** (Option B from the perf discussion): combining stations+prices into a single API response would be cleaner architecture but is a bigger refactor. Logged in `memory/project_deferred.md` for Story 0.1 hardening or follow-up.
- **Persistent disk cache for coord results**: in-memory cache resets each launch. Adding AsyncStorage persistence would help cold-start pan but adds complexity (cache invalidation, size cap).

### Deferred from code review (2026-04-15)

- **D-1 — Unbounded `coordCache` growth in long sessions.** No LRU/size cap on the module-level Map. Theoretical leak; mobile session length makes this low-risk. Add LRU when monitoring shows growth. Suggested: cap at 200 entries, evict oldest by `ts`.
- **D-2 — Station (5min) vs price (2min) TTL mismatch.** Brief orphaned-station window possible after price TTL expires but station TTL hasn't. Bundling into `/v1/map/nearby` (Option B) makes this moot.
- **D-3 — `setError(false)` on cache hit clears unrelated prior errors.** UX trade-off; arguably correct since data is now showing. Reconsider if users complain that error banners disappear unexpectedly.
- **D-4 — No defensive copy of cached arrays.** Convention here is no-mutation; low practical risk. Could `coordCache.set(key, { data: [...data], ts })` if a consumer ever mutates.
- **D-5 — AsyncStorage incoherent with in-memory cache.** Persistent layer only ever stores the *last* fetched coord, while in-memory cache holds many. Pre-existing pattern; AsyncStorage is for cold-start splash only.
- **D-6 — Stations array grows unbounded due to merge.** Pre-existing (not introduced by this story). The merge in `setStations(prev => …)` keeps every previously-known station for the session. Could add max-stations cap or distance-based eviction eventually.
- **D-7 — No invalidation hook for user-posted prices.** Becomes relevant when Epic 3 submission flow surfaces a user's own newly-submitted prices in `/v1/prices/nearby` (currently goes through verification first, so not yet user-visible).

### Rejected as noise
- Anchor flip causes color flicker on first pan — *intended behavior change per AC-3.*
- Debounce 250ms doubles request volume — *user-requested per AC-1; cache mitigates.*
- Comment about ~1.1km grid is misleading at high latitudes — *Poland is 50–54°N; ~0.7km grid there. Cosmetic.*
- `Map.values()` ordering non-deterministic — *no consumer in this codebase relies on order.*
- Cache key omits radius — *hooks call API with default radius only; not a real risk.*

---

## Test Plan

- Unit tests for `priceColor.ts` already cover the colour computation logic — no behaviour change in the algorithm itself, only the anchor input.
- Manual field test:
  1. Open app at GPS location A
  2. Pan map to location B (>20km away)
  3. Verify: station pins appear with colours within ~250ms of pan stop
  4. Pan back to A — verify: pins appear instantly (cache hit, no spinner)
  5. Verify: pins at B are no longer all grey
