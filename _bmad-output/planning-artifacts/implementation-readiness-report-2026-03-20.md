---
stepsCompleted: ['step-01-document-discovery', 'step-02-prd-analysis', 'step-03-epic-coverage-validation', 'step-04-ux-alignment', 'step-05-epic-quality-review', 'step-06-final-assessment']
documentsUsed:
  prd: _bmad-output/planning-artifacts/prd.md
  architecture: _bmad-output/planning-artifacts/architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: none
---

# Implementation Readiness Assessment Report

**Date:** 2026-03-20
**Project:** desert

---

## PRD Analysis

### Functional Requirements

**Price Discovery (Phase 1)**
- FR1: Driver can view a map of nearby fuel stations with current prices
- FR2: Driver can filter or identify stations by fuel type
- FR3: Driver can view detailed price information for a specific station
- FR4: Driver can visually compare prices across nearby stations (colour-coded by relative price)
- FR5: Driver can see data freshness indicators on station prices
- FR6: Driver can distinguish between estimated prices and community-verified prices
- FR7: System automatically determines price staleness per station by combining time-since-last-submission with macro market signals; stations with likely-outdated prices are visually flagged without sending user notifications

**Data Contribution (Phase 1 core, Phase 2 extensions)**
- FR8: Driver can submit a price board photo to update all fuel prices at a station
- FR9: System automatically extracts fuel prices from a submitted price board photo
- FR10: System matches a submitted photo to the correct station using GPS location
- FR11: System uses logo recognition as a secondary signal to confirm station identity
- FR12: Driver receives immediate submission confirmation regardless of backend processing status
- FR13: Driver can submit a pump display photo to contribute a single fuel type price *(Phase 2)*
- FR14: Driver can confirm or correct the system-suggested fuel type on a pump photo submission *(Phase 2)*
- FR15: Driver can queue photo submissions locally for automatic retry when offline or connectivity is poor

**User Management (Phase 1)**
- FR16: Driver can create an account at first launch via social sign-in (Google, Apple) or email/password
- FR17: Driver can view their personal submission history
- FR18: Driver can delete their account and all associated personal data
- FR19: Driver can export their personal data
- FR20: Driver can manage their notification preferences
- FR21: Driver can withdraw consent for specific data uses independently of account deletion

**Notifications & Alerts (Phase 2)**
- FR22: Driver can opt in to price drop alerts for nearby or saved stations
- FR23: Driver can opt in to sharp price rise alerts
- FR24: Driver receives a monthly savings summary notification
- FR25: System re-prompts drivers to enable notifications at high-value contextual moments

**Personal Analytics (Phase 2)**
- FR26: Driver can submit a pump meter photo to record a fill-up with volume and cost
- FR27: System calculates and displays driver savings vs. area average from pump meter data
- FR28: Driver can submit an odometer photo to enable fuel consumption tracking
- FR29: Driver can view their personal fuel consumption history (l/100km over time)
- FR30: Driver can view their personal fuel cost history and trends
- FR31: Driver can share their savings summary externally

**Community & Engagement (Phase 2)**
- FR32: Driver can view a leaderboard of savings rankings segmented by geographic area
- FR33: Driver can see their personal rank relative to other drivers in their region

**Station Management (Phase 2)**
- FR34: Station owner can claim and verify their station on the platform
- FR35: Station owner can self-update fuel prices for their station
- FR36: Station owner can view station performance metrics (views, interactions)

**Station Promotions (Phase 3)**
- FR37: Station owner can purchase promotional placement to increase station visibility to nearby drivers
- FR38: Station owner can manage active promotional campaigns and view performance metrics
- FR39: Driver can see promoted stations clearly distinguished from organic results

**Data Integrity & Moderation (Phase 1)**
- FR40: Ops team can review flagged and low-confidence photo submissions in a review queue
- FR41: Ops team can view anomaly detection alerts for suspicious submission patterns
- FR42: Ops team can access anonymised submission audit trails by station
- FR43: System automatically shadow-bans users whose submissions match high-confidence abuse patterns
- FR44: System flags medium-confidence suspicious submissions for ops review
- FR45: Ops team can manually apply or lift a shadow ban on any account
- FR46: Ops team can manually override or flag station prices as unverified
- FR47: Driver can report a price submission as incorrect
- ⚠️ **NOTE: FR48 is missing** — numbering skips from FR47 to FR49. Likely intentional deletion but worth confirming.

