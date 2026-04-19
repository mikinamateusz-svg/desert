# Story 8.5: Deal Creation & Submission

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.5
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.1/7.2 (STATION_MANAGER role, apps/partner scaffold), Story 7.6 (`Chain` model, `CHAIN_MANAGER` role, `ChainClaim` approval, `Station.chain_id`), Story 8.4 (BillingProfile prerequisite — check profile exists before deal submission, same gate as campaigns)
- **Required by:** Story 8.6 (moderation queue reads `Deal` rows), Story 8.7 (driver display reads approved `Deal` rows)

---

## User Story

**As a verified station owner or chain manager,**
I want to create a time-limited promotional deal offer for my station(s) with a verifiable proof URL,
So that drivers see accurate, current special offers before deciding to fill up.

---

## Context & Why

A deal that has no end date or no verifiable source is a liability — stale or unverifiable claims erode driver trust faster than no deals at all. Requiring a proof URL forces owners to have a real, linkable source (website, campaign page, social post), which makes moderation fast and gives drivers a way to verify independently.

Chain managers creating one deal across all their stations dramatically reduces admin burden — this is what makes deal advertising viable for large chains at all.

### Key design decisions

- **`DealStation` junction table**: Each `Deal` is linked to specific `Station` rows via `DealStation`. For chain "all stations" scope, rows are created at submission time (snapshot of current chain membership). This avoids dynamic chain membership lookups at display time (Story 8.7).
- **"Start immediately"**: `start_date` is set to the submission timestamp. Goes live as soon as ops approves (no BullMQ job needed).
- **Future-dated deals**: BullMQ delayed job `deal-activate-{dealId}` fires at `start_date`. On approval the job is scheduled; if the deal is withdrawn before the job fires, the job is removed.
- **Max 3 active deals per station**: Checked at submission time against `DealStation` rows where deal is APPROVED and currently within start–end window. A "currently active" deal is one where `start_date <= now()` and `end_date > now()`.

---

## Acceptance Criteria

**Given** a verified station owner or chain manager opens the Deals section
**When** they create a new deal
**Then** the form requires: offer text (max 150 chars), proof URL (syntactically valid), start configuration (date picker OR "Start immediately" checkbox), and end date (after start, ≤1 year from today)

**Given** a chain manager creates a deal
**When** they configure it
**Then** they additionally select scope: "This station only" (station picker from their chain) / "All my stations" / "Select stations" (multi-select from their chain station list)

**Given** any owner or chain manager submits a deal
**When** the submission succeeds
**Then** the deal is created with status `PENDING_REVIEW`, ops email is sent, and the submitter sees: "Your deal has been submitted for review. Once approved, it will go live [immediately / on {start date}]."

**Given** a deal has "Start immediately" selected
**When** ops approves it (Story 8.6)
**Then** the deal becomes visible on targeted station(s) immediately — no BullMQ job needed

**Given** a deal has a future start date
**When** ops approves it before the start date
**Then** a BullMQ delayed job is scheduled to activate the deal on `start_date`
**And** the deal is NOT visible to drivers until `start_date` is reached

**Given** a deal is in `PENDING_REVIEW` status
**When** the submitter withdraws it
**Then** the deal status is set to `WITHDRAWN`, removed from the ops queue, and any pending BullMQ activation job is removed
**And** no ops action is required

**Given** a station already has 3 currently active approved deals (approved, start_date ≤ now, end_date > now)
**When** an owner or chain manager attempts to submit a new deal for that station
**Then** the submission is blocked with: "This station already has 3 active deals. A new deal can be added once one expires or is removed."
**And** for chain managers submitting to multiple stations, per-station blocking is applied independently — stations not at the 3-deal limit proceed normally; those at the limit are listed as skipped

---

## Schema Changes

### New Models

