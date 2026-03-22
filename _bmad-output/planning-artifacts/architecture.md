---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-templates']
inputDocuments: ['prd.md', 'poc-spec.md']
workflowType: 'architecture'
project_name: 'desert'
user_name: 'Mateusz'
date: '2026-03-19'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
67 FRs across 12 capability areas. MVP scope covers Price Discovery (FR1–7), Data Contribution (FR8–15), User Management (FR16–21), Data Integrity & Moderation (FR40–47), Platform & Data (FR49–50), and Analytics & Operational Monitoring (FR61, FR64–65, FR67). Remaining FRs are Phase 2–3.

**Non-Functional Requirements:**
- Performance: 3s map load, 2s photo confirmation, 5-min async pipeline
- Reliability: 99.5% uptime MVP, 99.9% aspirational
- Security: TLS 1.2+, data at rest encrypted, raw GPS anonymised immediately
- Scalability: 100–200K MAU target, horizontally scalable, no hard ceiling
- Compliance: GDPR from day one — non-negotiable

**Scale & Complexity:**
- Primary domain: Mobile-first + backend platform + B2B SaaS
- Complexity level: High
- Estimated architectural components: 8–10 distinct services/surfaces

### Technical Constraints & Dependencies

- **Stack locked (mobile):** React Native + TypeScript + Expo
- **OCR (price board):** Claude Haiku 4.5 — validated at 80%/100% on usable images, ~$12/mo at mid-case volume
- **OCR (pump meter / fill-up):** Claude Sonnet 4.6 — Haiku insufficient for pump displays (7-segment digit misreads, hallucinated prices). Sonnet validated 2026-03-21: dispensed fuel, price/litre, litres, total all correct. Cross-validation (total ÷ litres = price/litre) is a hard pipeline requirement. Odometer OCR: Haiku sufficient.
- **GPS-to-POI:** Google Places API, `type=gas_station`, `rankby=distance`, 100–200m radius — validated at 100% (≤100m noise), 87% (200m)
- **Maps hybrid:** Google Places (POI sync, periodic) + Mapbox/HERE (tile rendering, per-load)
- **Push:** Firebase Cloud Messaging
- **Auth:** Google + Apple social sign-in + email/password
- **GDPR jurisdiction:** Polish/EU — shapes data model and consent architecture throughout
- **Camera-only capture:** No gallery upload — enforced at app level for data integrity

### Cross-Cutting Concerns Identified

1. **Authentication & authorisation** — 5 actor types (driver, station manager, fleet manager, ops/admin, data buyer), multi-surface, needs role-based access designed in from day one
2. **GDPR compliance** — anonymisation pipeline, consent tracking per user/feature, right to erasure without breaking referential integrity
3. **Async job processing** — photo pipeline must be retryable, observable, with dead-letter handling; never silently drops
4. **Offline-first mobile sync** — photo queue persists locally, retries on reconnect, state always visible to user
5. **Caching strategy** — map tiles (Mapbox/HERE), price data, POI data (Google Places periodic sync)
6. **Observability** — OCR pipeline health, API cost tracking, contribution funnel metrics (FR61–67)
7. **Audit trail** — submission history, moderation actions, shadow ban log — retained even after user deletion
8. **Multi-tenancy (fleet)** — fleet accounts with sub-users (drivers), scoped permissions, subscription billing

---

## Starter Template & Stack Decisions

### Repository Structure

**Turborepo monorepo** — single repo, all surfaces share TypeScript, types, and tooling:

```
desert/
├── apps/
│   ├── mobile/        # React Native + Expo (existing constraint)
│   ├── api/           # NestJS 11 backend
│   ├── web/           # Next.js 16 — public-facing + driver web
│   └── admin/         # Next.js 16 — ops dashboard
├── packages/
│   ├── db/            # Prisma schema + generated client
│   ├── types/         # Shared TypeScript types
│   └── config/        # Shared ESLint, TSConfig, etc.
```

### Backend — NestJS 11

