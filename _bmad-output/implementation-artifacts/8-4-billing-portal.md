# Story 8.4: Billing Portal

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.4
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 8.1 (`credit_balance_pln` on `User`, Stripe secret key, `STRIPE_SECRET_KEY` env var already present), Story 7.1 (apps/partner scaffold, partnerFetch)
- **Required by:** Story 8.5 (deal purchase reuses billing portal payment method)

---

## User Story

**As a verified station owner,**
I want a self-serve billing portal where I can manage my payment method, view invoices, and top up my pre-paid balance,
So that I can handle all financial administration without contacting support.

---

## Context & Why

Billing profile is a hard prerequisite for first campaign purchase — an owner who buys a campaign and cannot get a proper VAT invoice will blame the platform. Supporting both Individual and Company billing types ensures Polish chains (ORLEN, BP, Circle K) and independent owners alike get compliant invoices.

Story 8.1 created the `credit_balance_pln` field on `User` (deduction only). This story adds the top-up UI, saved payment method, billing profile, and PDF invoice generation on top.

### Key architecture choices

- **Stripe Customer** stores the saved payment method. Created lazily on first billing interaction. `stripe_customer_id` stored on `User`.
- **SetupIntent** (not Checkout Session) for saving a card — renders Stripe Elements inline in the partner portal for a seamless experience.
- **Top-up PaymentIntent** charges the saved Stripe Customer's default payment method immediately.
- **PDF invoice** generated server-side via `pdfkit` (Node.js) — stored in R2 with a 1-hour presigned URL returned on demand. Not pre-generated — generated once on first download request and cached in R2.
- **VAT rate**: 23% (Polish standard VAT, `stawka podstawowa`). Applied to all transactions.

---

## Acceptance Criteria

**Given** a verified station owner attempts their first campaign purchase (Story 8.1)
**When** they have not yet completed their billing profile
**Then** they are redirected to `/billing` to complete their profile before payment proceeds
**And** purchase is blocked until the profile is saved

**Given** an owner completes their billing profile
**When** they fill in the form
**Then** they choose between **Individual** (imię i nazwisko, adres, optional NIP) or **Company** (nazwa firmy, adres rejestrowy, NIP — required)
**And** the profile is saved and used to populate all future VAT invoices

**Given** an owner opens the Billing section
**When** they view it
**Then** they see: billing profile summary (with Edit link), current pre-paid credit balance in PLN, saved payment method (last 4 digits + expiry, or "Add a card"), and a transaction history list in reverse chronological order

**Given** an owner wants to add or replace their saved card
**When** they initiate the change
**Then** a Stripe Elements card form is rendered inline (no redirect)
**And** on success the new card replaces the previous saved method and is shown as the active method

**Given** an owner wants to top up their credit balance
**When** they select a top-up amount (50 PLN / 100 PLN / 200 PLN / custom ≥50 PLN)
**Then** the charge is applied immediately to their saved payment method
**And** the credit balance updates in real time on the page
**And** a transaction record is created

**Given** a transaction has been processed (campaign purchase or top-up)
**When** the owner requests a VAT invoice for that transaction
**Then** a VAT-compliant PDF invoice is generated with: platform billing details, owner billing profile, transaction amount (net + 23% VAT + gross), invoice number, and transaction date
**And** the PDF is available to download immediately

**Given** the owner views the Billing section in Polish, English, or Ukrainian
**When** it renders
**Then** all labels, amounts (PLN), and date formats are in the correct language
**And** generated PDF invoices are always in **Polish** regardless of UI language (Polish legal requirement)

---

## Schema Changes

### User Model Additions

```prisma
// Additions to existing User model
model User {
  // ... existing fields ...
  stripe_customer_id  String?             // created lazily on first billing action
  billing_profile     BillingProfile?
  billing_transactions BillingTransaction[]
}
```

### New Models