**Platform & Data**
- FR49: System captures and retains full price history from all submissions from day one *(Phase 1)*
- FR50: System provides regional fuel price aggregations by fuel type and geography *(Phase 1)*
- FR51: Public users can view regional fuel price trends and consumption benchmarks via a web portal *(Phase 2)*
- FR52: External data buyers can access licensed anonymous datasets via API *(Phase 3 in PRD — updated to Phase 2 in epics)*

**Fleet Tier (Phase 2 in PRD — updated to Phase 3 in epics)**
- FR53: Fleet manager can create a fleet account and add vehicles
- FR54: Fleet manager can invite and assign drivers to vehicles
- FR55: Fleet dashboard displays per-vehicle fuel cost history, consumption, and spend vs. regional average
- FR56: Fleet manager can generate and export fuel expense reports
- FR57: Fleet manager can configure price alerts per vehicle or fleet-wide
- FR58: System provides route-optimised refuelling suggestions
- FR59: Fleet tier provides API access to price data and fleet analytics
- FR60: Fleet subscription managed via self-serve billing portal

**Analytics & Operational Monitoring**
- FR61: Internal admin dashboard displays real-time operational health *(Phase 1)*
- FR62: Admin dashboard shows API cost tracking *(Phase 2)*
- FR63: Admin dashboard displays data freshness indicators per station *(Phase 2)*
- FR64: Admin dashboard shows contribution funnel metrics *(Phase 1)*
- FR65: Product analytics integration captures key user events *(Phase 1)*
- FR66: Admin dashboard shows user growth and engagement metrics *(Phase 2)*
- FR67: Alerting: ops team receives automated alerts on threshold breaches *(Phase 1)*

**Total FRs: 66** (FR1–FR67, excluding missing FR48)

---

### Non-Functional Requirements

**Performance**
- NFR1: Map view and station prices load within 3 seconds on standard mobile connection
- NFR2: Photo submission confirmation displayed within 2 seconds of capture
- NFR3: Backend processing pipeline completes within 5 minutes under normal load
- NFR4: App remains usable with cached data when backend is unavailable

**Reliability**
- NFR5: Target uptime 99.5% at MVP, aspirational 99.9% as infrastructure matures
- NFR6: Graceful degradation — cached map and price data served when backend unavailable
- NFR7: Photo submission queue persists locally and retries on reconnection — no data loss
- NFR8: Async processing failures logged and retried automatically — no silent drops

**Security**
- NFR9: All data in transit encrypted via TLS 1.2+
- NFR10: All personal data encrypted at rest
- NFR11: Raw GPS coordinates used for station matching then discarded — not stored linked to user identity
- NFR12: Social sign-in tokens handled via platform-standard OAuth flows — no credential storage on device
- NFR13: Device fingerprinting used only for abuse detection — not for tracking or advertising
- NFR14: Shadow-banned users' data retained in audit trail but excluded from publication

**Scalability**
- NFR15: Architecture supports 100–200k MAU at launch target; horizontally scalable to order-of-magnitude growth
- NFR16: Backend designed to scale horizontally — pipeline, database, and API layer independently scalable
- NFR17: Globally-capable from day one: multi-currency, per-market fuel taxonomies, localisation-ready
- NFR18: Autoscaling handles 3–5x baseline during peak commute hours

**Compliance**
- NFR19: GDPR compliance from day one — Polish/EU jurisdiction, non-negotiable
- NFR20: Layered consent model: core service consent at signup; feature-specific consent at first use
- NFR21: Right to erasure, data export, and consent withdrawal implemented in data model from launch
- NFR22: T&Cs and privacy policy legally reviewed before launch
- NFR23: App Store and Google Play data safety declarations completed as pre-launch checklist items

