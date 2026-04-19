# Story 8.1: Promotional Placement Purchase

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.1
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.1 (apps/partner scaffold, partnerFetch, partner_token cookie), Story 7.2 (STATION_MANAGER role), Story 7.3 (updateOwnerPrice — needed to hook resume check), Story 5.0 (PriceHistoryService.getRegionalAverage — voivodeship median)
- **Required by:** Story 8.2 (reads active campaigns to apply promoted treatment), Story 8.3 (reads campaign metrics), Story 8.4 (adds billing portal on top of credit_balance_pln)

---

## User Story

**As a verified station owner (STATION_MANAGER role),**
I want to purchase a promotional boost for my station directly in the partner portal,
So that my station is more visible to nearby drivers without needing to negotiate with a sales team.

---

## Context & Why

Self-serve ad buying removes the biggest friction in monetisation. The price gate (prices must be ≤ voivodeship median) ensures the promoted treatment always directs drivers toward genuinely competitive stations — protecting user trust while giving owners a clear, actionable incentive to stay price-competitive.

Auto-pause/resume is core to the product: owners should never feel the system is consuming their paid days unfairly. The 90-day hard expiry prevents abandoned campaigns from sitting in the system indefinitely.

Story 8.4 (Billing Portal) adds invoice generation, billing profile management, and balance top-up UI. This story implements the minimum: Stripe card payment, a `credit_balance_pln` field on `User`, campaign creation, and the daily pause/resume BullMQ job.

---

## Acceptance Criteria

**Given** a verified station owner (STATION_MANAGER role) opens the Promotions section of the partner portal
**When** they view it
**Then** they see a list of their current and past campaigns for their station, and an entry point to create a new campaign

**Given** an owner starts creating a campaign
**When** they proceed through the purchase flow
**Then** they select a duration: 1 active day or 7 active days
**And** the cost is shown in PLN before payment (fixed rate per active day)
**And** they see a clear notice: "Your promotion runs only while your prices are at or below the area median. If your prices rise above median, the campaign auto-pauses and no active days are consumed. All purchased days must be used within 90 days of purchase or they are forfeited."

**Given** an owner's current prices exceed the voivodeship median for ALL promoted fuel types at the time of purchase
**When** they attempt to confirm and pay
**Then** purchase is blocked with a message explaining the price gate and showing their current price vs. area median

**Given** an owner's prices are at or below the voivodeship median for at least one promoted fuel type
**When** they confirm and pay (by card via Stripe or from pre-paid credit balance)
**Then** the campaign is activated immediately (status: ACTIVE) and the station receives enhanced promoted treatment in the app

**Given** payment fails (Stripe decline or insufficient credit balance)
**When** the result is returned
**Then** the campaign record is NOT created — the owner is shown a clear payment error

**Given** an active campaign is running
**When** the daily price check job detects the owner's prices exceed the voivodeship median
**Then** the campaign is paused (status: PAUSED), enhanced treatment is removed
**And** the owner receives an email: "Your promotion has been paused because your prices are now above the area median."
**And** no active day is consumed on paused calendar days

**Given** a campaign is PAUSED and the owner updates their price back to ≤ voivodeship median via `updateOwnerPrice()`
**When** the price write succeeds
**Then** the campaign resumes automatically (status: ACTIVE) and enhanced treatment is restored
**And** the owner receives a push notification: "Your prices are competitive again — your promotion has resumed."

**Given** a campaign has existed for 90 calendar days since `purchased_at`
**When** the daily job runs
**Then** the campaign status is set to EXPIRED regardless of remaining unconsumed active days
**And** forfeited days are not refunded
**And** the owner receives an email: "Your promotion has ended (90-day window expired). X active days were unused."

**Given** all purchased active days have been consumed before the 90-day expiry
**When** the last active day is consumed
**Then** the campaign status is set to EXPIRED and enhanced treatment is removed

**Given** a campaign has ≥1 remaining unconsumed active days and `expires_at - now < 7 days`
**When** the daily job runs
**Then** the owner receives an email warning: "Your promotion expires in 7 days with N active days remaining."
**And** this warning is sent once only (guarded by `expiry_warning_sent` flag)

---

## Schema Changes

### New Prisma Models