```prisma
enum DealStatus {
  PENDING_REVIEW
  APPROVED
  REJECTED
  WITHDRAWN
  EXPIRED
}

model Deal {
  id                String     @id @default(cuid())
  user_id           String
  user              User       @relation(fields: [user_id], references: [id])
  status            DealStatus @default(PENDING_REVIEW)
  offer_text        String     @db.VarChar(150)
  proof_url         String
  start_immediately Boolean    @default(false)
  start_date        DateTime
  end_date          DateTime
  rejection_reason  String?
  approved_at       DateTime?
  approved_by       String?    // Admin User.id
  withdrawn_at      DateTime?
  created_at        DateTime   @default(now())
  updated_at        DateTime   @updatedAt

  deal_stations     DealStation[]

  @@index([status, start_date])
  @@index([user_id])
}

model DealStation {
  id         String  @id @default(cuid())
  deal_id    String
  deal       Deal    @relation(fields: [deal_id], references: [id], onDelete: Cascade)
  station_id String
  station    Station @relation(fields: [station_id], references: [id])

  @@unique([deal_id, station_id])
  @@index([station_id, deal_id])
}
```

### Station Model Addition

```prisma
// Add relation to Station model:
model Station {
  // ... existing fields ...
  deal_stations DealStation[]
}
```

### Migration Name

`add_deal_and_deal_station`

---

## API Changes

### New Module: DealModule

**Location:** `apps/api/src/deal/`

Files:
- `deal.module.ts`
- `deal.controller.ts`
- `deal.service.ts`
- `dto/create-deal.dto.ts`
- `workers/deal-activate.worker.ts`
- `constants.ts`

### DealController

```typescript
// apps/api/src/deal/deal.controller.ts
@Controller('v1/partner/deals')
@UseGuards(AuthGuard, RolesGuard)
export class DealController {
  // GET /v1/partner/deals
  // @Roles(STATION_MANAGER, CHAIN_MANAGER)
  // Query: ?stationId= (optional — filter deals to a specific station)
  // Returns: Deal[] (with deal_stations) for the authenticated user, newest first

  // POST /v1/partner/deals
  // @Roles(STATION_MANAGER, CHAIN_MANAGER)
  // Body: CreateDealDto
  // Returns: { deal: Deal, skippedStations?: string[] }
  //   skippedStations: station names that were at the 3-deal limit (chain manager only)

  // POST /v1/partner/deals/:dealId/withdraw
  // @Roles(STATION_MANAGER, CHAIN_MANAGER)
  // Ownership check: deal.user_id === userId
  // Only allowed if status === PENDING_REVIEW
  // Returns: { ok: true }
}
```

### CreateDealDto

```typescript
// apps/api/src/deal/dto/create-deal.dto.ts
export class CreateDealDto {
  @IsString() @MaxLength(150) @MinLength(1)
  offerText: string;

  @IsUrl({ require_protocol: true })
  proofUrl: string;

  @IsBoolean()
  startImmediately: boolean;

  @IsDateString()
  @ValidateIf(o => !o.startImmediately)
  startDate?: string;  // ISO date string; ignored if startImmediately=true

  @IsDateString()
  endDate: string;     // ISO date string; must be > start, ≤ 1 year from today

  // Chain manager fields — ignored for STATION_MANAGER role
  @IsOptional()
  @IsIn(['this_station', 'all_stations', 'selected_stations'])
  scope?: string;

  @IsOptional()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  stationIds?: string[];  // used when scope === 'selected_stations'

  // For STATION_MANAGER: stationId is inferred from their claimed station
  // For CHAIN_MANAGER: scope determines which stations get DealStation rows
  @IsOptional()
  @IsString()
  stationId?: string;  // STATION_MANAGER with multiple claimed stations: explicit target
}
```

### DealService

