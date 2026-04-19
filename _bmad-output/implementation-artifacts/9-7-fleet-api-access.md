# Story 9.7: Fleet API Access

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.7
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (Fleet model, apps/fleet scaffold), Story 9.3 (FleetAnalyticsService), Story 1.5 (JwtAuthGuard, RolesGuard, @Public() decorator), Story 1.0b (RedisModule, REDIS_CLIENT injection token)
- **Required by:** None

---

## User Story

**As a fleet manager,**
I want to generate API keys and use them to access my fleet's price data and analytics programmatically,
So that I can integrate Desert data into our existing TMS, ERP, or expense management system.

---

## Context & Why

Fleet managers operating at scale use Transport Management Systems (TMS) or ERP software (e.g. SAP, Dynamics) that need live fuel price data to calculate route costs and reconcile expenses. A REST API with API key authentication is the lowest-friction integration path — no OAuth dance, no frontend, just a key and an HTTP client.

Two data surfaces are exposed:
- **Price data** — station prices for a given fuel type and region. Useful for route cost estimation in TMS.
- **Fleet analytics** — the same dashboard data from Story 9.3. Useful for automated expense reports and cost centre allocations.

### API Key Design

API keys:
- Format: `dsk_` prefix + 64 hex chars (32 random bytes) — 68 chars total
- Stored as SHA-256 hash only — plaintext shown once at creation time
- `key_prefix` stores first 12 chars (`dsk_` + first 8 hex) for display
- Multiple keys per fleet (e.g. one per integration)
- Revocation via soft delete (`revoked_at`)

### Authentication Architecture

The global `JwtAuthGuard` (registered as `APP_GUARD`) protects all routes. External fleet API endpoints bypass it via `@Public()` and instead use `@UseGuards(ApiKeyGuard)` at the controller level. This is the standard NestJS pattern for mixed auth strategies.

**Rate limit:** 60 requests/minute per API key — enforced via Redis `INCR` + `EXPIRE` pattern. High enough for automated ERP polling; low enough to prevent abuse.

---

## Acceptance Criteria

**Given** a fleet manager is on the API Access page
**When** they enter a name and click "Create key"
**Then** the full key is shown once in a copyable modal
**And** only the key prefix (`dsk_a1b2c3...`) is shown in the key list thereafter

**Given** a fleet manager has created an API key
**When** an external system sends `Authorization: Bearer dsk_...` to `GET /v1/fleet-api/prices`
**Then** it receives a JSON array of stations with their latest verified prices for the requested fuel type and region

**Given** the same API key is used to call `GET /v1/fleet-api/analytics?period=30d`
**Then** it receives the fleet dashboard data (same as Story 9.3) scoped to the fleet that owns the key

**Given** an API key makes more than 60 requests within a 60-second window
**When** the 61st request arrives
**Then** the API returns HTTP 429 with body `{ "error": "Rate limit exceeded" }`

**Given** a fleet manager revokes an API key
**When** a request arrives using that key
**Then** the API returns HTTP 401

**Given** an invalid or absent key is sent
**When** any fleet API endpoint is called
**Then** the API returns HTTP 401

---

## New Prisma Model

```prisma
model FleetApiKey {
  id           String    @id @default(cuid())
  fleet_id     String
  fleet        Fleet     @relation(fields: [fleet_id], references: [id], onDelete: Cascade)
  name         String
  key_hash     String    @unique  // SHA-256(full key)
  key_prefix   String             // first 12 chars: 'dsk_' + first 8 hex chars
  last_used_at DateTime?
  revoked_at   DateTime?
  created_at   DateTime  @default(now())

  @@index([fleet_id])
}
```

**Add to `Fleet` model:**
```prisma
api_keys  FleetApiKey[]
```

**Migration name:** `add_fleet_api_key`

---

## ApiKeyGuard

**File:** `apps/api/src/fleet/api-key.guard.ts` (new)

