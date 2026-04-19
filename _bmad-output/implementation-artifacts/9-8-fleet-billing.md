# Story 9.8: Fleet Subscription Billing Portal

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.8
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (Fleet model with `stripe_customer_id`, `stripe_subscription_id`, `FleetSubscriptionStatus`), Story 8.1 (Stripe integration, webhook endpoint, raw body middleware), Story 8.4 (pdfkit PDF generation, R2 storage pattern, invoice numbering)
- **Required by:** None (final story in Epic 9)

---

## User Story

**As a fleet manager,**
I want a self-serve billing portal to subscribe, view invoices, update my payment method, and cancel my subscription,
So that I can manage my fleet tier costs without contacting support.

---

## Context & Why

Stories 9.1–9.7 built the fleet feature set. This story adds the payment layer that makes the fleet tier a commercial product. Without it, every fleet account stays on FREE_TRIAL indefinitely — the business has no revenue lever.

### Architectural Choices

**Stripe Subscriptions** (not one-time payments like Story 8.1 campaigns): fleet billing is recurring monthly, which is Stripe's `subscription` mode.

**Stripe Customer Portal**: self-serve cancel, payment method update, and Stripe-hosted invoice PDFs are handled by Stripe's hosted portal — no custom UI needed for those flows. The fleet app only needs a "Manage subscription" button that redirects to the portal.

**Polish VAT invoices (pdfkit)**: Stripe generates invoices in English. Polish law requires Polish-language VAT invoices (`FAKTURA VAT`) for B2B services sold in Poland. The same pdfkit approach as Story 8.4 is used — generated on the `invoice.payment_succeeded` webhook, stored in R2, available for download from the fleet portal.

**Shared webhook endpoint**: Fleet subscription events are added to the existing `POST /v1/stripe/webhooks` endpoint (Story 8.1). Each event type is disambiguated by metadata (`type: 'fleet_subscription'`) or by looking up `Fleet.stripe_customer_id`.

**Subscription enforcement at MVP**: trial expiry and subscription status are *tracked* but not enforced with feature gates. A post-MVP story adds access control (e.g. redirect to billing page if `subscription_status = CANCELLED` and trial expired). This keeps 9.8 scoped to billing plumbing only.

---

## Acceptance Criteria

**Given** a fleet manager on FREE_TRIAL visits the Billing page
**When** they click "Subscribe"
**Then** they are redirected to a Stripe Checkout page for the fleet subscription
**And** on successful payment they are redirected back to `fleet.desert.app/billing` with `status=success`
**And** `Fleet.subscription_status` is set to `ACTIVE` and `Fleet.stripe_subscription_id` is populated

**Given** a fleet manager is on ACTIVE subscription and clicks "Manage subscription"
**When** redirected to the Stripe Customer Portal
**Then** they can cancel the subscription, update their card, and view Stripe-generated invoices from the portal

**Given** a fleet subscription payment succeeds
**When** the `invoice.payment_succeeded` webhook fires
**Then** a `FleetBillingTransaction` record is created with gross/net/VAT amounts
**And** a Polish-language PDF invoice (`FAKTURA VAT`) is generated and stored in R2
**And** the invoice is available for download from the fleet portal's invoice history

**Given** a fleet subscription payment fails
**When** the `invoice.payment_failed` webhook fires
**Then** `Fleet.subscription_status` is set to `PAST_DUE`
**And** the fleet owner receives an email (via `EmailService` from Story 9.5) notifying them of the failed payment

**Given** a fleet manager cancels their subscription via the Stripe portal
**When** the `customer.subscription.deleted` webhook fires
**Then** `Fleet.subscription_status` is set to `CANCELLED`

**Given** a fleet manager has not filled in billing profile details (company name, address)
**When** they visit the Billing page
**Then** a billing profile form is shown above the subscribe button with a note that it is required for VAT invoices
**And** they can save the profile without subscribing

---

## New Prisma Models

```prisma
model FleetBillingProfile {
  id           String   @id @default(cuid())
  fleet_id     String   @unique
  fleet        Fleet    @relation(fields: [fleet_id], references: [id], onDelete: Cascade)
  name         String   // Company name or individual full name
  nip          String?  // Polish VAT number (NIP) — required for company invoices
  address_line String
  city         String
  postal_code  String
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
}

model FleetBillingTransaction {
  id                String   @id @default(cuid())
  fleet_id          String
  fleet             Fleet    @relation(fields: [fleet_id], references: [id], onDelete: Cascade)
  stripe_invoice_id String   @unique
  amount_gross_pln  Decimal  @db.Decimal(10, 2)
  amount_net_pln    Decimal  @db.Decimal(10, 2)
  amount_vat_pln    Decimal  @db.Decimal(10, 2)
  description       String   // e.g. "Desert Fleet — kwiecień 2026"
  invoice_number    String?  // FVF/2026/04/0001 — set on first PDF generation
  invoice_r2_key    String?  // fleet-invoices/{fleetId}/{id}.pdf
  period_start      DateTime
  period_end        DateTime
  created_at        DateTime @default(now())

  @@index([fleet_id, created_at])
}
```

