# Story 7.5: Owner Price Integrity Monitoring

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.5
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.3 (owner prices in PriceHistory with source='owner'), Story 7.2 (ClaimEmailService already built)
- **Modifies:** `photo-pipeline.worker.ts` (enqueue integrity check after price write), `PartnerService.updateOwnerPrice()` (integrity_hold gate)

---

## User Story

**As an ops admin,**
I want automated monitoring that flags when a verified station owner's submitted price is contradicted by community submissions,
So that bad-faith price manipulation is caught and reviewed without adding friction to honest owners.

---

## Context & Why

A station owner could post an artificially low price to attract map clicks, then not honour it at the pump. The 2% threshold is deliberately tight — 2% is substantial in a market where single-grosz differences drive driver decisions — while staying above noise from rounding. Implicit detection (community submissions as ground truth) avoids a driver-flagging loop. Owner prices are never auto-rolled back without human review.

**Architecture pattern:** Same BullMQ post-write job approach used by Story 6.1 (Price Drop Alerts). The photo pipeline worker enqueues an integrity check job best-effort after `priceService.setVerifiedPrice()`. The `IntegrityCheckWorker` processes asynchronously — no latency added to the OCR pipeline.

---

## Acceptance Criteria

**Given** a verified owner submits a price for a fuel type
**When** ≥2 community photo submissions for that fuel type at the same station arrive within 24 hours
**And** those community submissions report a price ≥2% higher than the owner-submitted price
**Then** an `IntegrityAlert` is created showing: station name, fuel type, owner price, community median price, % deviation, count of contradicting submissions, and timestamp

**Given** an integrity alert is created
**When** an ops admin views it in the admin panel
**Then** the owner-submitted price remains live — there is no automatic rollback
**And** the admin can choose: (a) dismiss as noise, (b) replace owner price with community median, (c) escalate to shadow-ban review

**Given** an owner account has ≥3 integrity alerts with `status = ESCALATED` (confirmed abuse, not dismissed) within any rolling 30-day window
**When** the third escalation is saved
**Then** `User.integrity_hold` is set to `true` for that owner
**And** subsequent price updates from that owner are written to `PendingOwnerPrice` (held queue) — not published to drivers

**Given** an ops admin opens the Pending Price Updates section
**When** a price update is in the held queue
**Then** the admin can approve (publishes to `PriceHistory` with `source: 'owner'`) or reject (discards)

**Given** an integrity alert has been open and unreviewed for 48 hours
**When** the deadline passes
**Then** an email reminder is sent to `ops@desert.app`

**Given** an owner submits a price ≥2% lower than the current community median
**When** it is their first such submission (no open `IntegrityAlert` on the account)
**Then** no alert is created — price drops below market are welcomed

**Given** ops takes any action on an alert (dismiss / replace / escalate)
**When** the action is saved
**Then** `IntegrityAlert.reviewed_at` and `IntegrityAlert.reviewed_by` are set, status updated, action logged via `AdminAuditLog`

---

## Schema Changes

### New enum: `IntegrityAlertStatus`

```prisma
enum IntegrityAlertStatus {
  OPEN
  DISMISSED   // dismissed as noise
  REPLACED    // owner price replaced with community median
  ESCALATED   // escalated to shadow-ban review (confirmed abuse)
}
```

### New model: `IntegrityAlert`

```prisma
model IntegrityAlert {
  id                     String               @id @default(uuid())
  station_id             String
  owner_user_id          String               // User.id of the station manager
  fuel_type              String
  owner_price            Float                // owner price at time of alert creation
  community_median_price Float                // median price of contradicting submissions
  deviation_pct          Float                // (community_median - owner_price) / owner_price * 100
  contradicting_count    Int                  // number of contradicting submissions in 24h window
  status                 IntegrityAlertStatus @default(OPEN)
  created_at             DateTime             @default(now())
  reviewed_at            DateTime?
  reviewed_by            String?              // admin User.id (not FK — log must survive admin deletion)

  station  Station @relation(fields: [station_id], references: [id])

  @@index([station_id, fuel_type, created_at])
  @@index([owner_user_id, status, created_at])
  @@index([status, created_at])
}
```

