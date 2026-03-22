---
stepsCompleted: [1]
documents:
  prd: _bmad-output/planning-artifacts/prd.md
  architecture: _bmad-output/planning-artifacts/architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: _bmad-output/planning-artifacts/ux-design-specification.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-03-21
**Project:** desert

## PRD Analysis

### Functional Requirements

**Price Discovery & Map (Phase 1)**
FR1: Driver can view a map of nearby fuel stations with current prices
FR2: Driver can filter or identify stations by fuel type
FR3: Driver can view detailed price information for a specific station
FR4: Driver can visually compare prices across nearby stations (colour-coded by relative price)
FR5: Driver can see data freshness indicators on station prices
FR6: Driver can distinguish between estimated prices and community-verified prices
FR7: System automatically determines price staleness per station by combining time-since-last-submission with macro market signals; stations with likely-outdated prices are visually flagged without sending user notifications

**Data Contribution (Phase 1)**
FR8: Driver can submit a price board photo to update all fuel prices at a station
FR9: System automatically extracts fuel prices from a submitted price board photo
FR10: System matches a submitted photo to the correct station using GPS location
FR11: System uses logo recognition as a secondary signal to confirm station identity
FR12: Driver receives immediate submission confirmation regardless of backend processing status
FR13: Driver can submit a pump display photo to contribute a single fuel type price
FR14: Driver can confirm or correct the system-suggested fuel type on a pump photo submission
FR15: Driver can queue photo submissions locally for automatic retry when offline or connectivity is poor

**User Account (Phase 1)**
FR16: Driver can create an account at first launch via social sign-in (Google, Apple) or email/password
FR17: Driver can view their personal submission history
FR18: Driver can delete their account and all associated personal data
FR19: Driver can export their personal data
FR20: Driver can manage their notification preferences
FR21: Driver can withdraw consent for specific data uses independently of account deletion

**Notifications & Alerts (Phase 1)**
FR22: Driver can opt in to price drop alerts for nearby or saved stations
FR23: Driver can opt in to sharp price rise alerts
FR24: Driver receives a monthly savings summary notification
FR25: System re-prompts drivers to enable notifications at high-value contextual moments

**Fill-up & Consumption Tracking (Phase 2)**
FR26: Driver can submit a pump meter photo to record a fill-up with volume and cost
FR27: System calculates and displays driver savings vs. area average from pump meter data
FR28: Driver can submit an odometer photo to enable fuel consumption tracking
FR29: Driver can view their personal fuel consumption history (l/100km over time)
FR30: Driver can view their personal fuel cost history and trends
FR31: Driver can share their savings summary externally

**Community & Leaderboard (Phase 2)**
FR32: Driver can view a leaderboard of savings rankings segmented by geographic area
FR33: Driver can see their personal rank relative to other drivers in their region

**Station Management (Phase 2)**
FR34: Station owner can claim and verify their station on the platform
FR35: Station owner can self-update fuel prices for their station
FR36: Station owner can view station performance metrics (views, interactions)

**Station Promoted Placement (Phase 2)**
FR37: Station owner can purchase a promoted placement giving enhanced map visibility (larger pin, promoted badge) for a flat daily/weekly fee
FR38: Promoted stations display with enhanced visual treatment and priority ordering when nearby
FR39: Driver can clearly identify promoted stations from organic results

**Station Deal Advertising (Phase 2)**
FR68: Station or chain manager can create a deal advertisement -- structured text: headline + conditions max 120 chars + active dates
FR69: Deal advertisements are reviewed and approved by ops before going live
FR70: Active deal advertisements are displayed in the station detail sheet, additive to community-reported prices -- never replacing them
FR71: Deal advertisements are billed by active days, invoiced end-of-month

**Station Picker (Phase 3)**
FR72: Driver can request a station recommendation from the map
FR73: App surfaces top 2 station recommendations ranked by a disclosed algorithm -- price, distance, data freshness, and active deals as declared factors
FR74: Active deal promotions that influenced a recommendation are transparently labelled on the recommendation card
FR75: Driver can navigate to either recommended station directly from the picker result