- TypeScript-first, modular, enterprise-grade
- Native BullMQ integration for async photo pipeline (retryable, observable, dead-letter)
- Decorator-based RBAC maps cleanly to 5 actor types
- Best AI code-gen support of any Node.js framework

### Web Surfaces — Next.js 16 (App Router)

- Public map/price viewer, driver registration, fleet dashboard, ops admin
- Server Components for SEO-critical pages
- Tailwind CSS + shadcn/ui

### Database — Neon PostgreSQL + Prisma ORM

- Serverless PostgreSQL, scale-to-zero, free tier: 0.5GB storage
- Prisma: TypeScript-first schema, migrations, generated client shared across monorepo
- GDPR right-to-erasure handled via soft-delete + anonymisation columns

### Queue & Cache — Upstash Redis + BullMQ

- Serverless Redis, free tier: 500K commands/month
- BullMQ: photo pipeline jobs with retry, backoff, dead-letter queue
- Price/POI cache layer (TTL-based invalidation)

### Photo Storage — Cloudflare R2

- 10GB free, **zero egress fees** (critical for map tile + photo serving)
- Auto-deletion after OCR processing: peak in-flight storage ~750MB–1.4GB regardless of scale
- R2 never approaches 10GB free tier ceiling with deletion-on-completion pattern

### Deployment

| Surface | Provider | Cost |
|---|---|---|
| API + workers | Railway | ~$5–10/month (0–5K MAU) |
| Web + admin | Vercel | Free (Hobby) |
| DB | Neon | Free tier → $19/month at scale |
| Redis | Upstash | Free tier → pay-per-use |
| Storage | Cloudflare R2 | Free (10GB) |

**Total MVP cost: ~$5–10/month at 0–5K MAU**

### Scaling Path (no ceiling)

| MAU | Monthly infra cost | Action |
|---|---|---|
| 0–5K | $5–10 | Railway free/hobby tier |
| 5K–100K | $50–300 | Railway scaled instances |
| 100K–500K | $500–2K | Migrate API to Railway containers or AWS ECS |
| 500K–10M | $2K–6K | Horizontal scaling, CDN, read replicas |
| 10M+ | $6K+ | Multi-region, dedicated infra |

No hard ceiling — every component (NestJS, Next.js, Postgres, Redis, R2) scales horizontally.

---

## Core Architectural Decisions

### Decision 3: Authentication & RBAC

**Decision:** SuperTokens (open source, Apache 2.0) for auth. Start on managed free tier, self-host when scale or cost warrants. NestJS Guards + decorator-based RBAC for route protection.

**Rationale:** Keycloak considered and rejected — enterprise IAM designed for internal SSO across corporate apps, not consumer mobile auth. Requires dedicated JVM server (~512MB–1GB RAM), no official React Native SDK, high ops burden. SuperTokens covers all our surfaces (NestJS, Next.js, React Native/Expo) with first-class SDKs, supports Google OAuth + Apple OAuth + email/password, and is free self-hosted forever.

**Actor surfaces:**

| Role | Surface |
|---|---|
| `DRIVER` | Mobile only (authenticated actions are camera-dependent) |
| `STATION_MANAGER` | Web |
| `FLEET_MANAGER` | Web dashboard |
| `ADMIN` | Admin panel |
| Public price map | Web — unauthenticated, SEO surface |

**Schema:**

```
User
├── supertokens_id (links to SuperTokens session — JWT verification)
├── role: DRIVER | STATION_MANAGER | FLEET_MANAGER | ADMIN | DATA_BUYER
└── fleet_id → Fleet (nullable — set for drivers and managers in a fleet)

Fleet
├── id, name
├── owner_id → User (FLEET_MANAGER)
└── subscription_status
```

**Enforcement:** Role stored in our DB (SuperTokens stores identity only). NestJS `AuthGuard` verifies JWT on every request, loads `User` record, attaches role. `RolesGuard` checks role against `@Roles()` decorator. Fleet scoping enforced at service layer — `FLEET_MANAGER` queries restricted to `driver.fleet_id = manager.fleet_id`.



### Decision 1: API Architecture Pattern

