# Story 10.2: Data Buyer Onboarding & Licensing

## Metadata
- **Epic:** 10 — Data Licensing & Public Portal
- **Story ID:** 10.2
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 10.1 (apps/web exists), Story 8.1 (Stripe webhook infrastructure, raw body middleware), Story 9.5 (EmailService via Resend), Story 1.5 (UserRole enum — DATA_BUYER exists)
- **Required by:** Story 10.3 (DataApiKey model defined here), Story 10.4 (same)

---

## User Story

**As an external data buyer,**
I want to browse available datasets, select a tier, pay, and receive my API key without involving a sales team,
So that I can access the data I need quickly and with minimal friction.

---

## Context & Why

The buyer journey is: landing page → application form → Stripe payment → ops review → API key delivered by email. Manual ops review is intentional at MVP: each buyer is checked for compliance and intended use before access is granted. The ops team is small and buyer volumes are expected to be low (tens, not thousands). Automation of key provisioning comes when volume makes manual review a bottleneck.

### User Account Strategy

Data buyers get a `User` record with `role = DATA_BUYER` — the role already exists in `UserRole` (Story 1.5). The User is created automatically during the application flow; the buyer never needs to log in to the web app for MVP. If they want to log in later (post-MVP buyer portal), they can use the "forgot password" flow in the mobile app or a future web auth page. The real access gate is the `DataApiKey` record created during approval, not the User session.

### Ops Workflow

After payment, a new "Data Buyers" section in `apps/admin` surfaces pending buyers for review. Ops clicks "Approve" — the system sets `DataBuyerProfile.status = ACTIVE`, generates an API key, and emails it to the buyer. No manual key handling. Ops clicks "Suspend" to revoke access.

---

## Acceptance Criteria

**Given** a buyer visits `/data`
**When** the page loads
**Then** they see two available tiers (Price Data, Consumption Data), their included datasets, update frequency, and pricing (PLN/month) with a "Get access" CTA per tier

**Given** a buyer clicks "Get access" on a tier
**When** they fill in the application form (email, company name, country, intended use) and submit
**Then** they are redirected to a Stripe Checkout page for a monthly subscription matching the selected tier

**Given** payment is successful
**When** Stripe redirects back to `/data/success`
**Then** the page shows: "Your application is being reviewed — you'll receive your API key by email within 1 business day"
**And** the ops team receives a notification email with the buyer's details

**Given** ops approves a buyer in the admin portal
**When** they click "Approve access"
**Then** the buyer receives an email with: their API key, the base URL (`https://api.desert.app/v1/data/`), a link to the documentation page, and their tier and rate limits
**And** `DataBuyerProfile.status` is set to `ACTIVE`

**Given** ops suspends an active buyer
**When** the action completes
**Then** `DataBuyerProfile.status` is set to `SUSPENDED`
**And** subsequent API calls with any of the buyer's keys return HTTP 401

**Given** a buyer's subscription payment fails on renewal
**When** the `invoice.payment_failed` webhook fires
**Then** `DataBuyerProfile.status` is set to `SUSPENDED`
**And** the buyer is emailed a payment failure notice with a Stripe portal link to update their card

---

## New Prisma Models

```prisma
enum DataBuyerStatus {
  PENDING_REVIEW   // paid, waiting for ops approval
  ACTIVE           // ops approved, key provisioned
  SUSPENDED        // access revoked (ops action or payment failure)
}

enum DataTier {
  PRICE_DATA        // Story 10.3 endpoints only
  CONSUMPTION_DATA  // Story 10.4 endpoints only (requires Epic 5 data)
  FULL_ACCESS       // all data endpoints
}

model DataBuyerProfile {
  id                     String          @id @default(cuid())
  user_id                String          @unique
  user                   User            @relation(fields: [user_id], references: [id])
  company_name           String
  country                String          @default("PL")
  intended_use           String          @db.Text
  tier                   DataTier
  status                 DataBuyerStatus @default(PENDING_REVIEW)
  stripe_customer_id     String?
  stripe_subscription_id String?
  created_at             DateTime        @default(now())
  updated_at             DateTime        @updatedAt

  api_keys               DataApiKey[]    // defined in Story 10.3

  @@index([status])
}
```