**Data Integrity & Moderation (Phase 1)**
FR40: Ops team can review flagged and low-confidence photo submissions in a review queue
FR41: Ops team can view anomaly detection alerts for suspicious submission patterns
FR42: Ops team can access anonymised submission audit trails by station
FR43: System automatically shadow-bans users whose submissions match high-confidence abuse patterns
FR44: System flags medium-confidence suspicious submissions for ops review
FR45: Ops team can manually apply or lift a shadow ban on any account
FR46: Ops team can manually override or flag station prices as unverified
FR47: Driver can report a price submission as incorrect
NOTE: FR48 is missing from the PRD -- gap in numbering between FR47 and FR49 (no functional impact)

**Platform & Data (Phase 1/2)**
FR49: System captures and retains full price history from all submissions from day one
FR50: System provides regional fuel price aggregations by fuel type and geography
FR51: Public users can view regional fuel price trends and consumption benchmarks via a web portal (Phase 2)
FR52: External data buyers can access licensed anonymous datasets via API (Phase 2)

**Fleet Tier (Phase 3)**
FR53: Fleet manager can create a fleet account and add vehicles
FR54: Fleet manager can invite and assign drivers to vehicles
FR55: Fleet dashboard displays per-vehicle fuel cost history, consumption, and spend vs. regional average
FR56: Fleet manager can generate and export fuel expense reports
FR57: Fleet manager can configure price alerts per vehicle or fleet-wide
FR58: System provides route-optimised refuelling suggestions (Phase 3)
FR59: Fleet tier provides API access to price data and fleet analytics (Phase 3)
FR60: Fleet subscription managed via self-serve billing portal

**Operations & Analytics (Phase 1/2)**
FR61: Internal admin dashboard displays real-time operational health (Phase 1)
FR62: Admin dashboard shows API cost tracking (Phase 2)
FR63: Admin dashboard displays data freshness indicators per station (Phase 2)
FR64: Admin dashboard shows contribution funnel metrics (Phase 1)
FR65: Product analytics integration captures key user events (Phase 2)
FR66: Admin dashboard shows user growth and engagement metrics (Phase 2)
FR67: Alerting for OCR failure rate, processing queue, third-party API errors (Phase 1)

**Total FRs: 74** (FR1-FR75, FR48 missing -- clerical gap, no functional impact)

---

### Non-Functional Requirements

**Performance**
NFR1: Map view and station prices load within 3 seconds on a standard mobile connection
NFR2: Photo submission confirmation displayed within 2 seconds of capture
NFR3: Backend processing pipeline completes within 5 minutes under normal load
NFR4: App remains usable with cached data when backend is unavailable or user is offline

**Reliability**
NFR5: Target uptime 99.5% at MVP, aspirational 99.9% as infrastructure matures
NFR6: Graceful degradation -- cached map and price data served when backend is unavailable
NFR7: Photo submission queue persists locally and retries on reconnection -- no data loss from transient outages
NFR8: Async processing failures are logged and retried automatically -- no silent drops

**Security**
NFR9: All data in transit encrypted via TLS 1.2+
NFR10: All personal data encrypted at rest
NFR11: Raw GPS coordinates used for station matching then discarded -- not stored linked to user identity
NFR12: Social sign-in tokens handled via platform-standard OAuth flows -- no credential storage on device
NFR13: Device fingerprinting used only for abuse detection -- not for tracking or advertising
NFR14: Shadow-banned users' data retained in audit trail but excluded from publication

**Scalability**
NFR15: Architecture supports 100-200k MAU at launch; horizontally scalable to order-of-magnitude growth without re-architecture
NFR16: Backend designed to scale horizontally -- photo processing pipeline, database, and API layer independently scalable
NFR17: Globally-capable from day one: multi-currency, per-market fuel taxonomies, localisation-ready
NFR18: Autoscaling handles 3-5x baseline during peak commute hours

**Compliance**
NFR19: GDPR compliance from day one -- Polish/EU jurisdiction
NFR20: Layered consent model: core service consent at signup; feature-specific consent at first use
NFR21: Right to erasure, data export, and consent withdrawal implemented in data model from launch
NFR22: T&Cs and privacy policy legally reviewed before launch
NFR23: App Store and Google Play data safety declarations completed as pre-launch checklist items

**Integration Reliability**
NFR24: Maps API cached tile and POI data -- graceful fallback if API unavailable
NFR25: OCR API submissions queued and retried if API unavailable -- no data loss
NFR26: Push notifications fire-and-forget -- delivery failure acceptable, no retry loop
NFR27: All third-party integrations have defined fallback behaviour -- no single integration failure causes full app failure

**Total NFRs: 27**

---

### PRD Completeness Assessment

