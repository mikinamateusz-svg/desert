# Story 2.19: Chain Badge on Pins + Multi-Select Chain Filter (Highlight Mode) + Fuel Dropdown Migration

Status: ready-for-dev

**Renumbered 2026-05-15 from 2.20 → 2.19** (closes a gap; 2.18 was the previous top of Epic 2).

**Trigger:** 2026-05-10 — new MVP requirement surfaced during four-pillar positioning session. A meaningful share of PL drivers are locked into specific chains by loyalty cards (Orlen Vitay, BPme, Shell ClubSmart, Circle K Pay) or fleet fuel cards. Without a chain signal on the pin and a way to prefer their chains on the map, drivers either tap through to discover a station is the wrong brand or miss the cheap chain-matched options entirely. Backend foundation is already in place (Story 2.14 populated `Station.brand`); only the UI is missing.

**Scope addendum 2026-05-15** (during design lock-in): bundled in a migration of the **fuel-type chip row** (built in Story 2.4 + UI-8) to a single-select **dropdown pill** matching the chain dropdown's affordance. The two filter axes (fuel + chain) get equal visual treatment as two pills on the chip row, fit comfortably on iPhone SE 1st gen (320pt width) without horizontal scroll, and use a consistent bottom-sheet interaction. Fuel change becomes two taps instead of one — acceptable trade-off since most users set fuel once and rarely switch. This supersedes Story 2.4's chip-row UX (kept the persistence + first-launch default mechanics from 2.4).

**Phase:** 1 (pre-launch). Wrap mobile chain-filter UI in `flags.chainFilter` (new flag) per `feedback_feature_flags.md` — default off on prod until brand pattern coverage is verified, default on for staging.

**Coupled stories:**
- **Already shipped:** 2.14 (Station Classification Enrichment) — populated `Station.brand` field; chain detection runs as a post-sync classification job
- **Already shipped, superseded here:** 2.4 (Fuel Type Filtering — first-launch default + persistence) — persistence + first-launch default kept; chip-row UX replaced with dropdown
- **Already shipped, superseded here:** UI-8 (Fuel Type Pills — Centring & Chrome Separation) — chip row layout replaced with two-pill dropdown row
- **Already shipped:** UI-2, UI-4 — map chrome surfaces extended (chip row container reused)

---

## Story

As a **driver locked into one or more fuel chains via loyalty / fleet card**,
I want to see at a glance which chain each station belongs to and visually prefer my chains on the map — without losing sight of cheaper non-chain stations,
so that the map respects my card-locked usage pattern but still lets me see when I'm trading off chain loyalty against a better price.

As an **operator**,
I want chain badges to surface the existing classification work without hiding stations that aren't in the filter,
so that the brand data we already collect creates user-visible value and the price-comparison pillar isn't undermined by a hard filter.

### Why

- **Real driver behaviour:** Polish drivers regularly carry one or more loyalty cards (Vitay is "the standard" per 2026 press; Circle K Pay, BPme, ClubSmart, MOYA Bonus all exist; fleet/business cards lock holders to specific chain networks).
- **Hard filter vs highlight:** The naive design hides non-chain stations. But the price-comparison pillar depends on the driver always being able to see whether they're missing a cheaper option. A driver who locks the filter to "Orlen + BP" still wants to know if a Circle K next door is 12 gr/L cheaper — they'll decide whether the savings are worth breaking loyalty. **Highlight mode** preserves that trust signal.
- **Cost to ship:** modest. Backend already populates `Station.brand` via Story 2.14. UI is pin-badge tab + filter sheet + a persisted preference + a desaturate pass on non-matched pins.
- **Cost to defer:** real. Chain-locked users churn or never install if the map shows them noise they can't act on.

---

## Acceptance Criteria

**AC1 — Chain monogram badge on every pin:**
Given a driver viewing the map at zoom ≥ 12,
When stations are rendered,
Then each chain-matched pin shows a small 2-character monogram badge attached as a tab on the top-right of the pin (e.g. `OR` for Orlen, `BP`, `SH`, `LO`, `CK`, `MO`, `AV`, `AU`),
And independent stations show **no badge** (absence indicates independent — no "indep." or "—" label),
And below zoom 12 the badge collapses to a coloured accent dot in the same slot so it doesn't dominate at far-zoom views,
And the badge is visually subordinate to the price-tier pin colour (green/yellow/red/grey) — badge is dark-neutral chip, not chain-coloured, so the two signals don't compete.

The badge tab is positioned so it does not occlude the price number at any zoom level.