```typescript
// apps/api/src/deal/deal.service.ts

// createDeal(userId: string, userRole: UserRole, dto: CreateDealDto): Promise<CreateDealResult>
//
// Step 1: Validate dates
//   - endDate must be after startDate (or after now if startImmediately)
//   - endDate must be ≤ 1 year from now (throw 400 if violated)
//   - startDate must be in the future (throw 400 if in the past and !startImmediately)
//
// Step 2: Resolve target station IDs
//   - STATION_MANAGER: load user's approved StationClaim → get station_id
//     If dto.stationId provided: verify it matches a claimed station (ownership check)
//   - CHAIN_MANAGER: resolve by scope:
//     'this_station': [dto.stationId] — verify station is in manager's chain
//     'all_stations': load all Station.id WHERE chain_id = manager's chain_id
//     'selected_stations': dto.stationIds — verify each is in manager's chain
//
// Step 3: Check 3-deal limit per station
//   - For each target station: count DealStation WHERE station_id = X
//     AND deal.status = 'APPROVED'
//     AND deal.start_date <= now AND deal.end_date > now
//   - Partition into: eligible stations (< 3 active deals) and blocked stations (= 3)
//   - If ALL stations are blocked: throw 400 with message
//   - If SOME blocked (chain manager only): proceed with eligible, collect skippedStations
//
// Step 4: Create Deal + DealStation rows in a transaction
//   const effectiveStartDate = dto.startImmediately ? new Date() : new Date(dto.startDate!);
//   await prisma.$transaction(async (tx) => {
//     const deal = await tx.deal.create({
//       data: {
//         user_id: userId,
//         offer_text: dto.offerText,
//         proof_url: dto.proofUrl,
//         start_immediately: dto.startImmediately,
//         start_date: effectiveStartDate,
//         end_date: new Date(dto.endDate),
//       },
//     });
//     await tx.dealStation.createMany({
//       data: eligibleStationIds.map(stationId => ({ deal_id: deal.id, station_id: stationId })),
//     });
//     return deal;
//   });
//
// Step 5: Send ops notification email (fire-and-forget)
//   this.dealEmailService.sendOpsNewDealNotification(deal).catch(...)
//
// Step 6: Return { deal, skippedStations: skippedStationNames }

// withdrawDeal(userId: string, dealId: string): Promise<void>
//   - Load deal, ownership check, status must be PENDING_REVIEW
//   - Set status: WITHDRAWN, withdrawn_at: now()
//   - Remove BullMQ activation job if scheduled: dealActivateQueue.remove(`deal-activate-${dealId}`)
//   - No email needed
```

### DealEmailService

```typescript
// apps/api/src/deal/deal-email.service.ts

// sendOpsNewDealNotification(deal: Deal, stationNames: string[]): Promise<void>
//   - To: OPS_EMAIL env var
//   - Subject: "Nowa oferta do moderacji — [first station name]"
//   - Body: deal details, proof URL (clickable), station list, submitter email, admin panel link

// sendDealApproved(userEmail: string, deal: Deal): Promise<void>  (called from Story 8.6)
// sendDealRejected(userEmail: string, deal: Deal, reason: string): Promise<void>  (called from Story 8.6)
```

Place in `apps/api/src/deal/deal-email.service.ts`. Reuses Resend client (same pattern as `ClaimEmailService` in Story 7.2). Import `ResendModule` or inject `ResendService` if extracted to a shared module.

### BullMQ — Deal Activation Queue

```typescript
// apps/api/src/deal/constants.ts
export const DEAL_ACTIVATE_QUEUE = 'deal-activate';

// apps/api/src/deal/workers/deal-activate.worker.ts
@Processor(DEAL_ACTIVATE_QUEUE)
export class DealActivateWorker extends WorkerHost {
  async process(job: Job<{ dealId: string }>): Promise<void> {
    // Set deal status to APPROVED (it was already approved, just future-dated)
    // Note: the deal was approved in Story 8.6 — at approval time, for future-dated deals,
    // status remains APPROVED but a delayed job is set to "activate" (make visible).
    // Story 8.7 reads deals WHERE status=APPROVED AND start_date <= now AND end_date > now.
    // So actually NO status change is needed — deal is already APPROVED.
    // The delayed job is purely a no-op marker — Story 8.7 display logic handles the date check.
    // But log it for observability:
    this.logger.log(`Deal ${job.data.dealId} start_date reached — now visible to drivers`);
  }
}
```

**Actually**: since Story 8.7 display logic uses `start_date <= now()` as a filter, no status transition is needed when the start date arrives. The BullMQ job is a no-op for MVP — its only purpose is future extensibility (e.g. sending a "Your deal is now live!" notification to the owner). Include it for completeness, marked as best-effort.