The PRD is comprehensive and well-structured. Key observations:
- All three revenue streams clearly documented with distinct products (promoted placement, deal advertising, data licensing)
- Phase assignments are explicit for all FRs
- NFRs cover all standard quality attributes with measurable targets where appropriate
- FR48 is a numbering gap -- no functional impact, clerical skip during editing
- Station Picker (FR72-75) and deal advertising (FR68-71) recently added; no epic stories exist for these yet -- Phase 2/3 scope, expected gap

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Summary | Epic Coverage | Status |
|---|---|---|---|
| FR1 | Map view with station prices | Story 2.2 | COVERED |
| FR2 | Filter by fuel type | Stories 2.2, 2.4 | COVERED |
| FR3 | Station detail price view | Story 2.5 | COVERED |
| FR4 | Colour-coded price comparison | Story 2.3 | COVERED |
| FR5 | Price freshness indicators | Story 2.6 | COVERED |
| FR6 | Estimated vs verified distinction | Story 2.6 | COVERED |
| FR7 | Automatic price staleness detection | Story 2.7 | COVERED |
| FR8 | Price board photo submission | Stories 3.1, 3.3, 3.7 | COVERED |
| FR9 | OCR price extraction | Story 3.5 | COVERED |
| FR10 | GPS-to-station matching | Story 3.4 | COVERED |
| FR11 | Logo recognition secondary signal | Story 3.6 | COVERED |
| FR12 | Immediate submission confirmation | Story 3.2 | COVERED |
| FR13 | Pump display photo contribution | Story 5.2 | COVERED |
| FR14 | Fuel type confirm/correct on pump photo | Story 5.2 | COVERED |
| FR15 | Offline queue with retry | Stories 3.2, 3.8 | COVERED |
| FR16 | Account creation (Google, Apple, email) | Stories 1.2, 1.3, 1.4 | COVERED |
| FR17 | Submission history | Story 1.6 | COVERED |
| FR18 | Account deletion & erasure | Story 1.8 | COVERED |
| FR19 | Personal data export | Story 1.9 | COVERED |
| FR20 | Notification preferences | Story 1.7 | COVERED |
| FR21 | Consent withdrawal | Story 1.10 | COVERED |
| FR22 | Price drop alerts | Story 6.1 | COVERED |
| FR23 | Sharp price rise alerts | Stories 6.2, 6.3 | COVERED |
| FR24 | Monthly savings summary notification | Story 6.5 | COVERED |
| FR25 | Smart notification re-prompting | Story 6.6 | COVERED |
| FR26 | Pump meter photo / fill-up recording | Stories 5.1, 5.2 | COVERED |
| FR27 | Savings vs. area average calculation | Stories 5.0, 5.3 | COVERED |
| FR28 | Odometer photo / consumption tracking | Stories 5.1, 5.4 | COVERED |
| FR29 | Personal consumption history | Story 5.5 | COVERED |
| FR30 | Personal fuel cost history | Story 5.5 | COVERED |
| FR31 | Savings summary sharing | Story 5.7 | COVERED |
| FR32 | Savings leaderboard | Story 6.7 | COVERED |
| FR33 | Personal rank in region | Story 6.7 | COVERED |
| FR34 | Station claim & verification | Stories 7.1, 7.2 | COVERED |
| FR35 | Station self-update prices | Story 7.3 | COVERED |
| FR36 | Station performance metrics | Story 7.4 | COVERED |
| FR37 | Station promoted placement purchase | Story 8.1 | COVERED (see note A) |
| FR38 | Promoted station visual treatment | Story 8.2 | PARTIAL (see note A) |
| FR39 | Driver identifies promoted stations | Story 8.2 | COVERED (see note A) |
| FR40 | Ops submission review queue | Story 4.2 | COVERED |
| FR41 | Ops anomaly detection alerts | Story 4.2 | COVERED |
| FR42 | Ops audit trail access | Story 4.3 | COVERED |
| FR43 | Auto shadow-ban (high confidence) | Story 4.3 | COVERED |
| FR44 | Flag medium-confidence for ops review | Story 4.3 | COVERED |
| FR45 | Manual shadow ban / lift | Story 4.5 | COVERED |
| FR46 | Manual price override / unverify | Story 4.5 | COVERED |
| FR47 | Driver reports incorrect submission | Story 4.4 | COVERED |
| FR48 | (MISSING -- clerical numbering gap) | N/A | N/A |
| FR49 | Full price history retained | Story 2.10 | COVERED |
| FR50 | Regional price aggregations | Story 2.10 | COVERED |
| FR51 | Public web portal for price trends | Story 10.1 | COVERED |
| FR52 | Licensed anonymous data API | Stories 10.2, 10.3, 10.4 | COVERED |
| FR53 | Fleet account & vehicle management | Epic 9 | COVERED (Phase 3) |
| FR54 | Fleet driver assignment | Epic 9 | COVERED (Phase 3) |
| FR55 | Fleet fuel cost dashboard | Epic 9 | COVERED (Phase 3) |
| FR56 | Fleet expense reports | Epic 9 | COVERED (Phase 3) |
| FR57 | Fleet price alerts | Epic 9 | COVERED (Phase 3) |
| FR58 | Route-optimised refuelling | Epic 9 | COVERED (Phase 3) |
| FR59 | Fleet API access | Epic 9 | COVERED (Phase 3) |
| FR60 | Fleet billing portal | Epic 9 | COVERED (Phase 3) |
| FR61 | Admin dashboard -- operational health | Story 4.6 | COVERED |
| FR62 | Admin dashboard -- API cost tracking | Story 4.7 | COVERED (Phase 2) |
| FR63 | Admin dashboard -- data freshness | Story 4.8 | COVERED (Phase 2) |
| FR64 | Admin dashboard -- contribution funnel | Story 4.6 | COVERED |
| FR65 | Product analytics integration | Stories 4.9, 6.8 | COVERED (Phase 2) |
| FR66 | User growth & engagement metrics | Story 4.9 | COVERED (Phase 2) |
| FR67 | Ops alerting (OCR, queue, API errors) | Story 4.4 | COVERED |
| FR68 | Deal advertisement creation | NO STORY | MISSING (see note B) |
| FR69 | Deal advertisement ops moderation | NO STORY | MISSING (see note B) |
| FR70 | Deal advertisement in-sheet display | NO STORY | MISSING (see note B) |
| FR71 | Deal advertisement billing | NO STORY | MISSING (see note B) |
| FR72 | Station Picker -- driver request | NO STORY | MISSING (see note C) |
| FR73 | Station Picker -- top 2 recommendations | NO STORY | MISSING (see note C) |
| FR74 | Station Picker -- transparent deal label | NO STORY | MISSING (see note C) |
| FR75 | Station Picker -- navigate to either result | NO STORY | MISSING (see note C) |