### New model: `PendingOwnerPrice`

```prisma
model PendingOwnerPrice {
  id           String    @id @default(uuid())
  station_id   String
  user_id      String    // owner User.id
  fuel_type    String
  price        Float
  created_at   DateTime  @default(now())
  reviewed_at  DateTime?
  reviewed_by  String?   // admin User.id
  approved     Boolean?  // null = pending, true = approved, false = rejected

  @@index([user_id, approved])
  @@index([approved, created_at])
}
```

### Addition to `User` model

```prisma
// User model — add:
integrity_hold Boolean @default(false)  // when true, owner price updates go to PendingOwnerPrice
```

### Addition to `Station` model

```prisma
// Station model — add:
integrityAlerts IntegrityAlert[]
```

**Migration name:** `add_integrity_alert`

---

## New Module: `apps/api/src/integrity/`

```
apps/api/src/integrity/
├── integrity.module.ts
├── integrity-alert.service.ts
├── integrity-check.worker.ts
└── integrity-reminder.worker.ts
```

### Queue names

```typescript
export const INTEGRITY_CHECK_QUEUE = 'integrity-checks';
export const INTEGRITY_REMINDER_QUEUE = 'integrity-reminders';
```

### `integrity-check.worker.ts`

```typescript
export interface IntegrityCheckJobData {
  stationId: string;
  fuelType: string;
  communityPrice: number;
  verifiedAt: string; // ISO timestamp
}

@Injectable()
export class IntegrityCheckWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrityCheckWorker.name);
  private worker!: Worker;
  private redisForBullMQ!: Redis;

  constructor(
    private readonly db: PrismaService,
    private readonly integrityAlertService: IntegrityAlertService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.redisForBullMQ = new Redis(this.config.getOrThrow('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<IntegrityCheckJobData>(
      INTEGRITY_CHECK_QUEUE,
      async (job) => {
        await this.processCheck(job.data);
      },
      { connection: this.redisForBullMQ },
    );
  }

  onModuleDestroy() {
    return Promise.all([this.worker.close(), this.redisForBullMQ.quit()]);
  }

  private async processCheck(data: IntegrityCheckJobData): Promise<void> {
    const { stationId, fuelType, communityPrice, verifiedAt } = data;
    const verifiedAtDate = new Date(verifiedAt);

    // 1. Find the latest owner price for this station + fuel type
    const ownerPriceRow = await this.db.priceHistory.findFirst({
      where: {
        station_id: stationId,
        fuel_type: fuelType,
        source: 'owner',
      },
      orderBy: { recorded_at: 'desc' },
      select: { price: true, recorded_at: true, submitted_by: true },
    });

    if (!ownerPriceRow) return; // no owner price — nothing to check

    // 2. Community price must be ≥2% HIGHER than owner price to trigger
    const deviation = (communityPrice - ownerPriceRow.price) / ownerPriceRow.price;
    if (deviation < 0.02) return; // price drop or within 2% — welcome, no alert

    // 3. Count contradicting submissions in the 24h window after the owner's price
    const windowStart = ownerPriceRow.recorded_at;
    const windowEnd = new Date(ownerPriceRow.recorded_at.getTime() + 24 * 60 * 60 * 1000);

    const contradicting = await this.db.$queryRaw<{ count: number; median_price: number }[]>`
      SELECT
        COUNT(*)::int                                           AS count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_val) AS median_price
      FROM (
        SELECT (elem.value::numeric) AS price_val
        FROM "Submission" s,
             jsonb_each_text(s.price_data) AS elem(key, value)
        WHERE s.station_id   = ${stationId}
          AND s.status        = 'verified'
          AND elem.key        = ${fuelType}
          AND s.created_at   >= ${windowStart}
          AND s.created_at   <= ${windowEnd}
          AND (elem.value::numeric) > ${ownerPriceRow.price * 1.02}
      ) sub
    `;

    const { count, median_price: communityMedian } = contradicting[0] ?? { count: 0, median_price: communityPrice };

    if (count < 2) return; // threshold not met

    // 4. Dedup: skip if OPEN alert already exists for this station+fuelType
    const existing = await this.db.integrityAlert.findFirst({
      where: {
        station_id: stationId,
        fuel_type: fuelType,
        status: 'OPEN',
      },
    });
    if (existing) return;

    // 5. Create alert
    const deviationPct = ((communityMedian - ownerPriceRow.price) / ownerPriceRow.price) * 100;

    const alert = await this.db.integrityAlert.create({
      data: {
        station_id: stationId,
        owner_user_id: ownerPriceRow.submitted_by ?? '',
        fuel_type: fuelType,
        owner_price: ownerPriceRow.price,
        community_median_price: communityMedian,
        deviation_pct: deviationPct,
        contradicting_count: count,
      },
    });

    // 6. Schedule 48h ops reminder
    await this.integrityAlertService.scheduleReminder(alert.id);

    this.logger.log(
      `IntegrityAlert created: station=${stationId} fuel=${fuelType} deviation=${deviationPct.toFixed(1)}%`,
    );
  }
}
```