```prisma
// apps/api/prisma/schema.prisma

enum CampaignStatus {
  PENDING_PAYMENT   // Stripe Checkout initiated, not yet confirmed
  ACTIVE
  PAUSED
  EXPIRED
  CANCELLED
}

model PromotionCampaign {
  id                     String          @id @default(cuid())
  station_id             String
  station                Station         @relation(fields: [station_id], references: [id])
  user_id                String
  user                   User            @relation(fields: [user_id], references: [id])
  status                 CampaignStatus  @default(PENDING_PAYMENT)
  active_days_purchased  Int             // 1 or 7
  active_days_consumed   Int             @default(0)
  price_pln              Decimal         @db.Decimal(10, 2)
  payment_method         String          // 'stripe' | 'credit'
  stripe_session_id      String?         @unique
  purchased_at           DateTime?
  expires_at             DateTime?       // purchased_at + 90 days
  paused_at              DateTime?
  expiry_warning_sent    Boolean         @default(false)
  price_drop_notify      Boolean         @default(false)  // optional add-on AC from Story 8.2
  created_at             DateTime        @default(now())

  @@index([station_id, status])
  @@index([user_id])
  @@index([status, expires_at])
}
```

### User Model Addition

```prisma
// Add to existing User model
model User {
  // ... existing fields ...
  credit_balance_pln     Decimal         @default(0) @db.Decimal(10, 2)
  promotion_campaigns    PromotionCampaign[]
}
```

### Migration Name

`add_promotion_campaign`

---

## API Changes

### New Module: PromotionModule

**Location:** `apps/api/src/promotion/`

Files:
- `promotion.module.ts`
- `promotion.controller.ts`
- `promotion.service.ts`
- `promotion-webhook.controller.ts`
- `dto/create-campaign.dto.ts`
- `workers/promotion-pause-check.worker.ts`
- `constants.ts`

### Pricing Constants

```typescript
// apps/api/src/promotion/constants.ts
export const CAMPAIGN_PRICE_PLN: Record<number, number> = {
  1: 9.99,
  7: 49.99,
};

export const CAMPAIGN_ACTIVE_DAYS_OPTIONS = [1, 7] as const;
export const CAMPAIGN_EXPIRY_DAYS = 90;
export const CAMPAIGN_EXPIRY_WARNING_DAYS = 7;
export const PROMOTION_PAUSE_CHECK_QUEUE = 'promotion-pause-check';
```

### PromotionController

```typescript
// apps/api/src/promotion/promotion.controller.ts
@Controller('v1/partner/promotions')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.STATION_MANAGER)
export class PromotionController {
  // GET /v1/partner/promotions/:stationId
  // Lists all campaigns for a station (ownership verified at service layer)
  // Returns: PromotionCampaign[] ordered by created_at DESC

  // POST /v1/partner/promotions/checkout
  // Body: CreateCampaignDto { stationId, activeDays: 1|7, paymentMethod: 'stripe'|'credit', priceDrop: boolean }
  // Returns: { sessionUrl: string } for Stripe | { campaignId: string } for credit payment
  // Service calls: checkPriceGate() → createStripeSession() or chargeCreditBalance()

  // POST /v1/partner/promotions/:campaignId/cancel
  // Sets status to CANCELLED, removes promoted treatment
  // Returns: { ok: true }

  // GET /v1/partner/promotions/:campaignId/price-gate-status
  // Returns: { eligible: boolean, currentPrice: number, medianPrice: number, fuelType: string }
  // Used by partner app to show the gate check result before purchase
}
```

### CreateCampaignDto

```typescript
// apps/api/src/promotion/dto/create-campaign.dto.ts
export class CreateCampaignDto {
  @IsString()
  stationId: string;

  @IsIn([1, 7])
  activeDays: number;

  @IsIn(['stripe', 'credit'])
  paymentMethod: string;

  @IsBoolean()
  @IsOptional()
  priceDrop?: boolean;  // opt-in for price-drop push notifications (Story 8.2)
}
```

### PromotionService