---

### Missing Requirements

**Note A -- Epic 8 stories need partial update (Phase 2/3)**
Epic 8 (Stories 8.1-8.4) was written before the promoted placement / deal advertising split. The stories cover the promoted placement product (FR37-39) reasonably well, but:
- Story 8.3 is labelled "campaign performance dashboard" which now belongs to deal advertising, not promoted placement. The story content needs review to clarify which product it serves.
- No Epic 8 stories cover deal advertising (FR68-71). These need new stories when Phase 2 deal advertising is built.
Recommendation: Review and update Epic 8 stories at Phase 2 sprint planning. Not a blocker for Phase 1.

**Note B -- FR68-71: Station Deal Advertising (Phase 2 -- expected gap)**
These 4 FRs were added today and have no stories yet. This is expected -- deal advertising is Phase 2 scope and Epic 8 stories predate the split. New stories required before Phase 2 deal advertising development begins.
Impact: None for Phase 1. Must be addressed before Phase 2 deal advertising sprint.

**Note C -- FR72-75: Station Picker (Phase 3 -- expected gap)**
These 4 FRs were added today and have no stories. Phase 3 scope -- no action required now.
Impact: None until Phase 3 planning.

---

### Coverage Statistics

- Total PRD FRs: 74 (FR1-FR75, FR48 missing)
- FRs fully covered in epics: 66
- FRs partially covered (need story update): 1 (FR38 -- Epic 8 story review)
- FRs not yet covered (Phase 2, expected): 4 (FR68-FR71)
- FRs not yet covered (Phase 3, expected): 4 (FR72-FR75)
- Phase 1 FR coverage: 100% of Phase 1 FRs covered
- Overall coverage: 89% (66/74), with all gaps being Phase 2/3 scope added today

## UX Alignment Assessment

### UX Document Status

