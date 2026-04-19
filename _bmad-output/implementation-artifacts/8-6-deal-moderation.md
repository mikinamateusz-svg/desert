# Story 8.6: Deal Moderation

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.6
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 8.5 (`Deal`, `DealStation` models, `DEAL_ACTIVATE_QUEUE` constant, `DealEmailService`, `DealService` exported from `DealModule`)
- **Required by:** Story 8.7 (displays APPROVED deals with `start_date <= now <= end_date` in station sheet)

---

## User Story

**As an ops admin,**
I want to review submitted deals before they go live and manage active deals,
So that false, misleading, or expired promotional claims never reach drivers.

---

## Context & Why

Unlike promoted placement (pure visibility boost with an automated price gate), deal advertising makes a specific factual claim — "20 gr/L off with our loyalty card" — that could be false or outdated. A human review step before going live protects driver trust. The ops surface must make verification fast: one click to open the proof URL, approve or reject. Auto-expiry on end date keeps the queue clean without daily ops effort.

### Patterns to Follow

All admin controller endpoints follow `apps/api/src/admin/` with `@Roles(UserRole.ADMIN)`. All moderation actions create an `AdminAuditLog` row with `admin_user_id`, `action`, `notes`. Admin app pages follow the pattern from `/claims` (Story 7.2) and `/integrity` (Story 7.5).

---

## Acceptance Criteria

**Given** an ops admin opens the Deals section of the admin panel
**When** they view it
**Then** they see a paginated list of deals with status `PENDING_REVIEW`, sorted oldest first (FIFO moderation queue)
**And** each row shows: station name(s), offer text, proof URL (clickable link, opens new tab), start date, end date, submitter account name, submission timestamp

**Given** an ops admin approves a deal
**When** they click Approve
**Then** the deal status is set to `APPROVED`, `approved_at` and `approved_by` are recorded
**And** if `start_immediately = true` OR `start_date <= now()`: the deal is visible to drivers immediately (Story 8.7 display filter activates)
**And** if `start_date > now()`: a BullMQ delayed job `deal-activate-{dealId}` is scheduled at `start_date` (for observability only — no status change needed, display logic is date-driven)
**And** the submitter receives an approval email
**And** an `AdminAuditLog` row is created: `action: 'DEAL_APPROVE'`

**Given** an ops admin rejects a deal
**When** they enter a reason and click Reject
**Then** the deal status is set to `REJECTED`, `rejection_reason` stored
**And** the deal is removed from the pending queue
**And** the submitter receives a rejection email with the rejection reason
**And** an `AdminAuditLog` row is created: `action: 'DEAL_REJECT'`

**Given** an active deal's `end_date` has passed
**When** the daily expiry job runs (06:00 UTC)
**Then** the deal status is set to `EXPIRED`
**And** no ops action is required — the deal is automatically removed from station sheets (Story 8.7 date filter stops including it)

**Given** an ops admin identifies an active deal that is no longer valid
**When** they manually expire it
**Then** the deal status is set to `EXPIRED` immediately
**And** an `AdminAuditLog` row is created: `action: 'DEAL_MANUAL_EXPIRE'`
**And** the deal is removed from station sheets on the next driver app load (Story 8.7 reads current status)

**Given** any moderation action (approve, reject, manual expire)
**When** it is saved
**Then** it is logged with: admin user ID, action string, deal ID in notes, timestamp

---

## API Changes

### New Admin Controller: AdminDealsController

**Location:** `apps/api/src/admin/admin-deals.controller.ts`