```typescript
// apps/api/src/promotion/promotion.service.ts

// checkPriceGate(stationId: string): Promise<{ eligible: boolean; currentPrice: number; medianPrice: number; fuelType: string }>
//   - Calls PriceHistoryService.getRegionalAverage(stationId.voivodeshipId) for each fuel type
//   - Returns eligible=true if stationCurrentPrice <= median for ANY fuel type
//   - Returns the best case (lowest ratio of current/median)
//   - Throws HttpException(400) with gateInfo if all fuel types exceed median

// createCampaign(userId, dto): Promise<{ sessionUrl?: string; campaignId?: string }>
//   - Calls checkPriceGate() — throws if not eligible
//   - If paymentMethod === 'stripe':
//     - Creates Stripe Checkout Session (mode: 'payment')
//     - Creates PromotionCampaign with status: PENDING_PAYMENT, stripe_session_id
//     - Returns { sessionUrl: session.url }
//   - If paymentMethod === 'credit':
//     - Loads user.credit_balance_pln — throws 400 if insufficient
//     - prisma.$transaction: deduct balance + create campaign (status: ACTIVE, purchased_at, expires_at)
//     - Schedules expiry warning job (see BullMQ section)
//     - Returns { campaignId: campaign.id }

// handleStripeWebhook(event: Stripe.Event): Promise<void>
//   - Handles checkout.session.completed
//   - Finds campaign by stripe_session_id
//   - Sets status: ACTIVE, purchased_at: now(), expires_at: now() + 90d
//   - Schedules expiry warning job
//   - Handles checkout.session.expired → deletes PENDING_PAYMENT campaign

// checkAndPauseCampaigns(): Promise<void>
//   - Called by PromotionPauseCheckWorker daily at 06:00 Warsaw time
//   - Loads all ACTIVE campaigns
//   - For each: calls checkPriceGate() — if NOT eligible, sets status: PAUSED, paused_at: now()
//     - Increments active_days_consumed if campaign was ACTIVE during yesterday (i.e. it was active at end of day)
//     - Sends pause email via ClaimEmailService (reuse Resend setup)
//   - Loads all PAUSED campaigns
//   - For each: calls checkPriceGate() — if eligible, sets status: ACTIVE, paused_at: null
//     - (Note: resume is also triggered from updateOwnerPrice() — see below)
//   - Loads all ACTIVE campaigns where expires_at <= now() → set EXPIRED, send expiry email
//   - Loads all ACTIVE/PAUSED campaigns where expires_at <= now() + 7d AND expiry_warning_sent = false
//     → send warning email, set expiry_warning_sent = true

// resumeCampaignsForStation(stationId: string): Promise<void>
//   - Called from PartnerService.updateOwnerPrice() after a successful price write
//   - Loads all PAUSED campaigns for stationId
//   - For each: calls checkPriceGate() — if eligible: status: ACTIVE, paused_at: null
//   - Sends push notification via Expo if any campaigns resumed (see Push Notification section)

// cancelCampaign(userId, campaignId): Promise<void>
//   - Ownership check: campaign.user_id === userId
//   - Only cancellable if status in [ACTIVE, PAUSED]
//   - Sets status: CANCELLED
//   - No refund (as stated in purchase T&C)
```

### Hook into PartnerService.updateOwnerPrice()

In `apps/api/src/partner/partner.service.ts`, after the successful price write and cache invalidation, add:

```typescript
// Fire-and-forget: do not block price update on campaign resume
this.promotionService.resumeCampaignsForStation(stationId).catch((err) => {
  this.logger.warn(`Campaign resume check failed for station ${stationId}: ${err.message}`);
});
```

`PromotionService` must be injected into `PartnerService`. To avoid circular dependency, inject via `ModuleRef` or add `PromotionModule` to `PartnerModule` imports (PromotionModule should NOT import PartnerModule — one-directional dependency).

### Stripe Webhook Controller

```typescript
// apps/api/src/promotion/promotion-webhook.controller.ts

@Controller('v1/stripe')
export class PromotionWebhookController {
  // POST /v1/stripe/webhooks
  // @Public() — no auth guard
  // Raw body required: use `@RawBody()` or configure Fastify raw body middleware for this route
  // Verifies Stripe webhook signature: stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  // Delegates to promotionService.handleStripeWebhook(event)
}
```

**Important:** Fastify does not parse raw body by default. Add `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` in `main.ts` or configure this route specifically. The `stripe.webhooks.constructEvent()` call requires the raw Buffer, not the parsed JSON body.

Stripe events to handle:
- `checkout.session.completed` → activate campaign
- `checkout.session.expired` → delete PENDING_PAYMENT campaign (cleanup)

### BullMQ — Daily Pause Check Job