```typescript
import {
  CanActivate, ExecutionContext, HttpException,
  Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const RATE_LIMIT_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer dsk_')) {
      throw new UnauthorizedException('API key required');
    }

    const key = authHeader.slice(7);  // strip 'Bearer '
    const hash = createHash('sha256').update(key).digest('hex');

    const apiKey = await this.prisma.fleetApiKey.findUnique({
      where: { key_hash: hash },
      select: { id: true, fleet_id: true, revoked_at: true },
    });

    if (!apiKey || apiKey.revoked_at) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Per-key rate limiting via Redis INCR + EXPIRE
    const rateLimitKey = `rate:apikey:${apiKey.id}`;
    const count = await this.redis.incr(rateLimitKey);
    if (count === 1) {
      // First request in window — set TTL
      await this.redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > RATE_LIMIT_REQUESTS) {
      throw new HttpException({ error: 'Rate limit exceeded' }, 429);
    }

    // Update last_used_at asynchronously — don't block the request
    this.prisma.fleetApiKey.update({
      where: { id: apiKey.id },
      data: { last_used_at: new Date() },
    }).catch(() => {});

    // Attach fleet context for use in controllers
    req.apiKeyFleetId = apiKey.fleet_id;
    return true;
  }
}
```

---

## Fleet Portal — API Key Management

### FleetApiKeysService

**File:** `apps/api/src/fleet/fleet-api-keys.service.ts` (new)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

export interface CreatedKeyDto {
  id: string;
  name: string;
  key: string;         // full key — shown once
  keyPrefix: string;
  createdAt: string;
}