**Add to `User` model:**
```prisma
data_buyer_profile  DataBuyerProfile?
```

**`DataApiKey` model** — defined in Story 10.3 with full guard implementation. Referenced here by relation only. Add to migration `add_data_buyer` as a forward reference or define a stub and expand in 10.3.

**Migration name:** `add_data_buyer`

---

## Data Buyer Constants

**File:** `apps/api/src/data-buyer/data-buyer.constants.ts` (new)

```typescript
// Stripe Price IDs — configure in Stripe Dashboard before go-live
// Pricing is TBD — set actual amounts before launch
export const STRIPE_PRICE_IDS: Record<string, string> = {
  PRICE_DATA:       process.env['STRIPE_DATA_PRICE_ID'] ?? '',
  CONSUMPTION_DATA: process.env['STRIPE_CONSUMPTION_PRICE_ID'] ?? '',
  FULL_ACCESS:      process.env['STRIPE_FULL_ACCESS_PRICE_ID'] ?? '',
};

// Metadata type tag to distinguish from fleet/promo checkout sessions
export const DATA_BUYER_CHECKOUT_METADATA_TYPE = 'data_buyer_subscription';

// Rate limits per tier (requests per day) — shown in approval email and docs
export const TIER_RATE_LIMITS: Record<string, { requestsPerDay: number; description: string }> = {
  PRICE_DATA:       { requestsPerDay: 10_000, description: 'Fuel price datasets' },
  CONSUMPTION_DATA: { requestsPerDay: 5_000,  description: 'Vehicle consumption datasets' },
  FULL_ACCESS:      { requestsPerDay: 20_000, description: 'All datasets' },
};
```

**Environment variables — add to `apps/api/.env.example`:**

```
# Stripe price IDs for data licensing tiers (TBD — set in Stripe Dashboard)
STRIPE_DATA_PRICE_ID=price_xxx
STRIPE_CONSUMPTION_PRICE_ID=price_xxx
STRIPE_FULL_ACCESS_PRICE_ID=price_xxx

# Web app URL (for Stripe redirect)
WEB_APP_URL=https://desert.app
```

---

## DataBuyerService

**File:** `apps/api/src/data-buyer/data-buyer.service.ts` (new)

