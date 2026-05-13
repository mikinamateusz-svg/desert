# Story 2.17: Dynamic Freshness UI (Rack-Aware)

Status: review

**Trigger:** 2026-05-09 — pre-launch design pass on the volatile-pricing problem. In a market where Orlen wholesale moves daily, a price verified yesterday may already be wrong by 5–10 groszy. Today's freshness UI uses purely time-based bands (fresh <2d / recent 2-7d / stale >7d, [freshnessBand](apps/mobile/src/utils/freshnessBand.ts)) and a "may be outdated" warning at the stale boundary. That's too lenient and time-only — a price one day old can be stale because rack just moved, and a price a week old can still be representative if rack has been flat. We have the signal (`StationFuelStaleness` table — server flags fuels as stale on rack movement, clears on fresh community submission) but it's not yet plumbed into the price API or surfaced in mobile UI.

**Phase:** 1 (pre-launch). Companion to 2.18 (community-grid estimates) — both ship together as the "honest map" launch posture.

**Coupled stories already shipped:**
- 2.6 — Price Freshness display (existing time-based bands).
- 2.8 — Price Staleness Auto-Detection (the worker that creates `StationFuelStaleness` rows on rack movement).
- 2.9 — Redis Price Cache.
- Photo pipeline / admin actions / fillup logging — all already clear `StationFuelStaleness` rows when a fresh community price lands ([photo-pipeline.worker.ts:1024](apps/api/src/photo/photo-pipeline.worker.ts#L1024), [admin-submissions.service.ts:618](apps/api/src/admin/admin-submissions.service.ts#L618), [fillup.service.ts:295](apps/api/src/fillup/fillup.service.ts#L295)).

**Coupled stories still spec-only / shipping alongside:**
- 2.18 — Community-Grid Estimates. Shares the staleness flag (estimates inherit staleness from their input neighbours).

---

## Story

As a **driver**,
I want the map to clearly mark prices that may be outdated — even if they're only a day old — when there's a reason to suspect they've changed,
so that I trust prices when they're trustworthy and verify them when they're not.

### Why

The Polish fuel market currently moves daily with Orlen wholesale rack price changes. A purely time-based "fresh / recent / stale" classification is wrong in two directions:

- **False stale:** a 5-day-old price during a flat-rack week is still representative; the existing UI scares users with "may be outdated" copy.
- **False fresh:** a 1-day-old price after an overnight rack movement is *probably* wrong but the existing UI says fresh.

The rack-movement signal already exists (`StationFuelStaleness` worker creates rows when Orlen rack moves; rows self-clear on next community submission). Plumbing it into the price API gives mobile the truth: a price is stale when the rack has moved since it was recorded, regardless of clock-age.

This story replaces time-only with **time + rack-event**. Freshness becomes "since the last relevant event" not "since some absolute date".

---

## Acceptance Criteria

**AC1 — `StationFuelStaleness` flag included in price API response:**
Given a mobile client calls a price-fetch endpoint that returns `StationPriceRow` (existing shape: `prices: Record<fuel, number>`, `priceRange`, `sources`, `estimateLabel`, `updatedAt`),
When the response is built,
Then it includes a new per-fuel boolean `stalenessFlags: Record<fuel, boolean>`,
And the value is `true` for fuel × station combinations with a non-cleared `StationFuelStaleness` row,
And `false` otherwise (including when the station has no submissions yet — rack-staleness is a per-fuel-per-station signal that requires a prior baseline).

**AC2 — Freshness band recalibrated to 3d / 7d / >7d, with rack-event override:**
Given a verified price for a station × fuel,
When the mobile classifies its freshness band,
Then the rule is:

```
if stalenessFlags[fuel] === true → 'stale' (rack moved since last verification)
else if (now - updatedAt) ≥ 7d → 'stale'
else if (now - updatedAt) ≥ 3d → 'recent'
else → 'fresh'
```

(Three states logically; visually fresh and recent are treated identically — see AC3.)

The 3d / 7d thresholds are mobile-side constants in `apps/mobile/src/utils/freshnessBand.ts` so they're tunable in a single place.

**AC3 — Pin gets a small grey dot for stale state:**
Given a station pin renders on the map,
When the underlying price is `stale` (per AC2),
Then a single small grey dot is drawn at the corner of the pin (8px, neutral grey, not the warning amber that's already used for the GPS-override state in 3.20),
And the dot is omitted for `fresh` and `recent` states (no decoration — solid color pin as today),
And the dot doesn't change behaviour: tap still opens the station detail sheet,
And the dot is consistent across both verified-stale and estimated-stale (estimate inherited from a stale-flagged input — relevant once 2.18 ships).

The dot complements rather than replaces the existing "estimated" treatment (grey-with-coloured-border for `estimated` state). A station can show: solid pin (verified, fresh/recent), solid + dot (verified, stale), grey-border (estimated, fresh/recent), grey-border + dot (estimated, stale).

**AC4 — Detail sheet shows simple stale tooltip:**
Given the user opens the station detail sheet for a station with at least one stale fuel,
When the sheet renders,
Then a single inline note appears: *"Cena może być nieaktualna — zweryfikuj, jeśli możesz."* (PL canonical),
And EN/UK translations are present,
And the note does not explain *why* (rack-moved vs age — keep the user-facing copy simple; admins / dev can investigate via per-row data),
And no per-fuel timestamps are shown (kept simple per design discussion — band classification is enough),
And the existing per-fuel `source` label (community / admin_override / seeded) is unchanged.

**AC5 — Stale state propagates from estimate inputs (forward-compat with 2.18):**
Given Story 2.18 lands and a station's price is an estimate derived from K nearby verified prices,
When any of those K input stations have a stale flag for that fuel,
Then the resulting estimate also carries the stale flag,
And the pin / detail surfaces follow AC3 / AC4 unchanged.

This AC is documentation of the contract the 2.18 spec must honour. 2.17 ships with the flag plumb only for direct community-verified rows; 2.18 extends the propagation to estimates.

**AC6 — Cache invariants preserved:**
Given the existing Redis price cache flow,
When a `StationFuelStaleness` row is created or cleared,
Then the affected station's cached `StationPriceRow` is invalidated (or rewritten),
And subsequent map fetches see the updated `stalenessFlags`.

The existing `setAtomic` / `invalidate` pattern already runs on every verified submission and admin action. We need to add a hook in the staleness-detection worker too — when it creates `StationFuelStaleness` rows on rack movement, invalidate the affected stations' caches so the next fetch reflects reality.

**AC7 — i18n PL/EN/UK + Translations type:**
Given new copy strings (the stale tooltip, removed-or-modified existing freshness copy if applicable),
When mobile renders,
Then PL canonical, EN/UK translated and present in the i18n type definitions, type-check fails on missing keys.

**AC8 — Backward-compat for existing data:**
Given the migration / API change rolls out before all mobile clients are updated,
When an old client receives a response with the new `stalenessFlags` field,
Then it ignores the unknown field gracefully (no crash, no validation failure),
And the old client continues using the existing time-only freshness logic until users update.

(Standard JSON additive-field tolerance — mostly automatic, but worth calling out so we don't accidentally introduce a strict-validation guard somewhere.)

---

## Tasks

### Backend (T1–T3)

**T1 — Price API includes `stalenessFlags`:**
- Locate the price assembly path. The map-fetch flow goes through the price service that builds `StationPriceRow` (consumed by `PriceCacheService`). Identify all the call sites that compose this shape.
- Add a join / sub-query: for each station × fuel in the response, check whether a `StationFuelStaleness` row exists. Single batched query per request (don't N+1 it):

```sql
SELECT station_id, fuel_type
FROM "StationFuelStaleness"
WHERE station_id IN ($1, ...)
```

- Build a `Map<stationId, Set<fuelType>>` from the result; fold into the per-station `stalenessFlags` object.
- Update `StationPriceRow` interface to include the new optional field.

**T2 — Cache invalidation on staleness flag changes:**
- In `staleness-detection.service.ts` (the worker that creates `StationFuelStaleness` rows): after `createMany`, call `priceCacheService.invalidate(stationId)` for each affected station. Best-effort (catch + log; don't fail the worker).
- Verify the existing flag-clearing call sites (`photo-pipeline`, `admin-submissions`, `fillup`) all already invalidate the cache. They do (the price cache is invalidated alongside the fresh price write). No change needed there.

**T3 — Tests for new wiring:**
- Service test: price-fetch returns `stalenessFlags` when staleness rows exist; absent (`{}`) when not.
- Service test: staleness-detection worker invalidates the right cache keys on `createMany`.
- Existing tests should pass unchanged — additive contract.

### Mobile (T4–T6)

**T4 — Update `freshnessBand` to consume the new flag:**
- Modify the function signature: `freshnessBand(updatedAt: string, stalenessFlag: boolean): 'fresh' | 'recent' | 'stale' | 'unknown'`.
- Logic per AC2.
- Recalibrate constants: `RECENT_THRESHOLD_DAYS = 3`, `STALE_THRESHOLD_DAYS = 7` (replacing existing 2 and 7).
- Update all call sites — `StationDetailSheet` is the main one; check for others.

**T5 — `StationPin` adds the grey stale dot:**
- New prop: `isStale: boolean`.
- When true, render an 8×8 absolutely-positioned grey dot at the top-right corner of the teardrop. Use a token-defined neutral grey (`tokens.neutral.n400` or similar) to avoid colliding with the GPS-override amber from 3.20.
- Pin gets `isStale` from the parent map view, computed via `freshnessBand` against the per-fuel staleness flag.
- Aggregation rule (when station has multiple fuels with mixed staleness): pin shows the dot if **any** fuel relevant to the displayed price is stale. Conservative — pin warns when *any* fuel might be stale; detail sheet disambiguates per fuel.

**T6 — Detail sheet stale tooltip:**
- In `StationDetailSheet`, when at least one fuel's `freshnessBand` resolves to `stale`, render the inline copy from AC4 above the fuel-list. Style: small / muted, neutral colour (not red-warning).
- Remove or repurpose the existing `t('freshness.mayBeOutdated')` copy — replace with the new key.
- No per-price timestamps (kept simple per design).

### i18n (T7)

**T7 — Translations + type updates:**
- Replace `freshness.mayBeOutdated` (or add a new key, deprecate the old) with `freshness.maybeOutdatedSimple` (PL: *"Cena może być nieaktualna — zweryfikuj, jeśli możesz."*; EN: *"Price may be outdated — verify if you can."*; UK: *"Ціна може бути неактуальною — перевірте, якщо можете."*).
- Update all consumers.
- Type-check confirms all keys present.

### Code review (T8)

**T8 — Run `bmad-code-review` after dev complete.** Focus areas:
- T1 query: is the staleness-flag query batched, not per-station? N+1 risk on large map fetches.
- T1: are all price-fetch paths updated? There's the map-fetch path; is there also a station-detail-fetch path? Check both return `stalenessFlags`.
- T2: cache invalidation race — what if rack-staleness lands while a price-fetch is in flight? The cache might serve a brief stale answer. Acceptable (next fetch corrects).
- T4: pre-existing call sites of `freshnessBand` — does the signature change break any? Audit imports.
- T5: pin dot z-index / accessibility — does the dot interfere with the touch target? It shouldn't (small overlay).
- T6: detail-sheet copy display — what if ALL fuels are stale vs only one? Single tooltip line is fine (per AC4 simplicity), but verify visually.
- AC8 backward compat: confirm there's no client-side strict validation (zod schema?) that would reject the new field.

---

## Out of Scope

- **Per-price age timestamps in the detail sheet** — explicitly dropped per design discussion. Band classification is enough.
- **Pin confidence variants for the upcoming 2.18 estimates** — covered by 2.18 separately (which puts confidence on the detail sheet, not the pin).
- **"Be the first to verify" contribution CTA on stations with no fresh prices** — explicitly dropped (don't direct people to specific stations).
- **Rack-movement reasoning surfaced to driver** ("Hurtowa cena Orlenu zmieniła się…") — kept the tooltip simple. Internal/admin tooling could expose the reason if needed; user-facing UI keeps it generic.
- **Configurable bands per market** — single constant for all markets / all fuels at this stage. If we ever launch in a market with different volatility characteristics, revisit.

---

## Notes for the implementer

- **Existing infra does most of the work.** `StationFuelStaleness` model exists, the worker creates rows, downstream events clear them. We're adding the read path to the price API and the visual treatment in mobile. No new schema. No new workers.
- **The cache is the canonical surface.** Don't add a separate "stale flag cache" layer — fold the flag into the existing `StationPriceRow` cached value, invalidate on the same triggers.
- **Don't over-engineer the dot.** Single 8×8 grey overlay at the corner. No animation, no badge text, no different colour per fuel. The dot says "be cautious"; the detail sheet says specifics.
- **2.18 dependency**: the AC5 "estimate inherits staleness" propagation is documented here as a contract for 2.18. 2.17 itself doesn't compute estimates — it just plumbs the flag.
- **No schema changes** in this story.
- **No migration** needed (additive API field, no DB).