**Integration Reliability**
- NFR24: Maps API: cached tile and POI data reduces dependency; graceful fallback if API unavailable
- NFR25: OCR API: submissions queued and retried if API unavailable — no data loss
- NFR26: Push notifications (FCM): fire-and-forget; notification delivery failure is acceptable
- NFR27: All third-party integrations have defined fallback behaviour — no single integration failure causes full app failure

**Total NFRs: 27**

---

### Additional Requirements

- **Tech stack:** React Native + TypeScript + Expo (mobile), NestJS 11 (API), Next.js 16 (web/admin), Turborepo monorepo
- **Camera-only capture:** Gallery upload explicitly not permitted — data integrity constraint
- **GPS mandatory:** Location permission required before camera opens for any photo submission
- **Offline-first:** Cached map + local SQLite submission queue with exponential backoff retry
- **Push notification strategy:** Value-first opt-in, contextual re-prompts at high-value moments
- **Search Mode:** Post-MVP capability — background location session for route-based refuelling
- **App Store compliance:** In-app price reporting, content policy in T&Cs, privacy label declarations
- **No FR48:** Gap in FR numbering (FR47 → FR49) — assumed intentional deletion; to be confirmed

---

### PRD Completeness Assessment

The PRD is comprehensive and well-structured. Requirements are clearly numbered, phased, and traceable. User journeys map directly to functional requirements. Key strengths:
- Clear phase assignments for all FRs
- PoC validation results documented inline
- Risk mitigations explicitly mapped
- Tech stack and architecture philosophy clearly stated

**Flags for follow-up:**
1. FR48 missing — numbering gap should be confirmed as intentional
2. PRD marks FR52 (data licensing API) as Phase 3; epics updated it to Phase 2 — needs alignment
3. PRD marks FR53–FR60 (Fleet) as Phase 2; epics updated to Phase 3 — needs alignment (decisions made intentionally during epics session but PRD not updated)