### `integrity-alert.service.ts`

```typescript
@Injectable()
export class IntegrityAlertService {
  constructor(
    private readonly db: PrismaService,
    private readonly claimEmailService: ClaimEmailService,
    @InjectQueue(INTEGRITY_REMINDER_QUEUE) private readonly reminderQueue: Queue,
  ) {}

  async scheduleReminder(alertId: string): Promise<void> {
    await this.reminderQueue.add(
      'integrity-reminder',
      { alertId },
      {
        delay: 48 * 60 * 60 * 1000,
        jobId: `integrity-reminder-${alertId}`, // idempotent
      },
    );
  }

  /** Called by ops admin: dismiss alert as noise */
  async dismiss(alertId: string, adminId: string): Promise<void> {
    await this.db.$transaction([
      this.db.integrityAlert.update({
        where: { id: alertId },
        data: { status: 'DISMISSED', reviewed_at: new Date(), reviewed_by: adminId },
      }),
      this.db.adminAuditLog.create({
        data: { admin_user_id: adminId, action: 'INTEGRITY_DISMISS', notes: alertId },
      }),
    ]);
  }

  /** Called by ops admin: replace owner price with community median */
  async replaceWithMedian(alertId: string, adminId: string): Promise<void> {
    const alert = await this.db.integrityAlert.findUniqueOrThrow({
      where: { id: alertId },
    });

    await this.db.$transaction([
      // Write community median as admin_override price
      this.db.priceHistory.create({
        data: {
          station_id: alert.station_id,
          fuel_type: alert.fuel_type,
          price: alert.community_median_price,
          source: 'admin_override',
          submitted_by: adminId,
        },
      }),
      this.db.integrityAlert.update({
        where: { id: alertId },
        data: { status: 'REPLACED', reviewed_at: new Date(), reviewed_by: adminId },
      }),
      this.db.adminAuditLog.create({
        data: {
          admin_user_id: adminId,
          action: 'INTEGRITY_REPLACE',
          notes: `alert=${alertId} median=${alert.community_median_price}`,
        },
      }),
    ]);

    // Invalidate Redis cache so drivers see the new price immediately
    // (PriceCacheService is in PriceModule — import it or use a simple Redis del)
    // If PriceModule is not available in IntegrityModule, inject RedisService directly:
    // await this.redis.del(`price:station:${alert.station_id}`);
  }

  /** Called by ops admin: escalate to shadow-ban review */
  async escalate(alertId: string, adminId: string): Promise<void> {
    const alert = await this.db.integrityAlert.findUniqueOrThrow({
      where: { id: alertId },
    });

    await this.db.$transaction([
      this.db.integrityAlert.update({
        where: { id: alertId },
        data: { status: 'ESCALATED', reviewed_at: new Date(), reviewed_by: adminId },
      }),
      this.db.adminAuditLog.create({
        data: { admin_user_id: adminId, action: 'INTEGRITY_ESCALATE', notes: alertId },
      }),
    ]);

    // Check 30-day rolling escalated count for this owner
    await this.checkAndApplyIntegrityHold(alert.owner_user_id);
  }

  private async checkAndApplyIntegrityHold(ownerUserId: string): Promise<void> {
    if (!ownerUserId) return;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const escalatedCount = await this.db.integrityAlert.count({
      where: {
        owner_user_id: ownerUserId,
        status: 'ESCALATED',
        created_at: { gte: since },
      },
    });

    if (escalatedCount >= 3) {
      await this.db.user.update({
        where: { id: ownerUserId },
        data: { integrity_hold: true },
      });
      this.logger.warn(`integrity_hold applied to user ${ownerUserId} after ${escalatedCount} escalations`);
    }
  }

  /** Admin: approve a held price update — publishes to PriceHistory */
  async approvePendingPrice(pendingId: string, adminId: string): Promise<void> {
    const pending = await this.db.pendingOwnerPrice.findUniqueOrThrow({
      where: { id: pendingId },
    });

    await this.db.$transaction([
      this.db.priceHistory.create({
        data: {
          station_id: pending.station_id,
          fuel_type: pending.fuel_type,
          price: pending.price,
          source: 'owner',
          submitted_by: pending.user_id,
        },
      }),
      this.db.pendingOwnerPrice.update({
        where: { id: pendingId },
        data: { approved: true, reviewed_at: new Date(), reviewed_by: adminId },
      }),
      this.db.adminAuditLog.create({
        data: { admin_user_id: adminId, action: 'PENDING_PRICE_APPROVE', notes: pendingId },
      }),
    ]);

    // Invalidate Redis cache
    await this.invalidateStationCache(pending.station_id);
  }

  /** Admin: reject a held price update — discards without publishing */
  async rejectPendingPrice(pendingId: string, adminId: string): Promise<void> {
    await this.db.$transaction([
      this.db.pendingOwnerPrice.update({
        where: { id: pendingId },
        data: { approved: false, reviewed_at: new Date(), reviewed_by: adminId },
      }),
      this.db.adminAuditLog.create({
        data: { admin_user_id: adminId, action: 'PENDING_PRICE_REJECT', notes: pendingId },
      }),
    ]);
  }

  private async invalidateStationCache(stationId: string): Promise<void> {
    // Direct Redis del — avoids importing PriceModule into IntegrityModule
    // Key format matches PriceCacheService: price:station:{id}
    await this.redis.del(`price:station:${stationId}`);
  }
}
```

