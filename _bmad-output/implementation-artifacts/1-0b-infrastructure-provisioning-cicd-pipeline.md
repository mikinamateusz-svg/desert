# Story 1.0b: Infrastructure Provisioning & CI/CD Pipeline

Status: ready-for-dev

## Story

As a **developer**,
I want all production infrastructure provisioned and a CI/CD pipeline deploying to it,
So that every subsequent story ships to real users from day one with no deployment surprises.

## Prerequisites (Manual — before coding begins)

The following accounts must be created and credentials stored in a password manager before this story begins:

| Service | Purpose | URL | Notes |
|---|---|---|---|
| Railway | API hosting (`apps/api`) | railway.app | Connect GitHub repo |
| Vercel | Web + admin hosting | vercel.com | Connect GitHub repo, 2 projects |
| Neon | Managed PostgreSQL | neon.tech | Create `desert-prod` project, note connection string |
| Upstash | Managed Redis | upstash.com | Create Redis database, note `REDIS_URL` |
| Cloudflare R2 | Photo storage | cloudflare.com | Create bucket `desert-photos`, create API token |

## Acceptance Criteria

1. **Given** the infrastructure is provisioned (Railway, Vercel, Neon, Upstash, Cloudflare R2),
   **When** a commit is pushed to `main`,
   **Then** `apps/api` is deployed to Railway and `GET /health` returns HTTP 200 with `{ status: "ok", timestamp: "..." }`.

2. **Given** the infrastructure is provisioned,
   **When** a commit is pushed to `main`,
   **Then** `apps/web` is deployed to Vercel and its index page is reachable.

3. **Given** the infrastructure is provisioned,
   **When** a commit is pushed to `main`,
   **Then** `apps/admin` is deployed to Vercel and its index page is reachable.

4. **Given** the deployed API,
   **When** the API starts on Railway,
   **Then** Neon PostgreSQL is reachable and all Prisma migrations are applied automatically at startup.

5. **Given** the deployed API,
   **When** the API starts on Railway,
   **Then** Upstash Redis is reachable (connection test on startup).

6. **Given** the deployed API,
   **When** the API starts on Railway,
   **Then** Cloudflare R2 bucket is accessible (credentials valid).

7. **Given** a commit is pushed to `main`,
   **When** CI/CD runs (GitHub Actions),
   **Then** lint → type-check → build → test → deploy runs in order with no manual intervention.

8. **Given** a deployment fails,
   **When** the CI/CD pipeline detects the failure,
   **Then** the GitHub Actions job is marked as failed (visible in PR checks and commit status).

## Tasks / Subtasks