```typescript
@Controller('v1/admin/deals')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDealsController {
  constructor(
    private readonly dealService: DealService,
    private readonly prisma: PrismaService,
    private readonly dealEmailService: DealEmailService,
  ) {}

  // GET /v1/admin/deals?status=PENDING_REVIEW&page=1&limit=25
  // Returns: { data: AdminDealRow[]; total: number }
  @Get()
  async listDeals(
    @Query('status') status = 'PENDING_REVIEW',
    @Query('page') page = '1',
    @Query('limit') limit = '25',
  ) {}

  // POST /v1/admin/deals/:id/approve
  @Post(':id/approve')
  async approveDeal(@Param('id') id: string, @CurrentUser() admin: User) {}

  // POST /v1/admin/deals/:id/reject
  @Post(':id/reject')
  async rejectDeal(
    @Param('id') id: string,
    @CurrentUser() admin: User,
    @Body() dto: RejectDealDto,
  ) {}

  // POST /v1/admin/deals/:id/expire
  @Post(':id/expire')
  async expireDeal(@Param('id') id: string, @CurrentUser() admin: User) {}
}
```

### AdminDealRow Type

```typescript
// apps/api/src/admin/dto/admin-deal.dto.ts
export interface AdminDealRow {
  id: string;
  status: DealStatus;
  offerText: string;
  proofUrl: string;
  startImmediately: boolean;
  startDate: string;   // ISO
  endDate: string;     // ISO
  createdAt: string;   // ISO
  submitterEmail: string | null;
  submitterDisplayName: string | null;
  stations: { id: string; name: string }[];
}
```

### RejectDealDto

```typescript
export class RejectDealDto {
  @IsString() @MinLength(1) @MaxLength(500)
  reason: string;
}
```

### DealService — Moderation Methods

Add to `apps/api/src/deal/deal.service.ts`:

```typescript
// approveDeal(dealId: string, adminUserId: string): Promise<void>
//   1. Load deal (throw 404 if not found, throw 400 if status !== PENDING_REVIEW)
//   2. prisma.$transaction:
//      - deal.status = APPROVED
//      - deal.approved_at = now()
//      - deal.approved_by = adminUserId
//      - adminAuditLog.create({ admin_user_id: adminUserId, action: 'DEAL_APPROVE', notes: `dealId=${dealId}` })
//   3. If deal.start_date > now(): schedule BullMQ delayed job
//      await this.dealActivateQueue.add(
//        'activate',
//        { dealId },
//        { delay: deal.start_date.getTime() - Date.now(), jobId: `deal-activate-${dealId}` }
//      )
//   4. Send approval email (fire-and-forget)
//      this.dealEmailService.sendDealApproved(submitter.email, deal).catch(...)

// rejectDeal(dealId: string, reason: string, adminUserId: string): Promise<void>
//   1. Load deal (throw 404, throw 400 if status !== PENDING_REVIEW)
//   2. prisma.$transaction:
//      - deal.status = REJECTED
//      - deal.rejection_reason = reason
//      - adminAuditLog.create({ ..., action: 'DEAL_REJECT', notes: `dealId=${dealId} reason=${reason}` })
//   3. Send rejection email (fire-and-forget)

// expireDeal(dealId: string, adminUserId: string): Promise<void>
//   1. Load deal
//   2. Verify status is APPROVED (throw 400 if already EXPIRED/REJECTED/WITHDRAWN)
//   3. prisma.$transaction:
//      - deal.status = EXPIRED
//      - adminAuditLog.create({ ..., action: 'DEAL_MANUAL_EXPIRE', notes: `dealId=${dealId}` })
//   4. Remove any pending BullMQ activation job (best-effort):
//      await this.dealActivateQueue.remove(`deal-activate-${dealId}`).catch(() => {})
```

### DealService — listDealsAdmin

```typescript
// listDealsAdmin(status: string, page: number, limit: number): Promise<{ data: AdminDealRow[]; total: number }>
//   - Fetch deals with status filter, include deal_stations.station (name only)
//   - Include user (email, display_name) via join
//   - Paginate: skip = (page - 1) * limit
//   - Order: PENDING_REVIEW → createdAt ASC (oldest first); others → createdAt DESC

const [deals, total] = await Promise.all([
  this.prisma.deal.findMany({
    where: { status: status as DealStatus },
    include: {
      deal_stations: { include: { station: { select: { id: true, name: true } } } },
      user: { select: { email: true, display_name: true } },
    },
    orderBy: { created_at: status === 'PENDING_REVIEW' ? 'asc' : 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  }),
  this.prisma.deal.count({ where: { status: status as DealStatus } }),
]);
```