**Inject `RedisService` into `IntegrityAlertService`** for the cache invalidation (avoids circular dependency with `PriceModule`). Alternatively import `PriceModule` if it exports `PriceCacheService` — check `PriceModule` exports.

### `integrity-reminder.worker.ts`

```typescript
@Injectable()
export class IntegrityReminderWorker implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker;
  private redisForBullMQ!: Redis;

  constructor(
    private readonly db: PrismaService,
    private readonly claimEmailService: ClaimEmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.redisForBullMQ = new Redis(this.config.getOrThrow('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<{ alertId: string }>(
      INTEGRITY_REMINDER_QUEUE,
      async (job) => {
        const alert = await this.db.integrityAlert.findUnique({
          where: { id: job.data.alertId },
          include: { station: { select: { name: true } } },
        });

        if (!alert || alert.status !== 'OPEN') return; // already resolved

        await this.claimEmailService.sendOpsAlert(
          `Unreviewed integrity alert: ${alert.station.name}`,
          `<p>An integrity alert for <strong>${alert.station.name}</strong> (${alert.fuel_type}) has been open for 48 hours.</p>
           <p>Owner price: ${alert.owner_price.toFixed(3)} PLN/L | Community median: ${alert.community_median_price.toFixed(3)} PLN/L | Deviation: ${alert.deviation_pct.toFixed(1)}%</p>
           <p>Please review in the admin panel.</p>`,
        );
      },
      { connection: this.redisForBullMQ },
    );
  }

  onModuleDestroy() {
    return Promise.all([this.worker.close(), this.redisForBullMQ.quit()]);
  }
}
```