**Add to `Fleet` model:**
```prisma
billing_profile      FleetBillingProfile?
billing_transactions FleetBillingTransaction[]
```

**Migration name:** `add_fleet_billing`

---

## Fleet Billing Constants

**File:** `apps/api/src/fleet/fleet-billing.constants.ts` (new)

```typescript
// VAT rate for Polish B2B services
export const FLEET_VAT_RATE = 0.23;

// Stripe Price ID for the fleet subscription (set in Stripe Dashboard)
// Environment variable: STRIPE_FLEET_PRICE_ID
// Pricing is TBD — configure in Stripe before go-live

// Invoice number prefix (FVF = Faktura VAT Fleet)
export const FLEET_INVOICE_PREFIX = 'FVF';

// R2 key prefix for fleet invoices
export const FLEET_INVOICE_R2_PREFIX = 'fleet-invoices';

// Metadata type tag on Checkout Session to distinguish fleet from partner transactions
export const FLEET_CHECKOUT_METADATA_TYPE = 'fleet_subscription';
```

**Environment variables — add to `apps/api/.env.example`:**

```
# Stripe fleet subscription price ID (created in Stripe Dashboard)
STRIPE_FLEET_PRICE_ID=price_xxx

# Fleet app URL (for Stripe redirect URLs)
FLEET_APP_URL=https://fleet.desert.app
```

---

## FleetBillingService

**File:** `apps/api/src/fleet/fleet-billing.service.ts` (new)