```typescript
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DataBuyerStatus, DataTier, UserRole } from '@prisma/client';
import {
  STRIPE_PRICE_IDS,
  DATA_BUYER_CHECKOUT_METADATA_TYPE,
  TIER_RATE_LIMITS,
} from './data-buyer.constants';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '', { apiVersion: '2024-06-20' });

@Injectable()
export class DataBuyerService {
  private readonly logger = new Logger(DataBuyerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ─── Application + Checkout ──────────────────────────────────────────────

  async apply(dto: {
    email: string;
    companyName: string;
    country: string;
    intendedUse: string;
    tier: DataTier;
  }): Promise<{ checkoutUrl: string }> {
    const priceId = STRIPE_PRICE_IDS[dto.tier];
    if (!priceId) throw new BadRequestException('Selected tier is not yet available for purchase');

    // Find or create User with DATA_BUYER role
    let user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      // Create User with DATA_BUYER role + random temp password
      // SuperTokens user creation is handled separately at auth level;
      // here we create the DB-side User row directly for the profile reference.
      // The buyer can set a password via "forgot password" when they want to log in.
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          role: UserRole.DATA_BUYER,
          display_name: dto.companyName,
        },
      });
    }

    // Idempotency: if a profile already exists and is ACTIVE or PENDING_REVIEW, don't re-apply
    const existing = await this.prisma.dataBuyerProfile.findUnique({
      where: { user_id: user.id },
    });
    if (existing && existing.status !== DataBuyerStatus.SUSPENDED) {
      throw new BadRequestException('An application for this email already exists');
    }

    // Create Stripe Customer
    const customer = await stripe.customers.create({
      email: dto.email,
      name: dto.companyName,
      metadata: { userId: user.id },
    });

    // Create or update DataBuyerProfile
    const profile = await this.prisma.dataBuyerProfile.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        company_name: dto.companyName,
        country: dto.country,
        intended_use: dto.intendedUse,
        tier: dto.tier,
        status: DataBuyerStatus.PENDING_REVIEW,  // status set to PENDING_REVIEW after payment
        stripe_customer_id: customer.id,
      },
      update: {
        company_name: dto.companyName,
        country: dto.country,
        intended_use: dto.intendedUse,
        tier: dto.tier,
        status: DataBuyerStatus.PENDING_REVIEW,
        stripe_customer_id: customer.id,
      },
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env['WEB_APP_URL']}/data/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env['WEB_APP_URL']}/data/signup?cancelled=1`,
      metadata: {
        profileId: profile.id,
        userId: user.id,
        type: DATA_BUYER_CHECKOUT_METADATA_TYPE,
      },
    });

    return { checkoutUrl: session.url! };
  }

  // ─── Webhook Handlers ────────────────────────────────────────────────────

  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (session.metadata?.type !== DATA_BUYER_CHECKOUT_METADATA_TYPE) return;

    const profileId = session.metadata.profileId;
    const subscriptionId = session.subscription as string;

    await this.prisma.dataBuyerProfile.update({
      where: { id: profileId },
      data: {
        status: DataBuyerStatus.PENDING_REVIEW,
        stripe_subscription_id: subscriptionId,
      },
    });

    // Notify ops
    const profile = await this.prisma.dataBuyerProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { email: true } } },
    });

    if (profile) {
      await this.email.sendOpsDataBuyerNotification({
        companyName: profile.company_name,
        email: profile.user.email ?? '',
        tier: profile.tier,
        intendedUse: profile.intended_use,
        profileId: profile.id,
      }).catch(() => {});
    }

    this.logger.log(`[DATA-BUYER] New application pending review: profile ${profileId}`);
  }

  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await this.prisma.dataBuyerProfile.updateMany({
      where: { stripe_subscription_id: subscription.id },
      data: { status: DataBuyerStatus.SUSPENDED },
    });
  }

  async handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.customer) return;
    const profile = await this.prisma.dataBuyerProfile.findFirst({
      where: { stripe_customer_id: invoice.customer as string },
      include: { user: { select: { email: true } } },
    });
    if (!profile) return;

    await this.prisma.dataBuyerProfile.update({
      where: { id: profile.id },
      data: { status: DataBuyerStatus.SUSPENDED },
    });

    if (profile.user.email) {
      await this.email.sendDataBuyerPaymentFailed({
        to: profile.user.email,
        companyName: profile.company_name,
      }).catch(() => {});
    }
  }

  // ─── Admin Actions ───────────────────────────────────────────────────────

  async listForAdmin(status?: DataBuyerStatus) {
    return this.prisma.dataBuyerProfile.findMany({
      where: status ? { status } : undefined,
      include: { user: { select: { email: true, id: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async approveAccess(profileId: string): Promise<void> {
    const profile = await this.prisma.dataBuyerProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { email: true, id: true } } },
    });
    if (!profile) throw new NotFoundException('Data buyer profile not found');
    if (profile.status === DataBuyerStatus.ACTIVE) return;  // idempotent

    // Generate API key (same pattern as FleetApiKey in Story 9.7)
    const { createHash } = await import('crypto');
    const raw = randomBytes(32).toString('hex');
    const key = `ddk_${raw}`;  // ddk_ = desert data key
    const keyHash = createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.slice(0, 12);

    await this.prisma.$transaction([
      // Activate profile
      this.prisma.dataBuyerProfile.update({
        where: { id: profileId },
        data: { status: DataBuyerStatus.ACTIVE },
      }),
      // Ensure DATA_BUYER role
      this.prisma.user.update({
        where: { id: profile.user_id },
        data: { role: UserRole.DATA_BUYER },
      }),
      // Create DataApiKey (model defined in Story 10.3)
      this.prisma.dataApiKey.create({
        data: {
          profile_id: profileId,
          name: 'Default',
          key_hash: keyHash,
          key_prefix: keyPrefix,
        },
      }),
    ]);

    // Send approval email with key (plaintext — shown once)
    const tierInfo = TIER_RATE_LIMITS[profile.tier];
    await this.email.sendDataBuyerApprovalEmail({
      to: profile.user.email!,
      companyName: profile.company_name,
      apiKey: key,
      tier: profile.tier,
      tierDescription: tierInfo.description,
      requestsPerDay: tierInfo.requestsPerDay,
    });

    this.logger.log(`[DATA-BUYER] Approved profile ${profileId}, key sent to ${profile.user.email}`);
  }

  async suspendAccess(profileId: string): Promise<void> {
    await this.prisma.dataBuyerProfile.update({
      where: { id: profileId },
      data: { status: DataBuyerStatus.SUSPENDED },
    });
  }
}
```

---

## Public API Endpoint

**File:** `apps/api/src/data-buyer/data-buyer.controller.ts` (new)

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { DataBuyerService } from './data-buyer.service';
import { DataTier } from '@prisma/client';

class ApplyDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(200) companyName: string;
  @IsString() @MaxLength(2) country: string;
  @IsString() @MinLength(20) @MaxLength(500) intendedUse: string;
  @IsEnum(DataTier) tier: DataTier;
}

@Controller('v1/data-buyers')
export class DataBuyerController {
  constructor(private readonly service: DataBuyerService) {}

  @Post('apply')
  @Public()
  async apply(@Body() dto: ApplyDto): Promise<{ checkoutUrl: string }> {
    return this.service.apply(dto);
  }
}
```

---

## Admin API Endpoints

**Add to `AdminController` or create `AdminDataBuyerController`:**

```typescript
// apps/api/src/admin/admin-data-buyer.controller.ts

@Controller('v1/admin/data-buyers')
@Roles(Role.ADMIN)
export class AdminDataBuyerController {
  constructor(private readonly dataBuyerService: DataBuyerService) {}

  @Get()
  async list(@Query('status') status?: DataBuyerStatus) {
    return this.dataBuyerService.listForAdmin(status);
  }

  @Post(':profileId/approve')
  @HttpCode(200)
  async approve(@Param('profileId') profileId: string) {
    await this.dataBuyerService.approveAccess(profileId);
    return { approved: true };
  }

  @Post(':profileId/suspend')
  @HttpCode(200)
  async suspend(@Param('profileId') profileId: string) {
    await this.dataBuyerService.suspendAccess(profileId);
    return { suspended: true };
  }
}
```

---

## Webhook Integration

**Extend `StripeWebhookController` (established in Story 9.8) with data buyer cases:**

```typescript
// In the switch statement — add alongside fleet cases:

case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session;
  await this.promotionService.handleCheckoutCompleted(session);       // promos
  await this.fleetBillingService.handleCheckoutCompleted(session);    // fleet
  await this.dataBuyerService.handleCheckoutCompleted(session);       // data buyers
  break;
}
case 'customer.subscription.deleted': {
  await this.fleetBillingService.handleSubscriptionDeleted(...);
  await this.dataBuyerService.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
  break;
}
case 'invoice.payment_failed': {
  await this.fleetBillingService.handleInvoiceFailed(...);
  await this.dataBuyerService.handleInvoiceFailed(event.data.object as Stripe.Invoice);
  break;
}
```

Each handler is no-op if the event doesn't belong to its domain (metadata type check / customer ID lookup).

---

## Email Service Extensions

**Add to `apps/api/src/email/email.service.ts`:**

```typescript
async sendOpsDataBuyerNotification(p: {
  companyName: string; email: string; tier: string;
  intendedUse: string; profileId: string;
}): Promise<void> {
  const opsEmail = process.env['OPS_NOTIFICATION_EMAIL'] ?? 'ops@desert.app';
  await this.resend.emails.send({
    from: this.from,
    to: opsEmail,
    subject: `New data buyer application: ${p.companyName}`,
    html: `
      <p><strong>Company:</strong> ${p.companyName}</p>
      <p><strong>Email:</strong> ${p.email}</p>
      <p><strong>Tier:</strong> ${p.tier}</p>
      <p><strong>Intended use:</strong> ${p.intendedUse}</p>
      <p><a href="${process.env['ADMIN_APP_URL']}/data-buyers">Review in admin portal →</a></p>
    `,
  }).catch((e: Error) => this.logger.error(`Ops notification failed: ${e.message}`));
}

async sendDataBuyerApprovalEmail(p: {
  to: string; companyName: string; apiKey: string;
  tier: string; tierDescription: string; requestsPerDay: number;
}): Promise<void> {
  await this.resend.emails.send({
    from: this.from,
    to: p.to,
    subject: 'Your Desert API access is ready',
    html: `
      <p>Hi ${p.companyName},</p>
      <p>Your Desert Data API access has been approved. Here are your credentials:</p>
      <table style="font-family:monospace; background:#f3f4f6; padding:16px; border-radius:8px; width:100%;">
        <tr><td><strong>API Key:</strong></td><td>${p.apiKey}</td></tr>
        <tr><td><strong>Base URL:</strong></td><td>https://api.desert.app/v1/data/</td></tr>
        <tr><td><strong>Tier:</strong></td><td>${p.tierDescription}</td></tr>
        <tr><td><strong>Rate limit:</strong></td><td>${p.requestsPerDay.toLocaleString()} requests/day</td></tr>
      </table>
      <p><strong>Save your API key — it will not be shown again.</strong></p>
      <p>Authorization header: <code>Authorization: Bearer ${p.apiKey}</code></p>
      <p><a href="${process.env['WEB_APP_URL']}/data/docs">View API documentation →</a></p>
    `,
  }).catch((e: Error) => this.logger.error(`Approval email failed: ${e.message}`));
}

async sendDataBuyerPaymentFailed(p: { to: string; companyName: string }): Promise<void> {
  await this.resend.emails.send({
    from: this.from,
    to: p.to,
    subject: 'Action required: Desert API payment failed',
    html: `
      <p>Hi ${p.companyName},</p>
      <p>We could not process your Desert Data API subscription payment. Your API access has been suspended.</p>
      <p>Please update your payment details to restore access:</p>
      <p><a href="https://billing.stripe.com/p/login/TBD">Update payment method →</a></p>
    `,
  }).catch((e: Error) => this.logger.error(`Payment-failed email failed: ${e.message}`));
}
```

**Add env vars to `.env.example`:**
```
OPS_NOTIFICATION_EMAIL=ops@desert.app
ADMIN_APP_URL=https://admin.desert.app
```

---

## Admin Portal — Data Buyers Section

### File Structure

```
apps/admin/app/(protected)/data-buyers/
├── page.tsx          — pending + active buyers list (Server Component)
├── actions.ts        — approve / suspend server actions
└── [profileId]/
    └── page.tsx      — buyer detail with intended use (Server Component)
```

### `actions.ts`

```typescript
'use server';
import { adminFetch } from '../../../lib/admin-api';
import { revalidatePath } from 'next/cache';

export async function approveDataBuyer(profileId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/data-buyers/${profileId}/approve`, { method: 'POST' });
    revalidatePath('/data-buyers');
    return {};
  } catch {
    return { error: 'Approval failed' };
  }
}