### `integrity.module.ts`

```typescript
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    PartnerModule,  // provides ClaimEmailService (exported in 7.2)
    BullModule.forFeature([
      { name: INTEGRITY_CHECK_QUEUE },
      { name: INTEGRITY_REMINDER_QUEUE },
    ]),
  ],
  providers: [IntegrityAlertService, IntegrityCheckWorker, IntegrityReminderWorker],
  exports: [IntegrityAlertService],
})
export class IntegrityModule {}
```

Register in `apps/api/src/app.module.ts`:
```typescript
import { IntegrityModule } from './integrity/integrity.module.js';
// Add to imports:
IntegrityModule,
```

---

## Photo Pipeline Hook

In `apps/api/src/photo/photo-pipeline.worker.ts`, after `this.priceService.setVerifiedPrice()` (line ~620), enqueue integrity check jobs:

```typescript
// In PhotoPipelineWorker — add to constructor:
@InjectQueue(INTEGRITY_CHECK_QUEUE) private readonly integrityCheckQueue: Queue,

// After setVerifiedPrice() call (best-effort, non-blocking):
const fuelTypesVerified = Object.keys(validatedPrices.prices);
for (const fuelType of fuelTypesVerified) {
  const price = validatedPrices.prices[fuelType];
  if (price === undefined) continue;

  this.integrityCheckQueue
    .add(
      'integrity-check',
      {
        stationId,
        fuelType,
        communityPrice: price,
        verifiedAt: new Date().toISOString(),
      },
      {
        // jobId not set — allow multiple jobs per station/fuel (each submission checked independently)
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    )
    .catch((err) => this.logger.warn(`Failed to enqueue integrity check: ${String(err)}`));
}
```

**Import** `INTEGRITY_CHECK_QUEUE` from `integrity/integrity-check.worker.ts`.

**`PhotoModule` needs the BullMQ queue from `IntegrityModule`:**

In `apps/api/src/photo/photo.module.ts`, add:
```typescript
BullModule.registerQueue({ name: INTEGRITY_CHECK_QUEUE }),
```

This follows the same pattern as Story 6.1 where `PhotoModule` registers the `price-drop-checks` queue without importing the full `PriceDropAlertModule`.

---

## `PartnerService.updateOwnerPrice()` — add integrity hold gate

Add at the top of the method (before validation):

```typescript
// Check integrity hold — held owners go to pending queue
const userFlags = await this.db.user.findUniqueOrThrow({
  where: { id: userId },
  select: { integrity_hold: true },
});

if (userFlags.integrity_hold) {
  // Validate range first (still reject obviously invalid prices)
  // ... (run validation as normal, but write to PendingOwnerPrice on success)
  await this.db.pendingOwnerPrice.create({
    data: {
      station_id: stationId,
      user_id: userId,
      fuel_type: fuelType,
      price,
    },
  });
  return { held: true };
}
```

Update the return type to include `{ held: true }` and handle it in `PartnerController`:

```typescript
// In PartnerController.updatePrice():
const result = await this.partnerService.updateOwnerPrice(...);

if (result && 'held' in result && result.held) {
  return {
    status: 'pending_review',
    message: 'Your price update is under review and will be published once approved.',
  };
}
// ... existing range error and success handling
```