**AC2 — Chain identity in station detail sheet:**
Given a driver opens the detail sheet for a specific station,
When the detail panel renders,
Then the chain name appears as the second line under the station name (e.g. *"BP"* / *"ORLEN"* / *"Stacja niezależna"*),
And no chain logo is rendered at v1 (text only — see Out of Scope on logo licensing).

**AC3 — Two-pill chip row (fuel dropdown + chain dropdown):**
Given a driver on the map view,
When they look at the chip row above the map,
Then the row contains exactly **two pills**:
1. `Paliwo: PB 95 ▾` (or whichever fuel is currently selected) — single-select fuel dropdown
2. `Sieci ▾` — multi-select chain dropdown

And both pills follow the same visual treatment (rounded, outline-by-default, brand-accent fill when in a non-default state),
And both pills sit on the same horizontal row with a 16pt gap, comfortably fitting iPhone SE 1st gen (320pt) without horizontal scroll,
And tapping either pill opens its respective bottom sheet.

The chip row from Stories 2.4 + UI-8 (five-fuel chip row) is **removed** — replaced by this two-pill layout.

**AC3a — Fuel dropdown pill behaviour:**
Given the fuel dropdown pill,
When the driver has a fuel preference (steady state — `useFuelTypePreference` always carries a default of `PB_95`, so this is the only state the user practically sees),
Then the pill shows `Paliwo: <FUEL_LABEL> ▾` (e.g. `Paliwo: PB 95 ▾`, `Paliwo: ON ▾`),
And the pill is filled with the brand-accent colour,
And tapping the pill opens the fuel-selection bottom sheet (AC3c).

> **Amended 2026-05-15 (code-review F18).** The original wording specified a pre-selection `Paliwo ▾` no-value state. Since `useFuelTypePreference` always returns a defaulted fuel (`PB_95`) and the first-launch picker (AC3c) opens with no dismiss escape before the pill is reachable, the no-value state was unreachable in practice. Dropping the requirement removes a never-triggered branch from the pill component.

**AC3b — Chain dropdown pill behaviour:**
Given the chain dropdown pill,
When no specific chains are selected (default — "all chains visible"),
Then the pill shows `Sieci ▾` in the neutral outline style,
And when one or more specific chains are active, the pill switches to brand-accent fill and displays the count (e.g. `3 sieci ▾`),
And on phones narrow enough that the active-state pill doesn't fit alongside the fuel pill, the active label collapses to count-only (e.g. `▓ 3 ▾ ▓`) — defensive only; the standard widths above 360pt show the full label.

**AC3c — Fuel selection bottom sheet:**
Given a driver taps the fuel pill,
When the fuel-selection sheet opens,
Then it shows:
1. Title: *"Wybierz paliwo"*
2. Single-select radio rows: `PB 95`, `PB 98`, `ON`, `ON+`, `LPG` (matching the fuel taxonomy currently supported)
3. The currently-selected fuel is pre-ticked
4. A primary `Zastosuj` button that closes the sheet

The sheet matches the visual + dismissal pattern of the chain filter sheet (AC4) and the existing `FlagWrongConfirmSheet` from 3.14: modal transparent, slide animation, drag handle, tap-outside-to-dismiss, hardware-back closes.

The first-launch flow from Story 2.4 AC1 is preserved: when no fuel preference exists in AsyncStorage, this sheet auto-opens once after the first launch with no `Zastosuj` until a fuel is picked (no dismiss escape). Persistence to AsyncStorage `desert:fuelType` is unchanged from 2.4 AC2.

**AC4 — Chain filter bottom sheet:**
Given a driver taps the `Sieci ▾` pill,
When the chain filter sheet opens,
Then it shows:
1. A short copy block: *"Twoje sieci — Pokażemy je w pełnych kolorach. Inne stacje pozostaną widoczne, ale wyciszone — żebyś nie przegapił taniej oferty."*
2. A reset row: `[✓] Wszystkie sieci` (ticked when no specific chains are selected; ticking it deselects all individual chains and exits the filter)
3. A list of all known PL chains as multi-select rows, each with its monogram preview: Orlen `OR`, BP `BP`, Shell `SH`, Lotos `LO`, Circle K `CK`, MOYA `MO`, AMIC `AM`, Avia `AV`, Auchan `AU`, Pieprzyk `PI`, Huzar `HU`, Independent `—`
4. A primary `Zastosuj (N)` button (N = current selected count) that simply closes the sheet — selection is applied live as the user ticks, so the button is a confirmation/close, not a commit gate.

The sheet matches the visual + dismissal pattern of the existing `FlagWrongConfirmSheet` (modal transparent, slide animation, drag handle, tap-outside-to-dismiss, hardware-back closes).