export async function suspendDataBuyer(profileId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/data-buyers/${profileId}/suspend`, { method: 'POST' });
    revalidatePath('/data-buyers');
    return {};
  } catch {
    return { error: 'Suspension failed' };
  }
}
```

### `page.tsx` (list — Server Component)

```tsx
import { adminFetch } from '../../../lib/admin-api';
import DataBuyerRow from './DataBuyerRow';

export default async function DataBuyersPage() {
  const buyers = await adminFetch<any[]>('/v1/admin/data-buyers').catch(() => []);
  const pending = buyers.filter((b) => b.status === 'PENDING_REVIEW');
  const active  = buyers.filter((b) => b.status === 'ACTIVE');
  const suspended = buyers.filter((b) => b.status === 'SUSPENDED');

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold mb-6">Data Buyers</h1>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-amber-700 mb-3">
            Pending Review ({pending.length})
          </h2>
          <ul className="divide-y divide-gray-100 border border-amber-200 rounded-xl overflow-hidden">
            {pending.map((b) => <DataBuyerRow key={b.id} buyer={b} />)}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-green-700 mb-3">Active ({active.length})</h2>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {active.map((b) => <DataBuyerRow key={b.id} buyer={b} />)}
          </ul>
        </section>
      )}

      {suspended.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Suspended ({suspended.length})</h2>
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden opacity-60">
            {suspended.map((b) => <DataBuyerRow key={b.id} buyer={b} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
```

**`DataBuyerRow.tsx`** — Client Component with approve/suspend buttons following the same pattern as claim approval rows in Story 7.2.

---

## `apps/web` Changes

### New Pages

```
apps/web/app/
├── data/
│   ├── page.tsx        — pricing landing (static — no fetch needed)
│   ├── signup/
│   │   └── page.tsx    — application form (Client Component)
│   └── success/
│       └── page.tsx    — post-checkout confirmation
```

### Pricing Landing (`/data/page.tsx`)

Server Component, mostly static. Renders tier cards with feature lists and "Get access" buttons pointing to `/data/signup?tier=PRICE_DATA` etc.

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fuel Price Data API | Desert',
  description: 'Access live and historical fuel price data for Poland via REST API.',
};