Found: `_bmad-output/planning-artifacts/ux-design-specification.md`
14-step workflow completed. Covers: visual foundation, design direction, 8 user journey flows, 10 custom components, UX consistency patterns, responsive design and accessibility strategy.

---

### UX to PRD Alignment

**Well aligned (Phase 1):**
- FR1-FR7 (map, fuel filter, freshness, estimated/verified): Journey 1 (Browse & Decide) and Journey 2 (Navigate) fully cover the map experience. MapPin component specifies all states including estimated and freshness variants.
- FR8-FR12, FR15 (price board photo, OCR, GPS match, confirmation, offline queue): Journey 2B (Price Contribution) and Journey 4 (Sign-Up Gate) cover the full submission flow including the camera overlay, GPS matching, confirmation card, and sign-up gate pattern.
- FR13-FR14, FR26-FR30 (pump photo, fill-up, odometer): Journey 2C (Fill-Up Log) covers pump capture, odometer nudge, dual contribution from pump photo, and cross-nudge patterns.
- FR16-FR21 (account, GDPR): Journey 3 (First Open / Onboarding) and Journey 5 (Sign-Up) cover the onboarding and account creation flows.
- FR22-FR25 (alerts): Not explicitly a dedicated journey, but notification preferences referenced in Account tab.
- FR34-FR39 (station management, promoted placement display): MapPin promoted state (40dp, amber badge) specified in component strategy. Journey 7 covers the station manager promotion creation flow.
- FR40-FR47 (ops, moderation): Journey 6 (Ops Review) covers the moderation queue.
- FR68-FR70 (deal advertising display and creation): Journey 7/8 covers deal advertisement creation (text-only structured fields: headline + conditions + dates) and display in the station sheet.

**Gaps identified:**

GAP 1 -- Station promoted placement purchase flow (FR37, Phase 2):
The UX spec covers how promoted stations are DISPLAYED on the map (MapPin promoted state) and in the station sheet, but does NOT include a UX journey for how a station owner PURCHASES a promoted placement. The station manager portal (Journey 7) covers deal advertising creation but not promoted placement purchase/management.
Severity: Low -- Phase 2, not a Phase 1 blocker. Add a journey at Phase 2 sprint planning.

GAP 2 -- Station Picker UX (FR72-FR75, Phase 3):
No UX journey or component exists for the "Pick for me" station recommendation feature. Expected -- Phase 3 scope.
Severity: None for current phases.

GAP 3 -- Notification/alerts UX journey (FR22-FR25, Phase 2):
No dedicated UX journey for price drop alerts, sharp-rise alerts, or monthly savings summary. The UX spec mentions the Alerts tab in the bottom nav but does not define the alert notification UX patterns.
Severity: Low -- Phase 2 feature. Define UX at Phase 2 planning before building Epic 6.

GAP 4 -- Leaderboard UX (FR32-FR33, Phase 2):
No UX journey for the savings leaderboard screen. Phase 2 scope.
Severity: Low -- add to Phase 2 UX work.

---

### UX to Architecture Alignment

**Well supported:**
- React Native + Expo: Architecture specifies this stack; UX specifies NativeWind on same stack -- fully aligned
- Camera capture (expo-camera / react-native-vision-camera): Architecture covers photo pre-processing pipeline; UX CameraOverlay component expects camera API access -- aligned
- GPS proximity check (PostGIS ST_DWithin, 200m): Architecture specifies PostGIS for station matching; UX ArrivalBanner requires 200m GPS check on app foreground -- aligned
- Offline queue: Architecture specifies local queue with retry; UX patterns specify silent offline queueing and local-first fill-up storage -- aligned
- Bottom sheet / map interaction: Architecture specifies React Native + Mapbox/HERE; UX StationSheet component expects native map interaction -- aligned
- Real-time price updates: Architecture specifies Redis cache + SSE; UX specifies map loads from cache with background refresh -- aligned
- WCAG AA accessibility: Architecture does not explicitly mention accessibility infrastructure; UX specifies react-native-accessibility-checker in CI -- minor gap (architecture should note this)

**Architecture gap:**

ARCH GAP -- Accessibility testing infrastructure not mentioned in architecture:
The UX spec requires react-native-accessibility-checker in the CI pipeline and Lighthouse accessibility score >= 90 for web surfaces. The architecture document does not reference these requirements. Low impact -- can be added to the CI/CD pipeline story without architectural changes.

---

### Warnings