```typescript
// apps/api/src/promotion/workers/promotion-pause-check.worker.ts

// Queue name: PROMOTION_PAUSE_CHECK_QUEUE = 'promotion-pause-check'
// Registered in PromotionModule via BullModule.registerQueue({ name: PROMOTION_PAUSE_CHECK_QUEUE })

// Scheduling: Use BullMQ repeatable job (NOT NestJS scheduler) for consistency with existing patterns:
//   await this.promotionPauseCheckQueue.add(
//     'daily-check',
//     {},
//     { repeat: { cron: '0 4 * * *' }, jobId: 'promotion-daily-pause-check' }
//   );
// Scheduled at 04:00 UTC (06:00 Warsaw standard time)
// jobId is stable — idempotent, won't add duplicates on restart (same pattern as Story 6.1 price alerts)

@Processor(PROMOTION_PAUSE_CHECK_QUEUE)
export class PromotionPauseCheckWorker extends WorkerHost {
  async process(job: Job): Promise<void> {
    await this.promotionService.checkAndPauseCampaigns();
  }
}
```

### BullMQ — Expiry Warning Delayed Job

When a campaign is activated (from Stripe webhook OR credit payment), schedule a delayed expiry warning:

```typescript
// In promotionService (after campaign status set to ACTIVE):
const warningDelay = campaign.expires_at.getTime() - Date.now() - (CAMPAIGN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
if (warningDelay > 0) {
  await this.promotionPauseCheckQueue.add(
    'expiry-warning',
    { campaignId: campaign.id },
    { delay: warningDelay, jobId: `promotion-expiry-warning-${campaign.id}` }
  );
}
```

The worker handles both `'daily-check'` and `'expiry-warning'` job names.

---

## Stripe Integration

### Package

```bash
# In apps/api
npm install stripe
```

Use `stripe` v17+ (current stable). Initialise once:

```typescript
// apps/api/src/promotion/promotion.service.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',  // pin to current stable API version
});
```

### Stripe Checkout Session

```typescript
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{
    price_data: {
      currency: 'pln',
      product_data: {
        name: `Station Promotion — ${activeDays} active day${activeDays > 1 ? 's' : ''}`,
        description: `Station: ${station.name}. Valid for 90 calendar days from purchase.`,
      },
      unit_amount: Math.round(CAMPAIGN_PRICE_PLN[activeDays] * 100), // Stripe uses grosz (1/100 PLN)
    },
    quantity: 1,
  }],
  success_url: `${process.env.PARTNER_APP_URL}/promotions?session_id={CHECKOUT_SESSION_ID}&status=success`,
  cancel_url: `${process.env.PARTNER_APP_URL}/promotions/new?session_id={CHECKOUT_SESSION_ID}&status=cancelled`,
  metadata: {
    campaignId: campaign.id,
    stationId: dto.stationId,
    userId: userId,
  },
  customer_email: user.email ?? undefined,
});
```

### Payment with Credit Balance

```typescript
// In PromotionService.createCampaign() — credit path
const pricePln = new Prisma.Decimal(CAMPAIGN_PRICE_PLN[dto.activeDays]);
await this.prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.credit_balance_pln.lessThan(pricePln)) {
    throw new HttpException('Insufficient credit balance', 400);
  }
  await tx.user.update({
    where: { id: userId },
    data: { credit_balance_pln: { decrement: pricePln } },
  });
  // create campaign inside same transaction
  const now = new Date();
  return tx.promotionCampaign.create({
    data: {
      station_id: dto.stationId,
      user_id: userId,
      status: CampaignStatus.ACTIVE,
      active_days_purchased: dto.activeDays,
      price_pln: pricePln,
      payment_method: 'credit',
      purchased_at: now,
      expires_at: new Date(now.getTime() + CAMPAIGN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      price_drop_notify: dto.priceDrop ?? false,
    },
  });
});
```

---

## Email Notifications

Reuse `ClaimEmailService` in `apps/api/src/partner/claim-email.service.ts` — add new methods:

```typescript
// Add to ClaimEmailService:
sendCampaignPaused(userEmail: string, stationName: string): Promise<void>
sendCampaignResumed(userEmail: string, stationName: string): Promise<void>
sendCampaignExpired(userEmail: string, stationName: string, unusedDays: number): Promise<void>
sendCampaignExpiryWarning(userEmail: string, stationName: string, daysLeft: number, unusedDays: number): Promise<void>
```