```typescript
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { FleetInvoiceService } from './fleet-invoice.service';
import {
  FLEET_VAT_RATE,
  FLEET_CHECKOUT_METADATA_TYPE,
} from './fleet-billing.constants';
import { FleetSubscriptionStatus } from '@prisma/client';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '', { apiVersion: '2024-06-20' });

@Injectable()
export class FleetBillingService {
  private readonly logger = new Logger(FleetBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly invoiceService: FleetInvoiceService,
  ) {}

  // ─── Stripe Customer (lazy creation per fleet) ─────────────────────────────

  async getOrCreateStripeCustomer(fleetId: string): Promise<string> {
    const fleet = await this.prisma.fleet.findUniqueOrThrow({
      where: { id: fleetId },
      include: { owner: { select: { email: true } } },
    });

    if (fleet.stripe_customer_id) return fleet.stripe_customer_id;

    const customer = await stripe.customers.create({
      email: fleet.owner.email ?? undefined,
      name: fleet.name,
      metadata: { fleetId: fleet.id },
    });

    await this.prisma.fleet.updateMany({
      where: { id: fleetId, stripe_customer_id: null },
      data: { stripe_customer_id: customer.id },
    });

    // Re-read to handle potential race
    const updated = await this.prisma.fleet.findUniqueOrThrow({ where: { id: fleetId } });
    return updated.stripe_customer_id!;
  }

  // ─── Checkout Session (subscribe) ──────────────────────────────────────────

  async createCheckoutSession(fleetId: string): Promise<{ url: string }> {
    const customerId = await this.getOrCreateStripeCustomer(fleetId);
    const priceId = process.env['STRIPE_FLEET_PRICE_ID'];
    if (!priceId) throw new BadRequestException('Fleet subscription not yet available');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env['FLEET_APP_URL']}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${process.env['FLEET_APP_URL']}/billing?status=cancelled`,
      metadata: {
        fleetId,
        type: FLEET_CHECKOUT_METADATA_TYPE,
      },
    });

    return { url: session.url! };
  }

  // ─── Customer Portal (manage subscription) ─────────────────────────────────

  async createPortalSession(fleetId: string): Promise<{ url: string }> {
    const fleet = await this.prisma.fleet.findUniqueOrThrow({ where: { id: fleetId } });
    if (!fleet.stripe_customer_id) {
      throw new BadRequestException('No billing account found — subscribe first');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: fleet.stripe_customer_id,
      return_url: `${process.env['FLEET_APP_URL']}/billing`,
    });

    return { url: session.url };
  }

  // ─── Billing Profile ───────────────────────────────────────────────────────

  async getBillingProfile(fleetId: string) {
    return this.prisma.fleetBillingProfile.findUnique({ where: { fleet_id: fleetId } });
  }

  async upsertBillingProfile(fleetId: string, dto: {
    name: string;
    nip?: string;
    addressLine: string;
    city: string;
    postalCode: string;
  }) {
    return this.prisma.fleetBillingProfile.upsert({
      where: { fleet_id: fleetId },
      create: {
        fleet_id: fleetId,
        name: dto.name,
        nip: dto.nip,
        address_line: dto.addressLine,
        city: dto.city,
        postal_code: dto.postalCode,
      },
      update: {
        name: dto.name,
        nip: dto.nip ?? null,
        address_line: dto.addressLine,
        city: dto.city,
        postal_code: dto.postalCode,
      },
    });
  }

  // ─── Invoice History ───────────────────────────────────────────────────────

  async getTransactions(fleetId: string) {
    const txns = await this.prisma.fleetBillingTransaction.findMany({
      where: { fleet_id: fleetId },
      orderBy: { created_at: 'desc' },
    });
    return txns.map((t) => ({
      id: t.id,
      description: t.description,
      amountGrossPln: parseFloat(t.amount_gross_pln.toString()),
      invoiceNumber: t.invoice_number,
      hasInvoice: !!t.invoice_r2_key,
      periodStart: t.period_start.toISOString(),
      periodEnd: t.period_end.toISOString(),
      createdAt: t.created_at.toISOString(),
    }));
  }

  async getInvoiceDownloadUrl(fleetId: string, transactionId: string): Promise<{ url: string }> {
    const txn = await this.prisma.fleetBillingTransaction.findFirst({
      where: { id: transactionId, fleet_id: fleetId },
    });
    if (!txn) throw new NotFoundException('Invoice not found');

    if (!txn.invoice_r2_key) {
      // PDF not yet generated (e.g. billing profile was added after the invoice event)
      // Trigger generation now
      const url = await this.invoiceService.generateAndStore(txn.id);
      return { url };
    }

    return { url: await this.invoiceService.getPresignedUrl(txn.invoice_r2_key) };
  }

  // ─── Webhook Handlers ──────────────────────────────────────────────────────

  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (session.metadata?.type !== FLEET_CHECKOUT_METADATA_TYPE) return;

    const fleetId = session.metadata.fleetId;
    const subscriptionId = session.subscription as string;

    await this.prisma.fleet.update({
      where: { id: fleetId },
      data: {
        subscription_status: FleetSubscriptionStatus.ACTIVE,
        stripe_subscription_id: subscriptionId,
      },
    });

    this.logger.log(`[FLEET-BILLING] Fleet ${fleetId} activated subscription ${subscriptionId}`);
  }

  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const fleet = await this.prisma.fleet.findFirst({
      where: { stripe_subscription_id: subscription.id },
    });
    if (!fleet) return;

    let status: FleetSubscriptionStatus;
    switch (subscription.status) {
      case 'active':    status = FleetSubscriptionStatus.ACTIVE; break;
      case 'past_due':  status = FleetSubscriptionStatus.PAST_DUE; break;
      case 'canceled':  status = FleetSubscriptionStatus.CANCELLED; break;
      default:          return;  // unpaid, trialing, etc. — no mapping for MVP
    }

    await this.prisma.fleet.update({
      where: { id: fleet.id },
      data: { subscription_status: status },
    });
  }

  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await this.prisma.fleet.updateMany({
      where: { stripe_subscription_id: subscription.id },
      data: { subscription_status: FleetSubscriptionStatus.CANCELLED },
    });
  }

  async handleInvoiceSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.customer || !invoice.subscription) return;

    const fleet = await this.prisma.fleet.findFirst({
      where: { stripe_customer_id: invoice.customer as string },
    });
    if (!fleet) return;

    // Guard against duplicate processing (idempotency)
    const existing = await this.prisma.fleetBillingTransaction.findUnique({
      where: { stripe_invoice_id: invoice.id },
    });
    if (existing) return;

    const grossPln = invoice.amount_paid / 100;  // Stripe stores in grosz (1/100 PLN)
    const netPln = parseFloat((grossPln / (1 + FLEET_VAT_RATE)).toFixed(2));
    const vatPln = parseFloat((grossPln - netPln).toFixed(2));

    const period = invoice.lines.data[0]?.period;
    const periodStart = period ? new Date(period.start * 1000) : new Date();
    const periodEnd = period ? new Date(period.end * 1000) : new Date();

    const monthLabel = periodStart.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
    const description = `Desert Fleet — ${monthLabel}`;

    const txn = await this.prisma.fleetBillingTransaction.create({
      data: {
        fleet_id: fleet.id,
        stripe_invoice_id: invoice.id,
        amount_gross_pln: grossPln,
        amount_net_pln: netPln,
        amount_vat_pln: vatPln,
        description,
        period_start: periodStart,
        period_end: periodEnd,
      },
    });

    // Generate PDF invoice (non-blocking — billing profile may not exist yet)
    this.invoiceService.generateAndStore(txn.id).catch((err) => {
      this.logger.error(`[FLEET-BILLING] PDF generation failed for txn ${txn.id}: ${err.message}`);
    });
  }

  async handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.customer) return;

    const fleet = await this.prisma.fleet.findFirst({
      where: { stripe_customer_id: invoice.customer as string },
      include: { owner: { select: { email: true } } },
    });
    if (!fleet) return;

    await this.prisma.fleet.update({
      where: { id: fleet.id },
      data: { subscription_status: FleetSubscriptionStatus.PAST_DUE },
    });

    if (fleet.owner.email) {
      await this.email.sendFleetPaymentFailed({
        to: fleet.owner.email,
        fleetName: fleet.name,
      }).catch(() => {});
    }
  }
}
```

---

## FleetInvoiceService

**File:** `apps/api/src/fleet/fleet-invoice.service.ts` (new)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import PDFDocument from 'pdfkit';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FLEET_INVOICE_PREFIX, FLEET_INVOICE_R2_PREFIX } from './fleet-billing.constants';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env['R2_ENDPOINT'],
  credentials: {
    accessKeyId: process.env['R2_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['R2_SECRET_ACCESS_KEY'] ?? '',
  },
});

const R2_BUCKET = process.env['R2_BUCKET'] ?? '';

@Injectable()
export class FleetInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAndStore(transactionId: string): Promise<string> {
    const txn = await this.prisma.fleetBillingTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: {
        fleet: {
          include: {
            billing_profile: true,
            owner: { select: { email: true } },
          },
        },
      },
    });

    if (txn.invoice_r2_key) {
      return this.getPresignedUrl(txn.invoice_r2_key);
    }

    // Generate invoice number
    const date = txn.created_at;
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const count = await this.prisma.fleetBillingTransaction.count({
      where: {
        fleet_id: txn.fleet_id,
        invoice_number: { not: null },
        created_at: { gte: monthStart, lt: monthEnd },
      },
    });
    const invoiceNumber = `${FLEET_INVOICE_PREFIX}/${year}/${String(month).padStart(2, '0')}/${String(count + 1).padStart(4, '0')}`;

    // Build PDF
    const pdfBuffer = await buildInvoicePdf({
      invoiceNumber,
      description: txn.description,
      grossPln: parseFloat(txn.amount_gross_pln.toString()),
      netPln: parseFloat(txn.amount_net_pln.toString()),
      vatPln: parseFloat(txn.amount_vat_pln.toString()),
      periodStart: txn.period_start,
      periodEnd: txn.period_end,
      issuedAt: txn.created_at,
      billingProfile: txn.fleet.billing_profile,
    });

    // Upload to R2
    const r2Key = `${FLEET_INVOICE_R2_PREFIX}/${txn.fleet_id}/${transactionId}.pdf`;
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    }));

    // Persist invoice number and R2 key
    await this.prisma.fleetBillingTransaction.update({
      where: { id: transactionId },
      data: { invoice_number: invoiceNumber, invoice_r2_key: r2Key },
    });

    return this.getPresignedUrl(r2Key);
  }

  async getPresignedUrl(r2Key: string): Promise<string> {
    return getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
      { expiresIn: 3600 },  // 1 hour
    );
  }
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────

interface InvoicePdfParams {
  invoiceNumber: string;
  description: string;
  grossPln: number;
  netPln: number;
  vatPln: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  billingProfile: {
    name: string;
    nip?: string | null;
    address_line: string;
    city: string;
    postal_code: string;
  } | null;
}

async function buildInvoicePdf(p: InvoicePdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.registerFont('Roboto', path.join(__dirname, '../assets/Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(__dirname, '../assets/Roboto-Bold.ttf'));
    doc.font('Roboto');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.font('Roboto-Bold').fontSize(18).text('FAKTURA VAT', { align: 'right' });
    doc.font('Roboto').fontSize(10)
      .text(`Numer: ${p.invoiceNumber}`, { align: 'right' })
      .text(`Data wystawienia: ${formatDatePl(p.issuedAt)}`, { align: 'right' })
      .moveDown(1);

    // Seller
    doc.font('Roboto-Bold').fontSize(10).text('Sprzedawca:');
    doc.font('Roboto').fontSize(10)
      .text('Desert App Sp. z o.o.')  // TBD — replace with legal entity name
      .text('ul. TBD 1, 00-000 Warszawa')
      .text('NIP: TBD')
      .moveDown(0.5);

    // Buyer
    doc.font('Roboto-Bold').fontSize(10).text('Nabywca:');
    if (p.billingProfile) {
      doc.font('Roboto').fontSize(10)
        .text(p.billingProfile.name)
        .text(p.billingProfile.address_line)
        .text(`${p.billingProfile.postal_code} ${p.billingProfile.city}`)
        .text(p.billingProfile.nip ? `NIP: ${p.billingProfile.nip}` : '')
        .moveDown(0.5);
    } else {
      doc.font('Roboto').fontSize(10).text('(brak danych nabywcy — uzupełnij profil rozliczeniowy)').moveDown(0.5);
    }

    // Period
    doc.font('Roboto').fontSize(10)
      .text(`Okres rozliczeniowy: ${formatDatePl(p.periodStart)} – ${formatDatePl(p.periodEnd)}`)
      .moveDown(1);

    // Line items table
    doc.font('Roboto-Bold').fontSize(10)
      .text('Opis', 50, doc.y, { width: 250 })
      .text('Netto (PLN)', 300, doc.y, { width: 80, align: 'right' })
      .text('VAT 23% (PLN)', 380, doc.y, { width: 80, align: 'right' })
      .text('Brutto (PLN)', 460, doc.y, { width: 80, align: 'right' });

    const tableY = doc.y + 2;
    doc.moveTo(50, tableY).lineTo(545, tableY).stroke();
    doc.moveDown(0.3);

    doc.font('Roboto').fontSize(10);
    const rowY = doc.y;
    doc.text(p.description, 50, rowY, { width: 250 });
    doc.text(p.netPln.toFixed(2), 300, rowY, { width: 80, align: 'right' });
    doc.text(p.vatPln.toFixed(2), 380, rowY, { width: 80, align: 'right' });
    doc.text(p.grossPln.toFixed(2), 460, rowY, { width: 80, align: 'right' });
    doc.moveDown(0.5);

    const totalY = doc.y;
    doc.moveTo(50, totalY).lineTo(545, totalY).stroke();
    doc.moveDown(0.2);
    doc.font('Roboto-Bold').fontSize(10);
    doc.text('RAZEM DO ZAPŁATY:', 300, doc.y, { width: 160 });
    doc.text(`${p.grossPln.toFixed(2)} PLN`, 460, doc.y, { width: 80, align: 'right' });

    doc.moveDown(2);
    doc.font('Roboto').fontSize(8).fillColor('#888')
      .text('Faktura wygenerowana automatycznie przez system Desert. Dokument nie wymaga podpisu.', { align: 'center' });

    doc.end();
  });
}

function formatDatePl(d: Date): string {
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
```

