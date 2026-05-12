# Story 2.20: Chain Badge on Stations + Multi-Select Chain Filter

Status: ready-for-dev

**Trigger:** 2026-05-10 — new MVP requirement surfaced during four-pillar positioning session. A meaningful share of PL drivers are locked into specific chains by loyalty cards (Orlen Vitay, BPme, Shell ClubSmart, Circle K Pay) or fleet fuel cards. Without a chain filter and visible badge, the map shows them many stations they can't usefully tank at — even if those stations are cheaper. This actively erodes app utility for chain-locked drivers, who are a sizeable subset (millions of PL fuel-card holders). Backend foundation is already in place (Story 2.14 populated `Station.brand`); only the UI is missing.

**Phase:** 1 (pre-launch). Wrap mobile chain-filter UI in `flags.chainFilter` (new flag) per `feedback_feature_flags.md` — default off on prod until brand pattern coverage is verified, default on for staging.

**Coupled stories:**
- **Already shipped:** 2.14 (Station Classification Enrichment) — populated `Station.brand` field; chain detection runs as a post-sync classification job
- **Already shipped:** 2.x map UI stories — this builds on the existing map view

---

## Story

As a **driver locked into one or more fuel chains via loyalty / fleet card**,
I want to see which chain each station belongs to and filter the map to show only my chains,
so that I'm not shown stations I can't usefully tank at, and the map's value is preserved for chain-locked usage patterns.

As an **operator**,
I want chain badges to surface the existing classification work,
so that the brand data we already collect creates user-visible value without additional backend work.

### Why

- **Real driver behaviour:** Polish drivers regularly carry one or more loyalty cards (Vitay is "the standard" per 2026 press; Circle K Pay, BPme, ClubSmart, MOYA Bonus all exist; fleet/business cards lock holders to specific chain networks).
- **App utility for chain-locked users without this:** poor. The cheapest station within radius is often a chain they can't use → the savings narrative misfires.
- **Cost to ship:** modest. Backend already populates `Station.brand` via Story 2.14. UI is map-pin badge + filter screen + a persisted preference.
- **Cost to defer:** real. Chain-locked users churn or never install in the first place if they can't filter the noise.

---

## Acceptance Criteria

**AC1 — Chain badge visible on every station pin (map view):**
Given a driver viewing the map,
When stations are rendered,
Then each pin includes a small chain badge (logo or 1-2 letter monogram for the chain) anchored to the pin or shown on tap-preview,
And independent stations show a neutral "indep." or "—" indicator,
And the badge is visually distinct from the price colour-coding (green/red/yellow) so the two signals don't compete.

The badge is small enough not to overwhelm the pin at typical zoom levels but legible at default zoom (~14).

**AC2 — Chain badge in station detail view:**
Given a driver opens the detail view for a specific station,
When the detail panel renders,
Then the chain name appears prominently (e.g. *"ORLEN"* / *"Lotos"* / *"BP"* / *"Stacja niezależna"*),
And if applicable, the chain's official logo (or a styled wordmark — depends on legal sign-off; safer fallback is text styling).

**AC3 — Chain filter UI on the map:**
Given a driver on the map view,
When they open the filter sheet (existing fuel-type filter UI extended, OR a new sub-section if cleaner),
Then they see a multi-select list of all chains present in PL (Orlen, Lotos, BP, Shell, Circle K, MOYA, AMIC, Avia, Auchan, Tesco, Huzar, Pieprzyk, Independent, plus an "All" toggle),
And selecting a subset filters map pins to only those chains,
And the filter persists across sessions (AsyncStorage on mobile; consider promoting to backend per-user pref later if needed for multi-device sync).

The "All" option is the default for new users (no filter applied = all chains visible).

**AC4 — Filter respects independent stations:**
Given a driver who selects only "Independent",
When the map filter applies,
Then only stations classified as `brand = "independent"` are shown,
And drivers who tank at independents (cheapest in many areas) don't lose access to them.

**AC5 — Filter visual indicator on the map:**
Given a chain filter is active (i.e. not "All" / not all chains selected),
When the map renders,
Then a subtle indicator (chip / badge near the filter button, e.g. *"3 sieci"*) shows the filter is active,
And tapping the indicator opens the filter sheet to adjust.

This prevents the "where did all the stations go?" confusion when a filter is silently active.

**AC6 — Brand pattern coverage review:**
Given the existing `apps/api/src/station/config/brand-patterns.ts` was created in Story 2.14,
When this story ships,
Then the brand pattern list is reviewed and updated for completeness — every meaningful PL chain should match correctly. Specific chains to verify:

- Orlen (incl. *"PKN ORLEN"*, *"Stacja Orlen"*, etc.)
- Lotos (most are post-merger Orlen-rebranded but some Lotos-branded stations remain)
- BP
- Shell
- Circle K (formerly Statoil)
- MOYA
- AMIC (formerly Lukoil PL)
- Avia
- Auchan (in-store fuel stations)
- Tesco (rare, mostly closed in PL)
- Huzar (independent network)
- Pieprzyk (independent network)
- Other: Bliska, Anwim, OKTAN, regional independents

