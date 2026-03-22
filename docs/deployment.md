# Deployment Guide

## Overview

The `desert` monorepo deploys three apps:

| App | Platform | Trigger |
|---|---|---|
| `apps/api` | Railway | Push to `main` |
| `apps/web` | Vercel | Push to `main` |
| `apps/admin` | Vercel | Push to `main` |

CI/CD is handled by GitHub Actions (`.github/workflows/ci.yml`). The `deploy` job runs only after the `ci` job passes on `main`.

---

## Required GitHub Actions Secrets

Add these in: GitHub repo → Settings → Secrets and variables → Actions

| Secret | Description | Where to find |
|---|---|---|
| `RAILWAY_TOKEN` | Railway deploy token | Railway → Account Settings → Tokens |
| `VERCEL_TOKEN` | Vercel deploy token | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel team/org ID | Vercel → Team Settings → General → Team ID |
| `VERCEL_WEB_PROJECT_ID` | Vercel project ID for `apps/web` | Vercel → desert-web → Settings → General → Project ID |
| `VERCEL_ADMIN_PROJECT_ID` | Vercel project ID for `apps/admin` | Vercel → desert-admin → Settings → General → Project ID |
| `DATABASE_URL` | Neon PostgreSQL connection string | Neon dashboard → Connection string (include `?sslmode=require`) |
| `REDIS_URL` | Upstash Redis URL | Upstash → Redis database → Connection → `rediss://` URL |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Cloudflare dashboard → R2 |
| `R2_ACCESS_KEY_ID` | R2 API token access key | Cloudflare → R2 → Manage R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret | Cloudflare → R2 → Manage R2 API Tokens |
| `R2_BUCKET_NAME` | R2 bucket name | `desert-photos` |

---

## Infrastructure

### Railway (`apps/api`)

- **Build:** Dockerfile at `apps/api/Dockerfile` (build context: repo root)
- **Start:** `npx prisma migrate deploy && node dist/main.js`
- **Health check:** `GET /health` → `{ status: "ok", timestamp: "..." }`
- **Config:** `apps/api/railway.toml`

### Vercel (`apps/web`, `apps/admin`)

- **Config:** `apps/web/vercel.json`, `apps/admin/vercel.json`
- **Build:** Monorepo-aware — runs `pnpm install` from repo root, then filters by app
- **Node version:** 24.x

### Neon (PostgreSQL)

- Connection string format: `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`
- Prisma migrations run automatically on every API startup via `prisma migrate deploy`

### Upstash (Redis)

- Use the `rediss://` (TLS) URL from Upstash dashboard
- Used by BullMQ job queue (Story 1.3+)

### Cloudflare R2

- S3-compatible storage for fuel price photos
- Bucket: `desert-photos`
- API endpoint: `https://<account-id>.r2.cloudflarestorage.com`

---

## Local Development

Copy `apps/api/.env.example` to `apps/api/.env` and fill in values. Local defaults use PostgreSQL and Redis running via Docker Compose.