```prisma
enum BillingType {
  INDIVIDUAL
  COMPANY
}

model BillingProfile {
  id           String      @id @default(cuid())
  user_id      String      @unique
  user         User        @relation(fields: [user_id], references: [id])
  type         BillingType
  name         String      // person name OR company name
  address_line String
  city         String
  postal_code  String
  country      String      @default("PL")
  nip          String?     // required for COMPANY; optional for INDIVIDUAL
  created_at   DateTime    @default(now())
  updated_at   DateTime    @updatedAt
}

enum TransactionType {
  CAMPAIGN_PURCHASE
  CREDIT_TOPUP
}

model BillingTransaction {
  id                       String          @id @default(cuid())
  user_id                  String
  user                     User            @relation(fields: [user_id], references: [id])
  type                     TransactionType
  amount_gross_pln         Decimal         @db.Decimal(10, 2)  // total charged incl. VAT
  amount_net_pln           Decimal         @db.Decimal(10, 2)  // amount_gross / 1.23
  amount_vat_pln           Decimal         @db.Decimal(10, 2)  // amount_gross - amount_net
  description              String          // e.g. "Campaign: 7 active days — [Station Name]"
  stripe_payment_intent_id String?
  campaign_id              String?         // ref to PromotionCampaign (no FK — soft ref to avoid cascade issues)
  invoice_r2_key           String?         // populated on first download
  invoice_number           String?         // e.g. "FV/2026/04/0001" — generated on first download
  created_at               DateTime        @default(now())

  @@index([user_id, created_at])
}
```

### Migration Name

`add_billing_profile_and_transactions`

### Retroactively Track Campaign Purchases from Story 8.1

When a campaign is created (Stripe webhook `checkout.session.completed` or credit payment), create a `BillingTransaction` record:

```typescript
// In PromotionService.handleStripeWebhook() and createCampaign() (credit path):
await this.prisma.billingTransaction.create({
  data: {
    user_id: campaign.user_id,
    type: TransactionType.CAMPAIGN_PURCHASE,
    amount_gross_pln: campaign.price_pln,
    amount_net_pln: campaign.price_pln.div(new Prisma.Decimal('1.23')).toDecimalPlaces(2),
    amount_vat_pln: campaign.price_pln.sub(campaign.price_pln.div(new Prisma.Decimal('1.23')).toDecimalPlaces(2)),
    description: `Kampania promocyjna — ${activeDays} dni aktywnych`,
    stripe_payment_intent_id: paymentIntentId ?? null,
    campaign_id: campaign.id,
  },
});
```

This requires updating Story 8.1's `PromotionService` to create a `BillingTransaction` record — update that file's implementation note.

---

## API Changes

### New Module: BillingModule

**Location:** `apps/api/src/billing/`

Files:
- `billing.module.ts`
- `billing.controller.ts`
- `billing.service.ts`
- `invoice.service.ts`
- `dto/save-billing-profile.dto.ts`
- `dto/topup.dto.ts`

### BillingController

```typescript
// apps/api/src/billing/billing.controller.ts
@Controller('v1/partner/billing')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.STATION_MANAGER)
export class BillingController {
  // GET /v1/partner/billing
  // Returns: { profile, creditBalance, paymentMethod, transactions }
  // paymentMethod: loaded from Stripe Customer's default payment method

  // POST /v1/partner/billing/profile
  // Body: SaveBillingProfileDto
  // Creates or updates BillingProfile for the user

  // POST /v1/partner/billing/setup-intent
  // Creates Stripe SetupIntent for saving a card
  // Returns: { clientSecret: string }
  // Frontend uses clientSecret with Stripe Elements to confirm the card

  // POST /v1/partner/billing/topup
  // Body: TopupDto { amountPln: number }
  // Charges saved Stripe Customer's default payment method
  // Creates BillingTransaction record
  // Returns: { newBalance: number }

  // GET /v1/partner/billing/invoice/:transactionId
  // Generates (or retrieves cached) PDF invoice for a transaction
  // Returns: { downloadUrl: string } — presigned R2 URL, 1-hour TTL
}
```