Any station name that doesn't match a known pattern falls back to `brand = "independent"` (existing behaviour from 2.14).

**AC7 — Re-classification trigger if brand patterns change:**
Given a driver complains about a misclassified station OR brand patterns are updated,
When the brand pattern config changes,
Then a one-shot re-classification job can be triggered from admin (incrementing `classification_version`) to rebrand affected stations,
And the existing 1,100ms-delay rate limit from Story 2.14 still applies.

---

## Tasks / Subtasks

- [ ] **T1: Backend — verify + extend brand pattern coverage**
  - [ ] 1.1 Audit `apps/api/src/station/config/brand-patterns.ts` against AC6 chain list
  - [ ] 1.2 Add missing patterns; tighten ambiguous ones
  - [ ] 1.3 Run a one-shot re-classification on staging (and later prod) to apply new patterns
  - [ ] 1.4 Spot-check 20 random stations after re-classify to confirm correct brand attribution

- [ ] **T2: API — chain filter parameter on station-list endpoint**
  - [ ] 2.1 Add optional `chains` query param (CSV) to existing station-list endpoint
  - [ ] 2.2 If absent → return all stations (default behaviour); if present → filter
  - [ ] 2.3 Validate against the known brand whitelist (reject unknown values)
  - [ ] 2.4 Tests for the filter logic + edge cases (empty list, "all", single chain, multiple)

- [ ] **T3: Mobile — chain badge UI on station pin**
  - [ ] 3.1 Choose visual approach (logo vs. monogram — start with monogram for legal safety, evaluate logo licensing later)
  - [ ] 3.2 Render badge on each `StationPin` component
  - [ ] 3.3 Ensure badge doesn't conflict with price colour-coding visually
  - [ ] 3.4 A11y: badge has accessible label (e.g. *"Stacja Orlen"*)

- [ ] **T4: Mobile — chain badge in station detail panel**
  - [ ] 4.1 Add chain row to `StationDetailPanel` component
  - [ ] 4.2 Independent fallback wording (*"Stacja niezależna"*)

- [ ] **T5: Mobile — chain filter UI**
  - [ ] 5.1 Decide: extend existing fuel-type filter sheet OR new dedicated sheet (designer to evaluate)
  - [ ] 5.2 Multi-select with "All" toggle
  - [ ] 5.3 Persist selection via AsyncStorage with key `desert:filter:chains`
  - [ ] 5.4 Re-apply filter on app launch

- [ ] **T6: Mobile — active-filter indicator on map**
  - [ ] 6.1 Show count chip near filter button when chains filter is active
  - [ ] 6.2 Tap chip → open filter sheet

- [ ] **T7: i18n**
  - [ ] 7.1 Add chain-name strings (or use `Station.brand` value directly if it's already a clean canonical name)
  - [ ] 7.2 *"Stacja niezależna"* / *"Independent station"* / *"Незалежна станція"*
  - [ ] 7.3 *"Sieci"* / *"Chains"* — filter title

- [ ] **T8: Tests**
  - [ ] 8.1 API filter tests (chain whitelist validation, multi-chain filtering)
  - [ ] 8.2 Mobile component tests for badge rendering across all known brands
  - [ ] 8.3 Filter persistence test (AsyncStorage)
  - [ ] 8.4 E2E (Playwright/Detox if available) — filter flow on the map

- [ ] **T9: Validation**
  - [ ] 9.1 Manual smoke: Łódź region with each major chain + independents, verify correct badges
  - [ ] 9.2 `pnpm -r type-check` + `pnpm -r lint` clean
  - [ ] 9.3 `bmad-code-review`

---

## Out of Scope

- **Loyalty / fuel-card integration** (e.g. *"Show me discount for my Vitay card"*) — too deep for this story; future Phase 2+ if signal emerges.
- **Chain-specific deal advertising** — overlaps with the existing Phase 2 station deal advertising work (FR68-71); this story doesn't address deals.
- **Logo licensing** — using chain wordmarks may need licensing review before launch. Default to text/monogram badges for v1; legal review before adding actual logo images.
- **Web app parity** — mobile-first for MVP. Web app extension can follow.

---

## Dev Notes

- **Backend foundation is solid** — Story 2.14 already classifies stations by brand on every sync. No new pipeline work needed except (a) brand pattern coverage review and (b) the API filter parameter.

- **Brand pattern config is the single source of truth.** Per Story 2.14 AC2: *"a config-driven brand list (defined in a TypeScript config file, not hardcoded in service logic)."* Keep new patterns in that one file.

- **Logo licensing risk.** Some chains may push back on third-party use of their logo on a competing app. Safer launch position: stylised text badges (e.g. amber-circle "O" for Orlen, dark-blue "S" for Shell). Real logos can be added later with explicit permission or partnership agreement (which Story 7.x partner-portal work may unlock).

- **Mateusz's research note (`feedback_vehicle_catalog_wikipedia.md`):** unrelated, but a reminder to use trustworthy reference sources when researching chain brand names — Wikipedia / official chain websites are fine for this.

- **Per `feedback_commit_messages.md`:** include "2.20" in commit message for traceability.