export interface ApiKeyListItemDto {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

@Injectable()
export class FleetApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async listKeys(fleetId: string): Promise<ApiKeyListItemDto[]> {
    const keys = await this.prisma.fleetApiKey.findMany({
      where: { fleet_id: fleetId, revoked_at: null },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, key_prefix: true, last_used_at: true, created_at: true },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      lastUsedAt: k.last_used_at?.toISOString() ?? null,
      createdAt: k.created_at.toISOString(),
    }));
  }

  async createKey(fleetId: string, name: string): Promise<CreatedKeyDto> {
    const raw = randomBytes(32).toString('hex');
    const key = `dsk_${raw}`;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.slice(0, 12);  // 'dsk_' + 8 hex chars

    const record = await this.prisma.fleetApiKey.create({
      data: {
        fleet_id: fleetId,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
      },
    });

    return {
      id: record.id,
      name: record.name,
      key,          // returned once — never stored in plaintext
      keyPrefix,
      createdAt: record.created_at.toISOString(),
    };
  }

  async revokeKey(fleetId: string, keyId: string): Promise<void> {
    // Verify key belongs to fleet before revoking
    await this.prisma.fleetApiKey.updateMany({
      where: { id: keyId, fleet_id: fleetId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }
}
```

### Fleet Portal Endpoints (JWT — FLEET_MANAGER)

**Add to `apps/api/src/fleet/fleet.controller.ts`:**

```typescript
// List API keys
@Get('api-keys')
@Roles(Role.FLEET_MANAGER)
async listApiKeys(@CurrentUser('fleet_id') fleetId: string): Promise<ApiKeyListItemDto[]> {
  return this.fleetApiKeysService.listKeys(fleetId);
}

// Create API key — returns full key once
@Post('api-keys')
@Roles(Role.FLEET_MANAGER)
async createApiKey(
  @CurrentUser('fleet_id') fleetId: string,
  @Body() dto: CreateApiKeyDto,
): Promise<CreatedKeyDto> {
  return this.fleetApiKeysService.createKey(fleetId, dto.name);
}

// Revoke API key
@Delete('api-keys/:keyId')
@Roles(Role.FLEET_MANAGER)
@HttpCode(204)
async revokeApiKey(
  @CurrentUser('fleet_id') fleetId: string,
  @Param('keyId') keyId: string,
): Promise<void> {
  return this.fleetApiKeysService.revokeKey(fleetId, keyId);
}
```

**DTO:**
```typescript
// apps/api/src/fleet/dto/create-api-key.dto.ts
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;
}
```

---

## External Fleet API Controller

**File:** `apps/api/src/fleet/fleet-public-api.controller.ts` (new)

```typescript
import {
  Controller, Get, Query, Req, UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import { FleetAnalyticsService } from './fleet-analytics.service';
import { FleetPublicPricesService } from './fleet-public-prices.service';
import { FastifyRequest } from 'fastify';

@Controller('v1/fleet-api')
@Public()             // Skip global JwtAuthGuard
@UseGuards(ApiKeyGuard)
export class FleetPublicApiController {
  constructor(
    private readonly analyticsService: FleetAnalyticsService,
    private readonly pricesService: FleetPublicPricesService,
  ) {}

  /**
   * GET /v1/fleet-api/prices?fuelType=ON&voivodeship=mazowieckie&limit=20
   * Returns stations with latest prices for the given fuel type and region.
   */
  @Get('prices')
  async getPrices(
    @Query('fuelType') fuelType: string,
    @Query('voivodeship') voivodeship: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr ?? '20', 10) || 20, 100);
    return this.pricesService.getLatestPrices({ fuelType, voivodeship, limit });
  }

  /**
   * GET /v1/fleet-api/analytics?period=30d
   * Returns fleet dashboard analytics scoped to the key's fleet.
   */
  @Get('analytics')
  async getAnalytics(
    @Req() req: FastifyRequest & { apiKeyFleetId: string },
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getDashboard(req.apiKeyFleetId, period ?? '30d');
  }

  /**
   * GET /v1/fleet-api/vehicles
   * Returns vehicle list for the key's fleet.
   */
  @Get('vehicles')
  async getVehicles(
    @Req() req: FastifyRequest & { apiKeyFleetId: string },
  ) {
    return this.pricesService.getFleetVehicles(req.apiKeyFleetId);
  }

  /**
   * GET /v1/fleet-api/fill-ups?vehicleId=xxx&from=2026-01-01&to=2026-02-01&limit=100
   * Returns fill-up history for the key's fleet.
   */
  @Get('fill-ups')
  async getFillUps(
    @Req() req: FastifyRequest & { apiKeyFleetId: string },
    @Query('vehicleId') vehicleId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 500);
    return this.pricesService.getFleetFillUps({
      fleetId: req.apiKeyFleetId,
      vehicleId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit,
    });
  }
}
```

### FleetPublicPricesService

**File:** `apps/api/src/fleet/fleet-public-prices.service.ts` (new)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FleetPublicPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestPrices(params: {
    fuelType: string;
    voivodeship: string;
    limit: number;
  }) {
    // DISTINCT ON: one row per station, ordered by newest price
    const rows = await this.prisma.$queryRaw<
      { station_id: string; name: string; brand: string | null; address: string | null; price: number; recorded_at: Date }[]
    >`
      SELECT DISTINCT ON (ph.station_id)
        ph.station_id  AS station_id,
        s.name,
        s.brand,
        s.address,
        ph.price,
        ph.recorded_at
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE ph.fuel_type     = ${params.fuelType}
        AND s.voivodeship     = ${params.voivodeship}
        AND ph.recorded_at   > NOW() - INTERVAL '48 hours'
      ORDER BY ph.station_id, ph.recorded_at DESC
      LIMIT ${params.limit}
    `;

    return rows
      .sort((a, b) => a.price - b.price)
      .map((r) => ({
        stationId: r.station_id,
        stationName: r.name,
        brand: r.brand,
        address: r.address,
        pricePerLitrePln: r.price,
        recordedAt: r.recorded_at.toISOString(),
      }));
  }

  async getFleetVehicles(fleetId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { fleet_id: fleetId, deleted_at: null },
      orderBy: { registration: 'asc' },
      select: { id: true, name: true, registration: true, created_at: true },
    });
    return vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      registration: v.registration,
      createdAt: v.created_at.toISOString(),
    }));
  }

  async getFleetFillUps(params: {
    fleetId: string;
    vehicleId?: string;
    from?: Date;
    to?: Date;
    limit: number;
  }) {
    const where: any = { fleet_id: params.fleetId };
    if (params.vehicleId) where.vehicle_id = params.vehicleId;
    if (params.from || params.to) {
      where.filled_at = {};
      if (params.from) where.filled_at.gte = params.from;
      if (params.to) where.filled_at.lte = params.to;
    }

    const rows = await this.prisma.fillUp.findMany({
      where,
      orderBy: { filled_at: 'desc' },
      take: params.limit,
      include: {
        vehicle: { select: { name: true, registration: true } },
        station: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      filledAt: r.filled_at.toISOString(),
      vehicleId: r.vehicle_id,
      vehicleName: r.vehicle?.name ?? null,
      vehicleRegistration: r.vehicle?.registration ?? null,
      stationName: r.station?.name ?? null,
      fuelType: r.fuel_type,
      litres: parseFloat(r.litres.toString()),
      totalCostPln: parseFloat(r.total_cost_pln.toString()),
      pricePerLitrePln: parseFloat(r.price_per_litre_pln.toString()),
    }));
  }
}
```