---

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Summary | Epic Coverage | Phase | Status |
|-----------|------------|---------------|-------|--------|
| FR1 | Driver views map of nearby stations with prices | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR2 | Driver filters stations by fuel type | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR3 | Driver views detailed price info for a station | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR4 | Driver visually compares prices (colour-coded) | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR5 | Driver sees data freshness indicators | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR6 | Driver distinguishes estimated vs. verified prices | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR7 | System auto-flags stale prices (market signal + time) | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR8 | Driver submits price board photo | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR9 | System extracts prices via OCR (Claude Haiku) | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR10 | System matches photo to station via GPS | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR11 | Logo recognition as secondary station identity signal | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR12 | Driver receives immediate submission confirmation | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR13 | Driver submits pump display photo (single fuel type) | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR14 | Driver confirms/corrects fuel type on pump submission | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR15 | Driver queues submissions offline with retry | Epic 3: Photo Contribution Pipeline | 1 | ✓ Covered |
| FR16 | Driver creates account (social or email/password) | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR17 | Driver views personal submission history | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR18 | Driver deletes account and personal data | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR19 | Driver exports personal data | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR20 | Driver manages notification preferences | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR21 | Driver withdraws consent for specific data uses | Epic 1: User Registration & Auth | 1 | ✓ Covered |
| FR22 | Driver opts in to price drop alerts | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR23 | Driver opts in to price rise alerts | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR24 | Driver receives monthly savings summary notification | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR25 | System re-prompts to enable notifications contextually | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR26 | Driver submits pump meter photo (fill-up record) | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR27 | System calculates savings vs. area average | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR28 | Driver submits odometer photo (consumption tracking) | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR29 | Driver views fuel consumption history (l/100km) | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR30 | Driver views fuel cost history and trends | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR31 | Driver shares savings summary externally | Epic 5: Personal Savings & Consumption | 2 | ✓ Covered |
| FR32 | Driver views savings leaderboard by area | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR33 | Driver sees personal rank in region | Epic 6: Community, Alerts & Engagement | 2 | ✓ Covered |
| FR34 | Station owner claims and verifies station | Epic 7: Station Partner Portal | 2 | ✓ Covered |
| FR35 | Station owner self-updates fuel prices | Epic 7: Station Partner Portal | 2 | ✓ Covered |
| FR36 | Station owner views performance metrics | Epic 7: Station Partner Portal | 2 | ✓ Covered |
| FR37 | Station owner purchases promotional placement | Epic 8: Station Promotions | 3 | ✓ Covered ⚠️ Phase mismatch (PRD: Phase 3, matches epics) |
| FR38 | Station owner manages campaigns + metrics | Epic 8: Station Promotions | 3 | ✓ Covered |
| FR39 | Driver sees promoted stations clearly labelled | Epic 8: Station Promotions | 3 | ✓ Covered |
| FR40 | Ops reviews flagged/low-confidence submissions | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR41 | Ops views anomaly detection alerts | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR42 | Ops accesses anonymised submission audit trails | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR43 | System auto shadow-bans high-confidence abuse | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR44 | System flags medium-confidence submissions for ops | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR45 | Ops manually applies/lifts shadow ban | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR46 | Ops manually overrides station prices | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR47 | Driver reports incorrect price submission | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR48 | *(Missing — gap in PRD numbering; intentional deletion assumed)* | N/A | N/A | ⚠️ Not in PRD |
| FR49 | System captures full price history from day one | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR50 | System provides regional price aggregations | Epic 2: Station Map & Price Discovery | 1 | ✓ Covered |
| FR51 | Public web portal for regional price trends | Epic 10: Data Licensing & Public Portal | 2 | ✓ Covered |
| FR52 | External data buyers access licensed API | Epic 10: Data Licensing & Public Portal | 2 | ✓ Covered ⚠️ PRD says Phase 3; epics moved to Phase 2 |
| FR53 | Fleet manager creates fleet account + adds vehicles | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR54 | Fleet manager invites and assigns drivers | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR55 | Fleet dashboard: per-vehicle cost/consumption history | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR56 | Fleet manager exports fuel expense reports | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR57 | Fleet manager configures price alerts per vehicle | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR58 | System provides route-optimised refuelling suggestions | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR59 | Fleet API access for external integrations | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR60 | Fleet subscription self-serve billing portal | Epic 9: Fleet Subscription Tier | 3 | ✓ Covered ⚠️ PRD says Phase 2; epics moved to Phase 3 |
| FR61 | Admin dashboard: real-time operational health | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR62 | Admin dashboard: API cost tracking | Epic 4 (Phase 2 extension) | 2 | ✓ Covered |
| FR63 | Admin dashboard: data freshness per station | Epic 4 (Phase 2 extension) | 2 | ✓ Covered |
| FR64 | Admin dashboard: contribution funnel metrics | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR65 | Product analytics integration (PostHog/Mixpanel) | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |
| FR66 | Admin dashboard: user growth + engagement metrics | Epic 4 (Phase 2 extension) | 2 | ✓ Covered |
| FR67 | Alerting: automated ops alerts on threshold breaches | Epic 4: Admin Operations & Data Integrity | 1 | ✓ Covered |

---

### Missing Requirements

No FRs are missing from epic coverage. All 66 defined FRs (FR1–FR67, excluding FR48 which is absent from the PRD itself) have a named epic and story mapping.

### Phase Alignment Issues (not missing — but PRD not updated)

The following FRs are covered in epics but with a different phase assignment than the PRD states. These are **intentional decisions made during the epics session** — the PRD needs to be updated to reflect them:

1. **FR52** — PRD: Phase 3 → Epics: Phase 2 (data licensing API pulled forward, self-serve onboarding confirmed)
2. **FR53–FR60** — PRD: Phase 2 → Epics: Phase 3 (Fleet tier deprioritised; demand to be validated via in-app feedback before building)
3. **FR37–FR39** — PRD: Phase 3 → Epics: Phase 3 (consistent ✓)

**Action required:** Update PRD phase assignments for FR52 and FR53–FR60 to match epics decisions.

### Coverage Statistics