const TIERS = [
  {
    id: 'PRICE_DATA',
    name: 'Price Data',
    priceLabel: 'TBD PLN/month',
    description: 'Live and historical fuel prices by station, region, and fuel type.',
    features: ['Station-level prices', 'Regional aggregates', 'Up to 12 months history', '10,000 req/day'],
    available: true,
  },
  {
    id: 'CONSUMPTION_DATA',
    name: 'Consumption Data',
    priceLabel: 'TBD PLN/month',
    description: 'Real-world fuel consumption benchmarks by vehicle make, model, and region.',
    features: ['l/100km by make/model', 'Regional breakdown', 'Seasonal trends', '5,000 req/day'],
    available: false,  // gated on Epic 5 data accumulation
    unavailableNote: 'Available once dataset reaches sufficient coverage.',
  },
];

export default function DataLandingPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Fuel Data API</h1>
      <p className="text-gray-500 mb-10">
        Integrate live Polish fuel price and consumption data into your products.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`rounded-2xl border p-6 flex flex-col ${
              tier.available ? 'border-gray-200' : 'border-gray-100 opacity-60'
            }`}
          >
            <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
            <p className="text-2xl font-bold text-gray-900 mt-1 mb-1">{tier.priceLabel}</p>
            <p className="text-sm text-gray-500 mb-4">{tier.description}</p>
            <ul className="space-y-1 mb-6 flex-1">
              {tier.features.map((f) => (
                <li key={f} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-green-500">✓</span> {f}
                </li>
              ))}
            </ul>
            {tier.available ? (
              <a
                href={`/data/signup?tier=${tier.id}`}
                className="block text-center py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium"
              >
                Get access
              </a>
            ) : (
              <p className="text-xs text-gray-400 text-center">{tier.unavailableNote}</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center mt-10">
        Questions? Contact <a href="mailto:data@desert.app" className="underline">data@desert.app</a>
      </p>
    </main>
  );
}
```

### Application Form (`/data/signup/page.tsx` — Client Component)

```tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';