**AC5 — Highlight mode (NOT hard hide):**
Given one or more specific chains are selected (the filter is active),
When the map renders,
Then chain-matched pins render at full opacity and full size with the monogram badge prominent,
And non-matched pins render at **60% opacity + 80% size, no shadow/glow**, but **remain visible and tappable**,
And the price number on a desaturated pin is still legible (white text, dark backdrop preserved),
And the price-tier colour (green/yellow/red/grey) remains visible on desaturated pins so the cheapest-station signal is not lost.

This is the load-bearing AC: never fully hide a station from the map just because it's outside the filter. The price-comparison pillar depends on the driver always being able to see what's around.

**AC6 — Demote announcement banner:**
Given a chain filter has just been activated (or changed),
When the map re-renders with the new filter,
Then a subtle banner appears under the chip row showing the active state and the demote count (e.g. *"3 sieci aktywne · 12 innych stacji wyciszonych"*) with a `Wyczyść` action on the right,
And the banner auto-dismisses after 4 seconds,
And it can be re-summoned by tapping the active `3 sieci ▾` pill (which re-opens the sheet — banner appears again on next change),
And `Wyczyść` resets the filter to no-selection (equivalent to ticking `Wszystkie sieci`).

**AC7 — Detail sheet hint for desaturated stations:**
Given a driver taps a desaturated (non-chain-matched) pin while a filter is active,
When the detail sheet opens,
Then a muted info line appears above the price table: *"Niezgodna z twoim filtrem sieci"* (icon: info circle, colour: neutral.n400),
And the rest of the detail sheet renders normally (full price table, navigate CTA, contribution CTA).

This single line resolves "why was this pin grey?" without a tooltip detour and without adding state to the pin tap itself.

**AC8 — Persistence:**
Given a driver sets a chain filter,
When they kill and re-launch the app,
Then the filter is restored from AsyncStorage (`@filters:chains` — JSON array of brand codes),
And an empty array OR a missing key both resolve to "no filter" (= ticked `Wszystkie sieci`, no demotion).

**AC9 — Default state for new users:**
Given a user opens the app for the first time after this story ships,
When the map renders,
Then no chain filter is active by default (all pins full colour),
And the onboarding flow does NOT push chain selection — drivers self-discover the filter when they want it.

**AC10 — Feature flag gate:**
Given the mobile build,
When `flags.chainFilter` is false,
Then the `Sieci ▾` pill is not rendered, the pin monogram badge is not rendered, the detail-sheet chain line is not rendered, and the filter state in AsyncStorage is ignored (treated as empty).
The flag defaults to **on for staging**, **off for production** until the AC11 brand-pattern coverage audit passes.

**AC11 — Brand pattern coverage audit:**
Given the existing `apps/api/src/station/config/brand-patterns.ts` was created in Story 2.14,
When this story ships,
Then the brand pattern list is reviewed and updated for completeness — every meaningful PL chain matches correctly. Patterns to verify:

- Orlen (incl. *"PKN ORLEN"*, *"Stacja Orlen"*, etc.)
- Lotos (most are post-merger Orlen-rebranded but some Lotos-branded stations remain)
- BP
- Shell
- Circle K (formerly Statoil)
- MOYA
- AMIC (formerly Lukoil PL)
- Avia
- Auchan (in-store fuel stations)
- Pieprzyk (independent network)
- Huzar (independent network)
- Other: Bliska, Anwim, OKTAN, regional independents → fall through to `brand = "independent"`

Any station name that doesn't match a known pattern falls back to `brand = "independent"` (existing 2.14 behaviour).

After the audit, a one-shot re-classification job is triggered (incrementing `classification_version`) to rebrand affected stations — existing 1,100ms-delay rate limit from Story 2.14 applies.

**AC12 — Accessibility:**
Given a screen reader user,
When pins or the filter sheet are surfaced,
Then the pin monogram has an `accessibilityLabel` of the full chain name (e.g. *"Stacja Orlen, PB 95 6,29 zł na litr"*),
And independent pins announce *"Stacja niezależna, PB 95 6,29 zł na litr"*,
And the filter sheet's checkboxes have proper `accessibilityRole="checkbox"` with `accessibilityState.checked` reflecting current selection,
And the demote banner is `accessibilityLiveRegion="polite"` so it announces on activation.

---

## Tasks / Subtasks