WARN 1: Station promoted placement purchase journey missing from UX spec (Phase 2 pre-work needed before Epic 8 stories are built)
WARN 2: Notifications/alerts UX not defined (Phase 2 pre-work needed before Epic 6 stories are built)
WARN 3: Leaderboard UX not defined (Phase 2 pre-work needed before leaderboard stories are built)
WARN 4: Architecture document should note accessibility testing infrastructure (react-native-accessibility-checker in CI, Lighthouse >= 90 for web)

## Epic Quality Review

### Epic User Value

All 10 epics are user-value oriented. Epic 4 (Admin Operations) is operational but enables data integrity which is indirectly user-facing value. PASS.

### Epic Independence

**CRITICAL -- Phase 1 forward dependencies (mitigated with fallbacks):**

1. Story 3.7 (Price Validation, Phase 1) depends on Story 5.0 (Regional Benchmarks, Phase 2)
   - Fallback documented in ACs: "at Phase 1 launch, submissions with price history older than 30 days fall through to Tier 3 (absolute range) until Story 5.0 is deployed"
   - Status: Mitigated but must be explicitly verified during Phase 1 QA that the Tier 3 fallback works correctly without Story 5.0

2. Story 2.11 (Cold Start Price Ranges, Phase 1) depends on Story 6.0 (ORLEN rack price ingestion, Phase 2)
   - Fallback documented: "uses voivodeship historical average until Story 6.0 is live"
   - Status: Mitigated and acceptable

3. Story 2.7 (Staleness Auto-Detection) implicitly depends on Story 6.0 for crude oil signals
   - ACs mention "crude oil movements" as a signal but Story 6.0 is the data source
   - Not explicitly called out in ACs
   - Recommendation: Add AC noting that crude oil signal is unavailable in Phase 1 and only generic staleness detection runs until Story 6.0

### Story Sizing

**CRITICAL -- Story 1.1 scope is too large:**
Story 1.1 (Turborepo Foundation) covers: monorepo scaffolding for 5 packages, CI/CD setup, Railway, Vercel, Neon, Upstash, and R2 provisioning, Prisma schema foundation, local dev env. This is a 2-week workstream, not a single story.
Recommendation: Break into:
- Story 1.0a: Monorepo scaffold + local dev environment
- Story 1.0b: Infrastructure provisioning (Railway, Vercel, Neon, Upstash, R2) + CI/CD pipeline

**MINOR -- Stories 4.1 and 5.1 are near upper bound:**
- Story 4.1 (Admin Dashboard Foundation): Next.js app + auth + role guards in one story -- manageable but dense
- Story 5.1 (Vehicle Setup + Car Recognition): Claude Opus integration + cascading dropdowns + vehicle dictionary -- at upper bound of reasonable size

### Story Independence and Forward Dependencies

**MAJOR -- Epic 3 tight linear chain:**
Stories 3.1 through 3.9 form a strict sequential chain where each depends on the prior. The entire contribution pipeline must ship as a unit. If any story is blocked, the entire pipeline is blocked.
Recommendation: Split into:
- Phase 1a (3.1-3.5): Camera capture through OCR -- minimal viable pipeline
- Phase 1b (3.6-3.9): Logo recognition, retry/DLQ, cost controls -- added robustness

**MAJOR -- Story 1.1 missing explicit prerequisites:**
ACs assume Railway, Vercel, Neon, Upstash, R2 accounts exist but do not state them as prerequisites.
Recommendation: Add "Prerequisites: Railway, Vercel, Neon, Upstash, R2 accounts and initial config completed by developer before this story begins"

### Acceptance Criteria Quality

**Overall: GOOD. Core ACs use Given/When/Then throughout and are testable. Specific gaps:**

Story 2.1 (Station Database Sync): Missing AC for sync data corruption scenario
Story 2.2 (Mobile Map View): Missing AC for "no stations in this area" state (relevant -- our UX spec added a station count chip for exactly this case; the AC should verify the chip shows "No stations in this area")
Story 2.7 (Price Staleness): "significantly different" is undefined -- add numeric threshold (e.g. >5% price movement across 3+ submissions within 10km)
Story 3.1 (Camera Capture): Missing AC for GPS race condition (resolves mid-capture); missing disambiguation edge case when station count changes between captures
Story 4.2 (Submission Review Queue): Missing AC for idempotency (admin reviews already-processed submission); missing expiry AC for old flagged submissions
Story 5.2 (Pump Meter OCR): Missing AC for internal consistency check -- when all three values extracted (litres, cost, price/L), they should satisfy price/L approx cost/litres; flag if not
Story 5.4 (Odometer OCR): Missing driver-visible feedback when km delta is zero or negative -- current AC says "flagged internally" but driver sees nothing
Story 6.0 (Fuel Price Feed): Circuit breaker / fallback behavior when ORLEN scrape target changes (site structure update breaking the scraper)
Story 7.3 (Self-Service Price Update): Missing AC for cold-start scenario where regional benchmark doesn't exist yet