### SaveBillingProfileDto

```typescript
export class SaveBillingProfileDto {
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  type: string;

  @IsString() @MaxLength(200)
  name: string;

  @IsString() @MaxLength(300)
  addressLine: string;

  @IsString() @MaxLength(100)
  city: string;

  @IsString() @MaxLength(10)
  postalCode: string;  // PL format: XX-XXX (validated via regex)

  @IsOptional() @IsString()
  nip?: string;        // validated for COMPANY type (10 digits, checksum)
}
```

**NIP validation:** reuse the checksum logic from Story 7.6 `validateNip()` utility. For `COMPANY` type, NIP is required and must pass checksum. For `INDIVIDUAL`, NIP is optional — if provided, must still pass checksum.

### TopupDto

```typescript
export class TopupDto {
  @IsNumber() @Min(50) @Max(10000)
  amountPln: number;
}
```

### BillingService

```typescript
// Key methods:

// getBillingOverview(userId): Promise<BillingOverviewDto>
//   - Loads BillingProfile, User.credit_balance_pln
//   - If user.stripe_customer_id: fetches Stripe Customer, reads default payment method
//     (stripe.customers.retrieve(customerId, { expand: ['default_source'] }) or
//      stripe.paymentMethods.list({ customer, type: 'card', limit: 1 }))
//   - Loads last 20 BillingTransactions ordered by created_at DESC
//   - Returns combined DTO

// saveBillingProfile(userId, dto): Promise<void>
//   - Upsert BillingProfile (unique on user_id)
//   - If type === 'COMPANY' and !dto.nip: throw 400

// createSetupIntent(userId): Promise<{ clientSecret: string }>
//   - Ensure Stripe Customer exists (createOrGetStripeCustomer)
//   - stripe.setupIntents.create({ customer: stripeCustomerId, payment_method_types: ['card'] })
//   - Returns { clientSecret: setupIntent.client_secret }

// createOrGetStripeCustomer(userId): Promise<string>
//   - Load user — if stripe_customer_id present, return it
//   - Otherwise: stripe.customers.create({ email: user.email, metadata: { userId } })
//   - Persist customer.id to user.stripe_customer_id
//   - Return customer.id

// topup(userId, amountPln): Promise<Decimal>
//   - Validate billing profile exists (throw 400 if not)
//   - Load stripe_customer_id (create if absent)
//   - Load default payment method from Stripe Customer
//   - Create PaymentIntent: stripe.paymentIntents.create({
//       amount: Math.round(amountPln * 100),  // grosz
//       currency: 'pln',
//       customer: stripeCustomerId,
//       payment_method: defaultPaymentMethodId,
//       confirm: true,
//       off_session: true,    // user not present — charge saved card
//     })
//   - On success: prisma.$transaction → User.credit_balance_pln += amountPln + create BillingTransaction
//   - Return new balance

// getInvoice(userId, transactionId): Promise<{ downloadUrl: string }>
//   - Load BillingTransaction (ownership check: transaction.user_id === userId)
//   - If transaction.invoice_r2_key is set: generate presigned URL and return
//   - Otherwise: call InvoiceService.generate(transaction, billingProfile) → Buffer
//     → upload to R2 key: invoices/{userId}/{transactionId}.pdf
//     → set invoice_r2_key + invoice_number on transaction
//   - Return { downloadUrl: presignedUrl (1-hour TTL) }
```

### InvoiceService

**Package:** `pdfkit` (`npm install pdfkit @types/pdfkit` in `apps/api`)