The job is **scheduled at approval time** (Story 8.6), not at submission time. Story 8.5 does not schedule this job. Include the `DEAL_ACTIVATE_QUEUE` constant and worker here so Story 8.6 can reference the queue name.

---

## Partner App — Deal Creation UI

### New Pages

**`apps/partner/src/app/deals/page.tsx`** — Deal list (Server Component)

Fetches `GET /v1/partner/deals` via `partnerFetch`. Shows:
- Active/pending deals (PENDING_REVIEW, APPROVED where start_date ≤ now ≤ end_date)
- Future deals (APPROVED where start_date > now)
- Past deals (EXPIRED, REJECTED, WITHDRAWN) in collapsible section

Each deal row shows: offer text (truncated), status badge, start–end dates, station name(s), and a "Withdraw" button if `status === PENDING_REVIEW`.

**`apps/partner/src/app/deals/new/page.tsx`** — Deal creation form (Server Component + Client components)

```tsx
// Form sections:
// 1. Offer text — textarea with live char counter (150 max), red when > 130
// 2. Proof URL — text input with placeholder "https://..."
// 3. Start date:
//    - Checkbox: "Start immediately (goes live when approved)"
//    - OR: date picker (HTML date input, min=tomorrow)
// 4. End date — date picker, min=start_date+1, max=1 year from today
// 5. Scope selector (CHAIN_MANAGER only):
//    - Radio group: "This station only" / "All my stations" / "Select stations"
//    - If "Select stations": station multi-select (fetches from GET /v1/partner/chain/stations)
// 6. Submit button: "Submit for review"
```

This is a Client Component (needs live char counter and conditional scope selector).

**`apps/partner/src/app/deals/new/submit-deal-action.ts`** — Server Action

```typescript
'use server';
import { partnerFetch } from '@/lib/partner-api';
import { redirect } from 'next/navigation';

export async function submitDealAction(formData: FormData) {
  const dto = {
    offerText: formData.get('offerText') as string,
    proofUrl: formData.get('proofUrl') as string,
    startImmediately: formData.get('startImmediately') === 'true',
    startDate: formData.get('startDate') as string | undefined,
    endDate: formData.get('endDate') as string,
    scope: formData.get('scope') as string | undefined,
    stationIds: formData.getAll('stationIds') as string[],
  };

  const result = await partnerFetch<{ deal: unknown; skippedStations?: string[] }>(
    'POST', '/v1/partner/deals', dto
  );

  if (result.skippedStations?.length) {
    redirect(`/deals?submitted=true&skipped=${result.skippedStations.join(',')}`);
  }
  redirect('/deals?submitted=true');
}
```

### Success Banner

After redirect to `/deals?submitted=true`, render a success banner:
```
"Your deal has been submitted for review. Once approved, it will go live [immediately / on {start date}]."
```

If `?skipped=...` is present: also render a warning banner listing stations that were at the 3-deal limit.

### Withdraw Action

**`apps/partner/src/app/deals/withdraw-action.ts`** — Server Action

```typescript
'use server';
export async function withdrawDealAction(dealId: string) {
  await partnerFetch('POST', `/v1/partner/deals/${dealId}/withdraw`);
  revalidatePath('/deals');
}
```

### Sidebar Navigation

Add "Deals" link to partner app sidebar (after "Promotions").

---

## Date Validation Details

All date validation is performed server-side in `DealService`. Client-side `<input type="date">` min/max attributes provide UX hints but are not trusted.

```typescript
// Server-side date validation in createDeal():
const now = new Date();
const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
const startDate = dto.startImmediately ? now : new Date(dto.startDate!);
const endDate = new Date(dto.endDate);

if (endDate <= startDate) {
  throw new HttpException('End date must be after start date', 400);
}
if (endDate > oneYearFromNow) {
  throw new HttpException('End date must be within 1 year of today', 400);
}
if (!dto.startImmediately && startDate <= now) {
  throw new HttpException('Start date must be in the future', 400);
}
```

---

## Chain Manager Station Resolution