### Register in FleetModule

```typescript
// apps/api/src/fleet/fleet.module.ts
import { ApiKeyGuard } from './api-key.guard';
import { FleetApiKeysService } from './fleet-api-keys.service';
import { FleetPublicPricesService } from './fleet-public-prices.service';
import { FleetPublicApiController } from './fleet-public-api.controller';

@Module({
  imports: [BullModule.registerQueue({ name: FLEET_ALERT_CHECKS_QUEUE }), EmailModule],
  controllers: [FleetController, FleetPublicApiController],
  providers: [
    FleetService,
    FleetAlertsService,
    FleetAlertCheckService,
    FleetAlertCheckWorker,
    FleetReportsService,
    FleetRouteService,
    FleetApiKeysService,
    FleetPublicPricesService,
    ApiKeyGuard,
  ],
})
export class FleetModule {}
```

---

## Fleet App Changes

### API Access Page

**File:** `apps/fleet/app/(fleet)/api-access/page.tsx` (new — Server Component)

```tsx
import { fleetFetch } from '../../../lib/fleet-api';
import ApiKeyList from './ApiKeyList';
import CreateKeyForm from './CreateKeyForm';

export const metadata = { title: 'API Access' };

async function getApiKeys() {
  try {
    return await fleetFetch<ApiKeyListItemDto[]>('/v1/fleet/api-keys');
  } catch {
    return [];
  }
}

export default async function ApiAccessPage() {
  const keys = await getApiKeys();
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold">API Access</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate keys to access your fleet data from external systems.
        </p>
      </div>
      <CreateKeyForm />
      <ApiKeyList keys={keys} />
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/api-access/actions.ts`

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { fleetFetch } from '../../../lib/fleet-api';

export async function createApiKeyAction(name: string): Promise<{ key: string; keyPrefix: string; id: string }> {
  const result = await fleetFetch<{ id: string; name: string; key: string; keyPrefix: string; createdAt: string }>(
    '/v1/fleet/api-keys',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  revalidatePath('/api-access');
  return { key: result.key, keyPrefix: result.keyPrefix, id: result.id };
}

export async function revokeApiKeyAction(keyId: string): Promise<void> {
  await fleetFetch(`/v1/fleet/api-keys/${keyId}`, { method: 'DELETE' });
  revalidatePath('/api-access');
}
```

**File:** `apps/fleet/app/(fleet)/api-access/CreateKeyForm.tsx` (new Client Component)

```tsx
'use client';

import { useState, useTransition } from 'react';
import { createApiKeyAction } from './actions';

export default function CreateKeyForm() {
  const [name, setName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await createApiKeyAction(name.trim());
      setCreatedKey(result.key);
      setName('');
    });
  }

  function handleCopy() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Create new key</h2>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. SAP Integration)"
          maxLength={64}
          required
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {/* Show key once after creation */}
      {createdKey && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            Save this key — it won't be shown again.
          </p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-3 py-2 font-mono break-all">
              {createdKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 rounded-lg border border-amber-300 text-xs font-medium text-amber-700 whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreatedKey(null)}
            className="text-xs text-amber-600 underline"
          >
            I've saved it — dismiss
          </button>
        </div>
      )}
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/api-access/ApiKeyList.tsx` (new Client Component)

```tsx
'use client';