The partner app `PriceUpdatePanel` should handle `status: 'pending_review'` response:
```typescript
if (body.status === 'pending_review') {
  setRows((r) => ({
    ...r,
    [fuelType]: { ...r[fuelType], status: 'idle', error: body.message },
  }));
}
```

---

## Admin Panel: Integrity Alerts Section

### New admin pages

```
apps/admin/app/(protected)/integrity/
├── page.tsx          # open alerts list
├── actions.ts        # dismiss / replace / escalate server actions
└── pending/
    └── page.tsx      # pending price updates list + approve/reject
```

### `lib/types.ts` additions

```typescript
export interface IntegrityAlertRow {
  id: string;
  station_id: string;
  station_name: string;
  owner_user_id: string;
  fuel_type: string;
  owner_price: number;
  community_median_price: number;
  deviation_pct: number;
  contradicting_count: number;
  status: 'OPEN' | 'DISMISSED' | 'REPLACED' | 'ESCALATED';
  created_at: string;
}

export interface PendingOwnerPriceRow {
  id: string;
  station_id: string;
  station_name: string;
  user_email: string | null;
  fuel_type: string;
  price: number;
  created_at: string;
}
```

### Admin API endpoints (add to `AdminClaimsController` or new `AdminIntegrityController`)

Create `apps/api/src/admin/admin-integrity.controller.ts`:

```typescript
@Controller('v1/admin/integrity')
@Roles(UserRole.ADMIN)
export class AdminIntegrityController {
  constructor(private readonly integrityAlertService: IntegrityAlertService) {}

  /** GET /v1/admin/integrity/alerts?status=OPEN */
  @Get('alerts')
  async listAlerts(@Query('status') status = 'OPEN') {
    const alerts = await this.db.integrityAlert.findMany({
      where: { status: status as IntegrityAlertStatus },
      include: { station: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
      take: 100,
    });
    return alerts.map((a) => ({
      id: a.id,
      station_id: a.station_id,
      station_name: a.station.name,
      owner_user_id: a.owner_user_id,
      fuel_type: a.fuel_type,
      owner_price: a.owner_price,
      community_median_price: a.community_median_price,
      deviation_pct: a.deviation_pct,
      contradicting_count: a.contradicting_count,
      status: a.status,
      created_at: a.created_at.toISOString(),
    }));
  }

  /** POST /v1/admin/integrity/alerts/{id}/dismiss */
  @Post('alerts/:id/dismiss')
  async dismiss(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.integrityAlertService.dismiss(id, admin.id);
    return { status: 'dismissed' };
  }

  /** POST /v1/admin/integrity/alerts/{id}/replace */
  @Post('alerts/:id/replace')
  async replace(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.integrityAlertService.replaceWithMedian(id, admin.id);
    return { status: 'replaced' };
  }

  /** POST /v1/admin/integrity/alerts/{id}/escalate */
  @Post('alerts/:id/escalate')
  async escalate(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.integrityAlertService.escalate(id, admin.id);
    return { status: 'escalated' };
  }

  /** GET /v1/admin/integrity/pending-prices */
  @Get('pending-prices')
  async listPending() {
    const rows = await this.db.pendingOwnerPrice.findMany({
      where: { approved: null },
      orderBy: { created_at: 'asc' },
    });
    // Join station and user manually (no FK on PendingOwnerPrice)
    // ... enrich with station.name and user.email via separate queries
    return rows;
  }

  /** POST /v1/admin/integrity/pending-prices/{id}/approve */
  @Post('pending-prices/:id/approve')
  async approvePending(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.integrityAlertService.approvePendingPrice(id, admin.id);
    return { status: 'approved' };
  }

  /** POST /v1/admin/integrity/pending-prices/{id}/reject */
  @Post('pending-prices/:id/reject')
  async rejectPending(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.integrityAlertService.rejectPendingPrice(id, admin.id);
    return { status: 'rejected' };
  }
}
```