### BullMQ — Deal Expiry Worker

Add a **daily expiry job** alongside the pause check pattern from Story 8.1.

**Option A (separate queue):** New `DEAL_EXPIRE_QUEUE = 'deal-expire'` with its own repeatable job.

**Option B (extend PromotionPauseCheckWorker):** Add deal expiry logic to the existing 04:00 UTC daily job in `PromotionPauseCheckWorker`.

**Chosen: Option B** — keeps all daily maintenance in one worker to avoid proliferating scheduled jobs. Rename the job name from `'daily-check'` to `'daily-maintenance'` and add deal expiry to `checkAndPauseCampaigns()`.

```typescript
// In PromotionService.checkAndPauseCampaigns() — add at the end:
// Expire past-due deals
const expiredDeals = await this.prisma.deal.findMany({
  where: {
    status: DealStatus.APPROVED,
    end_date: { lt: new Date() },
  },
  select: { id: true },
});
if (expiredDeals.length > 0) {
  await this.prisma.deal.updateMany({
    where: { id: { in: expiredDeals.map(d => d.id) } },
    data: { status: DealStatus.EXPIRED },
  });
  this.logger.log(`Expired ${expiredDeals.length} deals`);
}
```

`PromotionService` needs `DealModule` imported — OR inject `PrismaService` directly (already injected in `PromotionService`). Since `PromotionService` already has `PrismaService`, add the deal expiry SQL directly without importing `DealService` (avoids circular dep). Acceptable since it's a simple `updateMany`.

---

## Admin App Changes

### New Admin Page: `/deals`

**File structure:**

```
apps/admin/app/(protected)/deals/
├── page.tsx          # pending queue (Server Component)
├── actions.ts        # approve / reject / expire Server Actions
└── history/
    └── page.tsx      # approved + expired + rejected history (Server Component)
```

### `deals/page.tsx` — Pending Queue

```tsx
// Server Component
// Fetches GET /v1/admin/deals?status=PENDING_REVIEW&page=1 via adminFetch
// Renders paginated table:
// | Station(s) | Offer text | Proof URL | Start | End | Submitted by | Submitted at | Actions |
// Actions column: [Approve] [Reject] buttons
// Proof URL: <a href={deal.proofUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
// Long offer text: truncated to 80 chars with tooltip showing full text
// Station names: if > 2 stations, show "[Station 1], [Station 2] +N more"
```

### `deals/actions.ts` — Server Actions

```typescript
'use server';
import { adminFetch } from '../../../lib/admin-api';
import { revalidatePath } from 'next/cache';

export async function approveDeal(dealId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/deals/${dealId}/approve`, { method: 'POST' });
    revalidatePath('/deals');
    return {};
  } catch {
    return { error: 'Failed to approve deal' };
  }
}

export async function rejectDeal(dealId: string, reason: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/deals/${dealId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    revalidatePath('/deals');
    return {};
  } catch {
    return { error: 'Failed to reject deal' };
  }
}