**Decision:** Modular monolith — single NestJS deployment, logically separated modules.

**Rationale:** Full microservices would triple operational complexity at current scale with no meaningful benefit. NestJS modules provide clean service boundaries that can be extracted to independent services later if needed. Workers (photo pipeline) run as a separate process from the same codebase, allowing independent scaling.

```
NestJS App
├── PhotoModule        → BullMQ workers for OCR pipeline
├── PriceModule        → price reads/writes, cache invalidation
├── UserModule         → auth, GDPR, consent
├── StationModule      → POI sync, Google Places integration
├── FleetModule        → fleet accounts, sub-users (Phase 2)
└── AdminModule        → ops dashboard API, monitoring
```

---

### Decision 2: Data Model — User Submissions & GDPR

**Decision:** Retain `user_id` (non-nullable) on all submissions permanently. Null PII fields on the `User` record upon deletion. GPS coordinates never persisted. Photos deleted after OCR.

**Rationale:** Two competing needs:

1. **Anti-abuse / moderation** — detecting coordinated price manipulation requires knowing which submissions came from the same account. Nulling `user_id` on deletion would destroy this capability.
2. **GDPR right to erasure** — users have the right to have their personal data removed.

**Reconciliation:** GDPR permits retention of data under **legitimate interest** when necessary for fraud prevention and platform integrity. The `user_id` FK is retained; the identity behind it is erased. Moderation can see "submissions from account #4821 (deleted)" and detect behavioural patterns without recovering the user's name or email.

**Schema:**

```
User
├── id (UUID — permanent, never deleted)
├── email              → NULL on deletion
├── display_name       → NULL on deletion
├── auth_provider_id   → NULL on deletion
├── trust_score        → retained (platform integrity)
├── shadow_banned      → retained (platform integrity)
└── deleted_at, deletion_reason

Submission
├── id
├── user_id → User (non-nullable FK, always preserved — legitimate interest)
├── station_id → Station
├── price_data (JSONB — fuel type + price per litre)
├── photo_r2_key (NULL after OCR processing, minutes after submission)
├── ocr_confidence_score
├── status (pending / verified / rejected / shadow_rejected)
└── created_at
```

**GPS handling:** coordinates used in-flight for POI matching only — never written to the database.

**Privacy policy disclosure required:** "Aggregated contribution records are retained for platform integrity purposes after account deletion. These records contain no personally identifiable information."

---

### Decision 4: OCR Pipeline & Contribution Flow

**Decision:** Fire-and-forget contribution UX. Mobile offline queue with silent retry. Server-side async pipeline with no user-facing status updates.

**User flow:**
```
Take photo → tap submit → "Thanks for contributing!" → done
```
The interaction ends at the thank-you screen. OCR success or failure is an internal concern — never surfaced to the user as an error.

**Mobile offline queue:**

- Photo + metadata (GPS, fuel type) written to local SQLite queue on submit — before any network call
- Upload attempted immediately in background
- If upload fails (no signal, poor wifi): retry periodically with exponential backoff, on reconnect
- UI shows a non-alarming pending indicator ("2 photos queued") — informational, not an error state
- Queue entry cleared silently on successful server receipt

**Server-side pipeline (fully async):**

```
API receives photo + GPS + fuel_type
  → upload photo to R2
  → INSERT Submission(station_id: NULL, status: pending)
  → enqueue BullMQ job
  → return 202

BullMQ worker:
  → GPS + Google Places → station_id
  → fetch photo from R2
  → Claude Haiku 4.5 → price extraction + confidence score
  → validate prices (plausibility range check)
  → UPDATE Submission(station_id, price_data, ocr_confidence_score, status: verified/rejected)
  → DELETE photo from R2 (always — even on rejected)
```

**GPS matching in worker (not at submission time):** Sync GPS match at submission time was considered and rejected. Matching failures are outliers (user standing at station, realistic GPS noise is 15–50m). Moving match to the worker keeps the submission endpoint simple and fast with no sync external API call in the hot path.

**Retry & failure strategy:**