```typescript
// In DealService.resolveTargetStations(userId, userRole, dto):

if (userRole === UserRole.CHAIN_MANAGER) {
  // Load chain manager's chain via ChainClaim (must be APPROVED)
  const chainClaim = await this.prisma.chainClaim.findFirst({
    where: { user_id: userId, status: 'APPROVED' },
    include: { chain: { include: { stations: { select: { id: true, name: true } } } } },
  });
  if (!chainClaim) throw new ForbiddenException('No approved chain claim');

  const chainStations = chainClaim.chain.stations;

  switch (dto.scope) {
    case 'this_station': {
      const target = chainStations.find(s => s.id === dto.stationId);
      if (!target) throw new ForbiddenException('Station not in your chain');
      return [{ id: target.id, name: target.name }];
    }
    case 'all_stations':
      return chainStations.map(s => ({ id: s.id, name: s.name }));
    case 'selected_stations': {
      const idSet = new Set(dto.stationIds ?? []);
      const selected = chainStations.filter(s => idSet.has(s.id));
      if (selected.length !== idSet.size) throw new ForbiddenException('Some stations not in your chain');
      return selected;
    }
    default:
      throw new HttpException('Scope required for chain manager', 400);
  }
}

// STATION_MANAGER: single station from approved StationClaim
const claim = await this.prisma.stationClaim.findFirst({
  where: { user_id: userId, status: 'APPROVED' },
  include: { station: { select: { id: true, name: true } } },
});
if (!claim) throw new ForbiddenException('No approved station claim');
return [{ id: claim.station.id, name: claim.station.name }];
```

---

## 3-Deal Limit Check

```typescript
// In DealService.checkActiveDealsCount(stationId: string): Promise<number>
const now = new Date();
return this.prisma.dealStation.count({
  where: {
    station_id: stationId,
    deal: {
      status: DealStatus.APPROVED,
      start_date: { lte: now },
      end_date: { gt: now },
    },
  },
});
```

For bulk check (chain manager submitting to many stations), run in parallel:

```typescript
const counts = await Promise.all(
  targetStations.map(async s => ({
    ...s,
    activeDeals: await this.checkActiveDealsCount(s.id),
  }))
);
const eligible = counts.filter(s => s.activeDeals < 3);
const blocked = counts.filter(s => s.activeDeals >= 3);
```

---

## Module Registration

```typescript
// apps/api/src/deal/deal.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: DEAL_ACTIVATE_QUEUE }),
    PrismaModule,
  ],
  controllers: [DealController],
  providers: [DealService, DealActivateWorker, DealEmailService],
  exports: [DealService],  // Story 8.6 admin controller uses DealService
})
export class DealModule {}
```

Add `DealModule` to `AppModule` imports.

---

## i18n Strings

```typescript
// apps/partner/src/i18n/pl.ts
deals: {
  title: 'Oferty specjalne',
  createButton: 'Dodaj ofertę',
  form: {
    offerText: 'Treść oferty',
    offerTextPlaceholder: 'np. "20 gr/L taniej z kartą lojalnościową"',
    offerTextCounter: '{{count}}/150',
    proofUrl: 'Link do potwierdzenia oferty',
    proofUrlPlaceholder: 'https://...',
    startImmediately: 'Uruchom od razu po zatwierdzeniu',
    startDate: 'Data rozpoczęcia',
    endDate: 'Data zakończenia',
    scope: 'Stacje',
    scopeThisStation: 'Ta stacja',
    scopeAllStations: 'Wszystkie moje stacje',
    scopeSelected: 'Wybrane stacje',
    submitButton: 'Wyślij do moderacji',
  },
  status: {
    PENDING_REVIEW: 'Oczekuje na moderację',
    APPROVED: 'Zatwierdzona',
    REJECTED: 'Odrzucona',
    WITHDRAWN: 'Wycofana',
    EXPIRED: 'Wygasła',
  },
  submitted: 'Twoja oferta została wysłana do moderacji. Po zatwierdzeniu zostanie opublikowana {{timing}}.',
  submittedImmediately: 'od razu',
  submittedOn: 'dnia {{date}}',
  withdrawButton: 'Wycofaj ofertę',
  limitReached: 'Ta stacja ma już 3 aktywne oferty. Nową ofertę można dodać po wygaśnięciu jednej z obecnych.',
  skippedWarning: 'Następujące stacje pominięto (limit 3 ofert): {{stations}}',
},
```