- [ ] **Task 1: Railway configuration for `apps/api`** (AC: 1, 4, 5, 6)
  - [ ] Create `apps/api/railway.toml` (see Dev Notes)
  - [ ] Add `apps/api/Dockerfile` for reproducible Railway builds (see Dev Notes)
  - [ ] Add `prisma migrate deploy` to API startup sequence (run before `node dist/main.js`)
  - [ ] Update `apps/api/src/main.ts` to log a startup connection test for Redis
  - [ ] Add `apps/api/.env.example` entries: `DATABASE_URL`, `REDIS_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `PORT=3001`

- [ ] **Task 2: Vercel configuration for `apps/web` and `apps/admin`** (AC: 2, 3)
  - [ ] Create `apps/web/vercel.json` (see Dev Notes)
  - [ ] Create `apps/admin/vercel.json` (see Dev Notes)
  - [ ] Verify `apps/web/next.config.ts` has no local-only settings that break Vercel build
  - [ ] Verify `apps/admin/next.config.ts` has no local-only settings that break Vercel build

- [ ] **Task 3: Extend GitHub Actions CI to add CD** (AC: 7, 8)
  - [ ] Update `.github/workflows/ci.yml` to add a `deploy` job that runs after CI passes on `main` (see Dev Notes)
  - [ ] Use Railway CLI action for API deployment
  - [ ] Use Vercel CLI action for web and admin deployment
  - [ ] Add GitHub Actions secrets documentation to `docs/deployment.md`

- [ ] **Task 4: Cloudflare R2 — add SDK + connection module to API** (AC: 6)
  - [ ] Add `@aws-sdk/client-s3` to `apps/api` (R2 is S3-compatible)
  - [ ] Create `apps/api/src/storage/storage.module.ts` with R2 client provider
  - [ ] Create `apps/api/src/storage/storage.service.ts` with `testConnection()` method
  - [ ] Register `StorageModule` in `AppModule` and call `testConnection()` on startup
  - [ ] Export `StorageService` for use in `PhotoModule` (Story 1.4+)

- [ ] **Task 5: Neon connection + Prisma migration on startup** (AC: 4)
  - [ ] Add `prisma migrate deploy` to Railway start command (runs migrations before app boots)
  - [ ] Ensure `packages/db/prisma.config.js` reads `DATABASE_URL` from environment (already correct — verify)
  - [ ] Test locally: `DATABASE_URL=<neon-url> pnpm --filter @desert/db exec prisma migrate deploy`

- [ ] **Task 6: Upstash Redis — add connection test to API** (AC: 5)
  - [ ] Add `ioredis` (or `@upstash/redis`) to `apps/api` dependencies
  - [ ] Create `apps/api/src/redis/redis.module.ts` with Redis client provider
  - [ ] Redis client reads `REDIS_URL` from env, logs connection status on startup
  - [ ] Register `RedisModule` in `AppModule`

- [ ] **Task 7: Add required GitHub Actions secrets** (AC: 7)
  - [ ] Document all required secrets in `docs/deployment.md`:
    - `RAILWAY_TOKEN` — Railway deploy token
    - `VERCEL_TOKEN` — Vercel deploy token
    - `VERCEL_ORG_ID` — Vercel org ID
    - `VERCEL_WEB_PROJECT_ID` — Vercel project ID for apps/web
    - `VERCEL_ADMIN_PROJECT_ID` — Vercel project ID for apps/admin
    - `DATABASE_URL` — Neon production connection string
    - `REDIS_URL` — Upstash Redis URL
    - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

- [ ] **Task 8: End-to-end deployment verification** (AC: 1–8)
  - [ ] Push to `main`, confirm CI/CD runs end-to-end
  - [ ] `curl https://<railway-url>/health` → `{ "status": "ok", "timestamp": "..." }`
  - [ ] Open Vercel preview URL for `apps/web` → placeholder renders
  - [ ] Open Vercel preview URL for `apps/admin` → placeholder renders
  - [ ] Check Railway logs for Prisma migration success
  - [ ] Check Railway logs for Redis + R2 connection success

## Dev Notes

### Railway Config (`apps/api/railway.toml`)

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/main.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Dockerfile for `apps/api`

Railway can auto-detect NestJS, but a Dockerfile gives reproducible builds in a pnpm monorepo context:

```dockerfile
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @desert/db exec prisma generate
RUN pnpm --filter @desert/api run build

# Runtime
FROM node:24-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

**Note:** The `CMD` runs `prisma migrate deploy` before starting the app. This is safe for production — `migrate deploy` is idempotent and only applies pending migrations.

**Alternative (simpler):** If Railway detects the build correctly without a Dockerfile, skip the Dockerfile and set in Railway dashboard:
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @desert/db exec prisma generate && pnpm --filter @desert/api run build`
- Start command: `cd apps/api && npx prisma migrate deploy && node dist/main.js`
- Root directory: `/` (repo root)

### Vercel Config (`apps/web/vercel.json`)

```json
{
  "framework": "nextjs",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "buildCommand": "cd ../.. && pnpm --filter @desert/web run build",
  "outputDirectory": ".next"
}
```

Same pattern for `apps/admin/vercel.json` with `@desert/admin`.

**Vercel monorepo setup (in Vercel dashboard):**
- Project 1 (desert-web): Root Directory = `apps/web`, Framework = Next.js
- Project 2 (desert-admin): Root Directory = `apps/admin`, Framework = Next.js
- Both projects: Node version = 24.x, pnpm enabled

