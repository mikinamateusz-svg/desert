---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics']
inputDocuments: ['prd.md', 'architecture.md']
---

# desert - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for desert, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Price Discovery**
FR1: Driver can view a map of nearby fuel stations with current prices
FR2: Driver can filter or identify stations by fuel type
FR3: Driver can view detailed price information for a specific station
FR4: Driver can visually compare prices across nearby stations (colour-coded by relative price)
FR5: Driver can see data freshness indicators on station prices
FR6: Driver can distinguish between estimated prices and community-verified prices
FR7: System automatically determines price staleness per station by combining time-since-last-submission with macro market signals (ORLEN rack price and Brent crude movements, regional submission patterns); stations with likely-outdated prices are visually flagged on the map without sending user notifications

**Data Contribution**
FR8: Driver can submit a price board photo to update all fuel prices at a station
FR9: System automatically extracts fuel prices from a submitted price board photo via Claude Haiku 4.5 OCR
FR10: System matches a submitted photo to the correct station using GPS location (PostGIS, 200m radius)
FR11: System uses logo recognition as a secondary signal to confirm station identity
FR12: Driver receives immediate submission confirmation regardless of backend processing status
FR13: Driver can submit a pump display photo to contribute a single fuel type price *(Phase 2)*
FR14: Driver can confirm or correct the system-suggested fuel type on a pump photo submission *(Phase 2)*
FR15: Driver can queue photo submissions locally for automatic retry when offline or connectivity is poor

**User Management**
FR16: Driver can create an account at first launch via social sign-in (Google, Apple) or email/password — account creation is required to use the app, framed as joining the community
FR17: Driver can view their personal submission history
FR18: Driver can delete their account and all associated personal data
FR19: Driver can export their personal data
FR20: Driver can manage their notification preferences
FR21: Driver can withdraw consent for specific data uses independently of account deletion

**Notifications & Alerts** *(Phase 2)*
FR22: Driver can opt in to price drop alerts for nearby or saved stations
FR23: Driver can opt in to sharp price rise alerts
FR24: Driver receives a monthly savings summary notification
FR25: System re-prompts drivers to enable notifications at high-value contextual moments (first photo submission, first savings summary generated)

**Personal Analytics** *(Phase 2)*
FR26: Driver can submit a pump meter photo to record a fill-up with volume and cost
FR27: System calculates and displays driver savings vs. area average from pump meter data
FR28: Driver can submit an odometer photo to enable fuel consumption tracking
FR29: Driver can view their personal fuel consumption history (l/100km over time)
FR30: Driver can view their personal fuel cost history and trends
FR31: Driver can share their savings summary externally

**Community & Engagement** *(Phase 2)*
FR32: Driver can view a leaderboard of savings rankings segmented by geographic area
FR33: Driver can see their personal rank relative to other drivers in their region

**Station Management** *(Phase 2)*
FR34: Station owner can claim and verify their station on the platform
FR35: Station owner can self-update fuel prices for their station
FR36: Station owner can view station performance metrics (views, interactions)

**Station Promoted Placement** *(Phase 2)*
FR37: Station owner can purchase a promoted placement for their station, giving it enhanced map visibility (larger pin, promoted badge) for a flat daily/weekly fee
FR38: Promoted stations display with enhanced visual treatment (larger pin, badge) and priority ordering when nearby
FR39: Driver can clearly identify promoted stations from organic results

**Station Deal Advertising** *(Phase 2)*
FR68: Station or chain manager can create a deal advertisement — structured text: headline + conditions max 120 chars + active dates
FR69: Deal advertisements are reviewed and approved by ops before going live
FR70: Active deal advertisements are displayed in the station detail sheet, additive to community-reported prices — never replacing them
FR71: Deal advertisements are billed by active days, invoiced end-of-month

**Station Picker** *(Phase 3)*
FR72: Driver can request a station recommendation ("Pick for me") from the map
FR73: App surfaces top 2 station recommendations ranked by a disclosed algorithm — price, distance, data freshness, and active deals as declared factors
FR74: Active deal promotions that influenced a recommendation are transparently labelled on the recommendation card ("Has active offer")
FR75: Driver can navigate to either recommended station directly from the picker result

**Data Integrity & Moderation**
FR40: Ops team can review flagged and low-confidence photo submissions in a review queue
FR41: Ops team can view anomaly detection alerts for suspicious submission patterns
FR42: Ops team can access anonymised submission audit trails by station
FR43: System automatically shadow-bans users whose submissions match high-confidence abuse patterns without manual intervention (e.g. duplicate submissions from same GPS coordinates, prices outside market range, coordinated multi-account patterns from same device)
FR44: System flags medium-confidence suspicious submissions for ops review; ops team can confirm or dismiss a shadow ban
FR45: Ops team can manually apply or lift a shadow ban on any account
FR46: Ops team can manually override or flag station prices as unverified
FR47: Driver can report a price submission as incorrect

**Platform & Data**
FR49: System captures and retains full price history from all submissions from day one
FR50: System provides regional fuel price aggregations by fuel type and geography
FR51: Public users can view regional fuel price trends and consumption benchmarks via a web portal *(Phase 2)*
FR52: External data buyers can access licensed anonymous datasets via API *(Phase 3)*

**Fleet Tier** *(Phase 2)*
FR53: Fleet manager can create a fleet account and add vehicles (by registration plate or vehicle name)
FR54: Fleet manager can invite and assign drivers to vehicles
FR55: Fleet dashboard displays per-vehicle fuel cost history, consumption (l/100km), and spend vs. regional average
FR56: Fleet manager can generate and export fuel expense reports by vehicle, driver, or time period (CSV, PDF)
FR57: Fleet manager can configure price alerts per vehicle or fleet-wide; alerts delivered via push and email
FR58: System provides route-optimised refuelling suggestions — cheapest station within acceptable detour on a planned route *(Phase 2)*
FR59: Fleet tier provides API access to price data and fleet analytics for integration with external systems *(Phase 2)*
FR60: Fleet subscription managed via self-serve billing portal (upgrade, downgrade, cancel, invoice history)

**Analytics & Operational Monitoring**
FR61: Internal admin dashboard displays real-time operational health: OCR pipeline success/failure rates, average processing time, queue depth, and error breakdown by failure type *(Phase 1)*
FR62: Admin dashboard shows API cost tracking: daily/monthly spend on OCR (Claude Haiku), Maps (Google Places, Mapbox/HERE), and push notifications — with trend and budget alerts *(Phase 2)*
FR63: Admin dashboard displays data freshness indicators per station — time since last verified price update, stations with stale data flagged *(Phase 2)*
FR64: Admin dashboard shows contribution funnel metrics: photos submitted → OCR attempted → OCR succeeded → station matched → price published, with drop-off rates at each stage *(Phase 1)*
FR65: Product analytics integration (e.g. PostHog or Mixpanel) captures key user events: app open, map view, station detail view, photo capture initiated, photo submitted, price alert triggered, contribution streak — for retention and funnel analysis *(Phase 2)*
FR66: Admin dashboard shows user growth and engagement metrics: DAU/MAU, contribution rate, retention cohorts, top contributing users/regions *(Phase 2)*
FR67: Alerting: ops team receives automated alerts when OCR failure rate exceeds threshold, processing queue exceeds latency SLA, or third-party API error rate spikes *(Phase 1)*

### NonFunctional Requirements

**Performance**
NFR1: Map view and station prices load within 3 seconds on a standard mobile connection
NFR2: Photo submission confirmation displayed to the user within 2 seconds of capture
NFR3: Backend processing pipeline (OCR, station matching, price update) completes within 5 minutes under normal load
NFR4: App remains usable with cached data when backend is unavailable or user is offline

**Reliability**
NFR5: Target uptime 99.5% at MVP, aspirational 99.9% as infrastructure matures
NFR6: Graceful degradation — cached map and price data served when backend is unavailable; app does not hard-fail
NFR7: Photo submission queue persists locally and retries on reconnection — no data loss from transient outages
NFR8: Async processing failures are logged and retried automatically — no silent drops

**Security**
NFR9: All data in transit encrypted via TLS 1.2+
NFR10: All personal data encrypted at rest
NFR11: Raw GPS coordinates used for station matching then discarded — not stored linked to user identity
NFR12: Social sign-in tokens handled via platform-standard OAuth flows (Google, Apple) — no credential storage on device
NFR13: Device fingerprinting used only for abuse detection — not for tracking or advertising purposes
NFR14: Shadow-banned users' data retained in audit trail but excluded from publication

**Scalability**
NFR15: Architecture supports 100–200k MAU at launch target; horizontally scalable to order-of-magnitude growth without re-architecture
NFR16: Backend designed to scale horizontally — photo processing pipeline, database, and API layer independently scalable
NFR17: Globally-capable from day one: multi-currency, per-market fuel taxonomies, localisation-ready
NFR18: Autoscaling handles 3–5x baseline during peak commute hours

**Compliance**
NFR19: GDPR compliance from day one — Polish/EU jurisdiction, non-negotiable
NFR20: Layered consent model: core service consent at signup; feature-specific consent at first use; data licensing requires no individual consent if properly anonymised
NFR21: Right to erasure, data export, and consent withdrawal implemented in data model from launch — not retrofitted
NFR22: T&Cs and privacy policy legally reviewed before launch
NFR23: App Store and Google Play data safety declarations completed as pre-launch checklist items

**Integration Reliability**
NFR24: Maps API (Google Places + Mapbox/HERE hybrid): cached tile and POI data reduces dependency on real-time API availability; graceful fallback if API unavailable
NFR25: OCR API (Claude Haiku): submissions queued and retried if API unavailable — no data loss
NFR26: Push notifications (FCM): fire-and-forget; notification delivery failure is acceptable
NFR27: All third-party integrations have defined fallback behaviour — no single integration failure causes full app failure

### Additional Requirements

- **Monorepo:** Turborepo structure — apps/mobile (React Native + Expo), apps/api (NestJS 11), apps/web (Next.js 16), apps/admin (Next.js 16), packages/db (Prisma), packages/types, packages/config
- **Backend:** NestJS 11 with BullMQ for async photo pipeline — retryable, observable, dead-letter queue
- **Web surfaces:** Next.js 16 (App Router), Tailwind CSS + shadcn/ui, Server Components for SEO-critical pages
- **Database:** Neon PostgreSQL + Prisma ORM + PostGIS extension for spatial queries
- **Queue & Cache:** Upstash Redis + BullMQ — price cache (TTL-based) + photo pipeline jobs
- **Photo storage:** Cloudflare R2 — auto-delete after OCR processing; peak in-flight ~750MB–1.4GB regardless of scale
- **Auth:** SuperTokens (open source, Apache 2.0) — Google OAuth + Apple OAuth + email/password; NestJS Guards + decorator-based RBAC; 5 actor types: DRIVER, STATION_MANAGER, FLEET_MANAGER, ADMIN, DATA_BUYER
- **Deployment:** Railway (API + workers), Vercel (web + admin), Neon (DB), Upstash (Redis), Cloudflare R2
- **API design:** REST + OpenAPI, `/v1/` URL prefix, auto-generated spec from NestJS decorators; no public price API
- **Rate limiting:** Redis-backed per-IP (web) and per-user-token (API) via NestJS throttler
- **Station sync:** ~8,000 Polish stations in local DB, weekly Google Places grid sync, PostGIS `ST_DWithin` for GPS matching (200m radius)
- **Photo pre-processing:** expo-image-manipulator on device — 1920px max width, 75% JPEG quality, ~200–500KB per photo
- **Mobile offline queue:** SQLite-backed local queue, exponential backoff retry (30s, 2min, 10min), non-alarming pending indicator
- **GDPR data model:** Null PII fields on User record on deletion; retain `user_id` FK on Submission forever (legitimate interest for fraud prevention); GPS never written to DB
- **Pipeline retry strategy:** Transient errors → 3 retries with backoff; unreadable photo (<40% confidence) → immediate reject; GPS match failure → immediate reject; max retries → dead-letter queue + ops alert
- **Price caching:** Redis read-through (DB on miss), atomic cache invalidation on price verify, 10-min TTL safety fallback
- **SSR public map:** Next.js Server Components fetch prices server-side — no raw JSON endpoint exposed; full SEO indexing

### UX Design Requirements

No UX Design document found. UX requirements are captured within PRD user journeys and functional requirements.

### FR Coverage Map

| FR | Epic | Phase |
|---|---|---|
| FR1–FR7 | Epic 2: Station Map & Price Discovery | 1 |
| FR8–FR12, FR15 | Epic 3: Photo Contribution Pipeline | 1 |
| FR13–FR14 | Epic 5: Personal Savings & Consumption Intelligence | 2 |
| FR16–FR21 | Epic 1: User Registration & Authentication | 1 |
| FR22–FR25 | Epic 6: Community, Alerts & Engagement | 2 |
| FR26–FR31 | Epic 5: Personal Savings & Consumption Intelligence | 2 |
| FR32–FR33 | Epic 6: Community, Alerts & Engagement | 2 |
| FR34–FR36 | Epic 7: Station Partner Portal | 2 |
| FR37–FR39 | Epic 8: Station Promotions & Advertising (promoted placement) | 2 |
| FR68–FR71 | Epic 8: Station Promotions & Advertising (deal advertising) | 2 |
| FR72–FR75 | Future Epic: Station Picker | 3 |
| FR40–FR47 | Epic 4: Admin Operations & Data Integrity | 1 |
| FR49–FR50 | Epic 2: Station Map & Price Discovery | 1 |
| FR51 | Epic 10: Data Licensing & Public Portal | 2 |
| FR52 | Epic 10: Data Licensing & Public Portal | 2 |
| FR53–FR60 | Epic 9: Fleet Subscription Tier | 3 |
| FR61, FR64, FR67 | Epic 4: Admin Operations & Data Integrity | 1 |
| FR62, FR63, FR65, FR66 | Epic 4 (Phase 2 extension) | 2 |

## Epic List

### Epic 1: User Registration & Authentication
Drivers can create accounts, sign in (Google, Apple, email/password), and manage their identity and GDPR rights. The platform foundation is deployed, all surfaces are live, and an in-app feedback channel is open from day one.
**FRs covered:** FR16, FR17, FR18, FR19, FR20, FR21
**Architecture included:** Turborepo monorepo scaffolding, Neon DB provisioning, SuperTokens auth, NestJS RBAC (5 actor types), Railway/Vercel deployment, CI/CD baseline
**Phase:** 1 (MVP)

### Epic 2: Station Map & Price Discovery
Drivers and public users can view a map of Polish fuel stations colour-coded by price, see freshness indicators, and distinguish community-verified prices from seeded estimates.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR49, FR50
**Architecture included:** Google Places weekly station sync (~8,000 stations), PostGIS, Redis price cache, Mapbox tile rendering, SSR public map (Next.js Server Components)
**Phase:** 1 (MVP)

### Epic 3: Photo Contribution Pipeline
Drivers photograph price boards; the system extracts prices via AI OCR, matches the GPS location to the nearest station, updates the database, and immediately confirms to the driver — all within 10 seconds from their perspective. Offline submissions queue and retry automatically.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR15
**Architecture included:** expo-image-manipulator pre-processing, Cloudflare R2 upload, BullMQ async pipeline, Claude Haiku 4.5 OCR, PostGIS GPS matching, retry/dead-letter queue, SQLite offline queue
**Phase:** 1 (MVP)

### Epic 4: Admin Operations & Data Integrity
The ops team can review flagged submissions, monitor OCR pipeline health, detect and action abuse patterns, manage shadow bans, and keep data trustworthy. Phase 2 extends with API cost tracking, data freshness dashboards, and engagement metrics.
**FRs covered:** FR40, FR41, FR42, FR43, FR44, FR45, FR46, FR47, FR61, FR64, FR67 (Phase 2: FR62, FR63, FR65, FR66)
**Architecture included:** Admin Next.js dashboard, BullMQ observability, anomaly detection logic, shadow ban system, PostHog/Mixpanel analytics integration, automated alerting
**Phase:** 1 (MVP core) + 2 (extensions)

### Epic 5: Personal Savings & Consumption Intelligence *(Phase 2)*
Drivers who contribute pump meter and odometer photos unlock personal savings summaries, fuel consumption history (l/100km), and cost trend visualisations.
**FRs covered:** FR13, FR14, FR26, FR27, FR28, FR29, FR30, FR31
**Phase:** 2

### Epic 6: Community, Alerts & Engagement *(Phase 2)*
Drivers receive proactive price drop and sharp-rise alerts, earn a spot on the regional savings leaderboard, and can share monthly savings achievements.
**FRs covered:** FR22, FR23, FR24, FR25, FR32, FR33
**Phase:** 2

### Epic 7: Station Partner Portal *(Phase 2)*
Station owners claim and verify their station, self-update prices, and view performance metrics — becoming active, invested data contributors.
**FRs covered:** FR34, FR35, FR36
**Phase:** 2

### Epic 8: Station Promotions & Advertising *(Phase 2/3)*
Station owners and chain managers reach drivers through promoted map placement (Phase 2) and deal advertising — structured text offers with verified proof URLs (Phase 2). Station Picker (algorithm-driven recommendations, Phase 3) is a future epic.
**FRs covered:** FR37, FR38, FR39, FR68, FR69, FR70, FR71
**Phase:** 2 (promoted placement + deal advertising); Phase 3 (Station Picker — future epic)

### Epic 9: Fleet Subscription Tier *(Phase 3)*
Fleet managers track multi-vehicle fuel costs, generate expense reports, receive configurable price alerts, and get route-optimised refuelling suggestions via a B2B subscription. Deprioritised from Phase 2 — core price-discovery value works without the fleet tier; will revisit when fleet drivers signal demand in-app.
**FRs covered:** FR53, FR54, FR55, FR56, FR57, FR58, FR59, FR60
**Phase:** 3

### Epic 10: Data Licensing & Public Portal *(Phase 2)*
Public users browse a live fuel price map, SEO-optimised station pages, and regional analytics on the web. External data buyers self-serve one of two distinct licensed API products: fuel price data (available at launch) and vehicle consumption benchmarks (gated on Epic 5 adoption).
**FRs covered:** FR51, FR52
**Phase:** 2

---

## Epic 1: User Registration & Authentication

Drivers can create accounts, sign in (Google, Apple, email/password), and manage their identity and GDPR rights. The platform foundation is deployed and all surfaces are live.

### Story 1.0a: Turborepo Monorepo Scaffold & Local Dev Environment

As a **developer**,
I want a fully scaffolded monorepo with all packages building and a working local dev environment,
So that the team can start feature development immediately with consistent tooling.

**Why:** Getting the monorepo structure right before touching infrastructure prevents costly refactors later. Shared packages (types, db, config) established here are imported by every subsequent story — any structural problem compounds across the whole project. Local dev being reliable first means infrastructure surprises don't block feature work.

**Acceptance Criteria:**

**Given** the repository is freshly cloned
**When** the developer runs the install and build commands
**Then** all packages build without errors (apps/mobile, apps/api, apps/web, apps/admin, packages/db, packages/types, packages/config)

**Given** the monorepo is set up
**When** a developer runs the local dev command
**Then** apps/api starts on localhost with a `/health` endpoint returning 200
**And** apps/web and apps/admin are reachable on localhost
**And** a local PostgreSQL instance (Docker or Neon dev branch) is connected with Prisma migrations applied
**And** a local Redis instance (Docker or Upstash dev) is reachable from the API

**Given** the monorepo is set up
**When** a pull request is opened
**Then** CI runs lint, type-check, and build for all affected packages automatically

---

### Story 1.0b: Infrastructure Provisioning & CI/CD Pipeline

As a **developer**,
I want all production infrastructure provisioned and a CI/CD pipeline deploying to it,
So that every subsequent story ships to real users from day one with no deployment surprises.

**Prerequisites:** The following accounts must be created and credentials stored in the team password manager before this story begins:
- **Railway** — API hosting (apps/api)
- **Vercel** — Web and admin hosting (apps/web, apps/admin)
- **Neon** — Managed PostgreSQL (production + staging branches)
- **Upstash** — Managed Redis
- **Cloudflare R2** — Object storage for price submission photos

**Why:** Deploying a walking skeleton to production on day one means every feature built from Story 1.1 onwards is immediately shippable. Leaving infra provisioning until later creates a risky big-bang deployment that is hard to debug and delays user feedback.

**Acceptance Criteria:**

**Given** the infrastructure is provisioned (Railway, Vercel, Neon, Upstash, Cloudflare R2)
**When** a deployment is triggered on main
**Then** apps/api is live on Railway with a `/health` endpoint returning 200
**And** apps/web and apps/admin are live on Vercel with a reachable index page
**And** Neon PostgreSQL is reachable from the API with Prisma migrations applied
**And** Upstash Redis is reachable from the API
**And** Cloudflare R2 bucket is provisioned and accessible from the API

**Given** the deployed API
**When** `GET /health` is called
**Then** the response includes service status and current timestamp

**Given** a pull request is merged to main
**When** CI/CD runs
**Then** the deployment completes without manual intervention
**And** a failed deployment triggers an alert to the team channel (Slack or email)

### Story 1.1: Driver Email/Password Registration & Login

As a **driver**,
I want to create an account with my email and password and sign back in,
So that I can access the app and my contributions are tracked to my identity.

**Why:** Account creation is the gateway to the community flywheel — contributions, leaderboard, savings tracking, and moderation all depend on knowing who submitted what. Email/password covers users without Google or Apple accounts and is the baseline auth method before social sign-in is added.

**Acceptance Criteria:**

**Given** a new user opens the app for the first time
**When** they complete the registration form (email, password, display name)
**Then** a new `User` record is created with `role: DRIVER` and a linked SuperTokens session
**And** they are signed in and land on the map screen

**Given** a registered driver opens the app
**When** they enter their email and password
**Then** they receive a valid JWT session and are navigated to the map screen

**Given** a driver attempts to register with an email already in use
**When** they submit the registration form
**Then** they see a clear error message indicating the email is already registered

**Given** a driver enters an incorrect password on login
**When** they submit the form
**Then** they see an error message and the session is not created

**Given** a registered driver
**When** they sign out
**Then** their session token is invalidated and they are returned to the sign-in screen

**Given** a user views the registration or sign-in screen
**When** their device language is set to Polish, English, or Ukrainian
**Then** all text on the screen is displayed in that language