import { useTransition } from 'react';
import { revokeApiKeyAction } from './actions';

interface ApiKeyListItemDto {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function ApiKeyList({ keys }: { keys: ApiKeyListItemDto[] }) {
  const [pending, startTransition] = useTransition();

  if (keys.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">No API keys yet.</p>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Active keys</h2>
      <ul className="divide-y divide-gray-100">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center gap-3 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">{k.name}</div>
              <div className="text-xs text-gray-400 font-mono">{k.keyPrefix}••••••••</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Created {new Date(k.createdAt).toLocaleDateString()}
                {k.lastUsedAt && ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
              </div>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`Revoke key "${k.name}"? This cannot be undone.`)) {
                  startTransition(() => revokeApiKeyAction(k.id));
                }
              }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 disabled:opacity-50"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### API Documentation Block

Add a static documentation section to the API Access page (below key list) showing the base URL and available endpoints:

```tsx
// In page.tsx, add below ApiKeyList:
<div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs font-mono space-y-1">
  <p className="text-gray-500 font-sans text-xs font-semibold not-italic mb-2">Available endpoints</p>
  <p><span className="text-blue-600">GET</span>  /v1/fleet-api/prices?fuelType=ON&voivodeship=mazowieckie</p>
  <p><span className="text-blue-600">GET</span>  /v1/fleet-api/analytics?period=30d</p>
  <p><span className="text-blue-600">GET</span>  /v1/fleet-api/vehicles</p>
  <p><span className="text-blue-600">GET</span>  /v1/fleet-api/fill-ups?vehicleId=&from=&to=</p>
  <p className="text-gray-400 font-sans not-italic mt-2">Authorization: Bearer dsk_your_key</p>
</div>
```

### Navigation — Add API Access Tab

In `apps/fleet/app/(fleet)/layout.tsx`:

```tsx
{ href: '/api-access', label: 'API', icon: KeyIcon },
```

---

## Migration

**Name:** `add_fleet_api_key`

```sql
CREATE TABLE "FleetApiKey" (
    "id"           TEXT         NOT NULL,
    "fleet_id"     TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "key_hash"     TEXT         NOT NULL,
    "key_prefix"   TEXT         NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at"   TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetApiKey_key_hash_key" ON "FleetApiKey"("key_hash");
CREATE INDEX "FleetApiKey_fleet_id_idx" ON "FleetApiKey"("fleet_id");

ALTER TABLE "FleetApiKey" ADD CONSTRAINT "FleetApiKey_fleet_id_fkey"
  FOREIGN KEY ("fleet_id") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Tasks / Subtasks

- [ ] API: Prisma schema — `FleetApiKey` model + `Fleet.api_keys` relation (AC: 1)
  - [ ] Migration: `add_fleet_api_key`

- [ ] API: `ApiKeyGuard` — SHA-256 lookup + Redis rate limit (60 req/min) + `req.apiKeyFleetId` (AC: 4, 5, 6)
  - [ ] `INCR` + `EXPIRE` Redis pattern
  - [ ] 429 on rate limit exceeded with `{ "error": "Rate limit exceeded" }` body

- [ ] API: `FleetApiKeysService` — `listKeys`, `createKey`, `revokeKey` (AC: 1)
  - [ ] `generateApiKey()`: `dsk_` + `randomBytes(32).toString('hex')` + SHA-256 hash
  - [ ] `key_prefix = key.slice(0, 12)`
  - [ ] `revokeKey()` uses `updateMany` (ownership check implicit via `fleet_id`)

- [ ] API: Fleet portal endpoints — `GET/POST /v1/fleet/api-keys`, `DELETE /v1/fleet/api-keys/:keyId` (AC: 1)
  - [ ] `@Roles(Role.FLEET_MANAGER)` on all three

- [ ] API: `FleetPublicApiController` with `@Public() @UseGuards(ApiKeyGuard)` (AC: 2, 3, 4, 5, 6)
  - [ ] `GET /v1/fleet-api/prices` — delegates to `FleetPublicPricesService.getLatestPrices()`
  - [ ] `GET /v1/fleet-api/analytics` — delegates to `FleetAnalyticsService.getDashboard()`
  - [ ] `GET /v1/fleet-api/vehicles` — delegates to `FleetPublicPricesService.getFleetVehicles()`
  - [ ] `GET /v1/fleet-api/fill-ups` — delegates to `FleetPublicPricesService.getFleetFillUps()`

- [ ] API: `FleetPublicPricesService` — `getLatestPrices()`, `getFleetVehicles()`, `getFleetFillUps()` (AC: 2, 3)
  - [ ] `getLatestPrices()`: raw SQL `DISTINCT ON (station_id)` with voivodeship + 48h freshness filter
  - [ ] Sort by price ascending before returning

- [ ] API: Register all new providers + `FleetPublicApiController` in `FleetModule`

- [ ] Fleet app: `/api-access` page — `page.tsx`, `CreateKeyForm.tsx`, `ApiKeyList.tsx`, `actions.ts` (AC: 1)
  - [ ] Show full key once in amber alert box with copy button
  - [ ] Confirm dialog before revoke
  - [ ] Static endpoint documentation block

- [ ] Fleet app: Add API nav link in `(fleet)/layout.tsx`

---

## Dev Notes

### `@Public()` + `@UseGuards(ApiKeyGuard)` Interaction

The global `JwtAuthGuard` (registered as `APP_GUARD`) checks `@Public()` via `Reflector`. When `@Public()` is on the controller class, all its endpoints skip JWT auth. The `@UseGuards(ApiKeyGuard)` decorator then runs as a method-level guard on each handler.

Guard execution order in NestJS: global guards first, then controller guards, then route guards. Because `JwtAuthGuard` returns `true` early for `@Public()` endpoints, `ApiKeyGuard` runs afterward and performs its own full authentication. This is correct — no security gap.

### SHA-256 for API Key Hashing

API keys are 68 chars of random data (`dsk_` + 64 random hex chars), giving 256 bits of entropy. SHA-256 without salt is appropriate — API keys are long enough that rainbow tables are infeasible. Using bcrypt would add ~100ms latency per request at the guard level, which is unacceptable for API integrations. SHA-256 lookup is ~0.1ms.

### Redis Rate Limit Race Condition

The `INCR` + `EXPIRE` pattern has a minor race: if two requests arrive simultaneously and both see `count === 1`, both will call `EXPIRE`. Since `EXPIRE` is idempotent when setting the same value, this is harmless — the window resets correctly. A truly atomic implementation would use a Lua script, but for a 60 req/min limit on a B2B integration this precision is unnecessary.

### `updateMany` for Revocation

`FleetApiKeysService.revokeKey()` uses `updateMany` (not `update`) to avoid a `RecordNotFound` throw when the key doesn't belong to the fleet or is already revoked. The `updateMany` with `fleet_id` in the where clause provides the ownership check. No error is thrown if the key was not found — `DELETE /v1/fleet/api-keys/:keyId` returns 204 regardless (idempotent revocation).

### Max 10 Active Keys Per Fleet (MVP Limit)

Add a guard in `createKey()` to prevent unbounded key creation:

```typescript
const count = await this.prisma.fleetApiKey.count({
  where: { fleet_id: fleetId, revoked_at: null },
});
if (count >= 10) throw new BadRequestException('Maximum 10 active API keys per fleet');
```

This prevents abuse without requiring any schema change.

### `GET /v1/fleet-api/prices` — Parameter Validation

The `fuelType` and `voivodeship` query parameters are not validated by class-validator (no DTO on this endpoint). Add inline guards:

```typescript
const VALID_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];
if (!VALID_FUEL_TYPES.includes(fuelType)) {
  throw new BadRequestException('Invalid fuelType');
}
if (!voivodeship || voivodeship.length > 50) {
  throw new BadRequestException('voivodeship required');
}
```

This prevents SQL injection via parameterised queries (Prisma's `$queryRaw` already uses parameterisation) but also prevents obvious user errors.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