All emails use the existing Resend client. Template style: same pattern as Story 7.2 emails (plain text, Polish subject, partner-portal audience).

Subject lines (Polish):
- Pause: `"Twoja promocja została wstrzymana — ${stationName}"`
- Resume: Handled by push notification only (no email on resume — avoids noise)
- Expiry: `"Twoja promocja wygasła — ${stationName}"`
- Warning: `"Twoja promocja wygasa za ${daysLeft} dni — ${stationName}"`

---

## Push Notification on Resume

When `resumeCampaignsForStation()` detects a campaign resumed, send Expo push notification to the station owner:

```typescript
// Look up user's Expo push token (if stored) and send via existing NotificationService
// If NotificationService does not support partner users yet, log a TODO and skip silently
// Message: "Your prices are competitive again — your promotion for [Station Name] has resumed."
// Priority: 'normal' (not 'high' — not time-critical)
```

If `NotificationService` (from Epic 6) only supports `DRIVER` users and device tokens are only collected from the mobile app, skip the push notification with a `logger.warn()` and document as a known limitation. The email channel already covers the pause event; resume is a positive event so push is best-effort.

---

## Partner App — Promotions UI

### New Pages

**`apps/partner/src/app/promotions/page.tsx`** — Campaign list (Server Component)

```typescript
// Fetches GET /v1/partner/promotions/:stationId via partnerFetch
// Renders: CampaignStatusBadge, active days remaining, expiry date, status banner for PAUSED
// Shows "Create Campaign" button if no ACTIVE or PENDING_PAYMENT campaign exists for the station
// i18n: Polish/English/Ukrainian strings for all labels
```

**`apps/partner/src/app/promotions/new/page.tsx`** — Purchase flow (Server Component + Client actions)

```typescript
// Step 1: Duration selector (1 day / 7 days) with price shown
// Step 2: Payment method selector (Card / Credit Balance — balance shown from user profile)
// Step 3: Price gate check — fetches GET /v1/partner/promotions/:stationId/price-gate-status
//         Shows current price vs. median; blocks if not eligible
// Step 4: Terms notice (auto-pause, 90-day expiry, no refunds)
// Step 5: Confirm + Pay
//   - Stripe: calls POST /v1/partner/promotions/checkout → redirects to session.url
//   - Credit: calls POST /v1/partner/promotions/checkout → shows success and redirects to /promotions
// Stripe success redirect: /promotions?session_id=...&status=success — shows success banner
```

**`apps/partner/src/app/promotions/new/purchase-action.ts`** — Server Action

```typescript
// 'use server'
// Calls partnerFetch('POST', '/v1/partner/promotions/checkout', { stationId, activeDays, paymentMethod, priceDrop })
// For Stripe: returns { sessionUrl } — client redirects via router.push(sessionUrl)
// For credit: returns { campaignId } — client redirects via router.push('/promotions')
```

### Sidebar Navigation

Add "Promotions" link to the partner app sidebar (after "Metrics"), with an active indicator when a campaign is running.

---

## Environment Variables

Add to `apps/api/.env.example`:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Add to `apps/partner/.env.example`:

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

`STRIPE_PUBLISHABLE_KEY` is needed if the partner app renders a Stripe Elements card form (Story 8.4). For Story 8.1 (Checkout Session redirect), it is not strictly needed — include for forward compatibility.

---

## Active Day Accounting

The `active_days_consumed` counter increments by 1 per calendar day the campaign spends in ACTIVE status. The daily job is responsible:

```typescript
// In checkAndPauseCampaigns(), BEFORE processing pauses:
// For each campaign that was ACTIVE at the START of yesterday (not paused all day):
//   active_days_consumed += 1
//   if active_days_consumed >= active_days_purchased → set status: EXPIRED

// Simple approximation (MVP): increment for any campaign that is ACTIVE when the job runs
// (Runs at 04:00 UTC — close enough to "end of day" for MVP)
// Days the campaign spends PAUSED do not increment the counter
```

---

## Admin Panel

No new admin panel section for 8.1. Campaigns are visible via Prisma Studio for ops during MVP phase. Proper admin campaign oversight added in Story 8.3.

---

## Module Registration