export async function expireDeal(dealId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/deals/${dealId}/expire`, { method: 'POST' });
    revalidatePath('/deals');
    revalidatePath('/deals/history');
    return {};
  } catch {
    return { error: 'Failed to expire deal' };
  }
}
```

### `deals/history/page.tsx` — Deal History

```tsx
// Server Component
// Fetches GET /v1/admin/deals?status=APPROVED (active + future)
// Tab/toggle to switch between: Active, Upcoming, Expired, Rejected
// Active deals show [Expire] button (calls expireDeal Server Action)
// Rejected/expired are read-only with reason shown
```

### Reject Form — Inline Modal

Rejection requires entering a reason. Use an inline form pattern (already used in admin for other rejection flows):

```tsx
// In deals/page.tsx (Client Component island):
// When "Reject" is clicked: expand inline form below the row
// Input: <textarea name="reason" rows={2} placeholder="Reason for rejection..." />
// Buttons: [Confirm Reject] [Cancel]
// On confirm: call rejectDeal(dealId, reason) Server Action
```

### AdminAuditLog Type Additions

```typescript
// apps/admin/lib/types.ts — add to AdminAuditLog action strings docs:
// 'DEAL_APPROVE'         — deal approved by ops
// 'DEAL_REJECT'          — deal rejected with reason
// 'DEAL_MANUAL_EXPIRE'   — deal manually expired by ops
```

### Sidebar Navigation Update

Add "Deals" nav item to `apps/admin/app/(protected)/layout.tsx`:

```typescript
// In the nav items array, add after "Chain Claims" (from Story 7.6):
{ href: '/deals', label: t.nav.deals }
```

Add `t.nav.deals` to `apps/admin/lib/i18n.ts`:

```typescript
// In the i18n nav object:
deals: 'Deals',
```

---

## DealEmailService — Approval & Rejection Emails

Add to `apps/api/src/deal/deal-email.service.ts` (stub methods defined in Story 8.5, now implemented):

```typescript
// sendDealApproved(userEmail: string, deal: Deal, stationNames: string[]): Promise<void>
//   Subject: "Twoja oferta została zatwierdzona"
//   Body:
//     "Twoja oferta '[offerText]' dla stacji [station names] została zatwierdzona.
//      Zostanie opublikowana [od razu / dnia {startDate}] i będzie widoczna do {endDate}."

// sendDealRejected(userEmail: string, deal: Deal, reason: string): Promise<void>
//   Subject: "Twoja oferta nie została zatwierdzona"
//   Body:
//     "Twoja oferta '[offerText]' nie została zatwierdzona.
//      Powód: [reason]
//      Możesz poprawić ofertę i złożyć ją ponownie."
```

To get station names for the email, load `DealStation` rows with `station.name` when approving/rejecting.

---

## AdminAuditLog — Prisma Model Reference

`AdminAuditLog` schema (from Story 7.5, already exists after that migration):

```prisma
model AdminAuditLog {
  id            String   @id @default(uuid())
  admin_user_id String
  action        String   // e.g. 'DEAL_APPROVE', 'DEAL_REJECT', 'DEAL_MANUAL_EXPIRE'
  notes         String?  // free-form context, e.g. "dealId=xyz123 reason=..."
  created_at    DateTime @default(now())
}
```

---

## Module Updates

### AdminModule

Add `AdminDealsController` to `AdminModule`'s controllers array. Ensure `DealModule` is imported into `AdminModule` (for `DealService` injection):

```typescript
// apps/api/src/admin/admin.module.ts
@Module({
  imports: [
    // ... existing imports ...
    DealModule,
  ],
  controllers: [
    // ... existing controllers ...
    AdminDealsController,
  ],
})
export class AdminModule {}
```

### PromotionModule — Deal Expiry

`PromotionService` needs access to `DealStatus` enum. Since `DealStatus` is a Prisma enum, it's available from `@prisma/client` — no module import needed. Just use `DealStatus.APPROVED` and `DealStatus.EXPIRED` in the `checkAndPauseCampaigns()` method directly.

---

## Tasks / Subtasks

- [ ] API: DealService — moderation methods (AC: 2, 3, 4, 5, 6)
  - [ ] `approveDeal()`: status update + audit log + BullMQ delayed job (future-dated) + email
  - [ ] `rejectDeal()`: status update + rejection reason + audit log + email
  - [ ] `expireDeal()`: status update + audit log + remove BullMQ job
  - [ ] `listDealsAdmin()`: paginated query with stations + user join

- [ ] API: AdminDealsController (AC: 1, 2, 3, 5, 6)
  - [ ] `GET /v1/admin/deals` — paginated list with status filter
  - [ ] `POST /v1/admin/deals/:id/approve`
  - [ ] `POST /v1/admin/deals/:id/reject` (RejectDealDto)
  - [ ] `POST /v1/admin/deals/:id/expire`
  - [ ] Register in AdminModule (import DealModule)

- [ ] API: Daily expiry — extend PromotionPauseCheckWorker (AC: 4)
  - [ ] Add deal expiry logic to `checkAndPauseCampaigns()` using existing `PrismaService`
  - [ ] Log expired count

- [ ] DealEmailService — implement approval/rejection emails (AC: 2, 3)
  - [ ] `sendDealApproved()` — Polish subject/body, station names list
  - [ ] `sendDealRejected()` — Polish subject/body, reason

- [ ] Admin app: `/deals/page.tsx` — pending queue (AC: 1, 2, 3)
  - [ ] Paginated table with proof URL link (opens new tab)
  - [ ] Approve button → `approveDeal()` server action
  - [ ] Reject inline form → `rejectDeal()` server action
  - [ ] Multi-station display ("Station A, Station B +N more")

- [ ] Admin app: `/deals/actions.ts` — server actions (AC: 2, 3, 5)
- [ ] Admin app: `/deals/history/page.tsx` — active/expired/rejected history with expire button (AC: 5)
- [ ] Admin app: Sidebar nav — add "Deals" link (AC: 1)
- [ ] Admin app: i18n — add `t.nav.deals`

---

## Dev Notes

### BullMQ Delayed Job — `dealActivateQueue` in `DealService`

`DealService` needs `@InjectQueue(DEAL_ACTIVATE_QUEUE)` to schedule the activation job at approval. This means `DealModule` must register the queue:

```typescript
// Already in DealModule from Story 8.5:
BullModule.registerQueue({ name: DEAL_ACTIVATE_QUEUE }),
```

And `DealService` constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly dealEmailService: DealEmailService,
  @InjectQueue(DEAL_ACTIVATE_QUEUE) private readonly dealActivateQueue: Queue,
) {}
```

### Approve — Start Date Already Passed

If ops takes several days to review and approves a deal whose `start_date` is now in the past (e.g. the owner set start_date = tomorrow, but ops approved 5 days later), the deal should be immediately visible since `start_date <= now()`. No BullMQ job needed. The condition in `approveDeal()`:

```typescript
if (deal.start_date > new Date()) {
  // Future-dated: schedule activation job
  await this.dealActivateQueue.add('activate', { dealId }, {
    delay: deal.start_date.getTime() - Date.now(),
    jobId: `deal-activate-${dealId}`,
  });
}
// If start_date <= now(): deal is immediately visible (Story 8.7 filter activates it)
```

### Proof URL — Security

The admin panel renders `deal.proof_url` as a clickable `<a>` tag. Ensure the link uses `rel="noopener noreferrer"` to prevent tab-napping. Do NOT render the URL as an iframe (potential SSRF surface). Ops opens it in a new browser tab to verify manually.

### Audit Log Notes Format

Use consistent key=value format for `notes` field to allow future log parsing:

```
dealId=abc123
dealId=abc123 reason=Brak ważnego linku dowodowego
dealId=abc123
```

### Deal Status Transitions

Valid transitions:
- `PENDING_REVIEW` → `APPROVED` (ops approves)
- `PENDING_REVIEW` → `REJECTED` (ops rejects)
- `PENDING_REVIEW` → `WITHDRAWN` (submitter withdraws — Story 8.5)
- `APPROVED` → `EXPIRED` (daily job or manual expire)

Any attempt to approve/reject/expire from an invalid source status → throw `HttpException(400, 'Invalid status transition')`.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