| Failure type | Action |
|---|---|
| Transient (timeout, API error) | Retry ×3 with exponential backoff (30s, 2min, 10min) |
| Unreadable photo (confidence <40%) | Reject immediately, no retry |
| GPS match failure (no station within 200m) | Reject, no retry |
| Max retries exceeded | Dead letter queue → ops alert |

Photos deleted from R2 in all cases (verified, rejected, dead-letter). `photo_r2_key` nulled on Submission as part of the same DB update.

---

### Decision 6: API Surface Design

**Protocol: REST + OpenAPI.** Universal — works identically for mobile, web, admin, and third-party DATA_BUYER consumers. OpenAPI spec auto-generated from NestJS decorators. tRPC rejected: elegant for the TypeScript monorepo but incompatible with third-party consumers.

**Versioning: URL prefix `/v1/`.** Explicit, cacheable, works in every client. Applied from day one — DATA_BUYER actor requires version stability guarantees.

**No public price API.** The core data protection decision:

- **Web public map → SSR only.** Next.js Server Components fetch price data server-side. Browsers receive rendered HTML — no raw JSON endpoint is exposed. Full SEO indexing, anonymous price viewing, nothing to scrape via API.
- **Mobile → authentication required.** Users create accounts to use the app. Requiring auth for price lookups is natural — no friction, they sign in once.
- **Result:** prices are accessible only via the rendered web page or authenticated API calls. Casual scraping requires parsing SSR HTML or creating accounts and staying within rate limits.

**API surface:**

```
SSR only (no API endpoint — Next.js fetches internally):
  Public price map page

Authenticated API (all actors require valid session):
  POST   /v1/submissions          → DRIVER
  GET    /v1/prices/nearby        → any authenticated user
  GET    /v1/stations/:id         → any authenticated user
  GET/POST /v1/fleet/*            → FLEET_MANAGER
  GET/POST /v1/admin/*            → ADMIN
  GET    /v1/data/prices          → DATA_BUYER (explicit API key, paid, rate-limited per contract)
```

**Rate limiting:** Applied at NestJS layer via Redis (Upstash — already in stack). Per-IP for web, per-user-token for API. Backstop against abuse regardless of auth state.

---

### Decision 5: Caching Strategy

**Price data — Redis (Upstash), from day one:**

Redis is already in the stack for BullMQ — no additional infrastructure. Price data changes 1–2×/day per station but is read thousands of times. The read:write ratio justifies cache immediately.

- Read path: `Redis → PostgreSQL on miss`
- Write path: OCR worker updates DB + invalidates/writes Redis cache atomically on price verify
- TTL: 10 minutes as safety fallback (not primary freshness mechanism)
- Performance: Redis 0.1–1ms consistent vs PostgreSQL 1–10ms degrading under concurrent load

**Station data — PostgreSQL + PostGIS, synced weekly from Google Places:**

All ~8,000 Polish fuel stations stored in our DB. GPS matching in the OCR worker uses a local PostGIS spatial query — no Google Places API call per submission.

```sql
SELECT id, name FROM stations
WHERE ST_DWithin(location, ST_Point(:lng, :lat)::geography, 200)
ORDER BY location <-> ST_Point(:lng, :lat)::geography
LIMIT 1;
```

Sync: ~450 Google Places requests/week across a geographic grid → ~1,800/month → ~$58/month → covered entirely by Google's $200/month free credit. Effective cost: $0. International expansion increases this cost linearly but becomes negligible relative to revenue at that scale.

**Map tiles — no action required:**

Mapbox SDK caches tiles automatically on the client device. No server-side caching needed.

---

### Decision 4: OCR Pipeline & Contribution Flow

**No FCM for submission status.** Push notifications reserved for other features (price alerts, fleet notifications). Submission outcome is never communicated to the contributing user.

**Photo pre-processing before queue:** Regardless of device camera resolution, photos are resized and compressed client-side (via `expo-image-manipulator`) before entering the local queue. Target: 1920px max width, 75% JPEG quality → ~200–500KB per photo. Consistent upload size, lower OCR token cost, faster worker processing.