```typescript
// apps/api/src/billing/invoice.service.ts

// generate(transaction: BillingTransaction, profile: BillingProfile, user: User): Promise<Buffer>
//   Returns a PDF Buffer for the invoice

// Invoice layout (PDF, A4):
// ┌─────────────────────────────────────────┐
// │  desert sp. z o.o.                      │  (platform name - top left)
// │  ul. Przykładowa 1, 00-001 Warszawa     │
// │  NIP: [platform NIP]                    │
// │                                   FAKTURA VAT
// │                                   Nr: FV/2026/04/0001
// │                                   Data wystawienia: 07.04.2026
// ├─────────────────────────────────────────┤
// │  Nabywca:                               │
// │  [profile.name]                         │
// │  [profile.addressLine], [profile.city]  │
// │  NIP: [profile.nip] (if present)        │
// ├─────────────────────────────────────────┤
// │  Lp.  Usługa              Netto   VAT   Brutto
// │   1   [transaction.description]
// │       [amount_net_pln] PLN  23%  [amount_gross_pln] PLN
// ├─────────────────────────────────────────┤
// │  RAZEM: [amount_gross_pln] PLN (słownie: ...)
// └─────────────────────────────────────────┘

// Invoice number generation:
// FV/{YYYY}/{MM}/{NNNN} — sequential per user per month
// NNNN: count of this user's invoices in this month + 1, zero-padded to 4 digits
// Store in BillingTransaction.invoice_number before returning
```

**Platform billing details** — store as constants or env vars:

```typescript
// apps/api/src/billing/invoice.constants.ts
export const PLATFORM_BILLING = {
  name: 'desert sp. z o.o.',
  address: 'ul. Przykładowa 1, 00-001 Warszawa',  // replace before go-live
  nip: '0000000000',                               // replace before go-live
  vatRate: 0.23,
};
```

Add env vars `PLATFORM_COMPANY_NAME`, `PLATFORM_COMPANY_ADDRESS`, `PLATFORM_NIP` and load from there before go-live (hardcoded constants for dev).

---

## Stripe — SetupIntent + Elements Flow

Story 8.1 used Stripe Checkout Session (redirect-based). Story 8.4 uses **Stripe Elements** inline in the partner portal for a seamless card-saving experience — no redirect required.

### Backend: SetupIntent

```typescript
// POST /v1/partner/billing/setup-intent
// Returns: { clientSecret: string }
const setupIntent = await stripe.setupIntents.create({
  customer: stripeCustomerId,
  payment_method_types: ['card'],
  usage: 'off_session',  // allows future charges without user present (for top-ups)
});
// Returns setupIntent.client_secret to the partner app
```

### Frontend: Stripe Elements in Partner App

```tsx
// apps/partner/src/app/billing/AddCardForm.tsx  — Client Component
'use client';

import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export function AddCardForm({ onSuccess }: { onSuccess: () => void }) {
  return (
    <Elements stripe={stripePromise}>
      <CardFormInner onSuccess={onSuccess} />
    </Elements>
  );
}

function CardFormInner({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async () => {
    // 1. Call server action to get SetupIntent clientSecret
    const { clientSecret } = await createSetupIntentAction();
    // 2. stripe.confirmCardSetup(clientSecret, { payment_method: { card: elements.getElement(CardElement) } })
    // 3. On success: call onSuccess() to refresh billing page
  };

  return (
    <form onSubmit={...}>
      <CardElement />
      <button type="submit">Save card</button>
    </form>
  );
}
```

**Package:** `@stripe/react-stripe-js` + `@stripe/stripe-js` (`npm install` in `apps/partner`)