Add equivalent `en.ts` and `uk.ts` keys.

---

## Tasks / Subtasks

- [ ] Prisma schema: `Deal`, `DealStation`, `DealStatus` enum, `Station.deal_stations` relation (AC: all)
  - [ ] Migration `add_deal_and_deal_station`
  - [ ] `prisma generate`

- [ ] DealModule scaffold (AC: all)
  - [ ] Directory structure + `deal.module.ts`
  - [ ] Constants: `DEAL_ACTIVATE_QUEUE`
  - [ ] `DealActivateWorker` (no-op stub)
  - [ ] Register in AppModule

- [ ] DealService — resolveTargetStations (AC: 2)
  - [ ] STATION_MANAGER: load approved StationClaim
  - [ ] CHAIN_MANAGER: resolve by scope (this/all/selected)
  - [ ] Ownership checks for each path

- [ ] DealService — createDeal (AC: 1, 3, 4, 5, 7)
  - [ ] Date validation (server-side)
  - [ ] 3-deal limit check per station (parallel for chain managers)
  - [ ] `prisma.$transaction`: create Deal + DealStation rows
  - [ ] Fire-and-forget ops email

- [ ] DealService — withdrawDeal (AC: 6)
  - [ ] Status check (PENDING_REVIEW only)
  - [ ] Set WITHDRAWN, clear delayed job

- [ ] DealEmailService: ops notification email (AC: 3)

- [ ] Partner app: deal list page `/deals/page.tsx` (AC: 6)
  - [ ] Active/pending section
  - [ ] Past section (collapsible)
  - [ ] Withdraw button with `withdrawDealAction`

- [ ] Partner app: deal creation form `/deals/new/page.tsx` (AC: 1, 2)
  - [ ] Offer text + live char counter (Client Component)
  - [ ] Proof URL input
  - [ ] Start date / "Start immediately" toggle
  - [ ] End date picker with max=1 year
  - [ ] Chain manager scope selector + station multi-select
  - [ ] `submit-deal-action.ts` server action

- [ ] Partner app: success/skipped banners on `/deals?submitted=true` (AC: 3, 7)
- [ ] Sidebar: Deals navigation link
- [ ] i18n: pl/en/uk strings

---

## Dev Notes

### URL Validation

`class-validator` `@IsUrl()` validates URL format. Options:
```typescript
@IsUrl({ require_protocol: true, require_tld: true })
```

This rejects `localhost` URLs and requires a real TLD. Acceptable — proof URLs must be public web pages. The ops reviewer still verifies the URL content manually (Story 8.6).

### Date Handling — Timezone

`new Date(dto.endDate)` parses an ISO date string. If the client sends `"2026-12-31"` (date-only), it's parsed as UTC midnight. This is correct for end-of-day semantics on the last valid day. Story 8.6 daily expiry job also uses UTC midnight comparison.

Document for the partner app form: use `<input type="date">` which returns `YYYY-MM-DD` format — send as-is to the API. The API converts to `DateTime` (UTC midnight).

### Large Chains — "All My Stations" Performance

ORLEN has ~1,800 stations. Creating 1,800 `DealStation` rows in one transaction is fine (Prisma `createMany`). The `@@index([station_id, deal_id])` on `DealStation` ensures the 3-deal-limit check and Story 8.7 display query remain fast.

For the chain manager station multi-select in the partner app: fetch stations from `GET /v1/partner/chain/stations` (Story 7.6 endpoint). For large chains, render a searchable list (filter client-side on station name) rather than a plain `<select>`. Simple `<input type="text">` filter over a checkbox list is sufficient for MVP.

### Deal vs PromotionCampaign

`Deal` and `PromotionCampaign` are separate, independent features sharing the same partner app surface. A station can simultaneously have an active `PromotionCampaign` (pin boost) and active `Deal` rows (offer text in detail sheet). They do not interact. No cross-validation needed.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