const TIER_LABELS: Record<string, string> = {
  PRICE_DATA: 'Price Data', CONSUMPTION_DATA: 'Consumption Data', FULL_ACCESS: 'Full Access',
};

export default function SignupPage() {
  const params = useSearchParams();
  const tier = params.get('tier') ?? 'PRICE_DATA';

  const [form, setForm] = useState({
    email: '', companyName: '', country: 'PL', intendedUse: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/data-buyers/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, tier }),
        });
        if (!res.ok) {
          const body = await res.json() as { message?: string };
          throw new Error(body.message ?? 'Submission failed');
        }
        const { checkoutUrl } = await res.json() as { checkoutUrl: string };
        window.location.href = checkoutUrl;
      } catch (err: any) {
        setError(err.message ?? 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-12">
      <a href="/data" className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-block">← Back</a>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Apply for API access</h1>
      <p className="text-sm text-gray-500 mb-8">
        Tier: <strong>{TIER_LABELS[tier] ?? tier}</strong>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email" required value={form.email}
            onChange={(e) => update('email', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company name</label>
          <input
            type="text" required maxLength={200} value={form.companyName}
            onChange={(e) => update('companyName', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <select
            value={form.country} onChange={(e) => update('country', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="PL">Poland</option>
            <option value="DE">Germany</option>
            <option value="CZ">Czech Republic</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            How will you use this data?
          </label>
          <textarea
            required minLength={20} maxLength={500} value={form.intendedUse}
            onChange={(e) => update('intendedUse', e.target.value)}
            rows={4}
            placeholder="e.g. Route cost estimation in our logistics TMS..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{form.intendedUse.length}/500</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <button
          type="submit" disabled={pending}
          className="w-full py-3 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Redirecting to payment…' : 'Continue to payment'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          You'll be redirected to Stripe to complete payment. Your API key will be
          emailed within 1 business day after review.
        </p>
      </form>
    </main>
  );
}
```

### Success Page (`/data/success/page.tsx`)

```tsx
export default function SuccessPage() {
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="text-4xl mb-4">✓</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Application received</h1>
      <p className="text-gray-500">
        Your application is being reviewed. You'll receive your API key and documentation
        by email within 1 business day.
      </p>
      <p className="text-sm text-gray-400 mt-6">
        Questions? <a href="mailto:data@desert.app" className="underline">data@desert.app</a>
      </p>
    </main>
  );
}
```

**Add `NEXT_PUBLIC_API_URL` to `apps/web/.env.example`** — public API base URL for the client-side signup form fetch.

---

## Migration

**Name:** `add_data_buyer`

```sql
CREATE TYPE "DataBuyerStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "DataTier" AS ENUM ('PRICE_DATA', 'CONSUMPTION_DATA', 'FULL_ACCESS');

CREATE TABLE "DataBuyerProfile" (
    "id"                     TEXT          NOT NULL,
    "user_id"                TEXT          NOT NULL,
    "company_name"           TEXT          NOT NULL,
    "country"                TEXT          NOT NULL DEFAULT 'PL',
    "intended_use"           TEXT          NOT NULL,
    "tier"                   "DataTier"    NOT NULL,
    "status"                 "DataBuyerStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "stripe_customer_id"     TEXT,
    "stripe_subscription_id" TEXT,
    "created_at"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "DataBuyerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataBuyerProfile_user_id_key" ON "DataBuyerProfile"("user_id");
CREATE INDEX "DataBuyerProfile_status_idx" ON "DataBuyerProfile"("status");

ALTER TABLE "DataBuyerProfile" ADD CONSTRAINT "DataBuyerProfile_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

`DataApiKey` table is added in Story 10.3's migration (`add_data_api_key`).

---

## Tasks / Subtasks

- [ ] API: Prisma schema — `DataBuyerProfile` + `DataBuyerStatus` + `DataTier` enums (AC: 1, 2, 4)
  - [ ] Migration: `add_data_buyer`

- [ ] API: `DataBuyerService` (AC: 2, 3, 4, 5, 6)
  - [ ] `apply()` — create User (if new) + DataBuyerProfile + Stripe customer + Checkout
  - [ ] `handleCheckoutCompleted()` — gate on metadata type, update status, notify ops
  - [ ] `handleSubscriptionDeleted()` + `handleInvoiceFailed()` → SUSPENDED + email
  - [ ] `approveAccess()` — transaction: activate profile + set role + create DataApiKey (stub) + send key email
  - [ ] `suspendAccess()` — set SUSPENDED

- [ ] API: `POST /v1/data-buyers/apply` — `@Public()`, `ApplyDto` validation (AC: 2)
- [ ] API: Admin endpoints — list, approve, suspend (AC: 4, 5)
- [ ] API: Extend `StripeWebhookController` with data buyer event cases (AC: 3, 6)
- [ ] API: `EmailService` — `sendOpsDataBuyerNotification`, `sendDataBuyerApprovalEmail`, `sendDataBuyerPaymentFailed` (AC: 3, 4, 6)
- [ ] API: Env vars — `STRIPE_DATA_PRICE_ID`, `STRIPE_CONSUMPTION_PRICE_ID`, `STRIPE_FULL_ACCESS_PRICE_ID`, `WEB_APP_URL`, `OPS_NOTIFICATION_EMAIL` in `.env.example`

- [ ] Admin app: `app/(protected)/data-buyers/` — page.tsx + actions.ts + DataBuyerRow.tsx (AC: 4, 5)
  - [ ] Add "Data Buyers" link to admin nav

- [ ] Web: `/data/page.tsx` — pricing landing with two tier cards (AC: 1)
  - [ ] CONSUMPTION_DATA tier shown but greyed out (`available: false`)
- [ ] Web: `/data/signup/page.tsx` — application form, client-side POST to `/v1/data-buyers/apply` (AC: 2)
  - [ ] Pre-fill tier from query param
- [ ] Web: `/data/success/page.tsx` — confirmation page (AC: 3)
- [ ] Web: `NEXT_PUBLIC_API_URL` in `.env.example`

---

## Dev Notes

### User Creation Without SuperTokens

`DataBuyerService.apply()` creates a `User` row directly via Prisma, bypassing SuperTokens. This is intentional — data buyers don't need to authenticate via the mobile app. The User record exists for admin visibility and future buyer portal login. If a buyer later wants to log in, they can request a password reset via email.

The `User` model may have a `supertokens_id` field (from Story 1.1). This field should be nullable — set it to `null` for programmatically created data buyer accounts. If the field has a `NOT NULL` constraint, add a generated placeholder (e.g. `supertokens_id: 'buyer_' + userId`). Verify in the User model from Story 1.1.

### `approveAccess()` — DataApiKey Stub

`approveAccess()` calls `this.prisma.dataApiKey.create(...)` which requires the `DataApiKey` model from Story 10.3. When implementing 10.2, either:
1. Define `DataApiKey` in the `add_data_buyer` migration as part of this story, or
2. Implement 10.3 first and implement 10.2's `approveAccess()` last

Recommended: implement Stories 10.3 then 10.2's admin approval action, in that order.

### Consumption Data Tier — Gated Display

The consumption data tier is shown on the pricing page with `available: false`. The "Get access" CTA is replaced with an availability note. The `STRIPE_CONSUMPTION_PRICE_ID` env var can be left empty until the tier launches. `DataBuyerService.apply()` already guards: `if (!priceId) throw new BadRequestException(...)`.

### Stripe Stripe Portal Link in Payment-Failed Email

The Stripe Customer Portal login URL in `sendDataBuyerPaymentFailed()` uses a placeholder (`TBD`). Replace with the actual Stripe-hosted billing portal link from the Stripe Dashboard, or use a Stripe-generated portal session link (same approach as Story 9.8's `createPortalSession()`). For MVP, the link points to a static Stripe portal URL configured in the dashboard.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