---

## Email Service Extension

**Add to `apps/api/src/email/email.service.ts`:**

```typescript
async sendFleetPaymentFailed(params: { to: string; fleetName: string }): Promise<void> {
  try {
    await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: 'Nieudana płatność — Desert Fleet',
      html: `
        <p>Cześć,</p>
        <p>Nie udało nam się pobrać płatności za subskrypcję Desert Fleet dla floty <strong>${params.fleetName}</strong>.</p>
        <p>Zaktualizuj swoje dane płatnicze, aby uniknąć przerwania dostępu:</p>
        <p><a href="https://fleet.desert.app/billing" style="color:#2563eb;">Zarządzaj subskrypcją →</a></p>
      `,
    });
  } catch (err) {
    this.logger.error(`Failed to send payment-failed email to ${params.to}: ${(err as Error).message}`);
  }
}
```

---

## Webhook Integration

**Extend `PromotionWebhookController` to handle fleet events:**

```typescript
// apps/api/src/promotions/promotion-webhook.controller.ts
// Add FleetBillingService injection and new cases to the switch statement

@Post('webhooks')
@Public()
@HttpCode(200)
async handleWebhook(@Req() req: FastifyRequest): Promise<{ received: boolean }> {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new BadRequestException('Invalid webhook signature');
  }

  switch (event.type) {
    // ─── Existing cases (Stories 8.1, 8.4) ───────────────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.promotionService.handleCheckoutCompleted(session);   // 8.1 — no-op if not promo
      await this.fleetBillingService.handleCheckoutCompleted(session); // 9.8 — no-op if not fleet
      break;
    }
    case 'setup_intent.succeeded': {
      await this.billingService.handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
      break;
    }

    // ─── New fleet subscription cases (Story 9.8) ────────────────────────
    case 'customer.subscription.updated': {
      await this.fleetBillingService.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      await this.fleetBillingService.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    }
    case 'invoice.payment_succeeded': {
      await this.fleetBillingService.handleInvoiceSucceeded(event.data.object as Stripe.Invoice);
      break;
    }
    case 'invoice.payment_failed': {
      await this.fleetBillingService.handleInvoiceFailed(event.data.object as Stripe.Invoice);
      break;
    }
  }

  return { received: true };
}
```