```typescript
// apps/api/src/promotion/promotion.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: PROMOTION_PAUSE_CHECK_QUEUE }),
    PrismaModule,
    // Do NOT import PartnerModule (avoid circular dep)
    // PromotionService is injected INTO PartnerModule, not the other way
  ],
  controllers: [PromotionController, PromotionWebhookController],
  providers: [PromotionService, PromotionPauseCheckWorker],
  exports: [PromotionService],  // exported so PartnerModule can inject it
})
export class PromotionModule {}
```

Add `PromotionModule` to `AppModule` imports. Add `PromotionModule` to `PartnerModule` imports (for `PartnerService` to access `PromotionService`).

---

## Regional Median — Data Source

The price gate uses `PriceHistoryService.getRegionalAverage(voivodeshipId, fuelType)` from Story 5.0. This returns the regional average price for a given voivodeship and fuel type.

The `Station` model has a `voivodeship_id` field (set during classification, Story 2.14). To get the station's voivodeship:

```typescript
const station = await this.prisma.station.findUniqueOrThrow({
  where: { id: stationId },
  select: { voivodeship_id: true, brand: true, name: true },
});
const medianPrice = await this.priceHistoryService.getRegionalAverage(station.voivodeship_id, fuelType);
```

If `getRegionalAverage` returns null (fewer than 3 stations in region), fall back to: allow purchase (eligible = true) — can't gate on unavailable data. Log a warning.

---

## Price Gate Eligibility Check — Implementation

```typescript
async checkPriceGate(stationId: string): Promise<PriceGateResult> {
  const fuelTypes = ['pb95', 'on', 'pb98', 'lpg'];
  const currentPrices = await this.priceService.findPricesByStationIds([stationId]);
  const stationPrices = currentPrices[stationId] ?? {};

  for (const fuelType of fuelTypes) {
    const currentPrice = stationPrices[fuelType];
    if (!currentPrice) continue;

    const median = await this.priceHistoryService.getRegionalAverage(
      station.voivodeship_id,
      fuelType
    );
    if (median === null) return { eligible: true, reason: 'no_regional_data' };
    if (currentPrice <= median) {
      return { eligible: true, currentPrice, medianPrice: median, fuelType };
    }
  }

  // All fuel types exceed median
  const firstFuelType = fuelTypes.find(ft => stationPrices[ft]);
  return {
    eligible: false,
    currentPrice: stationPrices[firstFuelType],
    medianPrice: await this.priceHistoryService.getRegionalAverage(station.voivodeship_id, firstFuelType),
    fuelType: firstFuelType,
  };
}
```

---

## Tasks / Subtasks

- [ ] Prisma schema: add `PromotionCampaign` model, `CampaignStatus` enum, `credit_balance_pln` to User (AC: schema)
  - [ ] Write migration `add_promotion_campaign`
  - [ ] Run `prisma generate` to update client

- [ ] PromotionModule scaffold (AC: all)
  - [ ] Create `apps/api/src/promotion/` directory structure
  - [ ] `promotion.module.ts` with BullMQ queue registration
  - [ ] `constants.ts` with price table and queue name
  - [ ] Register PromotionModule in AppModule and PartnerModule

- [ ] PromotionService — price gate (AC: 3, 4)
  - [ ] `checkPriceGate()` — read current prices + regional average
  - [ ] `GET /v1/partner/promotions/:stationId/price-gate-status` endpoint

- [ ] PromotionService — campaign creation (AC: 4, 5)
  - [ ] Stripe Checkout Session creation (stripe payment path)
  - [ ] Credit balance deduction with `prisma.$transaction` (credit path)
  - [ ] `POST /v1/partner/promotions/checkout` endpoint

- [ ] Stripe webhook handler (AC: 4, 5)
  - [ ] `PromotionWebhookController` with raw body parsing
  - [ ] `handleStripeWebhook()` — activate on `checkout.session.completed`
  - [ ] `checkout.session.expired` cleanup

- [ ] BullMQ daily job (AC: 6, 7, 8, 9, 10)
  - [ ] `PromotionPauseCheckWorker` registered in PromotionModule
  - [ ] `checkAndPauseCampaigns()` — pause/resume/expire/warn logic
  - [ ] Schedule repeatable job at 04:00 UTC
  - [ ] Expiry warning delayed job scheduling on campaign activation