- [ ] **T1: Backend — brand pattern coverage audit + API filter not required**
  - [ ] 1.1 Audit `apps/api/src/station/config/brand-patterns.ts` against AC11 chain list
  - [ ] 1.2 Add missing patterns; tighten ambiguous ones
  - [ ] 1.3 Run a one-shot re-classification on staging (and later prod) to apply new patterns
  - [ ] 1.4 Spot-check 20 random stations after re-classify to confirm correct brand attribution
  - [ ] 1.5 **No API filter parameter needed** — the API continues to return all stations in radius; chain filtering is purely client-side because non-matched pins must remain visible (AC5). This avoids round-tripping the filter and means the filter UI is instant.

- [ ] **T2: Mobile — chain monogram badge on `StationPin`**
  - [ ] 2.1 Map `Station.brand` → 2-char monogram via `BRAND_MONOGRAM` constant (`Orlen → OR`, etc.; `independent → null`)
  - [ ] 2.2 Render badge as an absolutely-positioned tab on the top-right of the pin
  - [ ] 2.3 Below zoom 12, collapse to a coloured dot in the same slot
  - [ ] 2.4 a11y: extended `accessibilityLabel` includes chain name (AC12)
  - [ ] 2.5 No badge rendered when `brand === 'independent'`

- [ ] **T3: Mobile — chip row refactor: two-pill layout (`FuelFilterPill` + `ChainFilterPill`)**
  - [ ] 3.1 **Remove** the existing five-fuel chip row from UI-8 (`FuelTypePillRow` or equivalent component) — superseded
  - [ ] 3.2 Build `FuelFilterPill` showing `Paliwo: <FUEL> ▾` (or `Paliwo ▾` pre-selection); brand-accent fill when fuel is selected; opens fuel sheet on tap (AC3a)
  - [ ] 3.3 Build `ChainFilterPill` showing `Sieci ▾` (neutral outline) or `N sieci ▾` (brand-accent fill) when active; opens chain sheet on tap (AC3b)
  - [ ] 3.4 Layout: both pills inline, 16pt gap, on the existing chip-row container; verify iPhone SE 1st gen (320pt) renders without scroll
  - [ ] 3.5 Active-state collapse to count-only `▓ N ▾ ▓` if pills don't fit (defensive fallback)
  - [ ] 3.6 Wrap chain pill in `flags.chainFilter` (AC10) — when flag is off, only the fuel pill renders, occupying the row alone

- [ ] **T3a: Mobile — `FuelSelectionSheet` bottom sheet**
  - [ ] 3a.1 Match `FlagWrongConfirmSheet` modal/dismissal pattern (same as the chain sheet — T4)
  - [ ] 3a.2 Single-select radio rows: PB 95, PB 98, ON, ON+, LPG (AC3c)
  - [ ] 3a.3 Pre-tick currently-selected fuel
  - [ ] 3a.4 `Zastosuj` button closes the sheet
  - [ ] 3a.5 **Preserve 2.4 first-launch flow**: when no `desert:fuelType` exists in AsyncStorage, sheet auto-opens with no dismiss escape until a fuel is picked
  - [ ] 3a.6 Persistence unchanged from 2.4 (AsyncStorage `desert:fuelType`)
  - [ ] 3a.7 Reuse 2.4's existing fuel-type validation (AC7 — corrupt stored value handling)

- [ ] **T4: Mobile — `ChainFilterSheet` bottom sheet**
  - [ ] 4.1 Match `FlagWrongConfirmSheet` modal/dismissal pattern
  - [ ] 4.2 Render explainer copy + `[✓] Wszystkie sieci` reset + chain rows with monogram preview
  - [ ] 4.3 Live preview: selection updates AsyncStorage + map state as user ticks (no commit gate)
  - [ ] 4.4 `Zastosuj (N)` button closes the sheet
  - [ ] 4.5 Persist via AsyncStorage `@filters:chains` (AC8)

- [ ] **T5: Mobile — desaturation pass on non-matched pins**
  - [ ] 5.1 When filter is active, compute `isMatched = brandFilter.length === 0 || brandFilter.includes(station.brand)`
  - [ ] 5.2 Non-matched: 60% opacity, 80% transform-scale, no shadow/elevation
  - [ ] 5.3 Tap target unchanged (still 44dp min)
  - [ ] 5.4 Price text white, backdrop dark preserved (AC5 — must remain legible)

- [ ] **T6: Mobile — demote banner**
  - [ ] 6.1 Banner appears under chip row when filter is active OR just changed
  - [ ] 6.2 Copy: *"N sieci aktywne · M innych stacji wyciszonych"* + `Wyczyść` action
  - [ ] 6.3 Auto-dismiss after 4s
  - [ ] 6.4 Re-summoned on next filter change
  - [ ] 6.5 a11y: `accessibilityLiveRegion="polite"`