**Register `FleetBillingService` in `PromotionWebhookModule` imports**, or better: export `FleetBillingService` from `FleetModule` and import `FleetModule` in the promotions webhook module. Alternatively, inject via `forwardRef()` if there's a circular dependency.

**Simpler approach**: move the webhook controller to a top-level `StripeModule` that imports both `PromotionModule` and `FleetModule`. This avoids circular dependencies entirely. Rename from `PromotionWebhookController` to `StripeWebhookController` as part of this story.

---

## Fleet App UI Changes

### Billing Page

**File:** `apps/fleet/app/(fleet)/billing/page.tsx` (new — Server Component)

```tsx
import { fleetFetch } from '../../../lib/fleet-api';
import BillingStatus from './BillingStatus';
import BillingProfileForm from './BillingProfileForm';
import InvoiceHistory from './InvoiceHistory';

export const metadata = { title: 'Billing' };

async function getBillingData() {
  const [fleet, transactions, profile] = await Promise.all([
    fleetFetch<{ subscriptionStatus: string; trialEndsAt: string | null; name: string }>('/v1/fleet/me'),
    fleetFetch<any[]>('/v1/fleet/billing/transactions').catch(() => []),
    fleetFetch<any>('/v1/fleet/billing/profile').catch(() => null),
  ]);
  return { fleet, transactions, profile };
}

export default async function BillingPage() {
  const { fleet, transactions, profile } = await getBillingData();

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold">Billing</h1>
      <BillingStatus status={fleet.subscriptionStatus} trialEndsAt={fleet.trialEndsAt} />
      <BillingProfileForm initialProfile={profile} />
      <InvoiceHistory transactions={transactions} />
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/billing/actions.ts`