### Updated CI/CD Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI/CD

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: pnpm build

      - name: Type check
        run: pnpm type-check

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

  deploy:
    needs: ci
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Deploy API to Railway
        uses: bervProject/railway-deploy@v1.3.0
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          service: desert-api

      - name: Deploy web to Vercel
        run: npx vercel --token ${{ secrets.VERCEL_TOKEN }} --prod --yes
        working-directory: apps/web
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_WEB_PROJECT_ID }}

      - name: Deploy admin to Vercel
        run: npx vercel --token ${{ secrets.VERCEL_TOKEN }} --prod --yes
        working-directory: apps/admin
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_ADMIN_PROJECT_ID }}
```

**Note on Railway deployment:** If `bervProject/railway-deploy` action isn't ideal, use Railway's CLI directly:
```yaml
- name: Deploy API to Railway
  run: |
    npm install -g @railway/cli
    railway deploy --service desert-api
  env:
    RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### StorageService (Cloudflare R2)

R2 is S3-compatible. Use `@aws-sdk/client-s3` with custom endpoint:

```ts
// apps/api/src/storage/storage.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const accountId = this.config.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = this.config.getOrThrow<string>('R2_BUCKET_NAME');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.getOrThrow('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      },
    });
    this.testConnection();
  }

  async testConnection() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log('R2 bucket connection OK');
    } catch (err) {
      this.logger.error('R2 bucket connection FAILED', err);
    }
  }
}
```

### RedisModule (Upstash / ioredis)

```ts
// apps/api/src/redis/redis.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.getOrThrow('REDIS_URL'), {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
        client.on('connect', () => console.log('Redis connected'));
        client.on('error', (err) => console.error('Redis error', err));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

**Alternative:** Use `@upstash/redis` for a serverless-optimized HTTP client (no persistent connection needed for Upstash):
```ts
import { Redis } from '@upstash/redis';
const redis = new Redis({ url: process.env.REDIS_URL, token: process.env.UPSTASH_TOKEN });
```
Upstash provides both a standard `REDIS_URL` (ioredis-compatible) and an HTTP endpoint. Use `ioredis` for compatibility with BullMQ (Story 1.3+ requires BullMQ which needs ioredis).

### API Startup Logging Pattern

Update `apps/api/src/main.ts` to clearly log all service statuses on startup:

```ts
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const port = process.env['PORT'] ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on port ${port}`);
}
```

The Redis and R2 connection logs come from `RedisModule` and `StorageService.onModuleInit()`.

### Environment Variables Reference

Full list of env vars for `apps/api`:

| Variable | Local (`.env`) | Production (Railway) | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://desert:desert@localhost:5432/desert_dev` | Neon connection string | Include `?sslmode=require` for Neon |
| `REDIS_URL` | `redis://localhost:6379` | Upstash Redis URL | `rediss://` (TLS) for Upstash |
| `R2_ACCOUNT_ID` | — | Cloudflare account ID | From R2 dashboard |
| `R2_ACCESS_KEY_ID` | — | R2 API token access key | |
| `R2_SECRET_ACCESS_KEY` | — | R2 API token secret | |
| `R2_BUCKET_NAME` | — | `desert-photos` | |
| `PORT` | `3001` | Set by Railway automatically | |
| `NODE_ENV` | `development` | `production` | |

### Previous Story Learnings (from 1.0a)

1. **pnpm + Expo** — `shamefully-hoist=true` in `.npmrc` required; don't remove it.
2. **API build** — Always `rimraf dist && tsc -p tsconfig.build.json`; never `nest build`.
3. **Prisma 7** — No `url` in `datasource db {}` in schema.prisma. URL is in `prisma.config.js`. `migrate deploy` reads from `PRISMA_CONFIG` or the config file.
4. **Jest moduleNameMapper** — `{ "^(\\.{1,2}/.*)\\.js$": "$1" }` is required for ts-jest to resolve `.js` imports.
5. **Next.js 16.2 lint** — Use `eslint . --max-warnings 0`, not `next lint`.
6. **Dockerfile context** — Build context must be repo root to access `packages/*` and `pnpm-lock.yaml`.

### Neon Connection String Format

Neon requires SSL. Connection string format:
```
postgresql://user:password@ep-xxx-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Add to `packages/db/prisma.config.js` — already reads from `process.env.DATABASE_URL`, no changes needed.

### What This Story Does NOT Include

- No SuperTokens auth (Story 1.2)
- No OCR/photo pipeline (Story 1.4)
- No monitoring/alerting beyond startup logs (post-MVP)
- No staging environment (can be added after MVP)
- No custom domains (can be added after MVP)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