After SetupIntent confirms, Stripe automatically sets the new payment method as the default on the Customer (configure via `stripe.customers.update({ default_source: pm.id })` in a webhook or rely on Stripe's automatic behavior for SetupIntent with `usage: 'off_session'`).

**Webhook for SetupIntent:** Handle `setup_intent.succeeded` in `PromotionWebhookController` to explicitly set the payment method as the Customer's default:

```typescript
case 'setup_intent.succeeded': {
  const si = event.data.object as Stripe.SetupIntent;
  if (si.customer && si.payment_method) {
    await stripe.customers.update(si.customer as string, {
      invoice_settings: { default_payment_method: si.payment_method as string },
    });
  }
  break;
}
```

---

## Billing Profile — Purchase Gate

In `PartnerService` (or `PromotionService`), add a check before campaign creation:

```typescript
// In PromotionService.createCampaign():
const billingProfile = await this.prisma.billingProfile.findUnique({ where: { user_id: userId } });
if (!billingProfile) {
  throw new HttpException({ error: 'BILLING_PROFILE_REQUIRED' }, 400);
}
```

The partner app `purchase-action.ts` (Story 8.1) handles the `BILLING_PROFILE_REQUIRED` error by redirecting to `/billing?redirect=promotions/new`.

---

## Partner App — Billing UI

### Page Structure

**`apps/partner/src/app/billing/page.tsx`** — Server Component

Fetches `GET /v1/partner/billing` via `partnerFetch`. Renders:

```
┌─────────────────────────────────────────────┐
│  Billing profile          [Edit]            │
│  Firma: ORLEN SA          NIP: 1234567890   │
├─────────────────────────────────────────────┤
│  Credit balance                             │
│  ████ 47.50 PLN     [Top up]               │
├─────────────────────────────────────────────┤
│  Payment method                             │
│  Visa •••• 4242   expires 04/28  [Replace] │
├─────────────────────────────────────────────┤
│  Transactions                               │
│  07 kwi 2026  Campaign purchase  -49.99 PLN [Invoice ↓]│
│  05 kwi 2026  Credit top-up      +100.00 PLN [Invoice ↓]│
└─────────────────────────────────────────────┘
```

### New Pages

- **`/billing/page.tsx`** — overview (Server Component, as above)
- **`/billing/profile/page.tsx`** — billing profile form (Server Component + `save-profile-action.ts`)
- **`/billing/topup/page.tsx`** — top-up page with amount selector + `topup-action.ts`

### Server Actions

```typescript
// apps/partner/src/app/billing/save-profile-action.ts
'use server';
export async function saveProfileAction(data: SaveBillingProfileDto) {
  return partnerFetch('POST', '/v1/partner/billing/profile', data);
}

// apps/partner/src/app/billing/topup-action.ts
'use server';
export async function topupAction(amountPln: number) {
  return partnerFetch<{ newBalance: number }>('POST', '/v1/partner/billing/topup', { amountPln });
}

// apps/partner/src/app/billing/get-invoice-action.ts
'use server';
export async function getInvoiceAction(transactionId: string) {
  return partnerFetch<{ downloadUrl: string }>('GET', `/v1/partner/billing/invoice/${transactionId}`);
}

// apps/partner/src/app/billing/create-setup-intent-action.ts
'use server';
export async function createSetupIntentAction() {
  return partnerFetch<{ clientSecret: string }>('POST', '/v1/partner/billing/setup-intent');
}
```

### Invoice Download Button

The invoice download button calls `getInvoiceAction(transactionId)` to get a presigned URL, then opens it in a new tab. Since the URL is presigned (no auth required), `window.open(downloadUrl, '_blank')` works safely.

```tsx
// Client Component snippet
const handleDownload = async () => {
  const { downloadUrl } = await getInvoiceAction(transaction.id);
  window.open(downloadUrl, '_blank');
};
```

### Sidebar Navigation

Add "Billing" link to the partner app sidebar, with a badge showing credit balance (e.g. "47.50 PLN"). The balance is passed as a Server Component prop from the layout — do NOT fetch on every render. Re-fetch only on top-up success.

---

## R2 Key Format for Invoices

```
invoices/{userId}/{transactionId}.pdf
```

Unlike claim documents (Story 7.2), invoices are NOT deleted after download — they are retained for legal compliance. Generate once, cache in R2 indefinitely.

---

## Environment Variables

Add to `apps/api/.env.example`:

```bash
# Billing / Invoice
PLATFORM_COMPANY_NAME="desert sp. z o.o."
PLATFORM_COMPANY_ADDRESS="ul. Przykładowa 1, 00-001 Warszawa"
PLATFORM_NIP="0000000000"
```

Add to `apps/partner/.env.example`:

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

(Already added in Story 8.1 — confirm it's present.)

---

## Module Registration

```typescript
// apps/api/src/billing/billing.module.ts
@Module({
  imports: [PrismaModule, R2Module],  // R2Module for invoice upload
  controllers: [BillingController],
  providers: [BillingService, InvoiceService],
  exports: [BillingService],  // exported so PromotionModule can check billing profile
})
export class BillingModule {}
```

Add `BillingModule` to `AppModule` imports and to `PromotionModule` imports (so `PromotionService` can check billing profile).

---

## Tasks / Subtasks

- [ ] Prisma schema: `BillingProfile`, `BillingTransaction`, additions to `User` (AC: 2, 3, 5, 6)
  - [ ] Migration `add_billing_profile_and_transactions`
  - [ ] `prisma generate`

- [ ] BillingModule scaffold (AC: all)
  - [ ] Directory structure + `billing.module.ts`
  - [ ] Register in AppModule and PromotionModule

- [ ] BillingService — profile (AC: 1, 2)
  - [ ] `saveBillingProfile()` with NIP validation (reuse Story 7.6 `validateNip()`)
  - [ ] `getBillingOverview()` — load profile, balance, payment method, transactions
  - [ ] `POST /v1/partner/billing/profile` endpoint

- [ ] BillingService — Stripe Customer (AC: 4, 5)
  - [ ] `createOrGetStripeCustomer()` — lazy create, persist to User
  - [ ] `createSetupIntent()` — returns clientSecret
  - [ ] `POST /v1/partner/billing/setup-intent` endpoint
  - [ ] Webhook handler for `setup_intent.succeeded` → set default payment method

- [ ] BillingService — top-up (AC: 5)
  - [ ] `topup()` — PaymentIntent off-session + balance update + transaction record
  - [ ] `POST /v1/partner/billing/topup` endpoint

- [ ] BillingService — billing gate in PromotionService (AC: 1)
  - [ ] Check `BillingProfile` exists before campaign creation
  - [ ] Return `BILLING_PROFILE_REQUIRED` error

- [ ] Update PromotionService to create BillingTransaction on campaign purchase (AC: 3, 6)
  - [ ] Stripe webhook path: create BillingTransaction after campaign activation
  - [ ] Credit path: create BillingTransaction inside `prisma.$transaction`

- [ ] InvoiceService — PDF generation (AC: 6)
  - [ ] `npm install pdfkit @types/pdfkit` in apps/api
  - [ ] `generate()` — layout as specified, Polish language
  - [ ] Invoice number generation (`FV/{YYYY}/{MM}/{NNNN}`)
  - [ ] R2 upload + `invoice_r2_key` + `invoice_number` persisted to BillingTransaction
  - [ ] `GET /v1/partner/billing/invoice/:transactionId` endpoint

- [ ] Partner app: Billing page layout (AC: 3)
  - [ ] `/billing/page.tsx` — overview Server Component
  - [ ] Profile summary block
  - [ ] Credit balance block
  - [ ] Payment method block
  - [ ] Transaction list with invoice download buttons

- [ ] Partner app: Billing profile form (AC: 1, 2)
  - [ ] `/billing/profile/page.tsx`
  - [ ] `save-profile-action.ts`
  - [ ] NIP input with client-side checksum validation (Polish UX requirement)

- [ ] Partner app: Top-up page (AC: 5)
  - [ ] `/billing/topup/page.tsx` — amount selector (50/100/200/custom)
  - [ ] `topup-action.ts`

- [ ] Partner app: AddCardForm with Stripe Elements (AC: 4)
  - [ ] `npm install @stripe/react-stripe-js @stripe/stripe-js` in apps/partner
  - [ ] `AddCardForm.tsx` Client Component
  - [ ] `create-setup-intent-action.ts`

- [ ] Partner app: Invoice download (AC: 6)
  - [ ] `get-invoice-action.ts`
  - [ ] Download button with `window.open(url, '_blank')`

- [ ] Sidebar: Billing link with credit balance badge (AC: 3)
- [ ] i18n: pl/en/uk strings for all billing section labels (AC: 7)

---

## Dev Notes

### pdfkit Usage

```typescript
import PDFDocument from 'pdfkit';

async function generate(...): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Render invoice content
    doc.fontSize(20).text('FAKTURA VAT', { align: 'right' });
    // ... layout as specified
    doc.end();
  });
}
```

Polish characters (ą, ę, ó etc.) require a font that supports them. Register a font:
```typescript
// Use built-in Helvetica — it supports Latin-1 only (no Polish diacritics)
// Solution: embed a free Polish-compatible font like Lato or Roboto:
doc.registerFont('Roboto', path.join(__dirname, '../assets/Roboto-Regular.ttf'));
doc.font('Roboto');
```

Add `apps/api/src/billing/assets/Roboto-Regular.ttf` to the repository. Download from Google Fonts (OFL license, compatible with commercial use).

### Decimal Arithmetic for VAT

Always use `Prisma.Decimal` for monetary calculations — never cast to JS `number`:

```typescript
const amountGross = new Prisma.Decimal(amountPln);
const amountNet = amountGross.div(new Prisma.Decimal('1.23')).toDecimalPlaces(2);
const amountVat = amountGross.sub(amountNet);
```

`toDecimalPlaces(2)` uses `ROUND_HALF_UP` by default in `decimal.js` (which Prisma uses). This is correct for VAT rounding under Polish law.

### Stripe off_session PaymentIntent Errors

`off_session: true` means the customer is not present. If the card requires authentication (SCA/3DS), Stripe throws a `payment_intent_authentication_failure` error. Handle this explicitly:

```typescript
try {
  const pi = await stripe.paymentIntents.create({ ..., confirm: true, off_session: true });
} catch (err) {
  if (err instanceof Stripe.errors.StripeError && err.code === 'authentication_required') {
    throw new HttpException({ error: 'CARD_REQUIRES_AUTHENTICATION' }, 402);
  }
  throw err;
}
```

The partner app shows: "Your card requires additional verification. Please add a new card." (SCA-exempted cards — e.g. recurring merchant exemptions — will succeed without 3DS.)

### Invoice Number Sequential Counter

```typescript
// Count existing invoices for this user in this month:
const monthStart = new Date(year, month - 1, 1);
const monthEnd = new Date(year, month, 1);
const count = await this.prisma.billingTransaction.count({
  where: {
    user_id: userId,
    invoice_number: { not: null },
    created_at: { gte: monthStart, lt: monthEnd },
  },
});
const invoiceNumber = `FV/${year}/${String(month).padStart(2, '0')}/${String(count + 1).padStart(4, '0')}`;
```

This is not globally unique across users (two users can both have `FV/2026/04/0001`). That's correct — VAT invoice numbers are per-issuer. Since the platform issues all invoices, invoice numbers should ideally be globally sequential. Post-MVP: add a `InvoiceSequence` table with a global counter per month.

For MVP: use `FV/{year}/{month}/{userId[0..3]}-{NNNN}` to reduce collision risk while staying simple.

### stripe_customer_id — Race Condition

`createOrGetStripeCustomer()` can be called concurrently (e.g. two browser tabs). Protect with a simple upsert guard:

```typescript
// After creating Stripe customer:
await this.prisma.user.updateMany({
  where: { id: userId, stripe_customer_id: null },  // only update if still null
  data: { stripe_customer_id: customer.id },
});
// Reload to get the actual stripe_customer_id (may have been set by another request)
const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
return user.stripe_customer_id!;
// If two requests both created a Stripe customer: one ID is used and the other is orphaned.
// Acceptable for MVP — add a unique constraint check or DB lock post-MVP.
```

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