```typescript
'use server';

import { redirect } from 'next/navigation';
import { fleetFetch } from '../../../lib/fleet-api';
import { revalidatePath } from 'next/cache';

export async function subscribeAction() {
  const { url } = await fleetFetch<{ url: string }>('/v1/fleet/billing/checkout', { method: 'POST' });
  redirect(url);
}

export async function manageSubscriptionAction() {
  const { url } = await fleetFetch<{ url: string }>('/v1/fleet/billing/portal', { method: 'POST' });
  redirect(url);
}

export async function saveBillingProfileAction(formData: FormData) {
  await fleetFetch('/v1/fleet/billing/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: formData.get('name'),
      nip: formData.get('nip') || undefined,
      addressLine: formData.get('addressLine'),
      city: formData.get('city'),
      postalCode: formData.get('postalCode'),
    }),
  });
  revalidatePath('/billing');
}
```

**File:** `apps/fleet/app/(fleet)/billing/BillingStatus.tsx` (new Client Component)

```tsx
'use client';

import { useTransition } from 'react';
import { subscribeAction, manageSubscriptionAction } from './actions';

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  FREE_TRIAL:  { label: 'Free Trial',      colour: 'text-blue-600 bg-blue-50' },
  ACTIVE:      { label: 'Active',          colour: 'text-green-700 bg-green-50' },
  PAST_DUE:    { label: 'Payment failed',  colour: 'text-red-600 bg-red-50' },
  CANCELLED:   { label: 'Cancelled',       colour: 'text-gray-500 bg-gray-100' },
};

export default function BillingStatus({
  status,
  trialEndsAt,
}: {
  status: string;
  trialEndsAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const info = STATUS_LABELS[status] ?? STATUS_LABELS['FREE_TRIAL'];

  return (
    <div className="p-4 border border-gray-200 rounded-xl space-y-4">
      <div className="flex items-center gap-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${info.colour}`}>
          {info.label}
        </span>
        {status === 'FREE_TRIAL' && trialEndsAt && (
          <span className="text-xs text-gray-500">
            Trial ends {new Date(trialEndsAt).toLocaleDateString()}
          </span>
        )}
        {status === 'PAST_DUE' && (
          <span className="text-xs text-red-500">Update your payment method to restore access</span>
        )}
      </div>

      {status === 'FREE_TRIAL' || status === 'CANCELLED' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => subscribeAction())}
          className="w-full py-3 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Redirecting…' : 'Subscribe'}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => manageSubscriptionAction())}
          className="w-full py-3 rounded-lg border border-gray-300 text-gray-900 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Redirecting…' : 'Manage subscription'}
        </button>
      )}
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/billing/InvoiceHistory.tsx` (new Client Component — concise)

```tsx
'use client';

