# Story 12.8: Staging Environment Setup

**Status:** ready-for-dev
**Epic:** 12 — App Store & Go-to-Market Launch Preparation
**Created:** 2026-04-18
**Trigger:** Before Phase 2 dev begins (consumption tracking, paid features, data licensing)

---

## User Story

As an **operator**,
I want a dedicated staging environment separate from production,
So that I can test database migrations, new features, and risky changes without breaking the live app or exposing real users to half-finished work.

**Why:** Currently `main` auto-deploys to production. Phase 2 introduces database migrations (fill-up tracking, consumption history, leaderboard), paid features (advertising, data licensing), and API integrations. A bad migration or untested change in prod could corrupt user data, trigger the OCR spend cap, or cost real money on paid APIs. Staging is cheap insurance — ~$5-10/month for an isolated environment where breaking things is safe.

---

## Branching Strategy

- **`main` branch** → auto-deploys to **staging** environment
- **`prod` branch** → auto-deploys to **production** environment
- Promotion: merge `main` → `prod` once features are stable and tested

Day-to-day dev on `main`. When ready to ship, PR `main` → `prod`.

---

## Acceptance Criteria

### AC1 — Staging Vercel project
**Given** the web app
**When** staging is set up
**Then** a second Vercel project exists that auto-deploys from the `main` branch
**And** the production Vercel project is reconfigured to auto-deploy from the `prod` branch
**And** staging is reachable at `staging.litro.pl` (or `litro-staging.vercel.app` if domain DNS is removed)

### AC2 — Staging Railway API service
**Given** the API backend
**When** staging is set up
**Then** a second Railway service exists with its own env vars, pointing to the staging database
**And** the production Railway service continues to serve `desert-production-ac37.up.railway.app`
**And** the staging API is reachable at a distinct URL (e.g. `desert-staging.up.railway.app`)

### AC3 — Staging database (Neon branch)
**Given** the production Neon database on `main` branch
**When** staging is set up
**Then** a Neon `staging` branch is created from `main` (free tier allows up to 10 branches)
**And** the staging Railway API uses the `staging` branch connection string
**And** migrations are applied to `staging` first, verified, then applied to `main`

### AC4 — Isolated Redis (Upstash)
**Given** the production Upstash Redis database
**When** staging is set up
**Then** a second Upstash database exists for staging (free tier allows multiple)
**And** the staging API uses the staging Redis URL
**And** BullMQ queues, price caches, and rate limits are fully isolated between envs

### AC5 — Google Places API protection
**Given** Google Places API charges per request and previously caused a 2,000+ PLN surprise bill
**When** staging is set up
**Then** staging must NOT have a Google Places API key configured
**And** staging station data is seeded via `pg_dump` from the production stations table (no live API calls)
**And** any station classification / sync background jobs are disabled in staging env
**And** an env variable guard `DISABLE_PLACES_API=true` is checked in `StationSyncWorker.onModuleInit()` — throws on startup if places key is configured alongside this flag

### AC6 — Separate secrets per environment
**Given** each environment needs distinct credentials
**When** staging is set up
**Then** the following env vars are distinct per environment:
- `DATABASE_URL` (staging Neon branch vs. prod main)
- `REDIS_URL` (staging Upstash vs. prod)
- `RESEND_API_KEY` — staging can share prod key but `FEEDBACK_EMAIL` should point to a `staging@` address or gmail filter to keep test submissions separate
- `EXPO_PUBLIC_API_URL` (staging vs. prod API URL)
- `MAPBOX_TOKEN` — can share prod token (free tier has plenty of headroom)
- `ANTHROPIC_API_KEY` — can share, but staging OCR spend cap should be set lower (e.g. $5/day)
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — can share, no cost
- `INTERNAL_API_URL` — points to staging or prod API accordingly

### AC7 — Cloudflare R2 isolation
**Given** photo submissions uploaded to R2
**When** staging is set up
**Then** a separate R2 bucket (`litro-staging-photos`) is created
**And** staging API uses `R2_BUCKET=litro-staging-photos`
**And** the 30-day cleanup worker runs against the staging bucket in the staging env

### AC8 — Deploy workflow updates
**Given** the existing `ci.yml` GitHub Actions workflow
**When** staging is set up
**Then** the workflow branches:
- `push` to `main` → deploy to staging (Vercel + Railway)
- `push` to `prod` → deploy to production (Vercel + Railway)
- PRs → no deploy (or Vercel preview only, no DB/API deploys)
**And** the Vercel deploy step uses different project IDs per branch (`VERCEL_WEB_PROJECT_ID` vs `VERCEL_WEB_STAGING_PROJECT_ID`)
**And** Railway deploys use different project tokens per environment

### AC9 — DB migration safety gate
**Given** Phase 2 introduces multiple Prisma migrations
**When** a migration is merged to `main`
**Then** CI runs the migration against the staging Neon branch automatically
**And** CI blocks promotion to `prod` if the migration fails on staging
**And** a manual verification step (smoke test the staging app) is documented before the `main` → `prod` merge

### AC10 — OCR spend cap per environment
**Given** the existing OCR spend cap from Story 3.5
**When** staging is set up
**Then** staging has its own independent Redis-backed spend counter (keyed by env name in the Redis key)
**And** staging cap is set to a low value (e.g. $5/day) via `OCR_DAILY_SPEND_CAP_USD=5`
**And** production cap remains at its current value

---

## Non-Goals

- **Separate mobile APK for staging.** Mobile apps point at one API URL per build. For staging mobile testing, rebuild with `EXPO_PUBLIC_API_URL=<staging>` as a one-off, or add a dev menu setting to switch API URLs (deferred).
- **Separate Apple Sign-In client.** Apple client IDs are shared across envs — OAuth redirects still work.
- **Analytics env split.** When Phase 2 analytics lands (Epic 4), PostHog/Mixpanel will need their own staging project, but that is part of the analytics story, not this one.
- **Blue/green deploys or canary releases.** Explicit two-branch promotion is sufficient for solo alpha/beta scale.

---

## Cost Estimate

| Service | Additional monthly cost |
|---------|-------------------------|
| Railway (second API service) | $5-10 |
| Neon (extra branch) | $0 (free tier) |
| Upstash (second Redis) | $0 (free tier) |
| Cloudflare R2 (second bucket) | $0 (under 10GB) |
| Vercel (second project) | $0 (Hobby) |
| Mapbox | $0 (shared token) |
| Anthropic | <$1 (staging OCR usage) |
| **Total** | **~$5-11/month** |

---

## Implementation Order

1. Create Neon `staging` branch (2 min)
2. Create staging Upstash Redis database (2 min)
3. Create staging R2 bucket (2 min)
4. Duplicate Railway API service, point to staging DB/Redis/R2, set `DISABLE_PLACES_API=true` (15 min)
5. Duplicate Vercel web project, set to build from `main` branch, point `INTERNAL_API_URL` to staging API (10 min)
6. Reconfigure existing Vercel prod project to build from `prod` branch (5 min)
7. Create `prod` branch in Git from current `main`, push (2 min)
8. Update `.github/workflows/ci.yml` to route deploys per branch (30 min)
9. Smoke test staging env end-to-end (15 min)
10. Document the promotion procedure in `CONTRIBUTING.md` or `README.md` (10 min)

**Total setup time:** ~90 minutes.

---

## Rollback Plan

If staging setup causes problems, rollback is trivial:
1. Keep deploying from `main` as today (don't switch prod to the `prod` branch)
2. Leave staging env running for manual testing, don't rely on it
3. No prod data is touched at any point in setup — production DB is unaffected