- [ ] **T7: Mobile — station detail sheet — chain line + desaturated hint**
  - [ ] 7.1 Add chain row to `StationDetailSheet` (AC2)
  - [ ] 7.2 When entry was from a desaturated pin (filter active + station not in filter), show the *"Niezgodna z twoim filtrem sieci"* line above the price table (AC7)

- [ ] **T8: i18n**
  - [ ] 8.1 PL/EN/UK strings: filter title, explainer copy, chain row labels (use `Station.brand` capitalised + a few exceptions), reset row, button labels, banner copy, detail-sheet hint, independent fallback (*"Stacja niezależna"* / *"Independent station"* / *"Незалежна станція"*)

- [ ] **T9: Tests**
  - [ ] 9.1 Brand pattern coverage tests for new patterns added in T1
  - [ ] 9.2 Pin badge unit tests: each brand renders correct monogram; `independent` renders nothing
  - [ ] 9.3 Filter persistence test (AsyncStorage round-trip)
  - [ ] 9.4 Selector logic: chain filter set → matched/non-matched flags computed correctly
  - [ ] 9.5 Feature-flag-off renders no chain UI at all (fuel pill still renders)
  - [ ] 9.6 Fuel sheet first-launch flow: no AsyncStorage value → sheet auto-opens with no dismiss → picking a fuel persists + closes
  - [ ] 9.7 Existing 2.4 tests pass against the new pill (corrupt stored value handling, persistence round-trip)

- [ ] **T10: Validation**
  - [ ] 10.1 Manual smoke: Łódź region with each major chain + independents, verify correct badges, filter highlight, banner
  - [ ] 10.2 Manual: filter persists across app kill
  - [ ] 10.3 `pnpm -r type-check` + `pnpm -r lint` clean
  - [ ] 10.4 `bmad-code-review`

---

## Out of Scope

- **Loyalty / fuel-card integration** (e.g. *"Show me discount for my Vitay card"*) — too deep for this story; future Phase 2+ if signal emerges.
- **Chain-specific deal advertising** — overlaps with Phase 2 station deal advertising work (FR68-71); this story doesn't address deals.
- **Logo licensing** — using chain wordmarks/logos likely needs licensing review. v1 is text monograms only; real logos can be added later under partnership / explicit permission (which Story 7.x partner-portal work may unlock).
- **Backend API filter parameter** — chain filter stays client-side per T1.5 because non-matched stations must remain in the response (highlight mode, not hide). No `?chains=` parameter on `/v1/prices/nearby`.
- **Web app parity** — mobile-first for MVP. Web app extension can follow.
- **Per-user backend sync of the filter** — AsyncStorage only. Multi-device sync deferred.

---

## Dev Notes

- **Backend foundation is solid.** Story 2.14 already classifies stations by brand on every sync. No new pipeline work needed except the AC11 audit + a one-shot re-classify.

- **Brand pattern config is the single source of truth.** Per Story 2.14 AC2: *"a config-driven brand list (defined in a TypeScript config file, not hardcoded in service logic."* All new patterns land in `apps/api/src/station/config/brand-patterns.ts`.

- **No API change, no DB migration.** This is a pure mobile UI story over already-classified backend data. The API continues to return `brand` on every station in the existing nearby/detail responses.

- **Highlight-mode design choice (AC5) is load-bearing for the positioning pillars.** The price-comparison pillar (Pillar 4 — "really know what you're paying") collapses if drivers can't see cheaper alternatives. Hard hide would break it. The highlight mode is the explicit design constraint that resolves the tension between chain-locked utility and price visibility.

- **Logo licensing risk (existing).** Some chains may push back on third-party use of their logo on a competing app. Safer launch position: stylised text monograms. Real logos can be added later with explicit permission.

- **Per `feedback_commit_messages.md`:** include "2.19" in commit message for traceability.

- **Per `feedback_feature_flags.md`:** ship behind `flags.chainFilter` — staging on, prod off until AC11 audit complete on prod. **The fuel-pill dropdown migration is NOT behind a flag** — it's a UX refactor that ships unconditionally with this story; the chain UI is the new addition that needs the flag.

- **Why fuel goes to a dropdown too:** decided 2026-05-15 during 2.19 design. Two competing pills (fuel + chain) on the chip row don't fit on iPhone SE 1st gen (320pt) without horizontal scroll if both render as chip-rows. Collapsing fuel to a dropdown unifies the affordance with chain, fits any phone width, and trades a one-tap fuel switch for a two-tap one — acceptable since most users set fuel once and rarely switch. The 2.4 first-launch flow + AsyncStorage persistence are preserved; only the visual affordance changes.