### Database Creation Timing

Tables created when first needed by each story. No upfront schema dump. PASS.

### FR Traceability

All stories reference covered FRs. Minor inconsistency: a few stories say "Covers: New requirement" without a FR number (Story 1.12). Acceptable but should be noted for PRD backfill.

---

### Quality Findings Summary

| Severity | Issue | Story | Recommendation |
|---|---|---|---|
| CRITICAL | Story 1.1 is oversized -- covers monorepo, infra, CI/CD, 6 platforms | Story 1.1 | Split into 1.0a (scaffold) and 1.0b (infra/CI/CD) |
| CRITICAL | Phase 1 forward dep on Phase 2 story (3.7 depends on 5.0) | Story 3.7 | Verify Tier 3 fallback works in Phase 1 QA; add explicit AC |
| CRITICAL | Phase 1 forward dep on Phase 2 story (2.11 depends on 6.0) | Story 2.11 | Fallback exists; add Phase 1 planning caveat |
| MAJOR | Epic 3 tight linear chain -- no partial shipping possible | Epic 3 | Consider split: 3.1-3.5 (Phase 1a) vs 3.6-3.9 (Phase 1b) |
| MAJOR | Story 1.1 missing prerequisites (infra accounts) | Story 1.1 | Add Prerequisites section listing required accounts |
| MAJOR | Story 2.7 vague threshold ("significantly different") | Story 2.7 | Define numeric threshold in AC |
| MAJOR | Story 5.2 missing OCR consistency check (cost/volume/price math) | Story 5.2 | Add AC: extracted values validated for internal consistency |
| MAJOR | Story 4.2 missing idempotency and expiry ACs | Story 4.2 | Add ACs for already-reviewed submission and expiry window |
| MINOR | Story 2.2 missing "no stations in area" AC (aligns with UX spec station count chip) | Story 2.2 | Add AC verifying chip shows "No stations in this area" |
| MINOR | Story 3.1 missing GPS race condition AC | Story 3.1 | Add AC for GPS resolving mid-capture |
| MINOR | Story 5.4 missing driver-visible feedback for zero/negative km delta | Story 5.4 | Add AC: driver sees prompt, not just internal flag |
| MINOR | Story 6.0 missing circuit breaker AC for scraper failure | Story 6.0 | Add AC for site structure change fallback |
| MINOR | Story 7.3 missing cold-start AC (no regional benchmark yet) | Story 7.3 | Add AC for when benchmark unavailable |
| MINOR | Story 2.7 implicit Phase 2 dep (crude oil signals from Story 6.0) | Story 2.7 | Add note that crude oil signal unavailable in Phase 1 |

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK -- Phase 1 is close but 3 critical items require action before development starts. Phase 2+ gaps are expected and can be addressed at sprint planning time.**

---

### Critical Issues Requiring Immediate Action (before Phase 1 development)

**CRITICAL 1 -- Story 1.1 oversized (blocks sprint planning)**
Story 1.1 covers monorepo scaffolding, CI/CD, and provisioning of 6 infrastructure platforms in a single story. This is unestimable and unshippable as one unit.
Action: Split into Story 1.0a (monorepo scaffold + local dev) and Story 1.0b (infrastructure provisioning + CI/CD pipeline). Add prerequisites list (Railway/Vercel/Neon/Upstash/R2 accounts) to Story 1.0b.

**CRITICAL 2 -- Story 3.7 Phase 1/Phase 2 forward dependency not explicitly verified**
Story 3.7 relies on a Tier 3 fallback (absolute price range) when Story 5.0 regional benchmarks are unavailable. This fallback must be explicitly tested in Phase 1 QA -- it has never been independently verified.
Action: Add AC to Story 3.7: "Given Story 5.0 has not yet been deployed, When a submission is validated, Then Tier 3 (absolute range) is used and the submission is accepted/rejected correctly without any dependency on regional_benchmarks table."