- [ ] Email notifications (AC: 6, 8, 9, 10)
  - [ ] Add `sendCampaignPaused()`, `sendCampaignExpired()`, `sendCampaignExpiryWarning()` to `ClaimEmailService`

- [ ] Hook into updateOwnerPrice (AC: 7)
  - [ ] `resumeCampaignsForStation()` in PromotionService
  - [ ] Fire-and-forget call in `PartnerService.updateOwnerPrice()`

- [ ] Campaign list + cancel endpoint (AC: 1, last AC)
  - [ ] `GET /v1/partner/promotions/:stationId` — list campaigns
  - [ ] `POST /v1/partner/promotions/:campaignId/cancel`

- [ ] Partner app — Promotions UI (AC: 1, 2, 3, 4)
  - [ ] `/promotions/page.tsx` — campaign list with status
  - [ ] `/promotions/new/page.tsx` — purchase flow (duration + payment method + gate check + terms)
  - [ ] `purchase-action.ts` server action
  - [ ] Sidebar navigation link

- [ ] Environment variables
  - [ ] Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY to .env.example files
  - [ ] Document Stripe dashboard webhook setup (localhost.run for local dev)

---

## Dev Notes

### Stripe in Local Dev

Use `stripe listen --forward-to localhost:3000/v1/stripe/webhooks` (Stripe CLI) to receive webhook events locally. The CLI provides a `STRIPE_WEBHOOK_SECRET` for the local session. Do NOT hardcode the local secret — use `.env.local`.

### Raw Body for Stripe Signature Verification

Fastify parses JSON bodies by default. Stripe requires the raw Buffer to verify `stripe-signature` header. Solution — in `main.ts`, register a custom content type parser BEFORE the default JSON parser for the webhook route, OR disable JSON parsing for that specific route using a Fastify hook. Recommended pattern:

```typescript
// main.ts — Fastify raw body config
app.useBodyParser('application/json', (req, payload, done) => {
  // Store raw body on request for webhook routes
  let data = '';
  payload.on('data', chunk => data += chunk);
  payload.on('end', () => {
    (req as any).rawBody = Buffer.from(data);
    try { done(null, JSON.parse(data)); } catch { done(null, {}); }
  });
});
```

Then in `PromotionWebhookController`:
```typescript
const sig = req.headers['stripe-signature'] as string;
const event = stripe.webhooks.constructEvent((req as any).rawBody, sig, STRIPE_WEBHOOK_SECRET);
```

### Active Day Counter — Drift Risk

The MVP approximation (increment ACTIVE campaigns when daily job runs at 04:00 UTC) means a campaign activated at 23:59 gets a full day credited. This is intentional — it's simpler and slightly favourable to the owner. Post-MVP, switch to tracking `active_day_log` entries per calendar day for exact accounting.

### Credit Balance — Currency Handling

`credit_balance_pln` uses `Decimal @db.Decimal(10, 2)` (Prisma). Always compare with `Prisma.Decimal` instances — never cast to JS `number` for financial calculations. Use `.lessThan()`, `.sub()`, `.add()` methods.

### PriceGateResult Type

```typescript
type PriceGateResult = {
  eligible: boolean;
  currentPrice?: number;
  medianPrice?: number;
  fuelType?: string;
  reason?: 'no_regional_data';
};
```

### Dependency Injection Order

`PartnerModule` imports `PromotionModule` (to inject PromotionService into PartnerService).
`PromotionModule` does NOT import `PartnerModule`.
`PromotionService` imports `PriceModule` (for `PriceService`/`PriceHistoryService`) and `PrismaModule`.
`ClaimEmailService` is in `PartnerModule` — PromotionModule must either:
  - Re-declare email sending inline with the Resend client, OR
  - Move `ClaimEmailService` to a shared `NotificationModule` (preferred if ≥2 modules need it)

**Recommended:** create `apps/api/src/notifications/email.service.ts` to consolidate all Resend usage — but only if this pattern repeats ≥2 times. For 8.1, add the 4 campaign email methods directly to `ClaimEmailService` and import `PartnerModule` into `PromotionModule` with `forwardRef()` if needed, OR just duplicate the Resend send call inline in `PromotionService` since the email templates are simple.

### Story 8.4 Forward Compatibility

`credit_balance_pln` is added to `User` in this story. Story 8.4 (Billing Portal) adds top-up UI and invoice generation on top. Do NOT implement balance top-up in this story — only the deduction path.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