- **Total PRD FRs defined:** 66 (FR1–FR67, FR48 absent from PRD)
- **FRs covered in epics:** 66 / 66
- **Coverage percentage: 100%**
- **Phase mismatches requiring PRD update:** 9 FRs (FR52, FR53–FR60)

---

## UX Alignment Assessment

### UX Document Status

**Not found.** No UX design document exists in `_bmad-output/planning-artifacts/`.

### Implied UX Assessment

UX is strongly implied — desert is a consumer-facing mobile app (React Native/Expo) with a Next.js web portal. Key UI-intensive flows include:

- Map view with colour-coded station pins and freshness indicators (FR1–FR7)
- Camera capture with framing overlay and GPS confirmation (FR8–FR12)
- Photo submission queue and offline state UI (FR15)
- Onboarding and social sign-in flow (FR16)
- Owner portal: claim flow, price update, dashboard (FR34–FR36)
- Promotion purchase and campaign management (FR37–FR39)
- Personal savings dashboard and consumption charts (FR26–FR31)

### Warnings

⚠️ **No UX document exists for a primarily UI-driven application.** This is acceptable for a solo-founder early-stage project where the developer and designer are the same person, but carries the following risks:

1. **Inconsistent interaction patterns** — no shared reference for screen transitions, gestures, and component reuse across stories.
2. **Story ambiguity** — some stories (e.g., Story 2.x map interactions, Story 3.1 camera overlay) contain implicit UI decisions that will need to be made ad hoc during implementation.
3. **No accessibility baseline defined** — WCAG level not stated anywhere.

### Recommendation

For Phase 1 MVP, the absence of a UX doc is **acceptable** given the project stage and team size. However, before implementing Epic 2 (map) and Epic 3 (camera), consider creating lightweight wireframes or a screen-flow diagram for the core contribution loop (map → station detail → camera → confirmation) to align implementation intent. This does not block readiness.

---

## Epic Quality Review

### 🔴 Critical Violations

**None.** No epics are purely technical milestones without user value. No circular dependencies found. No forward dependencies that break Phase 1 delivery.

---

### 🟠 Major Issues

#### Issue 1: Incorrect `*Covers:*` FR annotations in Stories 4.6, 4.7, 4.8 (numbering shifted)

The `*Covers:*` footers on three Phase 2 Epic 4 stories have wrong FR numbers — each is off by one, which will mislead developers implementing them:

| Story | Story Title | `*Covers:*` annotation | Correct FR | Why wrong |
|-------|------------|----------------------|------------|-----------|
| 4.6 | Contribution Funnel & OCR Metrics | FR61 | FR64 | FR61 = real-time health; FR64 = contribution funnel — story is the funnel |
| 4.7 | API Cost Tracking Dashboard | FR64 | FR62 | FR64 = contribution funnel; FR62 = API cost tracking — story is cost tracking |
| 4.8 | Data Freshness Dashboard | FR65 | FR63 | FR65 = PostHog analytics; FR63 = data freshness — story is data freshness |

**Remediation:** Fix the `*Covers:*` annotation in each story footer. One-line change per story.

---

#### Issue 2: FR61 and FR65 Phase 1 coverage not explicitly assigned to Phase 1 stories

The coverage map lists FR61 (real-time operational health) and FR65 (PostHog/Mixpanel analytics integration) as **Phase 1** requirements, but:

- **FR61** — Story 4.6 claims it (annotation fix above would give it to FR64). FR61 content (OCR pipeline health: success/failure rates, queue depth, processing time) is not explicitly covered by any Phase 1 story's ACs. Story 4.1 (Admin Dashboard Foundation) creates the admin shell but doesn't define the health metrics endpoint.
- **FR65** — PostHog/Mixpanel SDK integration and event tracking (app open, map view, photo capture, submission) is listed as Phase 1 but no Phase 1 story implements it. Story 4.8's incorrect annotation claims it; Story 6.8 calls itself an "extension" — implying there's a base implementation, but that base is undefined.

**Remediation options:**
- Add PostHog/Mixpanel integration ACs to Story 1.1 (walk-skeleton deployment) or create a new Story 4.1a/4.9 for it
- Add pipeline health endpoint ACs to Story 4.1 (Admin Dashboard Foundation) to cover FR61
- Mark FR61 and FR65 as Phase 2 if this is the actual intent (changing the coverage map)