**CRITICAL 3 -- Story 2.7 implicit Phase 2 dependency not documented**
Story 2.7 references "crude oil movements" as a staleness signal but the data source (Story 6.0 ORLEN feed) is Phase 2. Phase 1 staleness detection will run without this signal but ACs do not acknowledge this.
Action: Add AC to Story 2.7: "Given Story 6.0 has not yet been deployed, When staleness detection runs, Then only time-based and community submission pattern signals are used -- crude oil signals are absent and no error is raised."

---

### Major Issues (address before affected story is built)

**MAJOR 1 -- Epic 3 tight linear chain**
Stories 3.1-3.9 cannot ship incrementally. Any block stops the entire pipeline.
Recommendation: Formally split into Phase 1a (3.1-3.5: capture to OCR) and Phase 1b (3.6-3.9: logo recognition, retry, cost controls). Phase 1a is the minimal viable contribution pipeline; Phase 1b adds robustness.

**MAJOR 2 -- 8+ stories missing error scenario ACs**
Specific gaps across Stories 2.2, 2.7, 3.1, 4.2, 5.2, 5.4, 6.0, 7.3. See Epic Quality Review section for full details.
Recommendation: Address these before each affected story enters development. Not all need fixing before Phase 1 starts -- only the Phase 1 stories (2.2, 2.7, 3.1, 4.2) are time-sensitive.

---

### Warnings (address before Phase 2 sprint planning)

**WARN 1 -- FR68-71 (Station Deal Advertising, Phase 2): No stories exist**
Epic 8 stories need updating to reflect the promoted placement / deal advertising split. New stories required for FR68-71 before Phase 2 deal advertising development.

**WARN 2 -- UX gaps for Phase 2 features**
Three Phase 2 features have no UX journeys yet: notifications/alerts (Epic 6), leaderboard, station promoted placement purchase flow. UX work needed before Phase 2 sprints for these.

**WARN 3 -- Architecture accessibility gap**
Architecture document does not mention react-native-accessibility-checker in CI or Lighthouse >= 90 target for web. Low impact but should be added to CI/CD story (1.0b) as an AC.

---

### Recommended Next Steps

1. **Split Story 1.1 into 1.0a + 1.0b** and add prerequisites section -- can be done today before development begins
2. **Add Phase 1 fallback ACs to Stories 3.7 and 2.7** -- critical for Phase 1 correctness
3. **Add missing error ACs to Phase 1 stories 2.2, 3.1, 4.2, 5.2** -- before each story enters the sprint
4. **Plan Phase 1a / Phase 1b split for Epic 3** -- discuss at first sprint planning
5. **Schedule Phase 2 UX work** -- alerts/notifications UX, leaderboard UX, promoted placement purchase journey -- before Phase 2 sprint planning begins
6. **Create Epic 8 Phase 2 stories** for deal advertising (FR68-71) before Phase 2 station monetisation sprint

---

### Coverage Summary

| Category | Count | Status |
|---|---|---|
| Total PRD FRs | 74 | -- |
| Phase 1 FRs with epic coverage | 100% | PASS |
| Phase 2 FRs with epic coverage | ~80% (FR68-71 missing) | NEEDS WORK |
| Phase 3 FRs with epic coverage | Partial (expected) | ACCEPTABLE |
| NFRs with architecture support | 27/27 | PASS |
| UX journeys for Phase 1 flows | Complete | PASS |
| UX journeys for Phase 2 flows | 3 gaps | NEEDS WORK |
| Epic quality (user value) | 10/10 epics | PASS |
| Story AC completeness | 8 gaps found | NEEDS WORK |
| Forward dependencies (Phase 1) | 3 found, 2 mitigated | NEEDS ACTION |

---

### Final Note

This assessment identified **14 issues** across 4 categories (FR coverage, UX alignment, epic quality, forward dependencies). **3 are critical and must be addressed before Phase 1 development begins.** The remaining 11 are major or minor issues that can be addressed as development progresses.

The foundation is strong: all Phase 1 FRs have stories, the data model is well-sequenced, FR traceability is complete, and the overall architecture is sound. With the 3 critical fixes, desert is ready to begin Phase 1 development.

**Assessor:** Implementation Readiness Workflow
**Date:** 2026-03-21
**Report:** _bmad-output/planning-artifacts/implementation-readiness-report-2026-03-21.md