### Story 1.2: Google Sign-In

As a **driver**,
I want to sign up and sign in using my Google account,
So that I can get started without creating a new password.

**Why:** Social sign-in dramatically reduces registration friction — the single biggest drop-off point in consumer app onboarding. Google is the dominant social provider on Android (desert's primary platform) and removes the password management burden entirely.

**Acceptance Criteria:**

**Given** a new user taps "Continue with Google" on the mobile sign-in screen
**When** they complete the Google OAuth flow
**Then** a `User` record is created with `role: DRIVER` and their Google identity linked via SuperTokens
**And** they are signed in and land on the map screen

**Given** a returning driver who registered with Google
**When** they tap "Continue with Google"
**Then** they are signed back into their existing account — no duplicate `User` record is created

**Given** a driver who cancels the Google OAuth flow mid-way
**When** they are returned to the app
**Then** no account is created and they remain on the sign-in screen with no error

**Given** the Google OAuth flow completes successfully
**When** the SuperTokens session is created
**Then** the resulting JWT is accepted by the NestJS `AuthGuard` on all protected API routes

**Given** a user views the Google sign-in screen
**When** their device language is set to Polish, English, or Ukrainian
**Then** all app-controlled text on the screen is displayed in that language

### Story 1.3: Apple Sign-In

As a **driver**,
I want to sign up and sign in using my Apple account,
So that I can get started privately without sharing my email if I choose not to.

**Why:** Apple sign-in is mandatory for App Store approval whenever any other social sign-in is offered. It's also the preferred sign-in method for a significant portion of iOS users, particularly privacy-conscious ones. Skipping it blocks iOS launch.

**Acceptance Criteria:**

**Given** a new user taps "Continue with Apple" on the mobile sign-in screen
**When** they complete the Apple OAuth flow
**Then** a `User` record is created with `role: DRIVER` and their Apple identity linked via SuperTokens
**And** they are signed in and land on the map screen

**Given** a driver who uses Apple's "Hide My Email" option during sign-up
**When** their account is created
**Then** the Apple-generated relay email is stored — the app functions identically regardless of whether a real or relay email is used

**Given** a returning driver who registered with Apple
**When** they tap "Continue with Apple"
**Then** they are signed back into their existing account — no duplicate `User` record is created

**Given** a driver who cancels the Apple OAuth flow mid-way
**When** they are returned to the app
**Then** no account is created and they remain on the sign-in screen with no error

**Given** the app is submitted to the App Store
**When** Google sign-in is offered
**Then** Apple sign-in is also present on the same screen (App Store compliance requirement)

**Given** a user views the Apple sign-in screen
**When** their device language is set to Polish, English, or Ukrainian
**Then** all app-controlled text on the screen is displayed in that language

### Story 1.4: First-Open Onboarding & Guest Mode

As a **new driver**,
I want to open the app and see the map immediately without being forced to register,
So that I can explore fuel prices before deciding whether to create an account.

**Why:** The no-registration-wall principle is central to desert's growth strategy — forcing sign-up before showing value kills conversion (the GasBuddy anti-pattern). The first-open experience must deliver immediate value (map with prices), offer a soft one-time sign-up prompt, and gate only the contribution action. Guest mode keeps the funnel wide open and lets the product speak for itself.

**Acceptance Criteria:**

**Given** a new user opens the app for the first time
**When** the app finishes loading
**Then** they see a splash screen briefly, followed by the map screen — no auth required
**And** a one-time soft sign-up card is shown: "Track your savings and streak" with options: Continue with Google · Continue with Apple · Use Email · Skip

**Given** a new user sees the soft sign-up card
**When** they tap Skip
**Then** they enter guest mode and land on the map
**And** the sign-up card is never shown again on any subsequent app open

**Given** a user who previously skipped the sign-up card
**When** they open the app again
**Then** they go directly to the map with no prompt shown

**Given** a guest user on the soft sign-up card
**When** they tap Use Email
**Then** they are navigated to the email registration screen (Story 1.1)

**Given** a guest user on the soft sign-up card
**When** they tap Continue with Google
**Then** they are navigated to the Google sign-in flow (Story 1.2)

**Given** a guest user on the soft sign-up card
**When** they tap Continue with Apple
**Then** they are navigated to the Apple sign-in flow (Story 1.3)

**Given** a guest user who completes the camera flow for their first price submission
**When** the photo is ready to submit
**Then** a contribution sign-up gate is shown: "Your photo is ready to submit" with Continue with Google · Continue with Apple · Use Email options
**And** if they abandon, the photo is discarded and they return to the map with no nag or penalty

**Given** a user viewing the soft sign-up card or the contribution sign-up gate
**When** their device language is set to Polish, English, or Ukrainian
**Then** all text is displayed in that language

**Dependencies:** Stories 1.1 (email auth), 1.2 (Google sign-in), 1.3 (Apple sign-in) must exist before this story can be fully wired up.

---

### Story 1.5: RBAC & Role Enforcement

As a **developer**,
I want all API routes protected by role-based access control,
So that each actor type can only access the resources they are authorised for.

**Why:** Desert has 5 distinct actor types with very different permissions — a driver must never access admin endpoints, a data buyer must never access fleet data. RBAC built in from day one is far cheaper than retrofitting it later, and prevents accidental data exposure as the API surface grows.

**Acceptance Criteria:**

**Given** an unauthenticated request to any protected API endpoint
**When** the request is received
**Then** the API returns 401 Unauthorized

**Given** an authenticated driver attempting to access an admin-only endpoint
**When** the request is received
**Then** the API returns 403 Forbidden

**Given** an authenticated user with role `ADMIN`
**When** they access an admin-only endpoint
**Then** the request is processed successfully

**Given** an authenticated user with role `DRIVER`
**When** they access a driver-permitted endpoint (e.g. `POST /v1/submissions`)
**Then** the request is processed successfully

**Given** any authenticated request
**When** the NestJS `AuthGuard` verifies the JWT
**Then** the `User` record (including role) is loaded from the database and attached to the request context for downstream use

**Given** the five actor types (DRIVER, STATION_MANAGER, FLEET_MANAGER, ADMIN, DATA_BUYER)
**When** any route is defined
**Then** it has an explicit `@Roles()` decorator — no route is inadvertently left unprotected

### Story 1.6: Submission History

As a **driver**,
I want to view a list of my past price submissions,
So that I can see my contribution history and track my activity on the platform.

**Why:** Contributors need feedback that their effort landed. Without a history screen, the app feels like a black hole after submission. It also lays the data foundation for Phase 2 leaderboards and contribution streaks — capturing the data now means nothing is lost even before those features are built.

**Acceptance Criteria:**

**Given** an authenticated driver with at least one past submission
**When** they navigate to their submission history screen
**Then** they see a chronological list of their submissions, each showing station name, fuel type(s), submitted price(s), and submission date

**Given** an authenticated driver with no past submissions
**When** they navigate to their submission history screen
**Then** they see an empty state message encouraging them to make their first contribution

**Given** a driver with many submissions
**When** they scroll through their submission history
**Then** the list paginates correctly and all submissions are accessible

**Given** a driver whose submission was rejected by the OCR pipeline
**When** they view their submission history
**Then** rejected submissions are either excluded or shown with a clear "not published" indicator — never shown as verified prices

**Given** a driver views their submission history screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all text on the screen is displayed in that language

### Story 1.7: Notification Preferences

As a **driver**,
I want to manage which notifications I receive from the app,
So that I only get alerts that are relevant and useful to me.

**Why:** Notification permission is one of the highest-value retention levers in the product — price drop alerts bring users back without any active effort. A value-first opt-in approach (showing the benefit before the OS dialog) maximises permission grant rates. Granular controls prevent users from disabling all notifications just to stop one they dislike.

**Acceptance Criteria:**

**Given** a driver opens the app for the first time
**When** they reach the notification permission prompt
**Then** they are shown the value proposition (price drop alerts, sharp-rise warnings, monthly savings summaries) before the OS permission dialog is shown

**Given** a driver who declined the OS notification permission
**When** they later navigate to notification preferences
**Then** they see a prompt explaining how to enable notifications via device settings — the app does not show a broken toggle

**Given** a driver with notifications enabled
**When** they navigate to notification preferences
**Then** they can individually toggle each notification type (price drops, sharp-rise alerts, monthly summary) on or off

**Given** a driver who has toggled a notification type off
**When** that notification type would otherwise be triggered
**Then** no notification is sent to that driver for that type

**Given** a driver who declined notifications at onboarding
**When** they complete their first photo submission
**Then** they are contextually re-prompted with "Want to know when prices drop near you?" — once, non-intrusively

**Given** a driver views the notification preferences screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all text on the screen is displayed in that language

### Story 1.8: Account Deletion & Right to Erasure

As a **driver**,
I want to permanently delete my account,
So that my personal data is removed from the platform in compliance with my GDPR rights.

**Why:** GDPR Article 17 (right to erasure) is a legal obligation for all EU-facing products — non-negotiable. The double-confirmation UX protects against accidental deletion. The PII-nulling approach (rather than record deletion) preserves moderation capability via the retained `user_id` FK, which is justified under GDPR legitimate interest for fraud prevention.

**Acceptance Criteria:**

**Given** an authenticated driver navigates to account settings
**When** they tap "Delete my account"
**Then** they are shown a first confirmation screen explaining what will be deleted (personal data) and what will be retained (anonymised contribution records for platform integrity)

**Given** a driver proceeds past the first confirmation
**When** they are shown the second confirmation
**Then** they must explicitly type "DELETE" to confirm — the final delete button is disabled until the text matches exactly

**Given** a driver completes both confirmation steps
**When** the deletion is processed
**Then** `email`, `display_name`, and `auth_provider_id` on their `User` record are set to NULL
**And** their SuperTokens session is revoked
**And** their `deleted_at` timestamp is recorded

**Given** an account has been deleted
**When** anyone (including ops) looks up that user
**Then** no personally identifiable information is recoverable — only the anonymised `user_id` and integrity-relevant fields (trust score, shadow ban status) remain

**Given** a deleted account's `user_id`
**When** the submissions table is queried
**Then** the `user_id` FK is still present on all past submissions — moderation capability is preserved per legitimate interest

**Given** a driver attempts to sign in after deleting their account
**When** they use their previous credentials
**Then** the login fails and they see a message indicating no account exists for those credentials

**Given** a driver views the account deletion screens
**When** their selected language is Polish, English, or Ukrainian
**Then** all text including confirmation prompts and warnings is displayed in that language

### Story 1.9: Personal Data Export

As a **driver**,
I want to download a copy of all my personal data held by the platform,
So that I can exercise my GDPR right to data portability.

**Why:** GDPR Article 20 (right to data portability) is a legal requirement for EU-facing products. Implementing it at launch avoids costly retrofitting and demonstrates good faith to regulators. It also builds user trust — drivers contributing data feel safer knowing they can take it with them.

**Acceptance Criteria:**

**Given** an authenticated driver navigates to account settings
**When** they request a data export
**Then** they receive confirmation that their export is being prepared

**Given** the export is prepared
**When** it is ready
**Then** the driver receives a download link (via email or in-app) to a JSON file containing all personal data: account details, submission history, notification preferences, and consent records

**Given** a driver downloads their export
**When** they open the file
**Then** it contains only their own data — no other user's data is included

**Given** a driver requests an export after account deletion is initiated
**When** the request is processed
**Then** the export reflects the data at the time of the request — the system does not block export during the deletion flow

**Given** the export download link
**When** more than 24 hours have passed
**Then** the link expires and is no longer accessible — a new request is required

**Given** a driver requests a data export
**When** their selected language is Polish, English, or Ukrainian
**Then** all confirmation messages and emails are delivered in that language

### Story 1.10: Consent Management

As a **driver**,
I want to review and withdraw my consent for data uses independently of deleting my account,
So that I have control over how my data is used.

**Why:** GDPR requires that consent be as easy to withdraw as to give, and that withdrawal is possible without forcing account deletion. The consent schema is intentionally minimal at MVP (core service only) but designed to be extensible — each Phase 2 feature that introduces a new data use will add its own consent type here.

**Acceptance Criteria:**

**Given** a new driver completes registration
**When** their account is created
**Then** a consent record is created with `type: CORE_SERVICE`, `consented_at` timestamp, and `withdrawn_at: NULL`

**Given** an authenticated driver navigates to privacy settings
**When** they view their consent status
**Then** they see the core service consent with the date they agreed and an option to withdraw

**Given** a driver withdraws core service consent
**When** they confirm the withdrawal
**Then** `withdrawn_at` is recorded on the consent record
**And** they are informed that withdrawing core service consent will result in account deletion (since the service cannot function without it)

**Given** the consent schema in the database
**When** a new feature requiring separate consent is added in future
**Then** a new consent `type` can be added without migrating existing consent records

**Given** a driver views the consent management screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all text including consent descriptions and withdrawal warnings is displayed in that language

### Story 1.11: Internationalisation (i18n) Foundation

As a **developer**,
I want all user-facing text externalised into language files supporting Polish, English, and Ukrainian,
So that every screen in the app can be displayed in the user's preferred language from day one.

**Why:** Polish is the primary market, but a significant Ukrainian population lives in Poland (one of the largest in Europe post-2022), and English-speaking expats and tourists are also a meaningful segment. Building i18n into the foundation — rather than retrofitting it later — is dramatically cheaper. Every string added from this story onwards goes into a language file, not hardcoded into components.

**Acceptance Criteria:**

**Given** the mobile app is set up
**When** the i18n framework is initialised (e.g. i18next + expo-localization)
**Then** language files exist for Polish (pl), English (en), and Ukrainian (uk) covering all existing UI strings

**Given** a user's device language is set to Polish, English, or Ukrainian
**When** they open the app
**Then** the app is displayed in their device language automatically

**Given** a user's device language is set to any other language
**When** they open the app
**Then** the app falls back to English as the default

**Given** a user navigates to app settings
**When** they select a preferred language manually
**Then** the app switches to that language immediately, overriding the device default

**Given** any new UI string is added to the codebase
**When** it is implemented
**Then** it is added to all three language files — no hardcoded strings in components

**Given** the web surfaces (apps/web, apps/admin)
**When** they are set up
**Then** they use the same i18n approach with the same three language files (pl, en, uk)

---

### Story 1.12: In-App Feedback & Feature Requests

As a **driver**,
I want to send feedback or suggest a feature directly from the app,
So that I can share ideas and problems without leaving the app to find a support channel.

**Why:** The cheapest and most reliable product research is a feedback button shipped on day one. Real drivers telling us what they need — in their own words, in context — is worth more than any survey. This also signals to early adopters that the team is listening, which builds loyalty. Lean implementation: a text field that lands in a tool the team already monitors. No custom infrastructure needed.

**Acceptance Criteria:**

**Given** a driver opens the app settings menu
**When** they view it
**Then** they see a "Send feedback" or "Suggest a feature" entry point

**Given** a driver taps the feedback entry point
**When** the feedback screen opens
**Then** they see a free-text field (max 1000 characters) and a send button
**And** their app version and OS are automatically attached to the submission (not shown to the user, used for triage)

**Given** a driver submits feedback
**When** it is sent
**Then** they see a brief confirmation: "Thanks — we read every message"
**And** the feedback is delivered to the team's designated inbox (e.g. a Canny board, a dedicated email address, or a simple webhook to Slack)

**Given** a driver submits feedback
**When** it is processed
**Then** no personal data beyond app version and OS is attached — feedback is anonymous by default

**Given** a driver views the feedback screen in their selected language
**When** it is Polish, English, or Ukrainian
**Then** all labels and confirmation messages are displayed in that language

*Covers: New requirement — product feedback loop. No FR assigned. Phase 1 (ship early to start collecting signal from day one).*

---

## Epic 2: Station Map & Price Discovery

Drivers and public users can view a map of Polish fuel stations colour-coded by price, see freshness indicators, and distinguish community-verified prices from seeded estimates.

### Story 2.1: Station Database & Google Places Sync

As a **developer**,
I want all Polish fuel stations stored in our database and kept in sync with Google Places,
So that GPS matching and map display work from local data without per-request API calls.

**Why:** Storing ~8,000 Polish stations locally with PostGIS is what makes GPS-to-station matching fast and cheap. Without this, every photo submission would require a live Google Places API call in the hot path — adding latency, cost, and an external point of failure. The weekly sync keeps data fresh at ~$0 effective cost (within Google's $200/month free credit).

**Acceptance Criteria:**

**Given** the sync job runs for the first time
**When** it completes
**Then** all discoverable Polish fuel stations are stored in the `stations` table with name, location (PostGIS `geography` point), address, and Google Places ID

**Given** a station stored in the database
**When** a PostGIS `ST_DWithin` query runs with a 200m radius around a GPS coordinate
**Then** the nearest station within range is returned in under 100ms

**Given** the weekly sync job runs
**When** Google Places returns updated station data
**Then** existing stations are updated and new stations are added — no duplicates created

**Given** the weekly sync job fails (Google Places API unavailable)
**When** the failure is detected
**Then** the job retries ×3 with exponential backoff (1 hour → 6 hours → 24 hours)
**And** if all retries fail, an ops alert is triggered
**And** the existing station data remains intact — the failure never corrupts existing records
**And** the next scheduled weekly run fires regardless of the previous failure

**Given** the stations table
**When** it is queried
**Then** it includes a `last_synced_at` timestamp per station so data freshness is always knowable

### Story 2.2: Mobile Map View with Station Pins

As a **driver**,
I want to see a map of nearby fuel stations centred on my location,
So that I can quickly find stations around me without having to search manually.

**Why:** The map view is the core of the product — it's what drivers open the app for. Getting this right (fast, location-aware, clear station pins) is the single most important first impression. Without it, nothing else in the product has context.

**Acceptance Criteria:**

**Given** an authenticated driver opens the app
**When** the map screen loads
**Then** it is centred on their current GPS location and nearby stations are shown as pins within a visible radius

**Given** the map is loading
**When** it takes longer than 3 seconds
**Then** a loading indicator is shown — the screen never displays a blank white page

**Given** a driver who has previously opened the app
**When** they open it again without connectivity
**Then** the last-known map view and station pins are shown from local cache — the app does not hard-fail offline

**Given** a driver moves to a new area
**When** they pan or zoom the map
**Then** station pins update to reflect the new visible area

**Given** the map is displayed
**When** station pins are rendered
**Then** each pin is tappable and opens the station detail screen

**Given** a driver views the map screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all UI text on the screen is displayed in that language

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. GPS/location service unavailable or denied at map load time; map tile provider unreachable; station data API returning 5xx.

### Story 2.3: Colour-Coded Price Comparison

As a **driver**,
I want stations on the map to be colour-coded by relative price,
So that I can instantly see which nearby stations are cheap or expensive without tapping each one.

**Why:** Colour coding is the core value delivery of the map — it turns raw data into an instant decision. Marek's journey in the PRD is entirely driven by this: he sees the Orlen is red (expensive) and the BP two streets over is green (cheap) and makes a better decision in seconds. Without colour coding, the map is just a list of stations.

**Acceptance Criteria:**

**Given** multiple stations are visible on the map
**When** their prices are loaded
**Then** each station pin is colour-coded relative to the others in the current view (e.g. green = cheapest, amber = mid-range, red = most expensive)

**Given** a driver selects a specific fuel type filter
**When** the filter is applied
**Then** colour coding updates to reflect relative prices for that fuel type only

**Given** only one station is visible in the current map view
**When** it is displayed
**Then** a neutral colour is used — relative pricing requires at least two stations to be meaningful

**Given** a station with no price data (no community submissions yet)
**When** it is shown on the map
**Then** it displays a distinct "no data" indicator rather than a colour — never misleadingly coloured

**Given** a driver zooms out to see a wider area
**When** many stations become visible
**Then** colour coding recalculates based on all visible stations in the current viewport

**Given** a driver views colour-coded station pins
**When** their selected language is Polish, English, or Ukrainian
**Then** all UI labels and legend text are displayed in that language

### Story 2.4: Fuel Type Filtering

As a **driver**,
I want to filter the map by fuel type,
So that I only see prices relevant to my vehicle.

**Why:** Polish stations carry multiple fuel types — a diesel driver doesn't care about LPG prices. Filtering keeps the map focused and colour coding meaningful. The taxonomy covers all standard grades across major Polish chains; branded premium names (Verva, V-Power, etc.) are mapped to their standard grade category.

**Acceptance Criteria:**

**Given** a driver is viewing the map
**When** they open the fuel type filter
**Then** they see all standard Polish fuel types: PB 95, PB 98, ON, ON Premium, LPG, AdBlue

**Given** a driver selects a fuel type
**When** the filter is applied
**Then** station pins show only the price for that fuel type
**And** colour coding reflects relative prices for that fuel type only
**And** stations with no data for that fuel type show a "no data" indicator

**Given** a driver's previously selected fuel type preference
**When** they reopen the app
**Then** their last-used fuel type filter is restored — they don't have to reselect every session

**Given** a first-time driver with no previously selected fuel type
**When** they open the map
**Then** PB 95 is selected by default as the most common fuel type in Poland

**Given** a driver clears the filter
**When** no fuel type is selected
**Then** the app falls back to the last-used fuel type, or PB 95 if no history exists — no filter is ever left in an unselected state

**Given** a station that carries branded premium fuel (e.g. Verva ON, Shell V-Power Diesel)
**When** a price is submitted for that fuel
**Then** it is stored and displayed under the standard grade category (ON Premium) — branded names are not separate filter options

**Given** a driver views the fuel type filter
**When** their selected language is Polish, English, or Ukrainian
**Then** all fuel type labels and UI text are displayed in that language

### Story 2.5: Station Detail Screen

As a **driver**,
I want to tap a station and see its full price breakdown,
So that I can make an informed decision before driving there.

**Why:** The map gives a quick overview, but the detail screen is where the actual decision happens. Drivers need to see all fuel types, the exact price per litre, how fresh the data is, and who verified it — all at a glance. This is also the entry point for submitting a price update (Epic 3).

**Acceptance Criteria:**

**Given** a driver taps a station pin on the map
**When** the station detail screen opens
**Then** they see the station name, address, and a price row for each fuel type available at that station (PB 95, PB 98, ON, ON Premium, LPG, AdBlue — whichever apply)

**Given** a station detail screen is open
**When** prices are displayed
**Then** each price row shows the price per litre and a freshness indicator (time since last update)

**Given** a station with prices for some but not all fuel types
**When** the detail screen is shown
**Then** only fuel types with known prices are shown — no placeholder rows for unknown types

**Given** a station with no price data at all
**When** the detail screen is shown
**Then** a clear "no prices yet — be the first to contribute" message is displayed with a prompt to submit a photo

**Given** a driver views the detail screen
**When** it is displayed
**Then** the sole CTA is "Navigate →" — there is no contribution button in the station sheet; contribution is always initiated from the "Add price" button on the map screen

**Given** a driver views the station detail screen
**When** they tap the "Navigate" button
**Then** the system deep-links to the device default maps app (Google Maps on Android, Apple Maps on iOS) with the station coordinates pre-filled as the destination — no address copying, no manual search

**Given** a driver tapped "Navigate" to a station and has returned to the app
**When** the app is foregrounded and the device's current GPS position is within 200m of that station
**Then** an arrival banner is shown above the map: "[Station Name] · prices here are Xd old" with an inline "Add price" CTA — the station sheet steps back to Navigate-only (amber ghost); the "Add price" map button remains visible as an alternative entry point

**Given** the arrival detection check runs on app foreground
**When** the user has not granted location permission ("while using") or location is unavailable
**Then** the CTA switch does not occur — the default layout (Navigate primary, Update prices secondary) is shown, with no error message or prompt

**Given** a driver views the station detail screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all text including station name, fuel type labels, arrival banner, and status messages is displayed in that language

### Story 2.6: Price Freshness & Verified vs Estimated Display

As a **driver**,
I want to know how fresh a price is and whether it's community-verified or just an estimate,
So that I can judge how much to trust what I'm seeing before I drive to a station.

**Why:** Stale or estimated prices are worse than no prices — a driver who trusts a 3-week-old price and finds it's wrong loses trust in the product immediately. Clearly distinguishing community-verified prices from seeded estimates, and surfacing freshness at a glance, sets the right expectations and drives contribution ("this price is 2 weeks old — I could fix that").

**Acceptance Criteria:**

**Data model note:** Freshness is tracked per (station × fuel_type) pair — not at the station level. Each fuel type at a station has its own `last_verified_at` timestamp and `source` (community | pump_meter | seeded). A pump meter submission for Diesel marks only Diesel as fresh; PB95 and LPG at the same station remain at their previous freshness state.

**Given** a fuel type at a station has a community-verified price
**When** it is displayed on the map or station detail screen
**Then** it shows a "verified" indicator and the time since that fuel type was last updated (e.g. "Diesel updated 1 day ago")

**Given** a community-verified price's `last_verified_at` is less than 2 days ago
**When** it is displayed
**Then** the freshness indicator uses the "fresh" visual treatment (green dot)

**Given** a community-verified price's `last_verified_at` is between 2 and 7 days ago
**When** it is displayed
**Then** the freshness indicator uses the "recent" visual treatment (amber dot)

**Given** a community-verified price's `last_verified_at` is more than 7 days ago
**When** it is displayed
**Then** the freshness indicator uses the "may be outdated" visual treatment (slate dot) and a staleness warning label is shown alongside the last-known price for that fuel type only

**Given** a station detail screen shows multiple fuel types
**When** their freshness states differ
**Then** each fuel type row shows its own freshness indicator independently — it is never possible for one fuel type's freshness to mask another's staleness

**Given** a fuel type at a station has only a seeded voivodeship-level estimate
**When** it is displayed
**Then** it is clearly labelled as "estimated" — visually distinct from verified prices (hollow ring indicator, grey fill, price shown as a range with "~" prefix) and never shown as community data

**Given** a fuel type that has been automatically flagged as stale by the system (Story 2.8)
**When** it is displayed
**Then** a "price may have changed" indicator is shown — distinct from the age-based staleness warning

**Given** a driver views the station detail screen
**When** freshness information is shown
**Then** they can see the exact date and time of the last verified submission per fuel type

**Given** a driver views freshness indicators on any screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all freshness labels and status text are displayed in that language

### Story 2.7: ORLEN Rack Price Ingestion

As a **developer**,
I want the system to ingest ORLEN rack prices on a scheduled basis,
So that Stories 2.8 (staleness detection) and 2.12 (estimated price ranges) have real-time Polish market signals to work with from Phase 1 launch.

**Why:** ORLEN rack prices are the most direct leading indicator for pump prices in Poland — when ORLEN moves their wholesale price, independents and competitors follow within 24–48h. Having this signal from day one makes staleness detection meaningful and estimated ranges accurate. Building this ingestion in Phase 1 also means Story 6.0 (Phase 2) can extend the same mechanism rather than build from scratch.

**Acceptance Criteria:**

**Given** a scheduled job runs twice daily (06:00 and 14:00 Warsaw time)
**When** it polls ORLEN's public rack price page
**Then** it fetches the current published wholesale prices for PB95, ON, and LPG
**And** stores each as a `market_signal` record: `signal_type` (orlen_rack_pb95 | orlen_rack_on | orlen_rack_lpg), `value` (PLN/litre), `recorded_at`, `pct_change` (vs previous reading)

**Given** the ORLEN rack price page is unavailable or returns unexpected data
**When** the ingestion job runs
**Then** it retries once after 30 minutes — if still failing, an ops alert is raised and the previous signal record is retained (no stale zeroes written)

**Given** a new market_signal record is written
**When** it represents a movement of ≥3% vs the previous reading for any fuel type
**Then** a flag is set on the record (`significant_movement: true`) for Story 2.8 to consume during its next staleness detection run

**Given** market_signal records are stored
**When** they are older than 90 days
**Then** they are archived — full history retained for trend analysis and future data licensing, never deleted

*Covers: Phase 1 prerequisite for Stories 2.8 and 2.12. Note: ORLEN rack price URL and page structure to be validated before development begins — page may require maintenance if ORLEN changes their site layout.*

---

### Story 2.8: Price Staleness Auto-Detection

As a **developer**,
I want the system to automatically flag stations whose prices are likely outdated based on market signals,
So that drivers are warned proactively before they arrive at a station with wrong prices.

**Why:** Time-based staleness alone is insufficient — a stable price from 3 weeks ago may be perfectly accurate, while a price from yesterday may be wrong if there was a market-wide movement. Combining macro signals (ORLEN rack price movements from Story 2.7, regional submission patterns) with time gives a much smarter freshness signal. Phase 2 extends this with Brent crude in PLN from Story 6.0 as an upstream early-warning signal. This is one of the differentiators called out in the PRD.

**Acceptance Criteria:**

**Data model note:** Staleness detection operates at the (station × fuel_type) level — each fuel type at a station is evaluated and flagged independently. Prerequisite: Story 2.7 (ORLEN rack price ingestion) must be deployed first.

**Given** the ORLEN rack price for a fuel type shows a movement of ≥3% in 24 hours (from the market_signal table populated by Story 2.7)
**When** the staleness detection job runs
**Then** each (station × fuel_type) combination in affected regions with no recent submission for that fuel type is flagged as "prices may have changed"

**Given** Story 6.0 (Phase 2) has been deployed and Brent crude in PLN shows a movement of ≥5% in 24 hours
**When** the staleness detection job runs
**Then** all (station × fuel_type) combinations nationally with no recent submission are evaluated for staleness — Brent is an upstream signal affecting all fuel types

**Given** a cluster of new submissions in a region showing prices for a specific fuel type more than 3% different from existing records
**When** the staleness detection job evaluates nearby unupdated stations
**Then** that same fuel type at nearby stations is also flagged as likely stale — staleness propagation is per fuel type, not per station

**Given** a (station × fuel_type) combination that has been flagged as stale
**When** a new verified submission or pump meter fill-up is received for that fuel type at that station
**Then** the stale flag is cleared automatically for that fuel type only — other fuel types at the station are unaffected

**Given** the staleness detection job
**When** it runs
**Then** it never sends push notifications to users — flagging is a silent data operation surfaced only via UI indicators (Story 2.6)

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. staleness detection job throws an uncaught exception or times out; market_signal table unavailable at job run time; job completes but database write of stale flags fails.

### Story 2.9: Redis Price Cache

As a **developer**,
I want price data served from Redis cache rather than hitting PostgreSQL on every request,
So that the map loads within 3 seconds even under high concurrent load.

**Why:** Price data is read thousands of times per day but changes only 1–2 times per station per day. Without a cache, every map load hits the database — at 100K+ MAU with concurrent rush-hour traffic, this becomes a bottleneck fast. Redis is already in the stack for BullMQ, so this costs nothing extra in infrastructure.

**Acceptance Criteria:**

**Given** a price is requested for a station
**When** it exists in Redis cache
**Then** it is returned from cache without a database query (sub-millisecond response)

**Given** a price is requested for a station
**When** it is not in Redis cache (cache miss)
**Then** it is fetched from PostgreSQL, returned to the caller, and written to Redis for subsequent requests

**Given** a new price is verified by the OCR pipeline
**When** the database is updated
**Then** the Redis cache for that station is invalidated and rewritten atomically in the same operation — stale cache is never served after a verified update

**Given** a cached price entry
**When** 24 hours have elapsed with no update
**Then** the TTL expires and the next request fetches fresh data from PostgreSQL — the TTL is a safety fallback, not the primary freshness mechanism

**Given** Redis is unavailable
**When** a price request is made
**Then** the API falls back to PostgreSQL directly — the app remains functional with no user-facing error

### Story 2.10: SSR Public Map

As a **public user**,
I want to view fuel station prices on the web without creating an account,
So that I can quickly check prices before heading out, and search engines can index the content.

**Why:** The public map is the primary SEO acquisition channel — drivers discovering the platform via Google ("fuel prices Warsaw") land here first. Server-side rendering means search engines index real price data, not a blank JS shell. It also means no raw JSON price API is exposed — the price data is only accessible via the rendered page, which is the core data protection decision from the architecture.

**Acceptance Criteria:**

**Given** an unauthenticated user visits the public map URL
**When** the page loads
**Then** they see a fully rendered map with station prices — no login required, no blank loading state while JS hydrates

**Given** a search engine crawler visits the public map
**When** it indexes the page
**Then** station names, locations, and current prices are present in the HTML — fully indexable without JavaScript execution

**Given** the public map page
**When** it is inspected via browser dev tools
**Then** there is no `/v1/prices` or equivalent JSON API endpoint being called — all price data is fetched server-side via Next.js Server Components

**Given** a public user who wants to submit a price
**When** they tap the contribution button
**Then** they are prompted to create an account — unauthenticated price submission is not permitted

**Given** a public user views the SSR public map
**When** their browser language is set to Polish, English, or Ukrainian
**Then** all UI text on the page is displayed in that language

### Story 2.11: Price History & Regional Aggregations

As a **developer**,
I want all price submissions retained in full and regional aggregations queryable from day one,
So that the platform builds a commercially valuable dataset from the very first contribution.

**Why:** The price history database is the long-term business asset — it's what makes B2B data licensing possible in Phase 3. Capturing it from day one means no data is ever lost, even before monetisation is ready. Regional aggregations (FR50) are also the foundation for the public data portal and fleet analytics in later phases.

**Acceptance Criteria:**

**Given** a price submission is verified by the OCR pipeline
**When** the station price record is updated
**Then** the previous price is not overwritten — a new `price_history` record is created with station ID, fuel type, price, source (community/seeded), and timestamp

**Given** the price history table
**When** queried for a specific station and fuel type
**Then** the full chronological price history is returned in correct order

**Given** multiple verified submissions exist across stations in a region
**When** a regional aggregation query runs (e.g. average PB 95 price in Mazowieckie voivodeship)
**Then** it returns the correct aggregated value based on the most recent verified price per station in that region

**Given** the price history table at scale
**When** millions of records accumulate over time
**Then** queries for recent prices (last 30 days) remain performant via appropriate indexing on station ID, fuel type, and timestamp

---

### Story 2.12: Rack-Derived Estimated Price Range (Cold Start)

As a **driver**,
I want to see an estimated price range for stations that have no recent community data,
So that the app is useful from day one — even before enough contributors exist to verify prices in my area.

**Why:** A blank screen or "no data" label on day one kills the product before it starts. But showing a single seeded estimate without context creates a false precision problem — drivers may trust it too literally. A rack-derived price range ("~6.40–6.70 PLN based on market data") is honest, still useful for decision-making, and visually communicates that it's an approximation. As the community grows, estimated ranges are replaced by verified prices — drivers see the product maturing in real time, which itself builds trust and motivates contribution. This is the cold start bridge until the community flywheel is self-sustaining.

**Acceptance Criteria:**

**Given** a fuel type at a station has no community-verified submission (cold start or long gap)
**When** it is displayed on the map pin or station detail screen
**Then** instead of a single seeded estimate, a price range is shown: e.g. "~6.40–6.70 PLN"
**And** the range is labelled clearly as "Market estimate" — distinct from both community-verified prices and plain seeded estimates
**And** the range is never presented as a precise current price

**Given** the estimated range is calculated
**When** it is generated
**Then** it is derived from the following multi-factor model applied in sequence:
1. **Base:** current ORLEN rack price for that fuel type (from Story 2.7 `market_signal` records)
2. **+ voivodeship margin band** — regional average retail margin for that voivodeship (sourced from e-petrol.pl weekly averages, stored as a static config updated periodically)
3. **+ station type modifier:** MOP station → +45 gr/l; standard → 0
4. **+ brand tier modifier:** hypermarket (Auchan, Carrefour) → −30 gr/l; budget branded (Circle K, Huzar, Moya, Amic) → −5 gr/l; mid-market (Orlen, Lotos) → 0; premium (BP, Shell) → +7 gr/l; unknown brand → 0
5. **+ German border zone modifier:** `is_border_zone_de = true` → −15 gr/l; otherwise 0
6. **+ settlement tier modifier:** rural → +10 gr/l; all other tiers → 0
**And** the result is displayed as a symmetric ±0.15 PLN band around the calculated midpoint (e.g. midpoint 6.85 PLN → shown as "~6.70–7.00 PLN")
**And** all modifier values are defined in a config file — not hardcoded in service logic — to allow tuning without a code deploy
**And** classification data for steps 3–6 is read from the station's classification fields populated by Story 2.14

**Given** ORLEN rack price data is unavailable for a fuel type
**When** the range cannot be calculated
**Then** the last known seeded voivodeship average is used as the midpoint with a ±5% band applied
**And** the label reads "Estimated" rather than "Market estimate" to reflect lower confidence

**Given** the rack price changes significantly (e.g. >3% movement in 24 hours per Story 2.7 and Story 2.8)
**When** the estimated range is next recalculated
**Then** it shifts to reflect the new rack price — the range is never left stale while rack data is available

**Given** a community-verified submission is received for a fuel type at a station
**When** it is published
**Then** the estimated range for that fuel type at that station is immediately replaced by the verified price — the range display disappears entirely for that fuel type
**And** the "verified" freshness treatment from Story 2.6 applies from that point forward

**Given** a driver views an estimated range
**When** they tap on it
**Then** a brief explanation is shown: "We don't have a recent community price here yet. This range is based on current wholesale market data. Tap to contribute a verified price." with a CTA to the contribution flow

**Given** a driver views any estimated range
**When** their selected language is Polish, English, or Ukrainian
**Then** all labels, range values, and explanation text are displayed in that language

*Covers: Cold start UX requirement introduced during go-to-market planning. Depends on Story 2.6 (freshness display), Story 2.7 (ORLEN rack price ingestion — provides the market_signal data this story reads), and Story 2.14 (station classification — provides brand, station_type, voivodeship, settlement_tier, and is_border_zone_de fields consumed by the seed formula). Story 2.8 (staleness detection) propagates stale flags that trigger range recalculation. Story 6.0 (Phase 2) extends the market_signal feed with Brent crude in PLN, improving signal quality — but Phase 1 ORLEN rack data from Story 2.7 is sufficient to run estimated ranges from launch. Transitions naturally to community-verified prices as Epic 3 contributions accumulate.*

---

### Story 2.13: On-Demand Station Sync Trigger

As a **developer / ops admin**,
I want to trigger a full Google Places station sync on demand without waiting for the weekly cron,
So that I can seed the database immediately after first deploy, recover from a failed sync, or re-populate after a data incident — without needing a UI.

**Why:** The weekly BullMQ cron (Sunday 02:00 UTC) means the station database is empty for up to 7 days after first deploy, leaving the map blank. On-demand triggering is essential for the initial seed and for any ops recovery scenario. The endpoint must be callable directly via curl/Postman without an admin UI — Story 4.10 will later add a UI button that calls this same endpoint.

**Acceptance Criteria:**

**Given** an authenticated ADMIN calls `POST /v1/admin/stations/sync`
**When** no sync is currently running
**Then** a BullMQ sync job is enqueued immediately and the response returns `{ "status": "queued", "jobId": "..." }` with HTTP 202

**Given** an authenticated ADMIN calls `POST /v1/admin/stations/sync`
**When** a sync job is already active (queued or running)
**Then** a new job is NOT enqueued and the response returns `{ "status": "already_running", "jobId": "..." }` with HTTP 409 — no duplicate sync runs

**Given** an authenticated ADMIN calls `GET /v1/admin/stations/sync/status`
**When** called at any time
**Then** the response returns the current sync state: `{ "status": "idle" | "running" | "failed", "lastCompletedAt": "<ISO timestamp> | null", "lastFailedAt": "<ISO timestamp> | null", "stationCount": <number> }`

**Given** a non-ADMIN authenticated user calls either endpoint
**When** the request is received
**Then** the API returns HTTP 403

**Given** an unauthenticated request hits either endpoint
**When** the request is received
**Then** the API returns HTTP 401

**Given** a sync job completes successfully (triggered on-demand or via weekly cron)
**When** it finishes
**Then** the `lastCompletedAt` timestamp and `stationCount` in the status response reflect the completed run

*Covers: Ops tooling requirement — no FR mapping. Depends on Story 2.1 (StationSyncService, StationSyncWorker). Story 4.10 (Epic 4) provides the admin UI that calls this endpoint.*

---

### Story 2.14: Station Classification Enrichment

As a **developer**,
I want each station record to carry classification metadata (brand, station type, voivodeship, settlement tier, German border zone flag),
So that downstream features — starting with Story 2.12's estimated price ranges — can apply per-station modifiers rather than treating all stations identically.

**Why:** Without classification, every station in Poland gets the same voivodeship average regardless of what it actually is — a Shell MOP on the A2 and an Auchan station in Warsaw would both show 6.85 PLN. Classification makes the cold-start seed model meaningful rather than uniformly wrong. These fields also serve future analytics (chain performance, MOP premium tracking, regional pricing trends) at no additional data collection cost.

**Acceptance Criteria:**

**Given** the Station schema is migrated
**When** the migration runs
**Then** the following fields are added to the `Station` model:
- `brand: String?` — normalised brand slug, e.g. `"orlen"`, `"bp"`, `"shell"`, `"circle_k"`, `"lotos"`, `"huzar"`, `"moya"`, `"amic"`, `"auchan"`, `"carrefour"`, `"independent"`, or `null` if unresolved
- `station_type: Enum` — `"standard"` | `"mop"` | `null` until classified
- `voivodeship: String?` — one of the 16 official voivodeship slugs (e.g. `"mazowieckie"`, `"malopolskie"`)
- `settlement_tier: Enum` — `"metropolitan"` | `"city"` | `"town"` | `"rural"` | `null` until classified
- `is_border_zone_de: Boolean @default(false)`
- `classification_version: Int @default(0)` — incremented on each re-classification run to enable future bulk re-runs

**Given** a station is synced from Google Places
**When** its `name` field is processed during classification
**Then** the brand is derived via case-insensitive substring matching against a known brand list
**And** the brand list and its mappings are defined in a config file — not hardcoded in service logic — so the list can be extended without a code deploy
**And** if no brand matches, `brand` is set to `"independent"`

**Given** a station record with coordinates exists
**When** MOP classification runs
**Then** a Google Places Nearby Search is issued within a 300m radius of the station's coordinates
**And** if any result has `"MOP"` in its name (case-insensitive), the station is classified as `station_type = "mop"`
**And** if no such result is found, `station_type = "standard"`
**And** the classification is persisted on the station record — the Nearby Search is not re-issued on every price calculation

**Given** a station with valid coordinates
**When** voivodeship assignment runs
**Then** the voivodeship is resolved via reverse geocode (Google Geocoding API or a static PostGIS administrative boundary layer)
**And** stored as a normalised slug matching the 16 official voivodeship names

**Given** a station with resolved coordinates and municipality
**When** settlement tier is assigned
**Then** the tier is determined as follows:
- `"metropolitan"`: station is within the administrative boundaries of Warsaw, Kraków, Wrocław, Gdańsk, Gdynia, Sopot, Poznań, or Łódź
- `"city"`: municipality population 50,000–500,000
- `"town"`: municipality population 10,000–50,000
- `"rural"`: municipality population below 10,000 or no urban settlement resolved
**And** population data is sourced from a static GUS municipality table bundled with the service — not a live API call per station

**Given** a station with valid coordinates
**When** German border zone classification runs
**Then** `is_border_zone_de = true` if the station is within 30km of any of the following border crossing centroids: Świecko/Słubice (52.35°N, 14.55°E), Zgorzelec (51.15°N, 15.01°E), Lubieszyn (53.41°N, 14.19°E), Łęknica (51.53°N, 14.74°E), Olszyna (51.18°N, 15.22°E)
**And** `is_border_zone_de = false` otherwise

**Given** a station sync job completes (weekly cron or on-demand per Story 2.13)
**When** new or updated station records exist
**Then** a classification enrichment job is enqueued in BullMQ as a post-sync step — it does NOT block the sync job itself
**And** stations with `classification_version = 0` are prioritised in the enrichment queue

**Given** a station already has classification data
**When** its `name` or coordinates change during a subsequent sync
**Then** classification is re-run for that station and `classification_version` is incremented

*Covers: prerequisite for Story 2.12 (multi-factor seed formula). Classification fields are also available for Epic 4 analytics dashboards (Stories 4.6, 4.8) and chain management (Story 7.6). Depends on Story 2.1 (StationSyncService, StationSyncWorker) and Story 2.13 (on-demand sync trigger). Google Places Nearby Search calls for MOP detection consume API quota — the enrichment job must batch requests and respect rate limits to stay within cost budget.*

---

## Epic 3: Photo Contribution Pipeline

Drivers photograph price boards; the system extracts prices via AI OCR, matches the GPS location to the nearest station, updates the database, and immediately confirms to the driver — all within 10 seconds from their perspective. Offline submissions queue and retry automatically.

### Story 3.1: Camera Capture & Photo Pre-Processing

As a **driver**,
I want to take a photo of a price board directly from within the app,
So that I can contribute price data in one tap without switching to my camera app.

**Why:** The 10-second contribution UX depends on a frictionless in-app camera flow. Camera-only capture (no gallery upload) is also a core data integrity mechanism — it prevents recycled or fabricated images from entering the pipeline. Pre-processing ensures consistent upload sizes and reduces OCR token costs regardless of the device camera resolution.

**Acceptance Criteria:**

**Given** a driver is on the map screen
**When** they want to contribute a price
**Then** an "Add price" pill button (＋ Add price) is always visible on the map — no station selection or pin tap is required; the driver's only job is to point the camera at the price board; GPS matching happens automatically after capture

**Given** a driver taps the "Add price" button
**When** location permission has not been granted
**Then** the camera does not open — instead a blocking screen is shown explaining that location is required to match the photo to a station, with a single CTA button that deep-links directly to the app's location permission settings

**Given** a driver taps the "Add price" button
**When** location permission has been granted
**Then** the device camera opens directly — the photo library is never accessible from this flow

**Given** the camera is open
**When** it is displayed
**Then** the overlay shows a passive GPS station indicator: "📍 Orlen Grodzka · 80m" if a single station is within 200m, or "📍 Matching station…" while GPS resolves — this is informational only and never blocks capture

**Given** the camera is open
**When** it is displayed
**Then** a framing overlay guides the driver to capture the price board close-up — wide-angle shots are the primary cause of OCR failure

**Given** a photo is captured via the FAB and GPS resolves to two or more stations within 200m
**When** the confirmation screen is shown
**Then** a single one-tap disambiguation is shown after capture — not before: "Which station was this? [Orlen Grodzka] [Circle K Floriańska]" — the driver confirms in one tap and moves on

**Given** a driver takes a photo
**When** it is captured
**Then** it is immediately compressed using expo-image-manipulator to a maximum of 1920px width and 75% JPEG quality (~200–500KB)

**Given** a photo that is too blurry or too dark to be usable
**When** it is captured
**Then** the driver sees a gentle prompt to retake — they are never blocked, but poor quality is flagged before submission

**Given** a compressed photo
**When** pre-processing is complete
**Then** it is passed to the offline queue (Story 3.2) — the driver never waits for any network operation at this point

**Given** a driver uses the camera capture screen
**When** their selected language is Polish, English, or Ukrainian
**Then** all guidance text and prompts are displayed in that language

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. camera permission denied (separate from location permission flow already covered); device storage full when writing compressed photo locally; camera hardware unavailable or crashes mid-capture.

### Story 3.2: Immediate Confirmation & Offline Queue

As a **driver**,
I want to see an instant "Thank you" confirmation after submitting a photo and have it automatically retry if I'm offline,
So that I'm never left waiting or wondering if my contribution was received.

**Why:** The fire-and-forget UX is central to the product's 10-second promise. If drivers had to wait for OCR to complete before seeing confirmation, the contribution flow would feel broken. The offline queue means a driver at a remote station with poor signal never loses a submission — it will always eventually reach the server.

**Acceptance Criteria:**

**Given** a driver taps submit after taking a photo
**When** the photo is added to the local SQLite queue
**Then** the "Thank you for contributing!" screen is shown immediately — before any network call is made

**Given** the device has connectivity
**When** a photo is added to the queue
**Then** upload to the server is attempted immediately in the background — the driver has already seen confirmation and moved on

**Given** the device has no connectivity at submission time
**When** a photo is added to the queue
**Then** it is retained locally and upload is retried automatically with exponential backoff (30s → 2min → 10min) when connectivity is restored

**Given** one or more photos are queued locally pending upload
**When** the driver checks the app
**Then** a non-alarming indicator shows the count of queued photos (e.g. "2 photos queued") — informational, never an error state

**Given** a queued photo that has been successfully uploaded to the server
**When** the server confirms receipt
**Then** the entry is silently removed from the local queue — no notification to the driver

**Given** the price board confirmation screen is shown
**When** it is displayed
**Then** a secondary nudge is shown beneath the confirmation message: "Did you fill up here? Log pump reading →" — one tap opens the fill-up camera; dismissing or ignoring it requires no action and the driver lands on the map

**Given** a driver views the confirmation screen or offline queue indicator
**When** their selected language is Polish, English, or Ukrainian
**Then** all text including the "Thank you" message, nudge, and queue status is displayed in that language

### Story 3.3: Photo Upload & Submission Record Creation

As a **developer**,
I want the server to accept a photo upload, store it in R2, and enqueue an async processing job,
So that the pipeline can process submissions without blocking the driver's device.

**Why:** Decoupling upload from processing is what makes the fire-and-forget UX possible. The API receives the photo, hands it off to the async pipeline, and returns immediately — the driver is done. All heavy lifting (OCR, GPS matching, validation) happens in the background.

**Acceptance Criteria:**

**Given** the mobile app uploads a photo with GPS coordinates and fuel type metadata
**When** the API receives the request
**Then** the photo is stored in Cloudflare R2 under a unique key
**And** a `Submission` record is created with `status: pending`, `station_id: NULL`, and the R2 key
**And** a BullMQ job is enqueued for async processing
**And** the API returns `202 Accepted` — never waits for processing to complete

**Given** the R2 upload fails
**When** the API attempts to store the photo
**Then** the API returns an error and no `Submission` record is created — the mobile queue retries the upload

**Given** a `Submission` record is created
**When** it is inspected
**Then** it contains: `user_id`, `r2_key`, `gps_lat`, `gps_lng`, `fuel_type`, `status: pending`, `created_at`
**And** GPS coordinates are stored on the Submission only for pipeline use — they are nulled after station matching is complete (Story 3.4)

**Given** the BullMQ job is enqueued
**When** it is inspected in the queue
**Then** it contains the `submission_id` and nothing else — all data is fetched by the worker from the database

### Story 3.4: GPS-to-Station Matching

As a **developer**,
I want the pipeline worker to match a submission's GPS coordinates to the nearest fuel station in our database,
So that every price submission is correctly attributed to the right station.

**Why:** GPS matching is one of the two critical assumptions validated in the PoC (100% accuracy at ≤100m noise, 87% at 200m). Doing it in the worker — not at submission time — keeps the API fast and avoids a synchronous external call in the hot path. Using PostGIS on our local stations table means no Google Places API call per submission.

**Acceptance Criteria:**

**Given** a BullMQ worker picks up a submission job
**When** it runs the GPS matching step
**Then** it queries the `stations` table using `ST_DWithin` with a 200m radius around the submission's GPS coordinates and selects the nearest result

**Given** a matching station is found within 200m
**When** the match succeeds
**Then** the top candidates with their distances are returned (not just the nearest) so the logo recognition step can evaluate ambiguity
**And** `station_id` is set on the `Submission` record with the nearest match
**And** `gps_lat` and `gps_lng` are nulled on the `Submission` — GPS coordinates are never retained after matching

**Given** no station is found within 200m
**When** the match fails
**Then** the submission is marked `status: rejected` with reason `no_station_match`
**And** the photo is deleted from R2
**And** no retry is attempted — GPS match failure is a data quality issue, not a transient error

**Given** the GPS matching query
**When** it runs
**Then** it completes in under 100ms using the PostGIS spatial index

### Story 3.5: OCR Price Extraction

As a **developer**,
I want the pipeline worker to extract fuel prices from the submitted photo using Claude Haiku 4.5,
So that price data is automatically populated without any manual review for the majority of submissions.

**Why:** OCR is the core AI capability of the product — validated in the PoC at 80% pass rate (100% on usable images) at ~$0.0009/image (~$12/month at mid-case volume). Claude Haiku 4.5 is the production choice: same model family as the Opus used in the PoC, sufficient capability, negligible cost at scale.

**Acceptance Criteria:**

**Given** a BullMQ worker has successfully matched a station (Story 3.4)
**When** it runs the OCR step
**Then** it fetches the photo from R2 and sends it to Claude Haiku 4.5 with a prompt to extract fuel prices by type

**Given** Claude Haiku returns a successful extraction
**When** the response is parsed
**Then** each detected fuel type and its price per litre is stored as structured data (`price_data` JSONB) on the `Submission` record
**And** an `ocr_confidence_score` is recorded alongside the extracted prices

**Given** an OCR confidence score below 40%
**When** the extraction is evaluated
**Then** the submission is marked `status: rejected` with reason `low_ocr_confidence`
**And** the photo is deleted from R2 — no retry attempted

**Given** a successful OCR extraction
**When** prices are parsed
**Then** each price is validated against a plausible range for Polish market (e.g. PB 95 between 4.00–12.00 PLN/litre) — prices outside this range are flagged for ops review rather than published

**Given** the Claude Haiku API is unavailable
**When** the OCR step is attempted
**Then** the job is retried per the pipeline retry strategy (Story 3.8) — the photo is not deleted until max retries are exhausted

### Story 3.6: Logo Recognition as Secondary Signal

As a **developer**,
I want the pipeline to use logo recognition to resolve ambiguous GPS matches only when two stations are close together at similar distances,
So that station attribution is accurate in dense urban areas without wasting cost on unambiguous matches.

**Why:** GPS matching alone is reliable when one station is clearly nearest. Logo recognition is only worth the cost and latency when the match is genuinely ambiguous — two stations within 200m at similar distances. The 50% threshold (nearest must be >50% closer than second nearest to skip logo recognition) was chosen to cover real-world dense urban edge cases while avoiding unnecessary API calls in the vast majority of submissions.

**Acceptance Criteria:**

**Given** a submission has been GPS-matched with only one station within 200m
**When** the logo recognition step evaluates
**Then** it is skipped entirely — GPS match is unambiguous

**Given** a submission has been GPS-matched with two or more stations within 200m
**When** the nearest station is more than 50% closer than the second nearest (e.g. 60m vs 140m — difference of 80m exceeds 50% of 140m)
**Then** logo recognition is skipped — GPS match is sufficiently clear

**Given** a submission has been GPS-matched with two or more stations within 200m
**When** the nearest station is NOT more than 50% closer than the second nearest (e.g. 80m vs 120m — difference of 40m is less than 50% of 120m)
**Then** logo recognition runs to resolve the ambiguity

**Given** logo recognition runs and the result matches the GPS-matched station's brand
**When** confidence is sufficient
**Then** the match is confirmed and the pipeline continues

**Given** logo recognition runs and the result contradicts the GPS-matched station's brand
**When** the mismatch is detected
**Then** the submission is flagged for ops review rather than auto-published — not rejected outright

**Given** logo recognition cannot identify a brand (logo not visible, obscured, or unrecognised)
**When** the result is inconclusive
**Then** the pipeline proceeds using GPS match alone — logo recognition failure is not a rejection reason

**Given** the logo recognition step itself fails (API error)
**When** the failure is caught
**Then** the submission proceeds on GPS match alone and the failure is logged — it does not block the pipeline

### Story 3.7: Price Validation & Database Update

As a **developer**,
I want the pipeline to validate extracted prices against market-aware bands and publish them atomically,
So that only plausible prices reach drivers and OCR misreads are caught before going live.

**Why:** OCR extracts prices but can't guarantee they're sensible — a misread digit produces wildly wrong values that relative bands catch immediately. Three validation tiers ensure the system works from day one (no data) and gets smarter as price history accumulates. Dynamic oil-price-aware bands are noted for post-MVP refinement. Note: Tier 2 (regional voivodeship average) requires the `regional_benchmarks` table created in Story 5.0 (Phase 2) — at Phase 1 launch, submissions with price history older than 30 days fall through to Tier 3 (absolute range) until Story 5.0 is deployed.

**Acceptance Criteria:**

**Given** OCR has extracted a price for a fuel type where a recent price exists (last 30 days)
**When** the price is validated
**Then** it is accepted if within ±20% of the last known price for that station + fuel type
**And** flagged for ops review if outside that band — never silently rejected or published

**Given** OCR has extracted a price for a fuel type where the last known price is older than 30 days
**When** the price is validated
**And** the `regional_benchmarks` table is available (Story 5.0 deployed)
**Then** it is accepted if within ±30% of the regional voivodeship average for that fuel type
**And** flagged for ops review if outside that band
**And** if the `regional_benchmarks` table is not yet available, the Tier 3 absolute range is used instead

**Given** OCR has extracted a price for a fuel type with no price history at all (new station or cold start)
**When** the price is validated
**Then** it is accepted if within the absolute fallback range for that fuel type:
- PB 95: 4.00–12.00 PLN/litre
- PB 98: 4.50–13.00 PLN/litre
- ON: 4.00–12.00 PLN/litre
- ON Premium: 4.50–13.00 PLN/litre
- LPG: 1.50–5.00 PLN/litre
- AdBlue: 3.00–15.00 PLN/litre
**And** flagged for ops review if outside that range

**Given** Story 5.0 has not yet been deployed
**When** a submission is validated and the last known price is older than 30 days
**Then** Tier 3 (absolute range) is used directly — no attempt is made to query `regional_benchmarks`
**And** the pipeline continues normally without error

**Given** at least one valid price passes validation
**When** the database update runs
**Then** the `Submission` status is set to `verified`
**And** for each verified fuel type: the (station × fuel_type) price record is updated with the new price and `last_verified_at` timestamp
**And** a new `price_history` record is created for each verified fuel type
**And** the staleness flag is cleared for each verified (station × fuel_type) combination
**And** the Redis cache for that station is invalidated atomically in the same operation

**Given** the database update completes
**When** R2 cleanup runs
**Then** the photo is deleted from R2 and `photo_r2_key` is nulled on the `Submission` — always, whether verified or rejected

**Given** all extracted prices fail validation
**When** the submission is evaluated
**Then** it is marked `status: rejected` with reason `price_validation_failed`
**And** the photo is deleted from R2

### Story 3.8: Pipeline Retry & Dead-Letter Queue

As a **developer**,
I want the pipeline to automatically retry transient failures and escalate unrecoverable submissions to ops,
So that no submission is silently lost and the team is alerted when intervention is needed.

**Why:** The async pipeline touches three external services (R2, Claude Haiku, PostgreSQL) — any of them can fail transiently. A retry strategy with exponential backoff handles the vast majority of failures automatically. The dead-letter queue ensures the remainder surface to ops rather than disappearing silently, which would erode data quality without anyone knowing.

**Acceptance Criteria:**

**Given** a pipeline job fails due to a transient error (timeout, API error, network issue)
**When** the failure is caught
**Then** the job is retried ×3 with exponential backoff: 30s → 2min → 10min
**And** the photo is retained in R2 during all retry attempts

**Given** a job fails due to a non-transient reason (OCR confidence <40%, no GPS match, price validation failed)
**When** the failure type is identified
**Then** no retry is attempted — the submission is rejected immediately and the photo deleted from R2

**Given** a job exhausts all 3 retries without success
**When** the final retry fails
**Then** the job is moved to the dead-letter queue
**And** the photo is deleted from R2
**And** an ops alert is triggered with the submission ID and failure reason

**Given** a submission in the dead-letter queue
**When** ops reviews it
**Then** they can manually requeue it for reprocessing or mark it as permanently rejected

**Given** the dead-letter queue
**When** it is monitored
**Then** ops receives an alert if queue depth exceeds 10 items — indicating a systemic issue rather than isolated failures

### Story 3.9: Pipeline Cost Controls

As a **developer**,
I want hard rate limits and a daily spend cap on the OCR pipeline,
So that a runaway bug, reprocessing loop, or submission flood cannot generate unbounded Claude API costs.

**Why:** The per-user anomaly detection (Story 4.3) catches individual bad actors, but it doesn't protect against systemic failures — a bug that requeues jobs in a loop, or a coordinated flood from many accounts. Two complementary controls close this gap: a BullMQ worker rate limit caps throughput at the queue level regardless of queue depth, and a daily spend hard cap pauses the worker when a cost ceiling is hit. Jobs are never lost — they stay in the queue and drain when normal operation resumes. Together these make cost runaway structurally impossible rather than just alertable.

**Acceptance Criteria:**

**Given** the BullMQ OCR worker is configured
**When** it is initialised
**Then** it processes at most 60 jobs per minute (configurable via `OCR_WORKER_RATE_LIMIT_PER_MINUTE` ENV var)
**And** excess jobs remain in the queue and are processed in order as capacity allows

**Given** the pipeline processes OCR jobs throughout the day
**When** the cumulative Claude API spend for the current UTC day reaches the configured limit (`MAX_DAILY_OCR_SPEND_USD` ENV var, default: $20)
**Then** the BullMQ worker pauses automatically — no new OCR jobs are processed
**And** an alert is sent to the ops team via the same channel configured in Story 4.4
**And** the alert includes current spend, job queue depth, and instructions to resume

**Given** the worker has been paused due to the daily spend cap
**When** an ADMIN manually resumes the worker via the admin dashboard (Dead-Letter Queue section)
**Then** processing resumes immediately and the spend counter continues accumulating until the next UTC day reset

**Given** the UTC day rolls over (midnight)
**When** the daily spend counter resets
**Then** the worker resumes automatically if it was paused solely due to the daily cap
**And** the reset is logged

**Given** the worker is paused
**When** new submissions arrive
**Then** they are uploaded to R2 and enqueued in BullMQ normally — the pause only affects processing, not submission receipt

*Covers: pipeline cost protection. No user-facing surface.*

---

## Epic 4: Admin Operations & Data Integrity

### Story 4.1: Admin Dashboard Foundation

As an **ops admin**,
I want a secure admin web dashboard accessible only to users with the ADMIN role,
So that I have a dedicated surface for all operational tasks without risking exposure to other actors.

**Why:** The admin dashboard is a high-risk surface — a single misconfigured route could expose moderation tools to regular users. Isolating it as a separate Next.js app with its own JWT + role guard at every API endpoint ensures the blast radius of any auth bug stays contained. The `promote-admin` CLI script avoids the footgun of ENV-var-based bootstrapping (which re-runs on every deploy) while keeping the process auditable and explicit.

**Acceptance Criteria:**

**Given** a user navigates to the admin dashboard URL
**When** they are not authenticated or their role is not ADMIN
**Then** they are redirected to a login page and cannot access any admin route

**Given** an authenticated ADMIN user
**When** they access the admin dashboard
**Then** they see a navigation sidebar with sections: Submission Review, Users, Dead-Letter Queue, Station Management, and Metrics
**And** the dashboard is served from the `apps/admin` Next.js 16 app with App Router

**Given** the admin app is deployed
**When** any admin API call is made to the NestJS backend
**Then** the `AdminModule` route guard verifies the JWT and confirms role = ADMIN before processing
**And** any non-ADMIN request returns 403 Forbidden

**Given** the admin dashboard is live
**When** an ADMIN navigates between sections
**Then** each section loads within 2 seconds on a standard connection

**Given** a `promote-admin` CLI script exists in the monorepo
**When** an operator runs `npm run promote-admin -- --email=<email>`
**Then** the matching User record's role is updated to ADMIN if it exists, or an error is printed if no user with that email is found
**And** the script is idempotent (re-running on an already-ADMIN user is a no-op with a confirmation message)

**Given** the i18n foundation (Story 1.10)
**When** an ADMIN uses the dashboard
**Then** the interface is available in Polish, English, and Ukrainian

*Covers: AdminModule scaffolding, NestJS AdminGuard, Next.js admin app routing, promote-admin CLI script*

### Story 4.2: Submission Review Queue

As an **ops admin**,
I want to see a queue of submissions flagged for manual review, and be able to approve or reject each one,
So that low-confidence or disputed prices don't pollute the public map.

**Why:** Flagged submissions — those with logo mismatches or borderline confidence scores — are the gap between automated pipeline and data quality. Without a human review queue, these either get auto-rejected (losing valid data) or auto-published (risking bad prices on the map). The queue gives ops a lightweight triage surface without blocking the pipeline. Contributor identity is intentionally anonymised in the UI (user ID only, no PII) to keep the review process focused on data quality, not individuals.

**Acceptance Criteria:**

**Given** an ADMIN is on the Submission Review screen
**When** they load the page
**Then** they see a paginated list of submissions with `status: flagged`, sorted by oldest first
**And** each row shows: station name, fuel type(s), extracted price(s), OCR confidence score, submission timestamp, and contributor user ID (anonymised display — no email or name)

**Given** a flagged submission in the queue
**When** the ADMIN clicks to open it
**Then** they see the full submission detail: all extracted prices, confidence score, GPS coordinates (rounded to 100m for privacy), station matched, and the reason it was flagged (e.g. `logo_mismatch`, `low_confidence`)

**Given** an ADMIN reviews a submission
**When** they click Approve
**Then** the submission `status` is updated to `verified` and the prices are published to the station's active price record
**And** the Redis cache for that station is invalidated

**Given** an ADMIN reviews a submission
**When** they click Reject with an optional reason
**Then** the submission `status` is updated to `rejected` and it is removed from the review queue
**And** the prices are not published

**Given** a submission is approved or rejected
**When** the action is saved
**Then** the admin action is written to an audit log (admin user ID, action, timestamp, submission ID) — retained permanently even if the admin's account is later deleted

**Given** the i18n foundation (Story 1.10)
**When** an ADMIN uses the review queue
**Then** the interface is available in Polish, English, and Ukrainian

*Covers: FR40, FR41*

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. database write fails mid-approve/reject (submission status left inconsistent); two admins act on the same submission simultaneously (concurrent action); Redis cache invalidation fails after approval.

### Story 4.3: User Abuse Detection & Shadow Ban

As an **ops admin**,
I want to view a user's submission history and apply a shadow ban when I detect coordinated or manipulative behaviour,
So that bad actors can't distort fuel prices on the map without knowing they've been actioned.

**Why:** Shadow banning — where a user's submissions are silently rejected without notifying them — is the right tool for price manipulation. Outright banning creates cat-and-mouse account cycling; shadow banning lets bad actors believe they're contributing while their data has no effect. Short-circuiting the pipeline at the API layer (before R2 upload and OCR) means shadow-banned submissions cost nothing to process. The anomaly detection alerts surface candidates for review without requiring ops to watch dashboards manually. Trust score gives ops a quantified signal of contributor reliability without exposing PII.

**Acceptance Criteria:**

**Given** an ADMIN opens a user profile in the Users section
**When** they view the page
**Then** they see the user's submission count, trust score, shadow ban status, and a paginated list of their submissions (price, station, status, timestamp)

**Given** a new driver account is created
**When** their User record is initialised
**Then** their trust_score is set to 100

**Given** a submission is processed by the pipeline
**When** its final status is set
**Then** trust_score is updated atomically: +5 for auto-verified, +10 for admin-approved, -10 for admin-rejected, -25 for shadow_rejected
**And** trust_score is clamped to a floor of 0 and a ceiling of 500

**Given** a submission enters the pipeline
**When** the BullMQ worker evaluates OCR confidence
**Then** if trust_score >= 200, submissions with OCR confidence 40–60% are auto-verified rather than flagged for review
**And** if trust_score < 50, all submissions are sent to the review queue regardless of OCR confidence

**Given** an ADMIN is viewing a user profile
**When** they click Shadow Ban and confirm
**Then** the user's `shadow_banned` flag is set to `true`
**And** all subsequent submissions from that user are short-circuited at the API layer

**Given** an authenticated driver submits a photo
**When** the API endpoint receives the submission and the driver's `shadow_banned = true`
**Then** a Submission record is created with `status: shadow_rejected` (for audit trail)
**And** no photo is uploaded to R2 and no BullMQ job is enqueued
**And** the API returns 202 — the driver sees normal confirmation UX with zero indication of rejection

**Given** an ADMIN has shadow-banned a user in error
**When** they click Remove Shadow Ban on the user profile
**Then** the `shadow_banned` flag is cleared and future submissions are processed normally

**Given** the anomaly detection system (running as a scheduled NestJS job)
**When** a user submits more than 20 prices within any 60-minute window, OR 3+ submissions for the same station within 30 minutes with prices varying >15%, OR the same price is submitted for 5+ stations within 60 minutes
**Then** an alert is raised in the admin dashboard flagging the user for review
**And** the submissions themselves are not automatically rejected — ops decides the action

*Covers: FR42, FR43, FR44. Admin interface in Polish only.*

### Story 4.4: Dead-Letter Queue Management

As an **ops admin**,
I want to see all pipeline jobs that have exhausted retries, investigate their failure reason, and either retry them manually or discard them,
So that no submission silently disappears and I can act on systemic pipeline failures quickly.

**Why:** The retry strategy (×3, 30s→2min→10min) handles transient failures, but some jobs will still end up in the dead-letter queue — e.g. a Claude API response format change that breaks the parser will cause every job in that window to fail identically, land in the DLQ, and trigger the alert. Manual retry lets ops recover all affected submissions after a hotfix deploy rather than losing them permanently. Without a DLQ management UI, these jobs are invisible and photos linger in R2 indefinitely.

**Acceptance Criteria:**

**Given** an ADMIN opens the Dead-Letter Queue section
**When** they load the page
**Then** they see a list of DLQ jobs sorted by oldest first, each showing: submission ID, station (if matched), failure reason, number of attempts, last attempt timestamp

**Given** a DLQ job in the list
**When** the ADMIN clicks Retry
**Then** the job is re-enqueued in BullMQ with a fresh retry counter
**And** it is removed from the DLQ view

**Given** a DLQ job in the list
**When** the ADMIN clicks Discard
**Then** the Submission record is updated to `status: rejected` with reason `dead_letter_discarded`
**And** if a photo still exists in R2 for this submission, it is deleted
**And** the job is removed from the DLQ view

**Given** the DLQ item count reaches 10 or more
**When** the threshold is crossed
**Then** an automated alert is sent to the ops team (email or Slack webhook, configurable via ENV var)
**And** the alert includes the current DLQ count and a direct link to the DLQ section of the admin dashboard

**Given** an ADMIN discards or retries a DLQ job
**When** the action is saved
**Then** the action is written to the audit log (admin user ID, action, timestamp, submission ID)

*Covers: FR47, FR67. Admin interface in Polish only.*

### Story 4.5: Manual Price Override & Station Refresh

As an **ops admin**,
I want to manually override the displayed price for a station or trigger an immediate price refresh,
So that I can correct data errors without waiting for a new community submission.

**Why:** Edge cases will occur where no community submission is forthcoming but a price is clearly wrong — a station's price board was mis-read, a bulk import had an error, or a station just changed prices and the cache is stale. A manual override gives ops a precision instrument for these situations. The override remains marked as current for 7 days — aligning with the display staleness window — after which it falls into the standard staleness system rather than reverting to the previous (potentially wrong) value. The cache refresh trigger is a separate, lighter operation for when the DB data is correct but Redis is serving stale data.

**Acceptance Criteria:**

**Given** an ADMIN searches for a station in the Station Management section
**When** they open a station's detail page
**Then** they see the current active price per fuel type, the source of each price (community submission, admin override, or seeded estimate), and the timestamp of the last verified submission

**Given** an ADMIN enters a manual price override for a fuel type at a station
**When** they submit it with a required reason note
**Then** the station's active price for that fuel type is updated in the DB with source `admin_override`
**And** the Redis cache for that station is invalidated immediately
**And** the override is written to the audit log with the reason note, admin user ID, and timestamp

**Given** an active admin override on a station
**When** fewer than 7 days have elapsed since the override was set
**Then** the price is shown as current with a visual indicator distinguishing it from community-verified prices

**Given** an active admin override on a station
**When** 7 or more days have elapsed since the override was set
**Then** the price value is retained but the override loses its current status and falls into the standard staleness detection system — it may be flagged as stale by Story 2.8 logic

**Given** a new verified community submission is received for a station with an active admin override
**When** the pipeline publishes the verified price
**Then** the admin override is superseded — the community price becomes the active price and the override is cleared

**Given** an ADMIN clicks Trigger Price Refresh for a station
**When** the action is confirmed
**Then** the Redis cache entry for that station is deleted
**And** the next request for that station's prices fetches fresh data from the DB
**And** no price data is changed — this is a cache-only operation

*Covers: FR45, FR46. Admin interface in Polish only.*

### Story 4.6: Contribution Funnel, OCR Metrics & Pipeline Health

As an **ops admin**,
I want to see real-time pipeline health and submission funnel metrics in the admin dashboard,
So that I can spot OCR degradation or queue problems the moment they happen — not after drivers notice stale prices.

**Why:** The OCR pipeline is the core of the product's data engine. Without visibility into pass rates, queue depth, and rejection reasons, a gradual degradation (e.g. a model update reducing confidence scores, or a processing backlog building up) is invisible until users notice stale prices. Real-time health is Phase 1 — you need this from the first submission in Łódź. Historical funnel analysis is part of the same view.

**Acceptance Criteria:**

**Given** an ADMIN opens the Metrics section
**When** they view the Pipeline Health tab
**Then** they see real-time indicators refreshing every 60 seconds:
- OCR pipeline status: success rate (last 1 hour), average processing time (p50 / p95), current queue depth
- Error breakdown by failure type: low_confidence, gps_no_match, price_validation_failed, logo_mismatch
- Dead-letter queue count (unprocessed items requiring manual action)

**Given** an ADMIN views the Contribution Funnel tab
**When** they select a time period (today / last 7 days / last 30 days)
**Then** they see: total submissions received, auto-verified count and %, admin-approved count and %, rejected count and % (broken down by reason), shadow_rejected count, dead-letter count — with drop-off rates at each stage

**Given** the funnel metrics are displayed
**When** the ADMIN selects a specific rejection reason
**Then** they can drill down to the list of submissions with that rejection reason in the selected period

*Covers: FR61, FR64. Admin interface in Polish only.*

### Story 4.7: API Cost Tracking Dashboard *(Phase 2)*

As an **ops admin**,
I want to see Claude Haiku API spend broken down by day, week, and month,
So that I can track costs against budget and spot anomalies before they become a surprise invoice.

**Why:** Claude API cost is the primary variable cost in the pipeline (~$0.0009/image). At scale this is negligible, but a bug causing reprocessing loops or an abuse spike could inflate costs unexpectedly. A cost dashboard makes this visible before the billing cycle closes. The pipeline-level failsafes (rate limiting and daily spend cap) live in Story 3.9 — this dashboard is the observability layer that sits on top of them.

**Acceptance Criteria:**

**Given** an ADMIN opens the API Cost tab
**When** they view it
**Then** they see Claude Haiku spend for: today, current week, current month, and last 3 months as a bar chart
**And** cost is shown in USD alongside the image count processed in each period

**Given** monthly spend exceeds a configurable threshold (default: $50)
**When** the threshold is crossed
**Then** an automated alert is sent to the ops team via the same channel configured in Story 4.4

*Covers: FR62. Admin interface in Polish only.*

### Story 4.8: Data Freshness Dashboard *(Phase 2)*

As an **ops admin**,
I want to see which stations have the most outdated prices, segmented by region,
So that I can identify coverage gaps and prioritise outreach or seeding efforts.

**Why:** Coverage is uneven by nature — urban stations get frequent submissions, rural ones may go weeks without one. Without a freshness view, ops is blind to which parts of the map are unreliable. This dashboard turns coverage into an actionable metric.

**Acceptance Criteria:**

**Given** an ADMIN opens the Data Freshness tab
**When** they view it
**Then** they see a table of all stations sortable by: last verified submission date, region (voivodeship), and current price source (community / admin override / seeded estimate)
**And** stations with no verified submission in the last 30 days are highlighted

**Given** the freshness table is displayed
**When** the ADMIN filters by voivodeship
**Then** the table updates to show only stations in that region with their freshness status

*Covers: FR63. Admin interface in Polish only.*

### Story 4.9: Product Analytics Integration & Engagement Dashboard *(Phase 2)*

As an **ops admin**,
I want a PostHog (or Mixpanel) integration capturing key user events, surfaced in a user growth and engagement dashboard,
So that I can understand how drivers actually use the product, identify retention problems, and make data-driven decisions about what to build next.

**Why:** DB queries tell you what happened (submissions count, active users), but product analytics tell you where people drop off and why they stop coming back. At Phase 1 launch in Łódź, your own queries are enough. By Phase 2, with multiple cities and growing traffic, you need to know which features drive retention, where the contribution funnel loses people, and which user cohorts stay engaged — this is what turns the app from a data project into a product.

**Acceptance Criteria:**

**Given** the PostHog (or equivalent) SDK is integrated into the mobile app and web surfaces
**When** a driver performs any of the following actions
**Then** the corresponding event is captured with the specified properties:
- `app_opened` — platform (iOS/Android), app version
- `map_viewed` — fuel type filter active
- `station_detail_viewed` — station_id, has_price (bool)
- `photo_capture_initiated` — from station detail (bool)
- `photo_submitted` — fuel_types count, station_id
- `submission_confirmed` — outcome (queued/sent)
- `contribution_streak_milestone` — streak length

**Given** a driver who has declined analytics consent (if separate consent is required)
**When** analytics events would be captured
**Then** no events are sent — consent state is checked before every event flush

**Given** an ADMIN opens the Engagement Dashboard section
**When** they view it, for a selectable period (last 7 / 30 / 90 days / all time)
**Then** they see:
- **DAU / MAU** ratio and trend line
- **Contribution rate** — % of MAU who submitted at least one photo in the period
- **Retention cohorts** — % of new drivers who return at day 7, day 14, day 30
- **Top contributing users** — anonymised (by user_id hash, not PII) — top 20 by submission count
- **Top contributing regions** — voivodeship-level submission heatmap

**Given** the engagement dashboard
**When** any metric is displayed
**Then** no personal data (names, emails, raw user IDs) is visible — only anonymised identifiers and aggregate statistics

**Given** the admin panel displays the engagement dashboard
**When** it is viewed alongside other admin panel sections (4.1, 4.6, 4.7, 4.8)
**Then** it follows the same navigation shell, authentication, and visual language — one coherent panel

*Covers: FR65, FR66. Admin interface in Polish only. Note: if PostHog's data residency options are insufficient for GDPR compliance, Mixpanel (EU data residency) or a self-hosted PostHog instance are viable alternatives — decision to be made pre-implementation.*

### Story 4.10: Admin UI — Manual Station Sync Trigger *(Phase 2)*

As an **ops admin**,
I want a button in the admin panel to trigger and monitor a station sync,
So that I can seed or re-populate station data without leaving the browser or using curl.

**Why:** Story 2.13 provides the API, but ops workflows are faster and less error-prone with a UI — especially under pressure during a data incident. A status display (last sync time, station count, whether a sync is running) also gives immediate confidence that the database is healthy.

**Acceptance Criteria:**

**Given** an ADMIN opens the Station Sync section of the admin panel
**When** they view it
**Then** they see: current sync status (Idle / Running / Failed), last completed sync timestamp, and total station count in the database

**Given** the ADMIN clicks "Run Sync Now"
**When** no sync is currently running
**Then** the button is disabled and replaced with a "Sync running…" indicator, and the status updates in real time (polling `GET /v1/admin/stations/sync/status` every 5 seconds)

**Given** a sync is already running
**When** the page is loaded or the status is polled
**Then** the "Run Sync Now" button is disabled with a tooltip: "Sync already in progress"

**Given** the sync completes
**When** the status poll detects completion
**Then** the last completed timestamp and station count update without a page reload, and the button re-enables

**Given** the sync fails (all retries exhausted)
**When** the status poll detects failure
**Then** a dismissible error banner is shown: "Last sync failed — check Railway logs" and the button re-enables so the admin can retry

**Given** the admin panel displays the Sync section
**When** it is viewed alongside other admin sections
**Then** it follows the same navigation shell, authentication guard (ADMIN only), and visual language as Story 4.1

*Covers: Ops tooling — no FR mapping. Depends on Story 2.13 (API endpoints) and Story 4.1 (admin dashboard shell). Admin interface in Polish only.*

---

## Epic 5: Personal Savings & Consumption Intelligence *(Phase 2)*

Drivers who submit pump meter and odometer photos unlock personal savings summaries, fuel consumption history (l/100km), and cost trend visualisations — all independent of community participation.

**FRs covered:** FR13, FR14, FR26, FR27, FR28, FR29, FR30, FR31
**Phase:** 2

### Story 5.0: Regional Benchmark Price Calculation & Storage

As a **developer**,
I want the system to periodically calculate and snapshot voivodeship-level average prices per fuel type,
So that savings calculations have a reliable, consistent benchmark to compare against.

**Why:** Savings figures are meaningless without a stable, well-defined benchmark. Calculating it on the fly from raw submissions at query time is expensive, inconsistent, and produces different results depending on when you ask. A snapshotted benchmark table makes savings calculations fast, reproducible, and historically accurate — a fill-up from 3 months ago always shows the benchmark that was current then.

**Acceptance Criteria:**

**Given** a scheduled job runs (every 24 hours)
**When** it calculates regional benchmarks
**Then** for each (voivodeship × fuel_type) combination it computes the median verified price from all submissions in the last 30 days
**And** stores it as a `regional_benchmark` record with: voivodeship, fuel_type, median_price, calculated_at, submission_count
**And** never overwrites previous records — each run appends a new snapshot, preserving history

**Given** a voivodeship × fuel_type combination has fewer than 5 verified submissions in the last 30 days
**When** the benchmark is calculated
**Then** no benchmark record is written for that combination — insufficient data is not stored as a zero or estimate

**Given** a FillUp record is created (Story 5.2)
**When** savings are to be calculated
**Then** the most recent `regional_benchmark` for that voivodeship × fuel_type is read and stored directly on the FillUp record as `area_avg_at_fillup` — the FillUp is permanently linked to the benchmark value at that moment in time

*Covers: prerequisite for FR27. Note: the `regional_benchmarks` table is also consumed by Story 3.7 (price validation tier 2) and will serve the data licensing epic in Phase 3.*

---

### Story 5.1: Vehicle Setup & Car Recognition

As a **driver**,
I want to add my car to the app — either by photographing it or selecting from a dropdown — and record its engine details,
So that my fill-ups and consumption are tracked per vehicle and contribute to real-world stats for my car model.

**Why:** Consumption is meaningless at the driver level — a driver with two cars will have wildly different l/100km depending on which car they filled up. Vehicle-level tracking is the foundation for accurate consumption history, cross-driver benchmarks by engine variant, and eventually a real-world consumption dataset with genuine data licensing value. The photo recognition path is the wow moment that makes onboarding feel magical; manual dropdowns ensure it works for everyone.

**PoC validated (2026-03-20):** Claude Opus 4.6 correctly identifies make, model, and generation from clear car photos. Haiku drops the ball on generation detail — not viable. Production choice: Opus (~$0.0045/event, one-time per vehicle — negligible at scale).

**Acceptance Criteria:**

**Given** a driver sets up their first vehicle
**When** they are shown the vehicle setup screen
**Then** they are offered three entry paths: take a photo, upload from gallery, or enter manually via dropdowns

**Given** a driver takes a photo or uploads from gallery
**When** the image is submitted to Claude Opus 4.6
**Then** the model identifies the most likely make, model, and generation and presents it as a suggestion with a confidence indicator
**And** the driver can confirm the suggestion or dismiss it and select manually

**Given** a driver has confirmed or selected make and model
**When** they proceed
**Then** a cascading dropdown presents: year → engine variant (sourced from InfoExpert or equivalent Polish vehicle dictionary)
**And** each engine variant displays: displacement, power (kW/HP), and fuel type — enough to uniquely identify the engine

**Given** Claude Vision cannot identify the car with sufficient confidence
**When** recognition fails or confidence is low
**Then** the driver is taken directly to manual dropdowns with no error shown — the suggestion step is silently skipped

**Given** a driver has selected their engine variant
**When** they complete setup
**Then** they are offered an optional nickname field (e.g. "My Golf", "Work Car") — skippable
**And** the vehicle is saved: make, model, year, engine variant, displacement, power, fuel type, nickname (if set)
**And** no registration plate is requested at any point in the flow

**Given** a driver has at least one vehicle set up
**When** they record a fill-up or odometer reading
**Then** they can select which vehicle it applies to from a list of their saved vehicles
**And** if they have only one vehicle it is pre-selected automatically

**Given** a driver wants to add another vehicle
**When** they open vehicle settings
**Then** they can add additional vehicles — no upper limit enforced at MVP
**And** each vehicle maintains its own independent fill-up and odometer history

**Given** a driver wants to edit a vehicle
**When** they open that vehicle's settings
**Then** they can update the nickname and engine variant — make/model/year are locked after first fill-up is linked to prevent history inconsistency

*Covers: prerequisite for FR26, FR28, FR29, FR30. Vehicle dictionary: InfoExpert or equivalent — licensing to be confirmed pre-Phase 2 development.*

---

### Story 5.2: Pump Meter OCR & Fill-Up Recording

As a **driver**,
I want to take a photo of the pump meter display after filling up,
So that the app automatically records my fill-up volume, cost, and fuel type without manual entry.

**Why:** The pump meter photo is the entry point to all personal savings intelligence. Manual data entry kills retention — if Kasia has to type in 47.3L and 6.79 PLN/L every fill-up, she won't. OCR removes that friction entirely. FR14 requires the driver to confirm/correct the fuel type suggestion since pump displays don't always make it unambiguous.

**Acceptance Criteria:**

**Given** a driver taps "Log fill-up" on the map screen (or the fill-up nudge on a price confirmation screen)
**When** location permission has been granted
**Then** the in-app camera opens with a framing overlay guiding them to capture the pump display clearly — no station pre-selection required; GPS matching uses the same 200m radius logic as price board submission

**Given** location permission has not been granted
**When** they attempt to open the fill-up camera
**Then** a blocking screen is shown explaining location is needed, with a deep-link to location settings — identical behaviour to price board submission

**Given** a driver takes a pump meter photo
**When** it is submitted
**Then** Claude Haiku OCR extracts: total cost (PLN), volume (litres), and price per litre — all three must be present for a successful extraction

**Given** OCR has extracted a fuel type from the pump display
**When** the driver sees the confirmation screen
**Then** the suggested fuel type is displayed with a one-tap correction option (dropdown: LPG, Diesel, 95, 98, 99) — they are never blocked, but the suggestion must be confirmable or correctable before saving

**Given** a driver confirms or corrects the fuel type
**When** they tap Save
**Then** before landing on the confirmation screen, a single-screen odometer nudge is shown: "Add odometer reading for l/100km tracking →" with a prominent "Add reading" CTA and a clearly visible "Skip" option — skipping saves the FillUp without consumption data and proceeds to confirmation

**Given** a driver confirms the fuel type and either adds or skips the odometer reading
**When** the FillUp record is saved
**Then** a FillUp record is created: timestamp, station (matched via GPS), fuel type, litres, total cost PLN, price per litre PLN
**And** the price per litre from the pump display is written as a verified community price for that (station × fuel_type) — `last_verified_at` set to now, stale flag cleared — the fill-up is simultaneously a personal record and a community price contribution for the driver's fuel type

**Given** the fill-up confirmation screen is shown
**When** it is displayed
**Then** the confirmation celebrates both contributions: fill-up data (e.g. "47.3L · 314 PLN") and the community update ("PB95 at Orlen updated ✓")
**And** a secondary nudge offers: "Other fuel prices here may be outdated — update them? Add price →" — one tap opens the price board camera; other fuel types at this station whose prices are stale are listed; dismissing requires no action

**Given** GPS station matching fails (no station within 200m)
**When** the fill-up is saved
**Then** it is saved without a station link — volume, cost, and fuel type are retained; station can be linked manually later
**And** no freshness update is made (station unknown)

**Given** OCR cannot extract all three required values (cost, volume, price per litre)
**When** processing completes
**Then** the driver is shown a retake prompt — they may skip and enter values manually as a fallback

*Covers: FR26, FR13, FR14*

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. AsyncStorage write fails when persisting FillUp record locally; server sync fails and local record cannot be retried; OCR service is down entirely (not just low confidence — no response at all).

---

### Story 5.3: Savings vs. Area Average Calculation

As a **driver**,
I want to see how much I saved (or overpaid) compared to the area average after each fill-up,
So that I can feel the tangible financial benefit of using the app to find cheaper stations.

**Why:** This is the core emotional hook — "23 PLN saved this fill-up" is what turns a utility app into something drivers are proud of. The calculation must be instant on the confirmation screen and honest: if she overpaid, she should know that too. Uses the `area_avg_at_fillup` stored on the FillUp record by Story 5.0 — never recalculated from current data.

**Acceptance Criteria:**

**Given** a FillUp record has been saved with a matched station, fuel type, and `area_avg_at_fillup`
**When** the confirmation screen is shown
**Then** the savings calculation is displayed: `(area_avg_at_fillup - paid_price_per_litre) × litres`
**And** positive savings are shown in green with "You saved X PLN vs. area average"
**And** negative savings (overpaid) are shown neutrally — "X PLN above area average" — never shaming language

**Given** a FillUp record has no `area_avg_at_fillup` (benchmark unavailable for that voivodeship × fuel_type)
**When** the confirmation screen is shown
**Then** the savings line is omitted entirely — no placeholder, no zero, no error message

**Given** a FillUp record has been saved without a matched station but GPS coordinates are known
**When** savings are calculated
**Then** the voivodeship is inferred from GPS coordinates directly — station match is not required for savings calculation

**Given** a driver views any past fill-up in their history
**When** the savings figure is displayed
**Then** it always reflects the `area_avg_at_fillup` snapshot from the time of the fill-up — never recalculated against current benchmarks

*Covers: FR27*

---

### Story 5.4: Odometer OCR & Consumption Tracking

As a **driver**,
I want to take a photo of my odometer at each fill-up,
So that the app automatically calculates my fuel consumption in l/100km without me keeping a manual logbook.

**Why:** This is Zofia's entire reason for using the app — she's kept a physical logbook for 11 years. The odometer photo paired with the pump meter eliminates that entirely. Critically, this must work independently of the savings flow — Zofia never submits a price board photo and doesn't care about the community. The first reading is always a baseline; consumption only becomes available from the second reading onward. All readings are per vehicle — a driver with two cars maintains two independent odometer sequences.

**Acceptance Criteria:**

**Given** a driver opens the contribute flow and selects "Record odometer"
**When** they proceed
**Then** they are asked to confirm which vehicle this reading is for — pre-selected if they have only one

**Given** a driver takes an odometer photo
**When** OCR processes it
**Then** the extracted km value is shown on a confirmation screen before saving — the driver can correct it if misread

**Given** a driver confirms the odometer reading
**When** it is saved
**Then** an `OdometerReading` record is created: km value, timestamp, vehicle ID
**And** if a FillUp record for the same vehicle exists within the same session (within 30 minutes), the odometer reading is linked to that FillUp automatically

**Given** this is the driver's first odometer reading for a vehicle
**When** it is saved
**Then** it is stored as a baseline — no l/100km is calculated and none is shown to the driver

**Given** a driver saves an odometer reading and a previous reading exists for that vehicle
**When** the system calculates consumption
**Then** l/100km = (sum of litres from all FillUp records for that vehicle between the two readings ÷ km delta) × 100
**And** the result is stored as `consumption_l_per_100km` on the most recent FillUp record in that segment

**Given** there are no FillUp records for that vehicle between two odometer readings
**When** consumption would be calculated
**Then** no l/100km is calculated for that segment — distance is recorded but litres are unknown; the segment is stored with `consumption_l_per_100km: null`

**Given** the km delta between two odometer readings is zero or negative
**When** consumption would be calculated
**Then** no calculation is made — the reading is flagged internally for review and the driver is shown a gentle prompt to check the value they entered

**Given** OCR cannot extract a readable km value
**When** processing completes
**Then** the driver is shown a retake prompt with manual entry as a fallback

**Given** a driver submits an odometer reading without a pump meter photo in the same session
**When** it is saved
**Then** it is stored normally — odometer tracking works independently of fill-up recording

*Covers: FR28*

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. OCR service is completely unavailable (not just unable to read the image); OdometerReading server sync fails after local save; km value passes validation but is implausibly large (e.g. 999999 — possible OCR artefact).

---

### Story 5.5: Personal History & Summaries

As a **driver**,
I want to view my fill-up history, fuel costs, and consumption trends — per vehicle and across all my cars —
So that I have a complete picture of my fuel spending and efficiency without keeping a manual logbook.

**Why:** This is the payoff screen — everything captured in Stories 5.1–5.4 surfaces here. Zofia gets her digital logbook. Kasia sees her savings accumulate. Tomasz tracks consumption patterns across routes. The per-vehicle view is the primary lens; the all-vehicles rollup gives the full financial picture. No charts without data — empty states must be clear and actionable.

**Acceptance Criteria:**

**Given** a driver opens their personal history
**When** they view it
**Then** they see a vehicle selector at the top: individual vehicles by name/nickname + an "All vehicles" option
**And** the view defaults to the most recently used vehicle

**Given** a driver selects a specific vehicle
**When** the history loads
**Then** they see a chronological list of fill-up records showing: date, station name (if matched), fuel type, litres, total cost, price per litre, and savings vs area average (if available)
**And** each fill-up that has a linked odometer segment shows the calculated l/100km for that segment

**Given** a driver selects a specific vehicle
**When** they view the summary section
**Then** they see: total spend for the selected period, average price per litre paid, average l/100km (across segments with full data), and total litres filled

**Given** a driver selects "All vehicles"
**When** the history loads
**Then** fill-ups from all vehicles are shown in a single chronological list, each labelled with the vehicle nickname
**And** the summary shows total spend and total savings across all vehicles for the selected period

**Given** a driver views any history screen
**When** they filter by time period
**Then** they can select: last 30 days, last 3 months, last 12 months, all time
**And** all figures and charts update to reflect the selected period

**Given** a driver has fill-up records but no odometer readings for a vehicle
**When** they view that vehicle's history
**Then** cost and savings data is shown but l/100km column is omitted — no placeholder or zero shown

**Given** a driver has no fill-up records yet for a vehicle
**When** they view that vehicle's history
**Then** a clear empty state is shown: "No fill-ups recorded yet" with a prompt to record their first

**Given** a driver views the history in their selected language
**When** Polish, English, or Ukrainian is active
**Then** all labels, units, and date formats are displayed in that language

*Covers: FR29, FR30*

---

### Story 5.6: Real-World Consumption Benchmarks by Vehicle

As a **driver**,
I want to see how my car's fuel consumption compares to other drivers with the same make, model, and engine,
So that I know whether my driving habits and car's condition are in line with what others actually experience — not just manufacturer claims.

**Why:** Manufacturer WLTP figures are notoriously optimistic — real-world consumption is typically 20–40% higher. A driver seeing their 1.4 TSI averaging 7.2L/100km wants to know: is that normal for this engine, or is something wrong with my car? This is also a data licensing differentiator — aggregated real-world consumption by engine variant across thousands of Polish drivers is genuinely valuable data that doesn't exist anywhere else at this granularity.

**Data model note:** Benchmarks are aggregated anonymously at the (make × model × engine variant) level. Minimum 10 drivers required before a benchmark is shown — below that threshold the sample is too small to be meaningful and could inadvertently expose individual data.

**Acceptance Criteria:**

**Given** a driver views a vehicle's history screen (Story 5.5)
**When** at least 10 other drivers with the same make, model, and engine variant have recorded consumption data
**Then** a benchmark section is shown: community average l/100km for that engine variant, number of contributing drivers (anonymised count), and where the driver sits relative to the average (e.g. "Your average: 7.2 L/100km — community average: 7.6 L/100km")

**Given** fewer than 10 drivers with that engine variant have recorded consumption
**When** the benchmark section would be shown
**Then** it is omitted entirely — no placeholder, no "not enough data yet" message in the main view; a subtle note in vehicle settings may explain it will appear over time

**Given** a benchmark is shown
**When** the driver views it
**Then** it is clearly labelled as community-sourced real-world data — never presented as manufacturer specification
**And** no individual driver's data is ever identifiable from the display

**Given** a scheduled job runs (every 24 hours)
**When** it recalculates consumption benchmarks
**Then** for each (make × model × engine variant) combination with ≥10 contributing drivers it computes the median l/100km from all recorded segments in the last 90 days
**And** stores it as a `consumption_benchmark` record: make, model, engine variant, median_l_per_100km, driver_count, calculated_at
**And** appends a new record each run — history is preserved, never overwritten

**Given** a driver has fewer than 3 recorded consumption segments for a vehicle
**When** their data would contribute to a benchmark
**Then** it is excluded — too few segments per driver risks outlier distortion

*Covers: data licensing foundation. Minimum viable dataset for this feature: ~500 drivers with consumption data across varied engine variants — expected to be available 3–6 months post Phase 2 launch.*

---

### Story 5.7: Savings Summary Sharing

As a **driver**,
I want to share my monthly savings summary as a card on social media,
So that I can show off how much I saved on fuel and bring other drivers into the community.

**Why:** This is the organic growth loop — Kasia screenshots her "94 PLN saved, top 20% in Warsaw" and sends it to a friend. That friend downloads the app. The shareable card needs to feel like an achievement, not a receipt. It should be visually compelling, clearly branded, and shareable in one tap to WhatsApp, Instagram, and other platforms without requiring extra steps.

**Acceptance Criteria:**

**Given** a driver has at least one month of fill-up data with savings figures
**When** they view their monthly summary
**Then** a "Share" button is shown that generates a branded shareable card

**Given** a driver taps Share
**When** the card is generated
**Then** it displays: total PLN saved that month, the driver's region ranking (if available from Epic 6 leaderboard), number of fill-ups, and desert app branding — no personal name, no station details, no raw prices
**And** the native OS share sheet opens so the driver can share to WhatsApp, Instagram Stories, or any installed app

**Given** a driver has savings data but no regional ranking yet (Epic 6 not released)
**When** the card is generated
**Then** it shows savings and fill-up count only — ranking section is omitted gracefully

**Given** a month with no positive savings (driver consistently paid above average)
**When** the share button would be shown
**Then** it is hidden — no card is generated for negative savings months; the driver is never prompted to share a bad outcome

**Given** a driver views the share screen
**When** their selected language is Polish, English, or Ukrainian
**Then** the card text is generated in that language

*Covers: FR31*

---

## Epic 6: Community, Alerts & Engagement *(Phase 2)*

Drivers receive proactive price drop and sharp-rise alerts, earn a spot on the regional savings leaderboard, and can share monthly savings achievements.

**FRs covered:** FR22, FR23, FR24, FR25, FR32, FR33
**Phase:** 2

### Story 6.0: Fuel Price Feed Ingestion

As a **developer**,
I want the system to extend the existing rack price ingestion with Brent crude in PLN and publish rise signal events,
So that sharp rise alerts (Story 6.3) have an upstream early-warning signal beyond what ORLEN rack alone provides.

**Why:** Story 2.7 (Phase 1) already ingests ORLEN rack prices — the most direct signal for Polish pump prices. Brent crude is the upstream signal that often moves first, giving 12–48h early warning before ORLEN publishes a rack price change. To be useful for Polish drivers, Brent must be expressed in PLN: USD/barrel × USD/PLN exchange rate. A weak złoty can push pump prices up even when crude stays flat. This story extends the Phase 1 mechanism rather than rebuilding it, and adds the BullMQ event publishing that Story 6.3's alert pipeline consumes.

**Acceptance Criteria:**

**Given** the existing twice-daily scheduled job from Story 2.7
**When** it runs
**Then** it is extended to also fetch the current Brent crude price (USD/barrel) from a reliable commodity feed (Alpha Vantage or equivalent)
**And** it fetches the current USD/PLN exchange rate from the NBP (Narodowy Bank Polski) public API
**And** it calculates Brent crude in PLN: USD/barrel × USD/PLN ÷ conversion factor to PLN/litre equivalent
**And** stores it as a `market_signal` record: signal_type (brent_crude_pln), value (PLN/litre equivalent), recorded_at, pct_change vs previous reading

**Given** the NBP exchange rate API is unavailable
**When** the ingestion job runs
**Then** the last known USD/PLN rate is used for the Brent calculation — staleness of up to 24h is acceptable for this signal
**And** the record is flagged with `rate_source: cached` so downstream consumers know the rate is not fresh

**Given** the Brent crude feed is unavailable
**When** the ingestion job runs
**Then** the job falls back gracefully — ORLEN rack prices from Story 2.7 alone are sufficient; Brent failure is logged but does not block the pipeline

**Given** either ORLEN rack price (from Story 2.7) or Brent crude in PLN shows a movement of ≥3% upward within 24 hours
**When** the ingestion job completes
**Then** a `price_rise_signal` event is published to the BullMQ queue for Story 6.3 to consume
**And** the signal includes: affected fuel types, % movement, signal source (orlen_rack | brent_crude_pln), recorded_at

**Given** market signals are stored
**When** they are older than 90 days
**Then** they are archived — full history retained for trend analysis and data licensing, never deleted

*Covers: prerequisite for Story 6.3. Extends Story 2.7 (Phase 1 ORLEN rack ingestion) — market_signal table and ingestion job already exist. Note: NBP API endpoint and Brent crude feed to be validated pre-Phase 2 development.*

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. Brent crude feed (Alpha Vantage or equivalent) is down for >24h — no fallback defined beyond NBP cached rate; NBP API returns a rate older than 24h (currently flagged as cached but no action taken); price_rise_signal event fails to publish to BullMQ (signal lost silently).

---

### Story 6.1: Price Drop Alerts

As a **driver**,
I want to be notified when fuel prices drop at stations near me or ones I've saved,
So that I never miss a chance to fill up cheaper without having to check the app constantly.

**Why:** Price drop alerts are the single highest-retention feature in the product — they bring drivers back without any active effort. The "cheaper than now" default lowers the barrier to opt in; the target price option gives price-conscious drivers like Kasia precise control. Both modes use community-confirmed submissions as the trigger — accuracy matters more than speed here, a false alert erodes trust fast.

**Acceptance Criteria:**

**Given** a driver opens notification preferences
**When** they configure price drop alerts
**Then** they can choose between two modes:
- **"Cheaper than now"** — alert me when any nearby station drops below the current lowest price in my area for my preferred fuel type
- **"Target price"** — alert me when any nearby station drops below a specific PLN/L threshold I set
**And** they can configure which fuel type(s) to monitor (defaults to their most-used fuel type from fill-up history if available)
**And** they can set a radius for "nearby" (5km / 10km / 25km)

**Given** a new verified price submission is processed
**When** it represents a price drop relative to the driver's configured threshold for any driver with an active alert
**Then** a push notification is sent: "PB95 dropped to 6.14 PLN/L at Circle K, 2.3km away"
**And** the notification deep-links directly to that station's detail screen

**Given** multiple stations near a driver drop prices in a short window (e.g. regional movement)
**When** alerts would be triggered for several stations simultaneously
**Then** a single batched notification is sent: "Prices dropped at 3 stations near you" — not one notification per station

**Given** a driver has not granted notification permission
**When** a price drop would trigger an alert
**Then** no notification is sent — the event is silently dropped; re-prompting is handled by Story 6.5

**Given** a driver taps the notification
**When** they open the app
**Then** they are taken directly to the station detail screen for the cheapest station that triggered the alert

**Given** a driver wants to pause alerts temporarily
**When** they update their preferences
**Then** they can disable alerts without losing their configured thresholds — re-enabling restores their previous settings

*Covers: FR22. Alert configuration UI (radius, fuel type, target price threshold, per-type toggles) defined in Story 6.4.*

---

### Story 6.2: Community-Confirmed Price Rise Alerts

As a **driver**,
I want to be notified when prices are rising across stations near me based on community reports,
So that I know a real regional price increase has hit my area and can act before I next fill up.

**Why:** This is the factual confirmation layer — prices have already moved at real stations, verified by real drivers. The regional threshold (30% of nearby stations, ≥2% rise) filters out single-station noise and isolated outliers. A regional movement is an unambiguous signal worth acting on. Tone is informational, not urgent — urgency is the job of Story 6.3's predictive alert which fires first.

**Acceptance Criteria:**

**Given** verified price submissions are processed continuously
**When** ≥30% of stations within a driver's configured radius show a price rise of ≥2% for the same fuel type within a 24-hour window
**Then** the driver receives a push notification: "PB95 prices are rising across stations near you — consider filling up soon"
**And** the notification deep-links to the map view filtered to that fuel type

**Given** a regional rise alert fires
**When** the driver has already received a predictive rise alert (Story 6.3) for the same movement
**Then** the notification acknowledges the sequence: "As expected, PB95 prices have now risen at stations near you"
**And** it is only sent if at least 6 hours have passed since the predictive alert — never back-to-back

**Given** a regional rise alert has been sent for a fuel type in a driver's area
**When** another regional rise would trigger within 48 hours for the same fuel type and area
**Then** no second alert is sent — one alert per price movement cycle per fuel type

**Given** a driver has not granted notification permission
**When** a rise alert would trigger
**Then** no notification is sent — silently dropped; re-prompting handled by Story 6.5

*Covers: FR23 (community-confirmed layer). Driver radius preference defined in Story 6.4.*

---

### Story 6.3: Predictive Price Rise Alerts

As a **driver**,
I want to receive an early warning when fuel prices are likely about to increase,
So that I can fill up before the rise hits the pumps near me.

**Why:** This is the app's most distinctive alert — firing before prices change makes desert feel like a well-informed friend, not just a data display. The trigger is the market signal ingested in Story 6.0: a ≥3% move in ORLEN rack prices or Brent crude. The tone is explicitly forward-looking and advisory — the data source is intentionally never disclosed to the driver. When predictions materialise, the app builds a reputation for prescience. Honesty about uncertainty ("may rise", "worth filling up if you can") maintains trust when the signal doesn't pan out.

**Acceptance Criteria:**

**Given** Story 6.0 publishes a `price_rise_signal` event to the BullMQ queue
**When** the alert worker processes it
**Then** all drivers with active rise alerts and a last fill-up within 14 days receive a push notification:
"Our data suggests fuel prices in your area may rise soon — worth filling up if you can."
**And** the notification deep-links to the map view
**And** the underlying data source (ORLEN rack prices, Brent crude) is never mentioned to the driver in any surface

**Given** both a Brent crude signal and an ORLEN rack signal fire within the same 24-hour window
**When** alerts would be sent for both
**Then** only one notification is sent — the ORLEN rack signal takes precedence as the more direct indicator

**Given** a predictive alert has been sent
**When** community submissions within 48 hours confirm the rise (Story 6.2 threshold met)
**Then** Story 6.2 sends the confirmation notification with copy that reinforces the prediction:
"Our prediction came true — prices have risen at stations near you."
**And** it is only sent if at least 6 hours have passed since the predictive alert

**Given** a predictive alert has been sent for a fuel type and area
**When** another market signal would trigger within 72 hours for the same fuel type
**Then** no second predictive alert is sent — one alert per price movement cycle

**Given** a driver has not filled up in the last 14 days
**When** a predictive alert would fire
**Then** no notification is sent — a driver who hasn't filled up recently is unlikely to act and the alert adds noise

**Given** a driver has not granted notification permission
**When** a predictive alert would trigger
**Then** no notification is sent — silently dropped; re-prompting handled by Story 6.5

*Covers: FR23 (predictive layer). Driver opt-in toggle for predictive alerts defined in Story 6.4. Internal implementation note: signal source logged for ops monitoring and prediction accuracy tracking — never exposed to drivers.*

---

### Story 6.4: Alert Preferences & Settings Panel

As a **driver**,
I want a single place to configure all my price alerts and notification settings,
So that I get only the alerts that are relevant to me without being overwhelmed.

**Why:** By Phase 2 the notification surface has grown significantly beyond the MVP baseline in Story 1.6 — drivers now have price drop thresholds, rise alert opt-ins, radius settings, fuel type preferences, and per-alert-type toggles to manage. Without a coherent settings panel this becomes scattered and confusing. One well-organised screen keeps it manageable and reduces the chance of drivers disabling everything just to stop one alert they dislike.

**Acceptance Criteria:**

**Given** a driver opens notification settings
**When** they view the alert preferences panel
**Then** they see clearly separated sections: Price Drop Alerts, Price Rise Alerts, and Monthly Summary

**Given** a driver configures Price Drop Alerts
**When** they edit the settings
**Then** they can: toggle the alert on/off, choose mode (cheaper than now / target price), set a target price (PLN/L) if target mode selected, choose fuel type(s) to monitor, and set their preferred radius (5km / 10km / 25km)
**And** fuel type defaults to their most-used fuel type from fill-up history if available

**Given** a driver configures Price Rise Alerts
**When** they edit the settings
**Then** they can independently toggle community-confirmed rise alerts (Story 6.2) and predictive rise alerts (Story 6.3) on or off
**And** they can set their preferred radius (shared with drop alert radius setting)

**Given** a driver configures Monthly Summary
**When** they edit the settings
**Then** they can toggle the monthly savings summary notification on or off

**Given** a driver disables a specific alert type
**When** that alert would otherwise trigger
**Then** it is silently suppressed — all other alert types continue unaffected

**Given** a driver has not granted OS notification permission
**When** they open the alert preferences panel
**Then** all toggles are shown as disabled with a clear explanation and a button that deep-links to device notification settings — no broken state

**Given** a driver saves their preferences
**When** they return to the panel later
**Then** all settings are persisted exactly as configured — no resets on app update or re-login

*Covers: FR20 (Phase 2 extension of Story 1.6 baseline). Story 1.6 handles MVP notification toggles and OS permission flow — this story extends it with Phase 2 alert configuration.*

---

### Story 6.5: Monthly Savings Summary Notification

As a **driver**,
I want to receive a monthly summary of how much I saved on fuel,
So that I feel the cumulative value of using the app even when I haven't opened it in a while.

**Why:** Individual fill-up savings feel small in the moment — 23 PLN doesn't move the needle emotionally. But "94 PLN saved in March" is tangible and shareable. The monthly summary is a retention heartbeat — it re-engages dormant drivers and gives active ones a moment of satisfaction. It also surfaces the share prompt (Story 5.7), turning a private achievement into an acquisition loop.

**Acceptance Criteria:**

**Given** a scheduled job runs on the 1st of each month at 09:00 Warsaw time
**When** it calculates monthly summaries
**Then** for each driver with ≥1 fill-up with savings data in the previous month it computes: total PLN saved vs area average, number of fill-ups, and regional leaderboard rank (if available from Story 6.7)

**Given** a monthly summary has been calculated for a driver
**When** the notification is sent
**Then** the message is celebratory and specific: "You saved 94 PLN on fuel in March — you're in the top 20% of savers in your area!"
**And** if no leaderboard rank is available the rank line is omitted gracefully: "You saved 94 PLN on fuel in March. Great month!"
**And** the notification deep-links to the savings summary screen where the share button (Story 5.7) is prominently shown

**Given** a driver had fill-ups in the previous month but no savings data (no benchmark available for their voivodeship × fuel type)
**When** the monthly summary would be sent
**Then** no notification is sent — a summary without a savings figure is not worth sending

**Given** a driver had no fill-ups recorded in the previous month
**When** the monthly summary job runs
**Then** no notification is sent for that driver

**Given** a driver has disabled monthly summary notifications in their preferences (Story 6.4)
**When** the job runs
**Then** no notification is sent — preference is respected regardless of savings amount

**Given** a driver has not granted notification permission
**When** the monthly summary would be sent
**Then** the summary is calculated and stored silently — it remains accessible in-app; re-prompting handled by Story 6.6

*Covers: FR24*

---

### Story 6.6: Smart Notification Re-prompting

As a **driver**,
I want the app to remind me about the value of notifications at the right moment,
So that I don't permanently miss out on alerts just because I dismissed the permission dialog at onboarding.

**Why:** Notification permission granted at onboarding is the exception, not the rule — most users dismiss the cold OS dialog. But a driver who just submitted their first photo and got a "thank you" is primed to hear "want to know when prices drop near you?" Re-prompting at the right moment converts dismissers into subscribers without feeling pushy. Story 1.6 handles the onboarding flow; this story handles the contextual re-prompt triggers that fire later.

**Acceptance Criteria:**

**Given** a driver who declined notification permission at onboarding
**When** they successfully submit their first price board photo
**Then** a non-blocking prompt appears after the "thank you" confirmation: "Want to know when prices drop near you? Enable alerts" with a single CTA that deep-links to device notification settings
**And** this prompt is shown only once — never repeated for the same trigger

**Given** a driver who declined notification permission
**When** their first monthly savings summary is calculated (even if unsent due to no permission)
**Then** a prompt appears the next time they open the app: "You saved 94 PLN last month — enable notifications to get your summary delivered automatically"
**And** this prompt is shown only once — never repeated for the same trigger

**Given** a driver has been shown both re-prompt triggers and declined both
**When** any further re-prompt opportunity arises
**Then** no further re-prompts are shown — two strikes, respect the decision

**Given** a driver grants notification permission after a re-prompt
**When** permission is confirmed
**Then** they are taken directly to the alert preferences panel (Story 6.4) to configure their preferences — not left at a blank settings screen

**Given** a driver views a re-prompt
**When** their selected language is Polish, English, or Ukrainian
**Then** all re-prompt text is displayed in that language

*Covers: FR25*

---

### Story 6.7: Savings Leaderboard

As a **driver**,
I want to see how my fuel savings compare to other drivers in my area,
So that saving money becomes a competition I actually want to win.

**Why:** The leaderboard turns rational frugality into a social game — "you're in the top 15% of savers in Warsaw this month" hits loss aversion and social comparison simultaneously. Geographic segmentation makes it feel relevant and winnable — competing against all of Poland is discouraging, competing against your district is motivating. Kasia's story makes this explicit: seeing she's in the bottom third is what drives her to submit 11 photos in a month.

**Acceptance Criteria:**

**Given** a driver opens the leaderboard
**When** they view it
**Then** they see a ranked list of anonymised drivers in their area (voivodeship), sorted by total PLN saved vs area average in the current calendar month
**And** their own position is always visible — pinned at the bottom if not in the visible top list
**And** other drivers are identified only by an anonymised display name (e.g. "Driver #4721") — never by real name or account details

**Given** a driver views the leaderboard
**When** they select a time period
**Then** they can switch between current month, last month, and last 3 months

**Given** a driver views the leaderboard
**When** fewer than 10 drivers in their voivodeship have savings data for the selected period
**Then** the leaderboard is not shown — a message explains it will appear as more drivers in their area contribute data

**Given** a driver's position changes on the leaderboard
**When** they open the app
**Then** their current rank is shown — no push notification for rank changes (too noisy); rank is surfaced passively via the monthly summary notification (Story 6.5)

**Given** a driver views the leaderboard
**When** their selected language is Polish, English, or Ukrainian
**Then** all labels, ranks, and date formats are displayed in that language

*Covers: FR32, FR33*

---

### Story 6.8: Notification & Alert Engagement Analytics

As an **ops admin**,
I want to see how drivers interact with notification permissions and alert settings,
So that I can identify where opt-in rates are low, measure re-prompting effectiveness, and decide where to invest product effort.

**Why:** Notification permission is the highest-retention lever in the product — but it's also the easiest thing for drivers to decline. Without visibility into grant rates, opt-in breakdown by alert type, and re-prompt conversion, the team is flying blind on one of the most important engagement mechanics. This dashboard turns notification data into actionable product decisions.

**Acceptance Criteria:**

**Given** an admin opens the Notification Analytics section of the admin panel
**When** they view it
**Then** they see the following metrics, filterable by time period (last 7 days / 30 days / 90 days / all time):
- **Permission grant rate:** % of new drivers who granted OS notification permission at onboarding vs declined
- **Re-prompt conversion:** % of drivers who granted permission after each re-prompt trigger (photo submission prompt vs savings summary prompt) vs dismissed
- **Alert opt-in rates:** % of permission-granted drivers who enabled each alert type (price drop / community rise / predictive rise / monthly summary)
- **Alert configuration breakdown:** distribution of radius choices (5km / 10km / 25km), drop alert mode split (cheaper-than-now vs target price)
- **Alert-to-engagement conversion:** % of sent notifications that result in an app open within 1 hour, broken down by alert type

**Given** an admin views the metrics
**When** they inspect a specific alert type
**Then** they can see a trend line over time — not just a current snapshot

**Given** the admin panel displays notification analytics
**When** it is viewed alongside other admin panel sections (4.6, 4.7, 4.8)
**Then** it follows the same navigation shell, authentication, and visual language as all other admin panel sections — one coherent panel, not a separate tool

*Covers: FR65 (extension). Architecture note: all admin panel stories (4.1, 4.6, 4.7, 4.8, this story) must be reviewed together at implementation readiness to ensure a coherent shared shell — navigation, auth, and tech stack must be consistent across all sections.*

---

## Epic 7: Station Partner Portal *(Phase 2)*

Station owners claim and verify their station, self-update prices, and view performance metrics — becoming active, invested data contributors.

**FRs covered:** FR34, FR35, FR36
**Phase:** 2

### Story 7.1: Station Claim — Easy Path

As a **station owner**,
I want to claim my station instantly using my Google Business Profile or work email,
So that I can start managing my station's prices without waiting for manual review.

**Why:** The easy path covers the majority of stations — chains via domain match, and the large portion of independents already on Google Business Profile (validated by PoC across Polish urban and rural areas, 2026-03-20). Getting these owners verified instantly, with zero ops involvement, is the highest-leverage first step. Owners who can't complete the easy path see a "verification pending" state and are handled by Story 7.2 when it ships.

**Acceptance Criteria:**

**Given** a station owner visits the partner portal for the first time
**When** they search for their station by name, address, or postcode
**Then** matching stations are shown with their current claim status: unclaimed / pending / verified

**Given** a station owner selects an unclaimed station and initiates a claim
**When** they choose "Verify with Google"
**Then** they are taken through Google Business Profile OAuth
**And** if their Google Business Profile includes that station's Google Places ID the claim is approved immediately and STATION_MANAGER role granted
**And** they land on the station management screen with a confirmation message

**Given** a station owner whose Google Business Profile does not include the station
**When** they complete OAuth
**Then** they are informed the automatic match failed and offered the domain match path instead

**Given** a station owner initiates a claim with a business email
**When** the domain is checked against the known chain list (ORLEN, BP, Circle K, Shell, Lotos, Moya, Amic)
**Then** if matched the claim is approved immediately and STATION_MANAGER role granted

**Given** neither Google OAuth nor domain match succeeds
**When** the easy path is exhausted
**Then** the owner is shown a clear message: "We couldn't verify automatically — we'll guide you through our manual verification process" with a CTA to Story 7.2 flow
**And** the station is marked "pending verification" — no access granted yet

**Given** a station already has a verified manager
**When** another owner attempts to claim it via the easy path
**Then** the claim is blocked — they are directed to contact support

*Covers: FR34 (easy path). Story 7.2 handles phone SMS and document upload for stations not covered here.*

---

### Story 7.2: Station Claim — Hard Path

As a **station owner**,
I want to verify my station ownership even if I don't have a Google Business Profile or chain email,
So that independent stations can still be claimed and managed on the platform.

**Why:** The hard path exists for the long tail — independent stations without Google Business Profiles or chain email domains. These are often exactly the stations that need the platform most (like Piotr competing with a nearby ORLEN). Phone SMS uses the station's existing Google Places phone number, keeping friction low. Document upload is the final fallback — ops-heavy but necessary for edge cases.

**Acceptance Criteria:**

**Given** a station owner arrives at the hard path (from Story 7.1's exhausted easy path)
**When** they proceed
**Then** they are shown a clear explanation of the two remaining options: phone verification and document upload, with phone presented first as the faster option

**Given** a station owner selects phone verification
**When** the system looks up the station in Google Places
**Then** if a phone number is found an automated SMS is sent with a 6-digit code valid for 24 hours
**And** the owner enters the code in the portal to complete verification instantly

**Given** the code is entered correctly within 24 hours
**When** it is validated
**Then** the claim is approved, STATION_MANAGER role granted, and the owner lands on the station management screen

**Given** no phone number exists in Google Places, or the owner cannot access that number
**When** phone verification cannot be completed
**Then** the owner is offered document upload: business registration document or utility bill showing the station address

**Given** a document is uploaded
**When** it enters the ops review queue
**Then** the station is marked "pending verification" — the owner sees an estimated review time of 2 business days
**And** they are notified by email when approved or rejected, with reason if rejected

**Given** an ops admin reviews a document upload
**When** they approve the claim
**Then** STATION_MANAGER role is granted and the owner is notified immediately

**Given** a station already has a verified manager
**When** another owner submits a hard path claim for the same station
**Then** it is flagged for ops review — both parties notified, existing manager retains access until resolved

*Covers: FR34 (hard path). Depends on Story 7.1 for the claim initiation flow and "pending" state.*

---

### Story 7.3: Self-Service Price Update

As a **verified station owner**,
I want to update my station's fuel prices directly in the partner portal,
So that accurate prices reach drivers immediately without waiting for community submissions.

**Why:** A verified owner updating their own prices is the highest-quality data source — authoritative, real-time, and eliminates the usual contribution lag. For the owner it is a trust signal to drivers; for the platform it provides an always-fresh anchor price even between community submissions. Fraud monitoring exists separately in Story 7.5 — this story assumes honest owners operating in good faith.

**Acceptance Criteria:**

**Given** a verified station owner (STATION_MANAGER role) opens the station management screen
**When** they view the price section
**Then** they see a price entry form with a field per fuel type their station offers (PB95, PB98, ON, LPG, and any other types present in the station's existing price record)

**Given** the owner submits a price for a fuel type
**When** the submitted value is validated
**Then** prices outside ±30% of the current regional benchmark for that fuel type are rejected with a clear message explaining the allowed range

**Given** a valid price is submitted
**When** it is saved
**Then** it is immediately published as the current owner-verified price for that fuel type
**And** it is visually distinguished from community submissions in the driver-facing app (e.g. "Owner verified" label)
**And** `last_updated_at` is set for that fuel type row only — other fuel types at the same station are not affected

**Given** an owner updates a price for one fuel type
**When** community photo submissions for any other fuel type at that station arrive
**Then** those submissions are processed independently — per-fuel-type freshness is preserved

**Given** an owner-submitted price is live
**When** community photo submissions for the same fuel type arrive
**Then** community prices are accepted and stored alongside the owner price
**And** the most recently submitted authoritative price (owner or community, whichever is newer) is shown to drivers

**Given** community submissions for the same fuel type arrive after an owner update
**When** ≥2 submissions within 24 hours report a price ≥2% higher than the owner-submitted price
**Then** an integrity alert is created in the ops admin panel (handled by Story 7.5) — the owner's price remains live pending ops review

**Given** an owner submits any price update
**When** it is saved
**Then** the action is logged with timestamp, owner user ID, station ID, fuel type, and submitted price — accessible to ops via the admin panel

*Covers: FR35. Depends on Story 7.1 / 7.2 for STATION_MANAGER role. Fraud monitoring logic for owner price contradictions is in Story 7.5.*

> **Note (implementation readiness):** Missing error-scenario ACs — add before this story is built. E.g. database write fails mid-update (price record left inconsistent); community submission arrives concurrently with owner update (race condition between two writers); Redis cache invalidation fails after owner price is saved.

---

### Story 7.4: Station Performance Metrics

As a **verified station owner**,
I want to see how drivers are interacting with my station on the platform,
So that I can understand my station's visibility and gauge the value of participating.

**Why:** Station owners are the supply-side partner. If they can see that claimed, price-updated stations attract more map views and detail opens, they have a concrete incentive to stay active and accurate. This dashboard is also the foundation for promotional features (Epic 8), where these same metrics become campaign performance indicators.

**Acceptance Criteria:**

**Given** a verified station owner opens the Performance section of the partner portal
**When** they view it
**Then** they see the following metrics for their station, filterable by last 7 days / 30 days / 90 days:
- **Map views:** how many times the station marker appeared in a driver's active map view
- **Detail opens:** how many times a driver tapped to view the station's price detail screen
- **Price contributions received:** count of community photo submissions accepted for this station in the period
- **Price freshness status:** current freshness label per fuel type (fresh / stale) — not a historical metric, just current state

**Given** the owner views any metric
**When** they inspect it
**Then** counts are shown as absolute numbers — no comparison to other stations is displayed

**Given** the station has been claimed for fewer than 7 days
**When** the owner opens Performance
**Then** a message explains that data is accumulating and full metrics will be visible once the station has been active for at least 7 days

**Given** the owner views the portal in their selected language
**When** it is Polish, English, or Ukrainian
**Then** all labels and date formats are displayed in that language

*Covers: FR36. Depends on Story 7.1 / 7.2 for STATION_MANAGER role.*

---

### Story 7.5: Owner Price Integrity Monitoring

As an **ops admin**,
I want automated monitoring that flags when a verified station owner's submitted price is contradicted by community submissions,
So that bad-faith price manipulation is caught and reviewed without adding friction to honest owners.

**Why:** A station owner could game the platform by posting an artificially low price to attract map clicks, then not honouring it at the pump. The 2% threshold is deliberately tight — 2% is already substantial in a market where single-grosz differences drive driver decisions — while staying above noise from rounding. Implicit detection avoids a driver-flagging loop that could generate false positives or be gamed. Community submissions remain the ground truth; owner prices are never auto-rolled back without human review.

**Acceptance Criteria:**

**Given** a verified owner submits a price for a fuel type
**When** ≥2 community photo submissions for that fuel type at the same station arrive within 24 hours
**And** those community submissions report a price ≥2% higher than the owner-submitted price
**Then** an integrity alert is created in the ops admin panel, showing: station name, fuel type, owner-submitted price, community median price, % deviation, count of contradicting submissions, and timestamp

**Given** an integrity alert is created
**When** an ops admin views it
**Then** the owner-submitted price remains live — there is no automatic rollback
**And** the admin can choose one of three actions: (a) dismiss as noise, (b) replace the owner price with the community median, or (c) escalate to shadow-ban review of the owner account

**Given** an owner account has ≥3 integrity alerts confirmed as abuse (not dismissed) within any rolling 30-day window
**When** the admin panel tallies the record
**Then** the owner is automatically flagged for escalated review
**And** subsequent price updates from that owner are held in a pending queue — not published immediately — until approved by ops

**Given** an integrity alert has been open and unreviewed for 48 hours
**When** the deadline passes
**Then** an automated reminder is sent to the ops team

**Given** an owner submits a price that is ≥2% lower than the current community median for that fuel type in their voivodeship
**When** it is their first such submission (no open integrity alerts on the account)
**Then** no alert is created — price drops below market are welcomed as competitive behaviour
**And** the system continues to monitor for contradicting community submissions as normal

**Given** ops takes any action on an integrity alert (dismiss / replace / escalate)
**When** the action is saved
**Then** the action is logged with admin user ID and timestamp — available in the audit trail alongside owner submission logs (Story 7.3)

*Covers: New fraud protection requirement introduced during Epic 7 story creation. Complements FR43 (auto shadow-ban), FR44 (medium-confidence ops review), FR45 (manual ban lift). Depends on Story 7.3 for owner price submission and logging.*

---

### Story 7.6: Chain Registration & Station Grouping

As a **developer and chain manager**,
I want fuel station chains to be automatically grouped from import data and chain managers to be able to manage their station list,
So that a chain manager can administer deals and promotions across all their stations without claiming each one individually.

**Why:** Poland's major chains — ORLEN (~1,800 stations), Circle K, BP, Shell, MOL — account for the majority of fuel stations in the dataset. Making them claim each station individually would kill chain adoption before it starts. OSM brand tags already encode this grouping; the auto-assignment at import simply makes it explicit in our data model. Giving chain managers the ability to add and remove stations ensures the list stays accurate as the network opens new sites or loses franchisees, without ops involvement in routine maintenance.

**Acceptance Criteria:**

**Given** the station import job runs (initial seed or incremental update)
**When** a station node has a `brand` tag
**Then** a `Chain` record is created for that brand if one does not already exist
**And** the station's `chain_id` is set to that chain

**Given** a station node has no `brand` tag but has an `operator` tag
**When** the import job runs
**Then** the operator value is normalised via a lookup table (e.g. "PKN Orlen" → "ORLEN", "BP Europa SE Oddział w Polsce" → "BP")
**And** if a matching chain exists after normalisation, the station is assigned to it
**And** if no match is found, `chain_id` remains null — the station is treated as standalone

**Given** a station belongs to a chain
**When** it is later re-imported with a different or absent brand tag
**Then** its chain assignment is not automatically changed — chain assignments are only modified by a chain manager or ops

**Given** a user registers for a partner account and selects "I manage a chain"
**When** they complete registration
**Then** they provide their company NIP and chain name
**And** the account is created with status `pending_chain_verification`
**And** ops is notified to verify the NIP against the CEIDG/KRS public registry

**Given** ops verifies the NIP and approves the chain account
**When** approval is saved
**Then** the user is granted `CHAIN_MANAGER` role
**And** all stations in the database whose `chain_id` matches their chain are linked to their account
**And** the chain manager receives an email: "Your chain account is verified. You now have access to [N] stations."

**Given** a chain manager opens their station list in the partner portal
**When** they view it
**Then** they see all stations currently assigned to their chain, with name, address, and current verification status

**Given** a chain manager wants to remove a station from their chain
**When** they initiate removal
**Then** the station's `chain_id` is set to null and the action is written to the audit log
**And** if that station has an active deal campaign, the deal is not automatically cancelled — it continues until expiry or manual cancellation

**Given** a chain manager wants to add a station to their chain
**When** they search for and select an unassigned station
**Then** the station's `chain_id` is set to their chain and the action is written to the audit log
**And** if the station is already assigned to another chain, the action is blocked — a station can belong to at most one chain at a time

**Given** a chain manager adds or removes a station
**When** the action is completed
**Then** it is logged: chain manager user ID, station ID, action type (add/remove), timestamp — accessible to ops via the audit log

*Covers: New data model requirement to support chain-level deal advertising (Story 8.5) and future chain-level promotions. Depends on Story 7.1 / 7.2 for the partner portal and STATION_MANAGER role. Note: OSM brand tag coverage for Polish stations is ~73%; remaining ~23% of untagged stations default to standalone and are not auto-assigned.*

---

## Epic 8: Station Promotions & Advertising *(Phase 2/3)*

Station owners and chain managers reach price-conscious drivers through two products: promoted placement (enhanced map visibility, Phase 2) and deal advertising (structured text offers in station sheet, Phase 2). Station Picker (algorithm-driven top-2 recommendations, Phase 3) extends this foundation — to be planned as its own epic when Phase 3 begins.

**FRs covered:** FR37, FR38, FR39, FR68, FR69, FR70, FR71
**Phase:** 2 (Stories 8.1–8.7); Phase 3 (Station Picker — future epic)

### Story 8.1: Promotional Placement Purchase

As a **verified station owner**,
I want to purchase a promotional boost for my station directly in the partner portal,
So that my station is more visible to nearby drivers without needing to negotiate with a sales team.

**Why:** Self-serve ad buying removes the biggest friction in monetisation — no sales calls, no minimums, no waiting. The visual boost (enhanced pin, richer list card) buys attention; the price gate ensures that attention is deserved. Auto-pause/resume means owners never lose campaign days unfairly — the campaign works when their prices are competitive and sleeps when they're not, with no manual intervention required. The 90-day hard expiry prevents abandoned campaigns from sitting dormant indefinitely.

**Acceptance Criteria:**

**Given** a verified station owner (STATION_MANAGER role) opens the Promotions section of the partner portal
**When** they view it
**Then** they see a clear entry point to create a new promotional campaign, with any current or past campaigns listed

**Given** an owner starts creating a campaign
**When** they go through the purchase flow
**Then** they select a duration: 1 active day or 7 active days
**And** the cost is shown in PLN before payment (fixed rate per active day)
**And** they are shown a clear notice: "Your promotion runs only while your prices are at or below the area median. If your prices rise above median, the campaign auto-pauses and no active days are consumed. All purchased days must be used within 90 days of purchase or they are forfeited."

**Given** an owner's current prices exceed the voivodeship median for all promoted fuel types at the time of purchase
**When** they attempt to activate a campaign
**Then** purchase is blocked with a message explaining the price gate and showing their current price vs. area median

**Given** an owner's prices are at or below the voivodeship median for at least one promoted fuel type
**When** they confirm and pay (by card via Stripe or pre-paid credit balance)
**Then** the campaign is activated immediately and the station receives enhanced promoted treatment in the app

**Given** payment fails
**When** the owner is shown the result
**Then** the campaign is not created — they are returned to the purchase step with a clear error

**Given** an active campaign is running
**When** the system's daily price check detects the owner has raised their prices above the voivodeship median
**Then** the campaign is automatically paused — enhanced treatment is removed from the map
**And** the owner receives a push notification and email: "Your promotion has been paused because your prices are now above the area median. Drop your prices to resume automatically."
**And** no active day is consumed on paused days

**Given** a campaign is auto-paused
**When** the owner updates their prices back to at or below the voivodeship median
**Then** the campaign automatically resumes — enhanced treatment is restored
**And** the owner receives a push notification: "Your prices are competitive again — your promotion has resumed."

**Given** a campaign has been running (active + paused days combined) for 90 days since purchase
**When** the 90-day hard expiry is reached
**Then** the campaign ends regardless of remaining unconsumed active days
**And** forfeited days are not refunded or credited
**And** the owner is notified 7 days before expiry if they have remaining active days unused

**Given** all purchased active days have been consumed before the 90-day expiry
**When** the last active day is used
**Then** the campaign ends, enhanced treatment is removed, and the campaign moves to history

*Covers: FR37. Depends on Story 7.1 / 7.2 for STATION_MANAGER role. Story 8.3 handles campaign performance view; Story 8.4 handles billing portal.*

---

### Story 8.2: Promoted Station Display

As a **driver**,
I want promoted stations to stand out visually on the map while remaining clearly marked as sponsored,
So that I notice active, price-competitive stations without feeling misled about organic rankings.

**Why:** The visual boost is the product the owner is paying for — a larger, more attractive pin gets noticed first. But trust is the platform's most valuable asset: drivers who discover that a prominent pin led them to an overpriced station will distrust the whole map. Clear "Sponsored" labelling, combined with the price gate in Story 8.1, means the boost always directs drivers toward genuinely competitive options. Map rank order is never altered — promoted stations earn attention, not a false position.

**Acceptance Criteria:**

**Given** a driver views the map
**When** one or more nearby stations have an active promotion
**Then** those station markers are visually enhanced: larger pin, station logo displayed (vs. generic icon for organic stations), and a subtle "Sponsored" label visible on the pin itself
**And** the enhanced treatment is consistent across map view and list view

**Given** a driver views the list of nearby stations
**When** a promoted station appears in the list
**Then** its list card is richer than organic cards: station logo, current prices, freshness status, and "Sponsored" label all visible without tapping

**Given** a driver taps a promoted station to view its detail screen
**When** they arrive
**Then** a "Sponsored" label is shown prominently near the station name — not in fine print

**Given** a driver views the map
**When** promoted stations are present
**Then** the map rank order (by distance or price, per driver's sort setting) is not affected by promotion status — promoted stations appear where they would organically, just with enhanced treatment

**Given** a promoted station's campaign auto-pauses (prices exceeded median) or expires
**When** the driver next loads or refreshes the map
**Then** the station reverts immediately to its standard organic appearance

**Given** a promoted station owner has enabled price-drop push notifications (Story 8.1 optional add-on)
**When** the owner updates their price to a lower value during an active campaign
**Then** nearby drivers within the station's normal map radius receive a push notification: "[Station name] just dropped their [fuel type] price — [new price] PLN/L"
**And** the notification is only sent if the campaign is currently active (not paused)

**Given** the driver's language is Polish, English, or Ukrainian
**When** any promoted label or notification is rendered
**Then** it is displayed in the driver's selected language

*Covers: FR39. Depends on Story 8.1 for campaign activation and auto-pause state.*

---

### Story 8.3: Campaign Performance Dashboard

As a **verified station owner**,
I want to see how my promotional campaign is performing and manage it,
So that I can evaluate whether the boost is delivering value and decide whether to buy again.

**Why:** Without visibility into what a promotion actually does, renewal is a leap of faith. Impressions and CTR close the loop — owners who see their station getting more detail opens during active days will renew. The dashboard also makes the auto-pause mechanic transparent: owners can see exactly which days were active vs. paused and why, so the model feels fair rather than opaque.

**Acceptance Criteria:**

**Given** a verified station owner opens the Promotions section
**When** they view an active campaign
**Then** they see: active days remaining, days until 90-day hard expiry, current status (active / paused — with reason if paused), and the following metrics updated daily:
- **Impressions:** times the station appeared as a promoted pin in a driver's map view
- **Detail opens:** taps on the station's detail screen during active campaign days
- **Click-through rate:** detail opens ÷ impressions
- **Active days consumed vs. total purchased**
- **Paused days:** total days the campaign spent paused due to price gate, shown separately so owners understand the mechanic

**Given** an owner views a completed or expired campaign in their history
**When** they open its detail
**Then** they see the same metrics as above, frozen at final values, with a clear indication of whether it ended naturally (days consumed), expired (90-day limit), or was cancelled

**Given** an owner wants to cancel an active campaign
**When** they initiate cancellation
**Then** they are shown how many unconsumed active days will be forfeited (no credit, no refund — consistent with the terms shown at purchase)
**And** they must confirm before the campaign is cancelled
**And** on confirmation the promoted treatment is removed immediately

**Given** an owner's campaign is auto-paused
**When** they view the dashboard
**Then** they see a clear banner: "Campaign paused — your prices are above the area median. Update your prices to resume automatically."
**And** the current price vs. median is shown so the owner knows exactly how far they are from resuming

**Given** an owner's campaign resumes automatically after a price drop
**When** they view the dashboard
**Then** the status updates to "Active" and the banner is gone — no manual action required

**Given** the owner views the dashboard in their selected language
**When** it is Polish, English, or Ukrainian
**Then** all labels, dates, and number formats are displayed in that language

*Covers: FR38. Depends on Story 8.1 for campaign lifecycle (auto-pause/resume, expiry) and Story 8.2 for promoted display.*

---

### Story 8.4: Billing Portal

As a **verified station owner**,
I want a self-serve billing portal where I can manage my payment method, view invoices, and top up my pre-paid balance,
So that I can handle all financial administration without contacting support.

**Why:** Every friction point in billing is a reason to cancel. A clean self-serve portal — add card, download invoice, top up — removes the most common support requests and makes the station owner feel in control. Billing profile is mandatory before first purchase — an owner who buys a campaign and then can't get a proper VAT invoice will blame the platform. Supporting both individual and company profiles ensures chains (ORLEN, BP, Circle K) and independents alike get compliant invoices.

**Acceptance Criteria:**

**Given** a verified station owner attempts to make their first campaign purchase (Story 8.1)
**When** they have not yet completed their billing profile
**Then** they are redirected to complete their billing profile before payment proceeds
**And** purchase is blocked until the profile is saved

**Given** an owner completes their billing profile
**When** they select their billing type
**Then** they choose between: **Individual** (name, address, optional personal NIP) or **Company** (company name, registered address, NIP — required for company type)
**And** the profile is saved and used for all future invoices

**Given** an owner opens the Billing section
**When** they view it
**Then** they see: billing profile summary (with an edit option), current pre-paid credit balance (PLN), saved payment method (last 4 digits + expiry, or "none"), and a list of past transactions in reverse chronological order

**Given** an owner wants to add or replace their payment method
**When** they initiate the change
**Then** they are taken through a Stripe card entry form
**And** on success the new card is saved and shown as the active payment method

**Given** an owner wants to top up their pre-paid credit balance
**When** they initiate a top-up
**Then** they select a top-up amount (predefined options: 50 PLN / 100 PLN / 200 PLN / custom amount ≥50 PLN)
**And** the charge is applied immediately to their saved payment method
**And** the credit balance is updated in real time

**Given** a transaction has been processed (campaign purchase or top-up)
**When** the owner requests an invoice for that transaction
**Then** a VAT-compliant PDF invoice is generated and available to download — populated with their saved billing profile details and the platform's billing details

**Given** an owner views the Billing section in their selected language
**When** it is Polish, English, or Ukrainian
**Then** all labels, amounts, and date formats are displayed in that language
**And** amounts are always shown in PLN

*Covers: FR37 (payment), FR38 (billing management). Depends on Story 8.1 for campaign purchase flow. Billing profile completion is a hard prerequisite for first purchase.*

---

### Story 8.5: Deal Creation & Submission

As a **verified station owner or chain manager**,
I want to create a time-limited promotional deal offer for my station(s) with a verifiable proof URL,
So that drivers see accurate, current special offers before deciding to fill up.

**Why:** A deal that has no end date or no verifiable source is a liability — stale or unverifiable claims erode driver trust faster than no deals at all. Requiring a URL forces owners to have a real, linkable source (website, campaign page, social post), which makes moderation fast and gives drivers a way to verify independently. Chain managers creating one deal across all their stations dramatically reduces admin burden vs. creating it station by station — this is what makes deal advertising viable for large chains at all.

**Acceptance Criteria:**

**Given** a verified station owner or chain manager opens the Deals section of the partner portal
**When** they create a new deal
**Then** they fill in:
- **Offer text** (max 150 characters, e.g. "20 gr/L off with our loyalty card")
- **Proof URL** (required — must be a syntactically valid URL; ops will verify it links to a real page confirming the offer)
- **Start date** — date picker, or a checkbox "Start immediately" (goes live as soon as ops approves)
- **End date** — required; must be after start date; must not be more than 1 year in the future

**Given** a chain manager creates a deal
**When** they configure it
**Then** they additionally select a scope: "This station only" / "All my stations" / "Select stations" (multi-select from their station list)

**Given** an owner or chain manager submits the deal
**When** submission is confirmed
**Then** the deal is created with status `pending_review` and ops is notified
**And** the submitter sees: "Your deal has been submitted for review. Once approved, it will go live [immediately / on {start date}]."

**Given** a deal has `start immediately` selected
**When** ops approves it
**Then** it goes live on all targeted stations as soon as approval is saved — no further action needed

**Given** a deal has a future start date
**When** ops approves it before the start date
**Then** it is queued and goes live automatically on the start date

**Given** a deal is still in `pending_review` status
**When** the owner or chain manager withdraws it
**Then** the deal is cancelled and removed from the moderation queue — no ops action needed

**Given** a station already has 3 active approved deals
**When** an owner attempts to create a new deal for that station
**Then** the submission is blocked with a message: "This station already has 3 active deals. A new deal can be added once one expires or is removed."

*Covers: FR68, FR69. Depends on Story 7.1 / 7.2 for STATION_MANAGER role and Story 7.6 for CHAIN_MANAGER role and station grouping. Billing for deal advertising reuses Story 8.4's billing portal.*

---

### Story 8.6: Deal Moderation

As an **ops admin**,
I want to review submitted deals before they go live and manage active deals,
So that false, misleading, or expired promotional claims never reach drivers.

**Why:** Unlike promoted placement (which is purely a visibility boost with an automated price gate), deal advertising makes a specific factual claim — "20 gr/L off with our card" — that could be false or outdated. A human review step before going live catches bad-faith submissions and protects driver trust. The ops surface needs to make verification fast: one click to open the proof URL, approve or reject with a reason. Auto-expiry on end date keeps the queue clean without ops having to manually retire deals.

**Acceptance Criteria:**

**Given** an ops admin opens the Deals section of the admin panel
**When** they view it
**Then** they see a paginated queue of deals with status `pending_review`, sorted oldest first
**And** each row shows: station name(s), offer text, proof URL (clickable, opens in new tab), start date, end date, submitter account name, submission timestamp

**Given** an ops admin reviews a deal
**When** they click Approve
**Then** the deal status is set to `approved`
**And** it goes live on its targeted stations per the start date logic in Story 8.5
**And** the submitter receives an email notification

**Given** an ops admin reviews a deal
**When** they click Reject and enter a reason
**Then** the deal status is set to `rejected` and it is removed from the review queue
**And** the submitter receives an email with the rejection reason so they can correct and resubmit

**Given** an active deal's end date has passed
**When** the daily expiry job runs
**Then** the deal status is set to `expired` and it is removed from all station sheets immediately
**And** no ops action is required

**Given** an ops admin identifies an active deal that is no longer valid (e.g. the owner has ended the promotion early)
**When** they expire it manually
**Then** the deal status is set to `expired` and it is removed from station sheets immediately
**And** the action is written to the audit log

**Given** any moderation action (approve, reject, manual expire)
**When** it is saved
**Then** it is logged: admin user ID, action, reason (if reject), deal ID, timestamp

*Covers: FR70, FR71. Depends on Story 8.5 for deal creation and status model.*

---

### Story 8.7: Deal Display in Station Sheet

As a **driver**,
I want to see active promotional deals on a station's detail screen,
So that I know about special offers before deciding to fill up there.

**Why:** A deal that's live but invisible to drivers delivers zero value to the station owner — and zero incentive to buy again. The station sheet is the right place: it's where the driver has already shown intent by tapping the station. The proof URL shown as "See full terms" gives drivers a way to verify independently, which is essential for building trust in deal claims. Limiting to 3 active deals prevents the section from overwhelming the price information that is still the primary reason drivers open the sheet.

**Acceptance Criteria:**

**Given** a driver taps a station and opens its detail screen
**When** that station has one or more active approved deals (within start–end date window)
**Then** a "Current offers" section is shown below the fuel price list
**And** each deal shows: offer text, "Valid until [end date formatted as e.g. 31 Mar 2026]", and a "See full terms →" link that opens the proof URL in the device browser

**Given** a station has more than 3 active deals
**When** the station sheet is displayed
**Then** only the 3 deals with the nearest end dates are shown — the driver never sees more than 3

**Given** a station has no active deals
**When** the station sheet is displayed
**Then** the "Current offers" section is omitted entirely — no empty state, no placeholder text

**Given** a deal's end date passes while the station sheet is open
**When** the driver next loads or refreshes the sheet
**Then** the expired deal is no longer shown

**Given** a driver views a deal
**When** their selected language is Polish, English, or Ukrainian
**Then** all labels, the "Valid until" date format, and the "See full terms" link text are displayed in that language

*Covers: FR68 (display surface). Depends on Story 8.6 for approved deal status and Story 2.5 for the station detail screen.*

---

## Epic 10: Data Licensing & Public Portal *(Phase 2)*

Public users browse a live fuel price map, station pages, and regional analytics on the web. External data buyers self-serve a licensing tier, pay, and receive API access to anonymised aggregate datasets.

**FRs covered:** FR51, FR52
**Phase:** 2

### Story 10.1: Public Fuel Price Web Portal

As a **public user**,
I want to browse live fuel prices, station details, and regional price trends on the web without installing an app,
So that I can check prices and discover the platform before deciding to download the app.

**Why:** Every Polish driver googling "ceny paliwa Warszawa" or "najtańsza stacja Mokotów" is a potential user. Individual SEO-optimised station pages and voivodeship pages capture that search intent at zero acquisition cost. The web portal delivers the full price-discovery value of the app in a browser — with a persistent, contextual nudge to install the app for real-time alerts and contributions. The data and map infrastructure are already built in Epic 2; this is a new rendering surface on top of it.

**Acceptance Criteria:**

**Given** a public user visits the web portal
**When** they land on the homepage
**Then** they see a live map of Polish fuel stations coloured by relative price (same colour-coding logic as the mobile app), with a search bar for city, postcode, or station name
**And** the page is server-side rendered for fast initial load and full crawlability by search engines

**Given** a user searches for a location or browses the map
**When** they find stations near them
**Then** they can see current prices, freshness indicators, and verified vs. estimated labels — the same data as in the app

**Given** a user clicks on a station marker or search result
**When** they arrive on the station detail page
**Then** the page shows: station name, address, current prices per fuel type with freshness status, price history chart (last 30 days), and number of community submissions
**And** the page URL is unique and SEO-friendly (e.g. `/stacja/pkn-orlen-warszawa-mokotow`)
**And** the page title and meta description are dynamically generated with station name, city, and current prices

**Given** a user views a station detail page
**When** they see the page
**Then** a prominent but non-intrusive banner is shown: "Seen a price that's wrong? Update it with the desert app" with App Store and Google Play links

**Given** a public user visits a regional overview page (e.g. `/region/mazowieckie`)
**When** they view it
**Then** they see: average prices per fuel type for that voivodeship over time (30-day trend chart), comparison to national average, and a list of the currently cheapest stations in the region
**And** the page is SEO-optimised with region-specific title and meta description

**Given** a public user visits any page
**When** the page loads
**Then** structured data (JSON-LD) is present for station pages to enable rich results in Google Search (address, price data, opening hours if available)

**Given** the portal is accessed
**When** any page is rendered
**Then** no account or login is required — all data is publicly visible

*Covers: FR51. Depends on Epic 2 for station data and price infrastructure. Web portal shares the Next.js web app already scaffolded in Epic 1.*

---

### Story 10.2: Data Buyer Onboarding & Licensing

As an **external data buyer**,
I want to browse available datasets, select a licensing tier, and pay — all without involving a sales team,
So that I can access the data I need quickly and with minimal friction.

**Why:** The first data licensing deals are the hardest — proving the data exists, demonstrating its quality, and getting a buyer to commit. Self-serve onboarding removes the bottleneck of sales calls for buyers who already know what they want. Manual API key provisioning at this stage is fine; the team needs to review each new buyer for compliance and intended use anyway. Automating key delivery comes later, once buyer volume makes manual review a bottleneck.

**Acceptance Criteria:**

**Given** an external buyer visits the data licensing section of the web portal
**When** they view it
**Then** they see available dataset tiers with clear descriptions, included datasets, update frequency, and pricing in PLN/month

**Given** a buyer selects a tier
**When** they proceed to sign up
**Then** they provide: company name, contact email, country, intended use case (free text), and billing details (company name, address, VAT number if applicable)
**And** they pay via Stripe (card or bank transfer for larger amounts)

**Given** payment is successful
**When** the transaction is confirmed
**Then** the buyer sees a confirmation screen: "Your access is being set up — you'll receive your API key and documentation by email within 1 business day"
**And** the ops team receives an automated notification with the buyer's details and intended use case for review and manual key provisioning

**Given** the ops team reviews and approves a buyer
**When** they provision the API key
**Then** the buyer receives an email with their API key, a link to the API documentation, and a summary of their licensed datasets and rate limits

**Given** a buyer's subscription renews monthly
**When** the renewal date arrives
**Then** Stripe automatically charges the saved payment method
**And** the buyer receives an invoice by email

**Given** a buyer wants to cancel their subscription
**When** they initiate cancellation
**Then** they can do so from the billing portal — access continues until the end of the paid period, then the API key is deactivated

*Covers: FR52 (onboarding and billing). Depends on Story 10.3 for the API itself. Manual key provisioning by ops — automation added in a future iteration when buyer volume justifies it.*

---

### Story 10.3: Fuel Price Data API

As an **external data buyer**,
I want API access to anonymised aggregate fuel price data by region and fuel type,
So that I can integrate desert's live price dataset into my own products and analytics.

**Why:** Fuel price data is available from day one — no dependency on Epic 5 adoption. Buyers include navigation apps (live prices for routing), logistics operators (regional price forecasting), financial analysts (market intelligence), and government regulators (price monitoring). This is the platform's first data revenue stream and the foundation of the licensing business. The anonymisation floor (minimum 5 submissions per data point) protects individual privacy and satisfies GDPR requirements on aggregate data.

**Acceptance Criteria:**

**Given** a buyer makes an API request
**When** they include their API key in the Authorization header
**Then** the request is authenticated and their tier's rate limits apply
**And** requests without a valid key return 401

**Given** a buyer queries the prices endpoint
**When** they request data
**Then** they can filter by: region (voivodeship), fuel type (PB95, PB98, ON, LPG), and time range (up to 12 months of history)
**And** the response includes: median price, min price, max price, sample size (submission count), and data timestamp — aggregated only, never individual submissions

**Given** a buyer queries the regional trends endpoint
**When** they request data
**Then** they receive daily price aggregates per voivodeship × fuel type for the requested period
**And** no data point is returned for any region × fuel type × day combination with fewer than 5 submissions — preventing de-anonymisation of sparse data

**Given** a buyer exceeds their tier's rate limit
**When** they make a request over the limit
**Then** the API returns 429 with a Retry-After header indicating when the limit resets

**Given** any endpoint is called
**When** a response is generated
**Then** all responses are JSON, all endpoints are versioned (`/v1/`), and a public documentation page covers all endpoints, parameters, response schemas, and tier rate limits

*Covers: FR52 (fuel price dataset). Depends on Story 10.2 for API key provisioning. Available at Phase 2 launch — no Epic 5 dependency.*

---

### Story 10.4: Vehicle Consumption Data API

As an **external data buyer**,
I want API access to anonymised real-world vehicle consumption benchmarks,
So that I can enrich my own products with independent, community-validated l/100km data by make, model, and region.

**Why:** No one else has real-world fuel consumption data at this scale and granularity — independent of manufacturer claims, covering real Polish driving conditions, broken down by vehicle make/model/engine/region/season. This is a defensible, high-value dataset for car manufacturers (real-world vs. WLTP benchmarking), insurers (consumption-based risk models), government regulators (real-world emissions data), and consumer organisations. It commands a higher price point than fuel price data and is sold as a separate product with its own tier. Availability is gated on Epic 5 adoption — the endpoint exists from day one but responds clearly when data is not yet sufficient.

**Acceptance Criteria:**

**Given** a buyer queries the consumption endpoint
**When** they include a valid API key with a consumption-tier licence
**Then** they can filter by: vehicle make, model, engine variant, region (voivodeship), fuel type, and time period
**And** the response includes: median l/100km, sample size, region, and period — aggregated only, never individual driver data

**Given** a buyer queries the consumption endpoint
**When** the platform does not yet have sufficient Epic 5 data for the requested filter combination
**Then** the API returns a 503 with a clear message: "Consumption data for this combination is not yet available — dataset is accumulating"
**And** the buyer is not charged for requests that return 503

**Given** a buyer queries the consumption endpoint
**When** data exists but the sample size for a filter combination is fewer than 10 records
**Then** that combination is excluded from the response — anonymisation floor is higher for consumption data than for price data, given the sensitivity of linking vehicle type to behaviour

**Given** a buyer with a consumption licence views the documentation
**When** they access it
**Then** they see the consumption endpoints clearly separated from the fuel price endpoints — two distinct product sections in the docs

**Given** any response is generated
**When** it is returned
**Then** no driver identity, account ID, GPS trace, or submission metadata is present — only vehicle category aggregates

*Covers: FR52 (consumption dataset). Depends on Story 10.2 for API key provisioning and Epic 5 (pump meter + odometer data) for data availability. Sold as a separate licensing tier from Story 10.3's fuel price data.*

---
