# Story 7.3: Self-Service Price Update

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.3
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.1/7.2 (STATION_MANAGER role, StationClaim), Story 5.0 (regional benchmark via `PriceHistoryService.getRegionalAverage()`)
- **Required by:** 7.5 (integrity monitoring hooks into owner price writes)

---

## User Story

**As a verified station owner,**
I want to update my station's fuel prices directly in the partner portal,
So that accurate prices reach drivers immediately without waiting for community submissions.

---

## Context & Why

Owner-submitted prices are the highest-quality data source on the platform: authoritative, real-time, verified at the identity level. This story wires up the price update form in `apps/partner`, a new `owner` price source in the backend, and the "Owner verified" badge in the driver-facing `StationDetailSheet`.

The most recent authoritative price wins — owner or community, whoever submitted last. This is the same pattern already used for `admin_override` prices vs. community submissions in `PriceService.findPricesByStationIds()`. Story 7.3 extends that pattern with a new `owner` source, added at both the DB enum level and the read-path merge logic.

**Note from Story 7.3 epic spec:** Error-scenario ACs were flagged as missing before implementation. This story adds them (see Acceptance Criteria section below).

---

## Acceptance Criteria

**Given** a verified station owner (STATION_MANAGER role) opens the station management screen
**When** they view the price section
**Then** they see a price entry form with one field per fuel type the station currently offers (PB_95, PB_98, ON, LPG, and any other types present in the station's latest price record from `PriceHistory`)
**And** the current price for each fuel type is shown as a placeholder in the input field

**Given** the owner submits a price for a fuel type
**When** the submitted value is validated
**Then** prices outside ±30% of the voivodeship regional average for that fuel type are rejected with a clear error message showing the allowed range in PLN/L
**And** if no regional average exists (insufficient data), absolute fuel-type bands are applied as fallback (same bands used by `PriceValidationService`)

**Given** a valid price is submitted
**When** it is saved
**Then** a `PriceHistory` row is written with `source: 'owner'` and `submitted_by: userId`
**And** the Redis price cache for that station is invalidated
**And** the `StationFuelStaleness` row for `[stationId, fuelType]` is deleted if it exists (clearing staleness for that fuel type only)
**And** the action is returned as confirmed to the partner app within 3 seconds

**Given** an owner updates a price for one fuel type
**When** community photo submissions for any other fuel type at that station arrive
**Then** those submissions are processed independently — per-fuel-type freshness is preserved (no cross-fuel invalidation)

**Given** an owner-submitted price is live
**When** community photo submissions for the same fuel type arrive
**Then** community prices are accepted and stored as normal
**And** `PriceService.findPricesByStationIds()` compares timestamps and returns whichever is more recent (owner or community) as the displayed price

**Given** the owner-submitted price is saved and the driver opens the station detail screen
**When** they view that fuel type
**Then** the price shows an "Owner verified" badge — visually distinct from community-sourced and estimated prices

**Given** a database write failure occurs mid-update (e.g., Prisma throws on `PriceHistory.create`)
**When** the error is caught
**Then** the API returns HTTP 500 with a generic error message
**And** no partial state is left — the cache is NOT invalidated if the DB write failed (cache invalidation only happens after successful DB write)

**Given** a community submission arrives concurrently with an owner price update (race condition between two writers to the same station's cache)
**When** both writes complete
**Then** `PriceCacheService.setAtomic()` / invalidation ensures the final cache state is consistent — whichever write completes last wins (last-write-wins is acceptable at this scale)

**Given** a valid price is submitted
**When** it is saved
**Then** a log entry is accessible in the admin panel showing: station name, fuel type, submitted price, owner user ID, timestamp

---

## Schema Changes

### Add `owner` to `PriceSource` enum

```prisma
enum PriceSource {
  community
  seeded
  admin_override
  owner          // ← new: verified station owner self-reported price
}
```

### Add `submitted_by` to `PriceHistory`

```prisma
model PriceHistory {
  id           String      @id @default(uuid())
  station_id   String
  fuel_type    String
  price        Float
  source       PriceSource
  recorded_at  DateTime    @default(now())
  submitted_by String?     // ← new: User.id — set for source=owner; null for community/seeded/admin_override

  station      Station     @relation(fields: [station_id], references: [id], onDelete: Cascade)

  @@index([station_id, fuel_type, recorded_at(sort: Desc)])
  @@index([submitted_by])   // ← new: for ops audit queries
}
```

**Migration name:** `add_price_history_owner_source`

---

## API Changes

### `PartnerService` — new methods

Add to `apps/api/src/partner/partner.service.ts`:

```typescript
// Absolute fallback bands (mirrors PriceValidationService — keep in sync)
private static readonly ABSOLUTE_BANDS: Record<string, { min: number; max: number }> = {
  PB_95:      { min: 4.0, max: 12.0 },
  PB_98:      { min: 4.5, max: 13.0 },
  ON:         { min: 4.0, max: 12.0 },
  ON_PREMIUM: { min: 4.5, max: 13.0 },
  LPG:        { min: 1.5, max: 5.0 },
  AdBlue:     { min: 3.0, max: 15.0 },
};

/** Returns current prices for the station (for pre-populating the form). */
async getStationCurrentPrices(stationId: string): Promise<Record<string, number>> {
  // Latest PriceHistory row per fuel type (any source) — gives the current state
  const rows = await this.db.$queryRaw<{ fuel_type: string; price: number }[]>`
    SELECT DISTINCT ON (fuel_type)
      fuel_type,
      price
    FROM "PriceHistory"
    WHERE station_id = ${stationId}
    ORDER BY fuel_type, recorded_at DESC
  `;

  return Object.fromEntries(rows.map((r) => [r.fuel_type, r.price]));
}

/** Validates and writes a single owner price update. */
async updateOwnerPrice(
  userId: string,
  stationId: string,
  fuelType: string,
  price: number,
): Promise<{ allowed_min: number; allowed_max: number } | void> {
  // 1. Verify user owns this station
  const claim = await this.db.stationClaim.findFirst({
    where: { user_id: userId, station_id: stationId, status: 'APPROVED' },
  });
  if (!claim) throw new ForbiddenException('You do not manage this station');

  // 2. Validate fuelType is a known type
  const KNOWN_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG', 'AdBlue'];
  if (!KNOWN_FUEL_TYPES.includes(fuelType)) {
    throw new BadRequestException(`Unknown fuel type: ${fuelType}`);
  }

  // 3. Validate price range: ±30% of regional average, fallback to absolute bands
  const station = await this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { voivodeship: true },
  });

  let allowedMin: number;
  let allowedMax: number;

  const regional = station.voivodeship
    ? await this.priceHistory.getRegionalAverage(station.voivodeship, fuelType)
    : null;

  if (regional?.averagePrice && regional.stationCount >= 3) {
    allowedMin = regional.averagePrice * 0.7;
    allowedMax = regional.averagePrice * 1.3;
  } else {
    const bands = PartnerService.ABSOLUTE_BANDS[fuelType];
    if (!bands) throw new BadRequestException(`No validation bands for fuel type: ${fuelType}`);
    allowedMin = bands.min;
    allowedMax = bands.max;
  }

  if (price < allowedMin || price > allowedMax) {
    return { allowed_min: allowedMin, allowed_max: allowedMax }; // caller throws 422
  }

  // 4. Write to PriceHistory — DB write MUST succeed before cache invalidation
  await this.db.priceHistory.create({
    data: {
      station_id: stationId,
      fuel_type: fuelType,
      price,
      source: 'owner',
      submitted_by: userId,
    },
  });

  // 5. Clear staleness for this fuel type (best-effort)
  await this.db.stationFuelStaleness
    .deleteMany({ where: { station_id: stationId, fuel_type: fuelType } })
    .catch(() => undefined);

  // 6. Invalidate cache — after successful DB write
  await this.priceCache.invalidate(stationId);
}
```

**Inject `PriceHistoryService` and `PriceCacheService` into `PartnerService`:**

```typescript
// PartnerModule must import PriceModule (which exports PriceHistoryService, PriceCacheService)
// or inject them directly if PriceModule exports them.

// If PriceModule doesn't export PriceCacheService, add it to exports in price.module.ts.
// Alternatively, call PriceService.invalidateStation() — add that method to PriceService if cleaner.
```

Check `apps/api/src/price/price.module.ts` exports: currently exports `PriceService`, `PriceValidationService`, `PriceCacheService`. Import `PriceModule` in `PartnerModule`.

### `PartnerController` — new endpoints

```typescript
/** GET /v1/partner/stations/{stationId}/prices — authenticated STATION_MANAGER */
@Get('stations/:stationId/prices')
@Roles(UserRole.STATION_MANAGER)
async getStationPrices(@Param('stationId') stationId: string, @CurrentUser() user: User) {
  // Verify ownership (service throws ForbiddenException if not owner)
  const claim = await this.partnerService.getApprovedClaim(user.id, stationId);
  if (!claim) throw new ForbiddenException();
  return this.partnerService.getStationCurrentPrices(stationId);
}

/** POST /v1/partner/stations/{stationId}/prices — authenticated STATION_MANAGER */
@Post('stations/:stationId/prices')
@Roles(UserRole.STATION_MANAGER)
async updatePrice(
  @Param('stationId') stationId: string,
  @CurrentUser() user: User,
  @Body() dto: UpdateOwnerPriceDto,
) {
  const rangeError = await this.partnerService.updateOwnerPrice(
    user.id,
    stationId,
    dto.fuelType,
    dto.price,
  );

  if (rangeError) {
    throw new HttpException(
      {
        message: `Price outside allowed range: ${rangeError.allowed_min.toFixed(2)}–${rangeError.allowed_max.toFixed(2)} PLN/L`,
        allowed_min: rangeError.allowed_min,
        allowed_max: rangeError.allowed_max,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  return { status: 'updated' };
}
```

```typescript
// dto/update-owner-price.dto.ts
import { IsString, IsNumber, Min, Max } from 'class-validator';

export class UpdateOwnerPriceDto {
  @IsString()
  fuelType!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1.0)
  @Max(20.0)
  price!: number;
}
```

### `PriceService.findPricesByStationIds()` — extend to include `owner` source

In the existing `admin_override` overlay query, extend to include `owner`:

```typescript
// BEFORE (line ~191 in price.service.ts):
WHERE station_id IN (${Prisma.join(stationIds)})
  AND source = 'admin_override'

// AFTER:
WHERE station_id IN (${Prisma.join(stationIds)})
  AND source IN ('admin_override', 'owner')
```

And in the merge logic (line ~214), extend the sources type:

```typescript
// BEFORE:
const sources: Record<string, 'community' | 'seeded' | 'admin_override'> = ...

// AFTER:
const sources: Record<string, 'community' | 'seeded' | 'admin_override' | 'owner'> = ...
```

When an `owner` price wins the timestamp comparison, set `sources[ft] = 'owner'`.

The existing recency logic (`if (ov.recordedAt > row.updatedAt)`) applies unchanged — community submission timestamp vs. owner price timestamp, most recent wins.

### `StationPriceRow` — add `'owner'` to sources union

In `apps/api/src/price/price-cache.service.ts` (or wherever `StationPriceRow` is defined):

```typescript
// BEFORE:
sources: Record<string, 'community' | 'seeded' | 'admin_override'>;

// AFTER:
sources: Record<string, 'community' | 'seeded' | 'admin_override' | 'owner'>;
```

### `PriceCacheService` — add `invalidate()` method

If not already present, add to `PriceCacheService`:

```typescript
async invalidate(stationId: string): Promise<void> {
  await this.redis.del(`price:station:${stationId}`);
}
```

(The exact Redis key pattern must match what `setAtomic()` writes. Check the existing key format in `price-cache.service.ts`.)

### `PartnerModule` — add `PriceModule` import

```typescript
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    SmsModule,
    PriceModule,   // ← new: provides PriceHistoryService, PriceCacheService
    BullModule.forFeature([{ name: CLAIM_REMINDER_QUEUE }]),
  ],
  controllers: [PartnerController],
  providers: [PartnerService, ClaimEmailService, ClaimReminderWorker],
  exports: [PartnerService, ClaimEmailService],
})
export class PartnerModule {}
```

---

## Admin Panel: Owner Price Audit View

Extend the existing station detail page (`apps/admin/app/(protected)/stations/[id]/page.tsx`) to show owner-submitted prices.

### New admin API endpoint

```typescript
// GET /v1/admin/stations/{id}/owner-prices
@Get(':id/owner-prices')
@Roles(UserRole.ADMIN)
async getOwnerPrices(@Param('id') id: string) {
  return this.db.priceHistory.findMany({
    where: { station_id: id, source: 'owner' },
    orderBy: { recorded_at: 'desc' },
    take: 50,
    include: {
      // submitted_by is a String (user_id), not a relation — join manually
    },
    select: {
      id: true,
      fuel_type: true,
      price: true,
      recorded_at: true,
      submitted_by: true,
    },
  });
}
```

Add to `StationDetail` type in `apps/admin/lib/types.ts`:

```typescript
export interface OwnerPriceRow {
  id: string;
  fuel_type: string;
  price: number;
  recorded_at: string;
  submitted_by: string | null;
}
```

Render in the admin station detail page as a simple table: Fuel Type | Price | Submitted by (user ID) | Timestamp.

---

## Mobile App: "Owner Verified" Badge

### `apps/mobile/src/api/prices.ts` — extend source type

```typescript
// BEFORE:
sources: Partial<Record<FuelType, 'community' | 'seeded'>>;

// AFTER:
sources: Partial<Record<FuelType, 'community' | 'seeded' | 'admin_override' | 'owner'>>;
```

### `apps/mobile/src/components/StationDetailSheet.tsx`

Add `isOwnerVerified` detection alongside the existing `isEstimated`:

```typescript
const isOwnerVerified = (ft: FuelType) => prices?.sources[ft] === 'owner';
```

In the price row render, add the badge after the price value:

```tsx
{isOwnerVerified(ft) && (
  <View style={styles.ownerBadge}>
    <Text style={styles.ownerBadgeText}>Owner verified</Text>
  </View>
)}
{!isOwnerVerified(ft) && <FreshnessIndicator ... />}
```

**Badge style** (use existing design tokens):

```typescript
ownerBadge: {
  backgroundColor: tokens.brand.b100,   // light brand tint
  borderRadius: 4,
  paddingHorizontal: 6,
  paddingVertical: 2,
  alignSelf: 'flex-start',
},
ownerBadgeText: {
  color: tokens.brand.b700,
  fontSize: 11,
  fontWeight: '600',
},
```

Consult `ui-1-design-tokens.md` for the exact token names. Use the primary brand colour family (equivalent of a success/trust indicator). Do NOT invent new tokens — use existing ones.

---

## Partner App: Price Update Panel

### `app/(partner)/station/[stationId]/page.tsx` — replace placeholder

```typescript
// Server Component — fetches current prices and renders PriceUpdatePanel
import { partnerFetch, PartnerApiError } from '../../../../lib/partner-api';
import { redirect } from 'next/navigation';
import PriceUpdatePanel from '../../../../components/PriceUpdatePanel';

export default async function StationManagementPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;

  let me: { role: string; managedStationId?: string };
  try {
    me = await partnerFetch('/v1/partner/me');
  } catch (e) {
    if (e instanceof PartnerApiError && e.status === 401) redirect('/login');
    throw e;
  }

  if (me.role !== 'STATION_MANAGER' || me.managedStationId !== stationId) {
    redirect('/claim');
  }

  const [station, currentPrices] = await Promise.all([
    partnerFetch<{ name: string; address: string | null }>(`/v1/partner/stations/${stationId}`),
    partnerFetch<Record<string, number>>(`/v1/partner/stations/${stationId}/prices`),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">{station.name}</h1>
      <p className="mb-8 text-sm text-gray-500">{station.address}</p>
      <PriceUpdatePanel stationId={stationId} currentPrices={currentPrices} />
    </main>
  );
}
```

### `components/PriceUpdatePanel.tsx` (Client Component)

```typescript
'use client';

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Petrol 95',
  PB_98: 'Petrol 98',
  ON: 'Diesel',
  ON_PREMIUM: 'Diesel Premium',
  LPG: 'LPG',
  AdBlue: 'AdBlue',
};

interface FuelRowState {
  value: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}

export default function PriceUpdatePanel({
  stationId,
  currentPrices,
}: {
  stationId: string;
  currentPrices: Record<string, number>;
}) {
  const fuelTypes = Object.keys(currentPrices).sort();
  const [rows, setRows] = useState<Record<string, FuelRowState>>(
    Object.fromEntries(
      fuelTypes.map((ft) => [
        ft,
        { value: currentPrices[ft]?.toFixed(3) ?? '', status: 'idle', error: null },
      ]),
    ),
  );

  const handleSubmit = async (fuelType: string) => {
    const value = parseFloat(rows[fuelType].value);
    if (isNaN(value)) {
      setRows((r) => ({ ...r, [fuelType]: { ...r[fuelType], error: 'Enter a valid price', status: 'error' } }));
      return;
    }

    setRows((r) => ({ ...r, [fuelType]: { ...r[fuelType], status: 'saving', error: null } }));

    const res = await fetch(`/api/partner/stations/${stationId}/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fuelType, price: value }),
    });

    if (res.ok) {
      setRows((r) => ({ ...r, [fuelType]: { ...r[fuelType], status: 'saved' } }));
      setTimeout(() => setRows((r) => ({ ...r, [fuelType]: { ...r[fuelType], status: 'idle' } })), 3000);
    } else {
      const body = await res.json().catch(() => ({}));
      setRows((r) => ({
        ...r,
        [fuelType]: {
          ...r[fuelType],
          status: 'error',
          error: body.message ?? 'Failed to save price',
        },
      }));
    }
  };

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Update prices</h2>
      <div className="space-y-4">
        {fuelTypes.map((ft) => (
          <div key={ft} className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium text-gray-700">
              {FUEL_LABELS[ft] ?? ft}
            </label>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="number"
                step="0.001"
                min="1"
                max="20"
                value={rows[ft].value}
                onChange={(e) =>
                  setRows((r) => ({ ...r, [ft]: { ...r[ft], value: e.target.value } }))
                }
                className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="0.000"
              />
              <span className="text-sm text-gray-400">PLN/L</span>
              <button
                onClick={() => handleSubmit(ft)}
                disabled={rows[ft].status === 'saving'}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white
                           hover:bg-blue-700 disabled:opacity-50"
              >
                {rows[ft].status === 'saving' ? '…' : rows[ft].status === 'saved' ? '✓ Saved' : 'Save'}
              </button>
            </div>
            {rows[ft].error && (
              <p className="text-xs text-red-600">{rows[ft].error}</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-gray-400">
        Prices outside ±30% of the regional average will be rejected.
        Drivers see "Owner verified" next to prices you submit.
      </p>
    </section>
  );
}
```

**Note:** The `fetch` call above goes to a Next.js API route (`/api/partner/stations/{id}/prices`) that proxies to the NestJS API with the `partner_token` cookie. Alternatively, call the NestJS API directly from a Next.js Server Action.

**Recommended approach — use a Server Action instead of a Route Handler:**

```typescript
// app/(partner)/station/[stationId]/actions.ts
'use server';
import { partnerFetch } from '../../../../lib/partner-api';

export async function updatePriceAction(
  stationId: string,
  fuelType: string,
  price: number,
): Promise<{ error?: string; allowed_min?: number; allowed_max?: number }> {
  try {
    await partnerFetch(`/v1/partner/stations/${stationId}/prices`, {
      method: 'POST',
      body: JSON.stringify({ fuelType, price }),
    });
    return {};
  } catch (e) {
    if (e instanceof PartnerApiError) {
      if (e.status === 422) {
        const body = JSON.parse(e.message.replace(/^API 422: /, ''));
        return { error: body.message, allowed_min: body.allowed_min, allowed_max: body.allowed_max };
      }
      return { error: 'Failed to save — please try again' };
    }
    return { error: 'Unexpected error' };
  }
}
```

Then `PriceUpdatePanel` calls `updatePriceAction(stationId, ft, value)` instead of `fetch`.

---

## Dev Notes

### `PriceCacheService.invalidate()` vs `setAtomic()`
The existing `setVerifiedPrice()` path calls `setAtomic()` which writes a complete `StationPriceRow` to cache. For owner price updates (single fuel type), we do NOT rebuild the full row in the service — we just invalidate the cache key so the next read triggers a fresh DB fetch via `findPricesByStationIds()`. This is simpler and avoids partial-row cache corruption.

Check the key format in `price-cache.service.ts` before implementing `invalidate()` — it must match what `setAtomic()` writes (likely `price:station:{stationId}`).

### Per-fuel-type independence
Owner prices write to `PriceHistory` per fuel type. Community submissions write `price_data` as a JSONB blob on `Submission` (all fuel types in one row). The `findPricesByStationIds()` read path:
1. Gets the latest `Submission` (all fuel types together, one timestamp)
2. Overlays per-fuel `PriceHistory` overrides (owner or admin_override) if newer

This means: if an owner updates only PB_95, the community submission's timestamp applies to all other fuel types (ON, LPG, etc.) and those remain unaffected. The owner's PB_95 only wins if its `recorded_at` > the Submission's `created_at`.

### Validation: regional average requires ≥3 stations
The `getRegionalAverage()` query returns `station_count`. Use ≥3 as the minimum threshold before trusting the regional average for validation (otherwise a single outlier station could set a skewed band). If `stationCount < 3`, fall back to absolute bands.

### `PriceSource` enum: TypeScript cast update
`PriceHistoryService.recordPrices()` currently casts source as `'community' | 'seeded'`. After adding `owner` to the Prisma enum, update the type to `Prisma.PriceSource` (or the generated enum) to avoid bypassing type safety. Owner prices do NOT go through `recordPrices()` — they write directly via `db.priceHistory.create()` in `PartnerService`.

### Story 7.5 integration point
Story 7.5 (Owner Price Integrity Monitoring) hooks into the OCR pipeline's `setVerifiedPrice()` call to detect when community prices contradict owner prices by ≥2% within 24h. Story 7.3 does NOT implement this logic — but the `submitted_by` field on `PriceHistory` and the `source = 'owner'` tag are the data 7.5 reads to build integrity alerts.

### `GET /v1/partner/stations/{stationId}` endpoint
Story 7.3 references `GET /v1/partner/stations/{stationId}` for station name/address on the management page. This endpoint isn't in Story 7.1's scope (7.1 only has `/partner/stations/search`). Add a new `getStationDetail()` method to `PartnerService` and a corresponding `@Get('stations/:stationId')` route to `PartnerController`:

```typescript
async getStationDetail(stationId: string): Promise<{ name: string; address: string | null; brand: string | null }> {
  return this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { name: true, address: true, brand: true },
  });
}
```

---

## Tasks

- [ ] **Schema:** Add `owner` to `PriceSource` enum; add `submitted_by String?` and `@@index([submitted_by])` to `PriceHistory`; run `prisma migrate dev --name add_price_history_owner_source`
- [ ] **API:** Extend `PriceService.findPricesByStationIds()` — add `'owner'` to the override source query and sources union type
- [ ] **API:** Add `invalidate(stationId)` to `PriceCacheService` (if not already present)
- [ ] **API:** Update `StationPriceRow.sources` type to include `'owner'`
- [ ] **API:** Add `getStationCurrentPrices()`, `updateOwnerPrice()`, `getStationDetail()` to `PartnerService`
- [ ] **API:** Add `GET /v1/partner/stations/:id/prices` and `POST /v1/partner/stations/:id/prices` to `PartnerController`; add `GET /v1/partner/stations/:id` for station detail
- [ ] **API:** Create `UpdateOwnerPriceDto` with `fuelType` (string) and `price` (number, 1–20, 3 decimal places)
- [ ] **API:** Import `PriceModule` in `PartnerModule`
- [ ] **API:** Add `GET /v1/admin/stations/{id}/owner-prices` to admin stations controller
- [ ] **Mobile:** Add `'owner'` to `StationPriceDto.sources` union type
- [ ] **Mobile:** Add `isOwnerVerified()` detection and "Owner verified" badge to `StationDetailSheet.tsx` using existing design tokens
- [ ] **Partner app:** Update `app/(partner)/station/[stationId]/page.tsx` — replace placeholder with actual price fetch + `PriceUpdatePanel`
- [ ] **Partner app:** Create `components/PriceUpdatePanel.tsx` (Client Component) with per-fuel-type input fields and server action submission
- [ ] **Partner app:** Create `app/(partner)/station/[stationId]/actions.ts` with `updatePriceAction` server action
- [ ] **Admin:** Add `OwnerPriceRow` type to `apps/admin/lib/types.ts`; render owner price table in station detail page
- [ ] **Sprint status:** Mark 7.3 ready-for-dev in sprint-status.yaml