---

#### Issue 3: FR66 has no story

**FR66** (Admin dashboard: user growth and engagement metrics — DAU/MAU, contribution rate, retention cohorts, top contributing users/regions) is listed as Phase 2 in the coverage map under "Epic 4 (Phase 2 extension)" — but no story covers it. Stories 4.6, 4.7, 4.8 cover FR64, FR62, FR63 respectively (after annotation fix). FR66 is unimplemented.

**Remediation:** Add Story 4.9: User Growth & Engagement Dashboard as a Phase 2 Epic 4 story, covering FR66.

---

### 🟡 Minor Concerns

#### Concern 1: Story 2.11 partial cross-phase dependency on ORLEN rack prices

Story 2.11 (Phase 1, cold start estimates) depends on ORLEN rack price signals "already in the staleness detection system" from Story 2.7. However, Story 2.7's ACs describe using "crude oil price movement" as a generic signal — they do not explicitly implement ORLEN rack price ingestion. The explicit ORLEN rack price ingestion is implemented in Story 6.0 (Phase 2).

Story 2.11 has a graceful fallback for when rack data is unavailable (falls back to voivodeship historical average), so Phase 1 delivery is not blocked. However, the intent of "rack-derived" cold start ranges will only fully materialise in Phase 2 when Story 6.0 is live.

**Recommendation:** Add a note to Story 2.11 clarifying that full rack-price-derived ranges require Story 6.0; Phase 1 delivery uses voivodeship average fallback.

---

#### Concern 2: Multiple "As a developer" story personas across all epics

Stories 1.1, 1.5, 1.11, 2.1, 2.7, 2.8, 2.10, 3.3-3.9, 5.0, 6.0 use "As a developer" persona. All are within user-centric epics and enable user value indirectly. This is the standard "walking skeleton" pattern and is not a structural defect. However, it's worth noting that:

- Story 1.5 (RBAC) has no direct user value — it is purely a security prerequisite. Its acceptance criteria are entirely developer/API-facing.
- Stories 3.3-3.9 form a continuous backend pipeline broken into substories; developers may want to consider whether all 7 are truly independently completable or if some should merge.

**Recommendation:** No change required; flag to dev team for sprint planning awareness.

---

#### Concern 3: Epic 9 (Fleet) has no stories

Epic 9 is intentionally deprioritized to Phase 3 with a clear rationale (no demand signal yet, core value works without it). This is not a defect — the decision is documented. However, the epic list entry and FR coverage map both reference Epic 9 stories that don't exist yet.

**Recommendation:** No change required. Revisit when in-app feedback (Story 1.12) produces fleet-related signals.

---

#### Concern 4: Persona formatting inconsistency

Stories 4.1, 4.6, 4.7, 4.8, 6.8 use `As an ops admin,` (unbolded, no asterisks) while the rest of the document uses `As a **driver**,` / `As a **station owner**,` (bolded). Minor formatting inconsistency — no impact on implementation but worth tidying.

---

### Best Practices Compliance Summary

| Epic | Delivers user value | Independently completable | Stories sized appropriately | ACs are testable | FR traceable |
|------|--------------------|--------------------------|-----------------------------|-----------------|--------------|
| Epic 1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Epic 2 | ✓ | ✓ (after Epic 1) | ✓ | ✓ | ✓ |
| Epic 3 | ✓ | ✓ (after Epics 1-2) | ✓ | ✓ | ✓ |
| Epic 4 | ✓ | ✓ (after Epics 1-3) | ✓ | ✓ | ⚠️ Annotation errors + FR66 missing |
| Epic 5 | ✓ | ✓ (Phase 2, after Epic 3) | ✓ | ✓ | ✓ |
| Epic 6 | ✓ | ✓ (Phase 2, after Epics 2-3) | ✓ | ✓ | ✓ |
| Epic 7 | ✓ | ✓ (Phase 2, after Epic 1) | ✓ | ✓ | ✓ |
| Epic 8 | ✓ | ✓ (Phase 3, after Epic 7) | ✓ | ✓ | ✓ |
| Epic 9 | ✓ | N/A (no stories yet) | N/A | N/A | ✓ (listed) |
| Epic 10 | ✓ | ✓ (Phase 2, after Epics 2-3) | ✓ | ✓ | ✓ |