Register in `AdminModule` — inject `PrismaService` into `AdminIntegrityController` directly (or delegate to `IntegrityAlertService`). Add `IntegrityModule` to `AdminModule` imports.

### Admin sidebar — add "Integrity" nav item

In `apps/admin/app/(protected)/layout.tsx`:
```typescript
{ href: '/integrity', label: t.nav.integrity },
```

Add to `i18n.ts` nav translations (pl/en/uk).

### `app/(protected)/integrity/actions.ts`

```typescript
'use server';
import { adminFetch } from '../../../lib/admin-api';
import { revalidatePath } from 'next/cache';

export async function dismissAlert(alertId: string) {
  await adminFetch(`/v1/admin/integrity/alerts/${alertId}/dismiss`, { method: 'POST' });
  revalidatePath('/integrity');
}

export async function replaceAlert(alertId: string) {
  await adminFetch(`/v1/admin/integrity/alerts/${alertId}/replace`, { method: 'POST' });
  revalidatePath('/integrity');
}

export async function escalateAlert(alertId: string) {
  await adminFetch(`/v1/admin/integrity/alerts/${alertId}/escalate`, { method: 'POST' });
  revalidatePath('/integrity');
}

export async function approvePendingPrice(pendingId: string) {
  await adminFetch(`/v1/admin/integrity/pending-prices/${pendingId}/approve`, { method: 'POST' });
  revalidatePath('/integrity/pending');
}

export async function rejectPendingPrice(pendingId: string) {
  await adminFetch(`/v1/admin/integrity/pending-prices/${pendingId}/reject`, { method: 'POST' });
  revalidatePath('/integrity/pending');
}
```

---

## Dev Notes

### Median calculation for contradicting submissions
The SQL uses `PERCENTILE_CONT(0.5)` — same aggregate used in Story 6.2 (community rise detection). It operates over a lateral join that unpacks `Submission.price_data` JSONB. The query filters only submissions where the price for `fuelType` exceeds `ownerPrice * 1.02`. The median of this filtered set is the `community_median_price` stored in the alert.

### Submission.price_data JSON structure
`price_data` is a JSONB column. The schema stores fuel prices as `{ "PB_95": 6.89, "ON": 6.45 }`. The SQL unpacks with `jsonb_each_text(s.price_data) AS elem(key, value)`, then casts `value` to `numeric`. This is the same pattern used in Story 6.2's CTE.

### Dedup: one OPEN alert per station+fuelType
`IntegrityCheckWorker` skips alert creation if an OPEN alert already exists for `[station_id, fuel_type]`. This prevents alert flooding when many community submissions arrive in quick succession. Once an alert is reviewed (any status change), new submissions can trigger a fresh alert.

### `PriceHistory.submitted_by` for owner_user_id
`IntegrityCheckWorker` reads `submitted_by` from the latest `PriceHistory` row with `source='owner'`. This field was added in Story 7.3. If `submitted_by` is null (data written before 7.3 shipped), the alert is still created but `owner_user_id` is stored as empty string — ops can still see the station and fuel type.

### AdminAuditLog — action strings for integrity
Using new action strings: `INTEGRITY_DISMISS`, `INTEGRITY_REPLACE`, `INTEGRITY_ESCALATE`, `PENDING_PRICE_APPROVE`, `PENDING_PRICE_REJECT`. These are freeform strings (the column is `String`, not an enum) — no schema migration needed for `AdminAuditLog`.

### Cache invalidation in `replaceWithMedian`
After replacing the owner price with the community median, the Redis cache for that station must be invalidated so drivers see the updated price immediately. `IntegrityAlertService` has `RedisService` injected for this. The cache key is `price:station:{stationId}` — must match `PriceCacheService`'s `KEY_PREFIX`. Add a constant:

```typescript
// In a shared location, or inline in IntegrityAlertService:
const PRICE_CACHE_KEY = (stationId: string) => `price:station:${stationId}`;
```

Verify this matches `PriceCacheService`'s key format before shipping.

### `integrity_hold` is not reversible via ops UI in this story
Story 7.5 sets `integrity_hold = true` automatically after 3 escalations. There is no UI to remove the hold in this story. Ops can manually clear it via the database or a future admin action. Add a note to `project_deferred.md`: "Add integrity_hold lift action to admin panel (Story 7.5 sets it but doesn't provide removal UI)."

### `PhotoModule` circular dependency risk
`PhotoModule` registers `INTEGRITY_CHECK_QUEUE` via `BullModule.registerQueue`. It does NOT import `IntegrityModule`. `IntegrityModule` does NOT import `PhotoModule`. There is no circular dependency.

The queue name constant (`INTEGRITY_CHECK_QUEUE`) is exported from `integrity/integrity-check.worker.ts` and imported in `photo/photo.module.ts`. This is a safe string constant import — no module circular dep.

### `PendingOwnerPrice` — no Station/User FK relations in Prisma
`PendingOwnerPrice` does not define Prisma relations to `Station` or `User` (to keep the schema simple and avoid FK constraint issues). In `listPending()`, enrich results with a separate query: fetch `station.name` by `station_id` and `user.email` by `user_id` in a single `$queryRaw` JOIN.

---

## Tasks

- [ ] **Schema:** Add `IntegrityAlertStatus` enum; add `IntegrityAlert` model; add `PendingOwnerPrice` model; add `integrity_hold Boolean @default(false)` to `User`; add `integrityAlerts` relation to `Station`; run `prisma migrate dev --name add_integrity_alert`
- [ ] **API:** Create `apps/api/src/integrity/` with `IntegrityModule`, `IntegrityAlertService`, `IntegrityCheckWorker`, `IntegrityReminderWorker`
- [ ] **API:** Register `INTEGRITY_CHECK_QUEUE` and `INTEGRITY_REMINDER_QUEUE` in `IntegrityModule`
- [ ] **API:** Register `IntegrityModule` in `app.module.ts`
- [ ] **API:** Add `BullModule.registerQueue({ name: INTEGRITY_CHECK_QUEUE })` to `PhotoModule`
- [ ] **API:** Inject `@InjectQueue(INTEGRITY_CHECK_QUEUE)` into `PhotoPipelineWorker`; enqueue integrity check jobs after `setVerifiedPrice()` — best-effort, non-blocking
- [ ] **API:** Add `integrity_hold` gate to `PartnerService.updateOwnerPrice()` — write to `PendingOwnerPrice` when hold is active; return `{ held: true }`
- [ ] **API:** Update `PartnerController.updatePrice()` to handle `{ held: true }` → return `{ status: 'pending_review', message: '...' }`
- [ ] **API:** Create `admin-integrity.controller.ts` with list/dismiss/replace/escalate for alerts and list/approve/reject for pending prices
- [ ] **API:** Register `AdminIntegrityController` in `AdminModule`; import `IntegrityModule` in `AdminModule`
- [ ] **Admin:** Add `IntegrityAlertRow`, `PendingOwnerPriceRow` types to `apps/admin/lib/types.ts`
- [ ] **Admin:** Create `apps/admin/app/(protected)/integrity/page.tsx` — open alerts table with action buttons (dismiss/replace/escalate)
- [ ] **Admin:** Create `apps/admin/app/(protected)/integrity/actions.ts` with server actions
- [ ] **Admin:** Create `apps/admin/app/(protected)/integrity/pending/page.tsx` — pending price updates with approve/reject
- [ ] **Admin:** Add "Integrity" nav item to sidebar and i18n strings
- [ ] **Partner app:** Update `PriceUpdatePanel` to handle `status: 'pending_review'` response
- [ ] **Sprint status:** Mark 7.5 ready-for-dev in sprint-status.yaml