export default function InvoiceHistory({ transactions }: { transactions: any[] }) {
  if (transactions.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Invoice history</h2>
      <ul className="divide-y divide-gray-100">
        {transactions.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm text-gray-900">{t.description}</div>
              <div className="text-xs text-gray-400">
                {t.invoiceNumber ?? '—'} · {t.amountGrossPln.toFixed(2)} PLN
              </div>
            </div>
            {t.hasInvoice && (
              <a
                href={`/api/invoice/${t.id}`}
                target="_blank"
                className="text-xs text-blue-600 hover:underline"
              >
                Download PDF
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**File:** `apps/fleet/app/api/invoice/[transactionId]/route.ts` (new — proxy to backend for PDF download)

```typescript
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env['FLEET_API_URL'] ?? 'http://localhost:3001';

export async function GET(
  _req: NextRequest,
  { params }: { params: { transactionId: string } },
): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_token')?.value;
  if (!token) return new NextResponse('Unauthorized', { status: 401 });

  const upstream = await fetch(
    `${API_BASE}/v1/fleet/billing/invoices/${params.transactionId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!upstream.ok) return new NextResponse('Not found', { status: upstream.status });

  const { url } = await upstream.json() as { url: string };
  return NextResponse.redirect(url);  // redirect to presigned R2 URL
}
```

### Navigation — Add Billing Tab

In `apps/fleet/app/(fleet)/layout.tsx`:

```tsx
{ href: '/billing', label: 'Billing', icon: CreditCardIcon },
```

---

## Backend Endpoints Summary

**Add to `FleetController`:**

```typescript
// GET /v1/fleet/billing/profile
@Get('billing/profile')
@Roles(Role.FLEET_MANAGER)
async getBillingProfile(@CurrentUser('fleet_id') fleetId: string) {
  return this.fleetBillingService.getBillingProfile(fleetId);
}

// PUT /v1/fleet/billing/profile
@Put('billing/profile')
@Roles(Role.FLEET_MANAGER)
async upsertBillingProfile(
  @CurrentUser('fleet_id') fleetId: string,
  @Body() dto: UpsertBillingProfileDto,
) {
  return this.fleetBillingService.upsertBillingProfile(fleetId, dto);
}

// POST /v1/fleet/billing/checkout
@Post('billing/checkout')
@Roles(Role.FLEET_MANAGER)
async createCheckout(@CurrentUser('fleet_id') fleetId: string) {
  return this.fleetBillingService.createCheckoutSession(fleetId);
}

// POST /v1/fleet/billing/portal
@Post('billing/portal')
@Roles(Role.FLEET_MANAGER)
async createPortal(@CurrentUser('fleet_id') fleetId: string) {
  return this.fleetBillingService.createPortalSession(fleetId);
}

// GET /v1/fleet/billing/transactions
@Get('billing/transactions')
@Roles(Role.FLEET_MANAGER)
async getTransactions(@CurrentUser('fleet_id') fleetId: string) {
  return this.fleetBillingService.getTransactions(fleetId);
}

// GET /v1/fleet/billing/invoices/:transactionId
@Get('billing/invoices/:transactionId')
@Roles(Role.FLEET_MANAGER)
async getInvoiceUrl(
  @CurrentUser('fleet_id') fleetId: string,
  @Param('transactionId') transactionId: string,
) {
  return this.fleetBillingService.getInvoiceDownloadUrl(fleetId, transactionId);
}
```

**DTO:**
```typescript
// apps/api/src/fleet/dto/upsert-billing-profile.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertBillingProfileDto {
  @IsString() @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(20) nip?: string;
  @IsString() @MaxLength(200) addressLine: string;
  @IsString() @MaxLength(100) city: string;
  @IsString() @MaxLength(10) postalCode: string;
}
```

---

## Migration

**Name:** `add_fleet_billing`

```sql
-- FleetBillingProfile
CREATE TABLE "FleetBillingProfile" (
    "id"           TEXT         NOT NULL,
    "fleet_id"     TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "nip"          TEXT,
    "address_line" TEXT         NOT NULL,
    "city"         TEXT         NOT NULL,
    "postal_code"  TEXT         NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FleetBillingProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FleetBillingProfile_fleet_id_key" ON "FleetBillingProfile"("fleet_id");
ALTER TABLE "FleetBillingProfile" ADD CONSTRAINT "FleetBillingProfile_fleet_id_fkey"
  FOREIGN KEY ("fleet_id") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FleetBillingTransaction
CREATE TABLE "FleetBillingTransaction" (
    "id"                TEXT          NOT NULL,
    "fleet_id"          TEXT          NOT NULL,
    "stripe_invoice_id" TEXT          NOT NULL,
    "amount_gross_pln"  DECIMAL(10,2) NOT NULL,
    "amount_net_pln"    DECIMAL(10,2) NOT NULL,
    "amount_vat_pln"    DECIMAL(10,2) NOT NULL,
    "description"       TEXT          NOT NULL,
    "invoice_number"    TEXT,
    "invoice_r2_key"    TEXT,
    "period_start"      TIMESTAMP(3)  NOT NULL,
    "period_end"        TIMESTAMP(3)  NOT NULL,
    "created_at"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FleetBillingTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FleetBillingTransaction_stripe_invoice_id_key"
  ON "FleetBillingTransaction"("stripe_invoice_id");
CREATE INDEX "FleetBillingTransaction_fleet_id_created_at_idx"
  ON "FleetBillingTransaction"("fleet_id", "created_at");
ALTER TABLE "FleetBillingTransaction" ADD CONSTRAINT "FleetBillingTransaction_fleet_id_fkey"
  FOREIGN KEY ("fleet_id") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Tasks / Subtasks

- [ ] API: Prisma schema — `FleetBillingProfile` + `FleetBillingTransaction` + relations on `Fleet` (AC: 1, 3, 6)
  - [ ] Migration: `add_fleet_billing`

- [ ] API: `FleetBillingService` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `getOrCreateStripeCustomer()` — `updateMany` with `stripe_customer_id: null` guard
  - [ ] `createCheckoutSession()` — mode: 'subscription', metadata `type: 'fleet_subscription'`
  - [ ] `createPortalSession()` — requires `stripe_customer_id`
  - [ ] `getBillingProfile()` + `upsertBillingProfile()` (AC: 6)
  - [ ] `getTransactions()` + `getInvoiceDownloadUrl()` (AC: 3)
  - [ ] `handleCheckoutCompleted()` — gate on metadata type (AC: 1)
  - [ ] `handleSubscriptionUpdated/Deleted()` (AC: 5)
  - [ ] `handleInvoiceSucceeded()` — idempotency check on `stripe_invoice_id`, fire-and-forget PDF (AC: 3)
  - [ ] `handleInvoiceFailed()` — PAST_DUE + email (AC: 4)

- [ ] API: `FleetInvoiceService` — invoice number generation + pdfkit PDF + R2 upload + presigned URL (AC: 3)
  - [ ] Add `Roboto-Regular.ttf` + `Roboto-Bold.ttf` to `apps/api/src/assets/` (if not already present from Story 8.4 / 9.4)
  - [ ] Polish `FAKTURA VAT` layout: seller block (TBD), buyer block, line item table, total

- [ ] API: `EmailService.sendFleetPaymentFailed()` (AC: 4)

- [ ] API: Extend `StripeWebhookController` (or `PromotionWebhookController`) with fleet event cases (AC: 1, 3, 4, 5)
  - [ ] Inject `FleetBillingService` into webhook controller
  - [ ] Add: `customer.subscription.updated/deleted`, `invoice.payment_succeeded/failed`
  - [ ] `checkout.session.completed` routes to both promo and fleet handlers (each no-ops if not theirs)

- [ ] API: Backend endpoints — checkout, portal, profile CRUD, transactions, invoice URL (AC: 1, 2, 3, 6)
  - [ ] `UpsertBillingProfileDto` with class-validator
  - [ ] Register `FleetBillingService`, `FleetInvoiceService` in `FleetModule`

- [ ] API: Env vars — `STRIPE_FLEET_PRICE_ID`, `FLEET_APP_URL` in `.env.example`

- [ ] Fleet app: Billing page — `page.tsx`, `BillingStatus.tsx`, `BillingProfileForm.tsx`, `InvoiceHistory.tsx`, `actions.ts` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Server Actions for subscribe, manage, save profile (redirect on checkout/portal)
  - [ ] Show trial end date on FREE_TRIAL status
  - [ ] PAST_DUE warning copy

- [ ] Fleet app: `/api/invoice/[transactionId]/route.ts` — presigned URL redirect proxy (AC: 3)

- [ ] Fleet app: Billing tab in `(fleet)/layout.tsx` nav

- [ ] Stripe Dashboard: configure Customer Portal (enable cancel, update payment method)

---

## Dev Notes

### Subscription Enforcement — Post-MVP

This story tracks `FleetSubscriptionStatus` but does NOT add feature gates (middleware that checks status and redirects). A separate story post-MVP adds enforcement: e.g. if `subscription_status = CANCELLED` and `trial_ends_at < now()`, redirect all fleet portal routes to `/billing`. Keeping enforcement out of scope here avoids accidental lockouts during development.

### PDF Seller Block — TBD

The seller block in `buildInvoicePdf()` uses placeholder values (`Desert App Sp. z o.o.`, `TBD`). These must be replaced with the actual legal entity name, address, and NIP before go-live. Legal entity formation is tracked separately from technical implementation.

### `StripeWebhookController` Rename

The existing `PromotionWebhookController` handles only promotion events. After this story, it handles both promotion and fleet subscription events. Rename to `StripeWebhookController` when implementing to reflect the broader scope. This is a rename + file move — no API surface change.

### `invoice.payment_succeeded` — Currency

The Stripe webhook amount is in the smallest currency unit (grosz for PLN — 1/100 PLN). The calculation `invoice.amount_paid / 100` converts to PLN. Verify the Stripe account currency is set to PLN in the Stripe Dashboard (account settings → currency) before processing invoices.

### Stripe Customer Portal Configuration

Before the "Manage subscription" flow works, the Stripe Customer Portal must be configured in the Stripe Dashboard:
1. Go to Stripe Dashboard → Billing → Customer Portal
2. Enable: Cancel subscriptions (at period end), Update payment method
3. The portal landing URL (branding, cancel policy) should match the fleet app style

### PDF Generation on Webhook — Non-Blocking

`handleInvoiceSucceeded()` calls `invoiceService.generateAndStore()` with `.catch()` — it's fire-and-forget. If PDF generation fails (e.g. billing profile doesn't exist yet), the `FleetBillingTransaction` is created with `invoice_r2_key = null`. The manager can download the PDF later — `getInvoiceDownloadUrl()` triggers generation if the key is absent. This avoids blocking the webhook response and prevents Stripe from retrying the event.

### R2 Client Reuse

The R2 client in `FleetInvoiceService` is defined inline (same pattern as Story 8.4's billing service). If Story 8.4 introduced a shared `R2Service` injectable, use it here instead of duplicating the client setup.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