---

## Summary and Recommendations

### Overall Readiness Status

**✅ READY FOR PHASE 1 IMPLEMENTATION** (with minor pre-implementation fixes recommended)

Phase 1 (Epics 1–4) has no critical blockers. The PRD, architecture, and epics are comprehensive, well-structured, and mutually consistent. All Phase 1 FRs are covered. Issues found are annotations errors and missing Phase 2 story — none block Phase 1 development.

---

### Issues by Priority

| # | Severity | Issue | Action Required |
|---|----------|-------|----------------|
| 1 | 🟠 Major | Stories 4.6, 4.7, 4.8 have wrong `*Covers:*` FR numbers (shifted) | Fix annotations before Epic 4 implementation |
| 2 | 🟠 Major | FR65 (Phase 1 PostHog integration) has no Phase 1 story | Add ACs to Story 1.1 or create Story 4.0 |
| 3 | 🟠 Major | FR66 (Phase 2 user growth metrics) has no story | Add Story 4.9 before Phase 2 planning |
| 4 | 🟠 Major | FR61 Phase 1 coverage ambiguous (claimed by Phase 2 Story 4.6) | Clarify: add FR61 ACs to Story 4.1 |
| 5 | 🟠 Major | PRD phase mismatches for FR52, FR53-FR60 (epics supersede) | Update PRD to match epics decisions |
| 6 | 🟡 Minor | Story 2.11 ORLEN rack price dependency (Phase 1/2 split) | Add note to story — fallback exists |
| 7 | 🟡 Minor | Persona formatting inconsistency in Epic 4 stories | Cosmetic fix |
| 8 | 🟡 Minor | No UX document — wireframes recommended for Epic 2-3 core loop | Optional pre-implementation |

---

### Recommended Next Steps

1. **Before starting Epic 4 implementation:** Fix `*Covers:*` annotations in Stories 4.6, 4.7, 4.8 (three one-line fixes)
2. **Before starting Epic 1 implementation:** Decide where PostHog/Mixpanel integration lives — add it to Story 1.1's ACs or create a dedicated story; FR65 is Phase 1
3. **Before Phase 2 planning:** Add Story 4.9 (User Growth & Engagement Dashboard) to cover FR66
4. **Before Phase 2 planning:** Clarify FR61 (real-time operational health) — add specific ACs to Story 4.1 (admin shell) for the pipeline health endpoint
5. **Before PRD is next reviewed:** Update PRD phase assignments: FR52 Phase 3 → Phase 2; FR53-FR60 Phase 2 → Phase 3 (to match epics decisions)
6. **Optional, before Epic 2:** Create a lightweight screen-flow diagram for the core contribution loop (map → station detail → camera → confirmation) — not a blocker but reduces ad-hoc UI decisions during implementation

---

### Strength of the Artefacts

The planning artefacts for desert are notably strong for a solo-founder project:

- **PRD:** 66 FRs, 27 NFRs, PoC validation results inline, risk mitigations mapped, tech stack specified. Well above average for early-stage projects.
- **Architecture:** Specific technology choices locked with rationale, cost estimates validated, all integration failure modes defined.
- **Epics:** 10 epics, 60+ stories, all with Given/When/Then ACs, Why sections, FR traceability, dependency notes. Phase boundaries are clear and logical.
- **Business model:** Financial model, go-to-market strategy, and acquisition valuation documented — unusual at this stage, de-risks execution decisions.

The four issues above are minor corrections in an otherwise well-prepared implementation specification.

---

*Assessment completed: 2026-03-20*
*Documents assessed: PRD, Architecture, Epics (UX: not present)*
*Total FRs validated: 66/66 covered*
*Critical blockers for Phase 1: 0*
*Issues requiring attention before Phase 2: 4*
