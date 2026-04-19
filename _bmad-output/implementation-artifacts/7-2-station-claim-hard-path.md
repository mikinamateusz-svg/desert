# Story 7.2: Station Claim — Hard Path

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.2
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 7.1 (StationClaim schema, PartnerModule scaffold, apps/partner app)
- **Required by:** 7.3, 7.4 (STATION_MANAGER role, management screen)

---

## User Story

**As a station owner,**
I want to verify my station ownership even if I don't have a Google Business Profile or chain email,
So that independent stations can still be claimed and managed on the platform.

---

## Context & Why

The easy path (7.1) covers chains and stations with a Google Business Profile. This story handles the long tail — independent stations without GBP or chain email. These are often exactly the stations that need the platform most (the Piotrs competing with a nearby ORLEN).

Two mechanisms, presented in preference order:

1. **Phone SMS** — the station's Google Places phone number is publicly listed. Low friction: owner proves control of the business phone. Works for most independents.
2. **Document upload** — business registration certificate or utility bill showing the station address. Ops-heavy fallback, necessary for edge cases (no listed phone, shared number, etc.). 2-business-day SLA.

This story also introduces conflict handling: if a station already has a verified owner and someone else attempts a hard-path claim, ops are notified and both parties receive email — the existing manager retains access pending resolution.

---

## Acceptance Criteria

**Given** a station owner arrives at the hard path (from Story 7.1's exhausted easy path CTA)
**When** they proceed
**Then** they are shown both options — phone verification first, document upload second

**Given** a station owner selects phone verification
**When** the system calls the Google Places API with the station's `google_places_id`
**Then** if a phone number is found, the owner sees the number masked (last 4 digits visible, e.g., `+48 *** *** 1234`) and a "Send verification code" button
**And** on submit, a 6-digit code is sent via Twilio SMS to the unmasked number and stored in Redis with 24h TTL

**Given** the owner enters the 6-digit code
**When** it is validated against the Redis entry within 24 hours
**Then** the claim is approved immediately, STATION_MANAGER role granted, and the owner is redirected to `/login?message=verified&redirect=/station/{stationId}`

**Given** the code is incorrect or expired
**When** the owner submits it
**Then** an error is shown — they may request a new code (rate-limited: max 3 sends per claim per 24h)

**Given** no phone number exists in Google Places, or the owner chooses not to use it
**When** they opt for document upload
**Then** they can upload a single file (PDF, JPEG, PNG, max 10 MB): a business registration certificate or utility bill showing the station address
**And** the file is stored in R2 at `claim-docs/{userId}/{stationId}/{uuid}.{ext}`, the `StationClaim` record is updated with `method: DOCUMENT_UPLOAD` and `document_r2_key`, and the owner sees an "Under review — expect 2 business days" confirmation

**Given** a document upload claim has been open and unreviewed for 48 hours
**When** the deadline passes
**Then** an email reminder is sent to `ops@desert.app`

**Given** an ops admin opens the Claims section of the admin panel
**When** they view it
**Then** they see all `PENDING` document-upload claims with: station name, claimant email, submission date, and a "View document" link (presigned R2 URL, 30-min TTL)

**Given** an ops admin reviews a document upload
**When** they approve
**Then** `StationClaim.status = APPROVED`, `reviewed_by = adminId`, `reviewed_at = now()`
**And** the user's role is upgraded to `STATION_MANAGER`
**And** an approval email is sent: "Your station has been verified. Log in to start managing [Station Name]."
**And** the document is deleted from R2

**Given** an ops admin rejects a claim
**When** they save with a rejection reason
**Then** `StationClaim.status = REJECTED`, `rejection_reason` is stored
**And** a rejection email is sent with the reason
**And** the document is deleted from R2

**Given** a station already has an `APPROVED` claim from another user
**When** a different owner submits a hard-path claim for the same station
**Then** a new `StationClaim` with `status: CONFLICT` is created for the new claimant
**And** an ops notification email is sent to `ops@desert.app` listing both parties (name + email)
**And** both the existing manager and the new claimant receive email: "Ownership dispute flagged — our team will be in touch within 2 business days"
**And** the existing manager retains full access until ops resolves the conflict

**Given** an owner has an existing `REJECTED` claim for a station
**When** they attempt to initiate a new claim
**Then** they are allowed to start fresh — a new `StationClaim` record is created (rejected claims do not block re-attempts)

---

## Schema Changes

### Add `CONFLICT` to `ClaimStatus` enum

```prisma
enum ClaimStatus {
  PENDING
  APPROVED
  REJECTED
  CONFLICT   // ← new: disputed ownership, requires ops resolution
}
```

### Add fields to `StationClaim` model

```prisma
model StationClaim {
  // ... existing fields from Story 7.1 ...

  // New in Story 7.2:
  document_r2_key  String?   // set when method = DOCUMENT_UPLOAD
  phone_last4      String?   // last 4 digits of phone SMS sent to (audit log)
  rejection_reason String?   // set by ops on rejection
}
```

**Migration name:** `add_station_claim_hard_path_fields`

---

## New Service: `SmsService`

Create `apps/api/src/sms/sms.service.ts` — a thin Twilio wrapper, following the pattern of `StorageService`.

```typescript
// apps/api/src/sms/sms.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private client!: ReturnType<typeof twilio>;
  private fromNumber!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_FROM_NUMBER') ?? '';

    if (!accountSid || !authToken) {
      this.logger.warn('Twilio credentials not configured — SMS will be skipped');
      return;
    }

    this.client = twilio(accountSid, authToken);
  }

  async sendSms(to: string, body: string): Promise<void> {
    if (!this.client) {
      this.logger.warn(`SMS skipped (no client): ${to}`);
      return;
    }
    await this.client.messages.create({ body, from: this.fromNumber, to });
  }
}
```

```typescript
// apps/api/src/sms/sms.module.ts
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
```

Install: `pnpm add twilio --filter @desert/api`

---

## Email Notifications (Resend — existing pattern)

Resend is already used in `UserService.sendExportEmail()`. Add a standalone `ClaimEmailService` rather than extending `UserService`.

```typescript
// apps/api/src/partner/claim-email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class ClaimEmailService {
  private readonly logger = new Logger(ClaimEmailService.name);
  private resend: Resend | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('RESEND_API_KEY');
    if (key) this.resend = new Resend(key);
    else this.logger.warn('RESEND_API_KEY not set — claim emails will be skipped');
  }

  async sendApproval(email: string, stationName: string, stationId: string): Promise<void> {
    const partnerUrl = this.config.get<string>('PARTNER_APP_URL') ?? 'https://partner.desert.app';
    await this.send(
      email,
      'Your station has been verified — desert partner',
      `<p>Your claim for <strong>${stationName}</strong> has been approved.</p>
       <p><a href="${partnerUrl}/login?redirect=/station/${stationId}">Log in to start managing your station →</a></p>`,
    );
  }

  async sendRejection(email: string, stationName: string, reason: string): Promise<void> {
    await this.send(
      email,
      'Station claim update — desert partner',
      `<p>Your claim for <strong>${stationName}</strong> was not approved.</p>
       <p><strong>Reason:</strong> ${reason}</p>
       <p>If you believe this is an error, reply to this email and we'll take another look.</p>`,
    );
  }

  async sendConflictNotice(email: string, stationName: string): Promise<void> {
    await this.send(
      email,
      'Ownership dispute flagged — desert partner',
      `<p>We've received a conflicting ownership claim for <strong>${stationName}</strong>.</p>
       <p>Our team will review both claims and be in touch within 2 business days.</p>
       <p>Your access is not affected during this review.</p>`,
    );
  }

  async sendOpsAlert(subject: string, body: string): Promise<void> {
    const opsEmail = this.config.get<string>('OPS_EMAIL') ?? 'ops@desert.app';
    await this.send(opsEmail, subject, body);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({
        from: 'desert <noreply@desert.app>',
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${String(err)}`);
    }
  }
}
```

---

## `PartnerService` extensions

Add these methods to `apps/api/src/partner/partner.service.ts` (extending 7.1's service):

```typescript
// --- Phone SMS verification ---

/** Look up station phone from Google Places. Returns masked number + boolean indicating phone exists. */
async lookupStationPhone(
  stationId: string,
): Promise<{ exists: boolean; masked: string | null }> {
  const station = await this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { google_places_id: true },
  });

  if (!station.google_places_id) return { exists: false, masked: null };

  const apiKey = this.config.get<string>('GOOGLE_PLACES_API_KEY');
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${station.google_places_id}?fields=internationalPhoneNumber`,
    { headers: { 'X-Goog-Api-Key': apiKey ?? '' } },
  );

  if (!res.ok) return { exists: false, masked: null };

  const data = (await res.json()) as { internationalPhoneNumber?: string };
  const phone = data.internationalPhoneNumber;

  if (!phone) return { exists: false, masked: null };

  // Mask: show country code + last 4 digits only, e.g. "+48 *** *** 1234"
  const last4 = phone.slice(-4);
  const masked = `${phone.slice(0, phone.indexOf(' ') + 1)}*** *** ${last4}`;

  return { exists: true, masked };
}

/** Send SMS verification code. Rate-limited to 3 sends per claim per 24h. */
async sendPhoneVerificationCode(userId: string, stationId: string): Promise<SmsResult> {
  // Rate limit check: max 3 SMS per claim per 24h
  const rateLimitKey = `claim:sms:ratelimit:${stationId}:${userId}`;
  const count = await this.redis.incr(rateLimitKey);
  if (count === 1) await this.redis.expire(rateLimitKey, 24 * 60 * 60);
  if (count > 3) return { success: false, reason: 'rate_limited' };

  // Fetch actual phone from Google Places
  const station = await this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { google_places_id: true },
  });

  if (!station.google_places_id) return { success: false, reason: 'no_phone' };

  const apiKey = this.config.get<string>('GOOGLE_PLACES_API_KEY');
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${station.google_places_id}?fields=internationalPhoneNumber`,
    { headers: { 'X-Goog-Api-Key': apiKey ?? '' } },
  );

  if (!res.ok) return { success: false, reason: 'places_api_error' };

  const data = (await res.json()) as { internationalPhoneNumber?: string };
  const phone = data.internationalPhoneNumber;

  if (!phone) return { success: false, reason: 'no_phone' };

  // Generate and store code
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  await this.redis.set(
    `claim:sms:code:${stationId}:${userId}`,
    code,
    'EX',
    24 * 60 * 60,
  );

  // Send SMS (non-blocking log on failure)
  try {
    await this.smsService.sendSms(
      phone,
      `Your desert verification code: ${code}. Valid for 24 hours.`,
    );
  } catch (err) {
    this.logger.error(`SMS send failed for station ${stationId}: ${String(err)}`);
    return { success: false, reason: 'sms_failed' };
  }

  // Store last4 for audit
  await this.db.stationClaim.upsert({
    where: { station_id_user_id: { station_id: stationId, user_id: userId } },
    create: {
      station_id: stationId,
      user_id: userId,
      status: 'PENDING',
      method: 'PHONE_SMS',
      phone_last4: phone.slice(-4),
    },
    update: { method: 'PHONE_SMS', phone_last4: phone.slice(-4) },
  });

  return { success: true };
}

/** Validate SMS code. Approves claim on success. */
async confirmPhoneCode(userId: string, stationId: string, code: string): Promise<SmsConfirmResult> {
  const stored = await this.redis.get(`claim:sms:code:${stationId}:${userId}`);
  if (!stored) return { success: false, reason: 'code_expired' };
  if (stored !== code) return { success: false, reason: 'code_invalid' };

  await this.redis.del(`claim:sms:code:${stationId}:${userId}`);
  await this.approveClaim(userId, stationId, 'PHONE_SMS'); // same private method from 7.1
  return { success: true, stationId };
}

// --- Document upload ---

/** Store uploaded document in R2 and update the StationClaim record. */
async uploadClaimDocument(
  userId: string,
  stationId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileExt: string,
): Promise<void> {
  const docId = randomUUID();
  const r2Key = `claim-docs/${userId}/${stationId}/${docId}.${fileExt}`;

  await this.storageService.uploadBuffer(r2Key, fileBuffer, mimeType);

  await this.db.stationClaim.upsert({
    where: { station_id_user_id: { station_id: stationId, user_id: userId } },
    create: {
      station_id: stationId,
      user_id: userId,
      status: 'PENDING',
      method: 'DOCUMENT_UPLOAD',
      document_r2_key: r2Key,
    },
    update: { method: 'DOCUMENT_UPLOAD', document_r2_key: r2Key, status: 'PENDING' },
  });

  // Schedule 48h ops reminder via BullMQ
  const claim = await this.db.stationClaim.findUniqueOrThrow({
    where: { station_id_user_id: { station_id: stationId, user_id: userId } },
    select: { id: true },
  });

  await this.claimReminderQueue.add(
    'claim-review-reminder',
    { claimId: claim.id },
    {
      delay: 48 * 60 * 60 * 1000,
      jobId: `claim-reminder-${claim.id}`, // idempotent: no duplicate reminders if re-uploaded
    },
  );
}

// --- Conflict handling ---

/** Attempt hard-path claim for a station that is already APPROVED by someone else. */
async initiateConflictClaim(
  userId: string,
  stationId: string,
  existingManagerUserId: string,
): Promise<void> {
  // Get both users' details for notification
  const [newClaimant, existingManager, station] = await Promise.all([
    this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, display_name: true },
    }),
    this.db.user.findUniqueOrThrow({
      where: { id: existingManagerUserId },
      select: { email: true, display_name: true },
    }),
    this.db.station.findUniqueOrThrow({
      where: { id: stationId },
      select: { name: true },
    }),
  ]);

  // Create CONFLICT claim for new claimant
  await this.db.stationClaim.create({
    data: {
      station_id: stationId,
      user_id: userId,
      status: 'CONFLICT',
      method: 'DOCUMENT_UPLOAD',
    },
  });

  // Notify ops
  await this.claimEmailService.sendOpsAlert(
    `Ownership dispute: ${station.name}`,
    `<p>A new ownership claim has been filed for <strong>${station.name}</strong> (station ID: ${stationId}).</p>
     <p><strong>Existing manager:</strong> ${existingManager.display_name ?? '—'} (${existingManager.email ?? '—'})</p>
     <p><strong>New claimant:</strong> ${newClaimant.display_name ?? '—'} (${newClaimant.email ?? '—'})</p>
     <p>Please review in the admin panel.</p>`,
  );

  // Notify both parties
  if (existingManager.email) {
    await this.claimEmailService.sendConflictNotice(existingManager.email, station.name);
  }
  if (newClaimant.email) {
    await this.claimEmailService.sendConflictNotice(newClaimant.email, station.name);
  }
}
```

### Local types

```typescript
type SmsResult = { success: true } | { success: false; reason: string };
type SmsConfirmResult = { success: true; stationId: string } | { success: false; reason: string };
```

---

## `PartnerController` additions

```typescript
/** GET /v1/partner/claims/{stationId}/phone/lookup — authenticated */
@Get('claims/:stationId/phone/lookup')
async lookupPhone(@Param('stationId') stationId: string) {
  return this.partnerService.lookupStationPhone(stationId);
}

/** POST /v1/partner/claims/{stationId}/phone/send — authenticated, rate-limited */
@Post('claims/:stationId/phone/send')
async sendPhoneCode(@CurrentUser() user: User, @Param('stationId') stationId: string) {
  return this.partnerService.sendPhoneVerificationCode(user.id, stationId);
}

/** POST /v1/partner/claims/{stationId}/phone/confirm — authenticated */
@Post('claims/:stationId/phone/confirm')
async confirmPhoneCode(
  @CurrentUser() user: User,
  @Param('stationId') stationId: string,
  @Body() dto: ConfirmPhoneDto,
) {
  return this.partnerService.confirmPhoneCode(user.id, stationId, dto.code);
}

/** POST /v1/partner/claims/{stationId}/document — authenticated, multipart */
@Post('claims/:stationId/document')
@UseInterceptors(FileInterceptor('file'))
async uploadDocument(
  @CurrentUser() user: User,
  @Param('stationId') stationId: string,
  @UploadedFile(
    new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10 MB
        new FileTypeValidator({ fileType: /(pdf|jpeg|jpg|png)$/i }),
      ],
    }),
  )
  file: Express.Multer.File,
) {
  const extMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };
  const ext = extMap[file.mimetype] ?? 'bin';

  await this.partnerService.uploadClaimDocument(
    user.id,
    stationId,
    file.buffer,
    file.mimetype,
    ext,
  );

  return { status: 'pending', message: 'Document received — expect review within 2 business days' };
}
```

**Multipart support in NestJS/Fastify:** use `@nestjs/platform-fastify` with `fastify-multipart`. The `FileInterceptor` must be imported from `@nestjs/platform-express`... but this project uses Fastify. Use `@fastify/multipart` directly and parse in the controller, OR switch to using the `@UploadedFile` pattern with a Fastify-compatible interceptor.

**Recommended approach for MVP:** use raw Fastify multipart parsing in the controller handler and bypass the `FileInterceptor` abstraction:

```typescript
@Post('claims/:stationId/document')
async uploadDocument(
  @CurrentUser() user: User,
  @Param('stationId') stationId: string,
  @Req() req: FastifyRequest,
) {
  if (!req.isMultipart()) throw new BadRequestException('Expected multipart form data');

  const data = await req.file();
  if (!data) throw new BadRequestException('No file provided');

  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!ALLOWED_MIME.includes(data.mimetype)) {
    throw new BadRequestException('Only PDF, JPEG, or PNG files are accepted');
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of data.file) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const MAX_BYTES = 10 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) throw new BadRequestException('File exceeds 10 MB limit');

  const extMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };

  await this.partnerService.uploadClaimDocument(
    user.id,
    stationId,
    buffer,
    data.mimetype,
    extMap[data.mimetype] ?? 'bin',
  );

  return { status: 'pending' };
}
```

Ensure `@fastify/multipart` is registered on the Fastify instance (check `apps/api/src/main.ts` — it may already be registered for the photo pipeline).

---

## BullMQ: Claim Review Reminder Worker

```
apps/api/src/partner/
├── claim-reminder.worker.ts
```

```typescript
// claim-reminder.worker.ts
export const CLAIM_REMINDER_QUEUE = 'claim-review-reminders';

@Injectable()
export class ClaimReminderWorker implements OnModuleInit, OnModuleDestroy {
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

    this.worker = new Worker(
      CLAIM_REMINDER_QUEUE,
      async (job: Job<{ claimId: string }>) => {
        const claim = await this.db.stationClaim.findUnique({
          where: { id: job.data.claimId },
          include: { station: { select: { name: true } }, user: { select: { email: true } } },
        });

        if (!claim || claim.status !== 'PENDING') return; // already resolved

        await this.claimEmailService.sendOpsAlert(
          `Unreviewed claim reminder: ${claim.station.name}`,
          `<p>The document upload claim for <strong>${claim.station.name}</strong> (claim ID: ${claim.id}) has been pending for 48 hours without review.</p>
           <p>Claimant: ${claim.user.email ?? '—'}</p>
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

Inject `claimReminderQueue` into `PartnerService`:

```typescript
// In PartnerModule:
BullModule.registerQueue({ name: CLAIM_REMINDER_QUEUE }),

// In PartnerService constructor:
@InjectQueue(CLAIM_REMINDER_QUEUE) private readonly claimReminderQueue: Queue,
```

---

## Admin Panel: Claims Section

### New files in `apps/admin`

```
apps/admin/app/(protected)/claims/
├── page.tsx          # pending claims list
├── actions.ts        # approve/reject server actions
└── [id]/
    └── page.tsx      # claim detail + document view
```

### lib/types.ts additions

```typescript
export interface ClaimRow {
  id: string;
  station_id: string;
  station_name: string;
  station_address: string | null;
  claimant_email: string | null;
  claimant_display_name: string | null;
  method: 'PHONE_SMS' | 'DOCUMENT_UPLOAD' | 'GOOGLE_BUSINESS' | 'DOMAIN_MATCH';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONFLICT';
  created_at: string;
  document_r2_key: string | null;
}

export interface ClaimListResult {
  data: ClaimRow[];
  total: number;
}
```

### app/(protected)/claims/actions.ts

```typescript
'use server';
import { adminFetch } from '../../../lib/admin-api';
import { revalidatePath } from 'next/cache';

export async function approveClaim(claimId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/claims/${claimId}/approve`, { method: 'POST' });
    revalidatePath('/claims');
    return {};
  } catch {
    return { error: 'Failed to approve claim' };
  }
}

export async function rejectClaim(
  claimId: string,
  reason: string,
): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/claims/${claimId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    revalidatePath('/claims');
    return {};
  } catch {
    return { error: 'Failed to reject claim' };
  }
}

export async function getDocumentUrl(claimId: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await adminFetch<{ url: string }>(`/v1/admin/claims/${claimId}/document`);
    return { url: res.url };
  } catch {
    return { error: 'Failed to load document' };
  }
}
```

### Admin sidebar — add "Claims" nav item

In `apps/admin/app/(protected)/layout.tsx`, add:

```typescript
{ href: '/claims', label: t.nav.claims },
```

Add `claims` to `i18n.ts` nav translations (pl/en/uk).

---

## Admin API Module additions (`apps/api/src/admin/`)

Add to the existing `AdminMetricsController` (or create a new `AdminClaimsController`):

```typescript
// apps/api/src/admin/admin-claims.controller.ts
@Controller('v1/admin/claims')
@Roles(UserRole.ADMIN)
export class AdminClaimsController {
  constructor(
    private readonly db: PrismaService,
    private readonly storageService: StorageService,
    private readonly claimEmailService: ClaimEmailService,
  ) {}

  /** GET /v1/admin/claims?status=PENDING */
  @Get()
  async listClaims(@Query('status') status = 'PENDING') {
    const claims = await this.db.stationClaim.findMany({
      where: { status: status as ClaimStatus },
      include: {
        station: { select: { name: true, address: true } },
        user: { select: { email: true, display_name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return {
      data: claims.map((c) => ({
        id: c.id,
        station_id: c.station_id,
        station_name: c.station.name,
        station_address: c.station.address,
        claimant_email: c.user.email,
        claimant_display_name: c.user.display_name,
        method: c.method,
        status: c.status,
        created_at: c.created_at.toISOString(),
        document_r2_key: c.document_r2_key,
      })),
      total: claims.length,
    };
  }

  /** GET /v1/admin/claims/{id}/document — returns 30-min presigned URL */
  @Get(':id/document')
  async getDocument(@Param('id') id: string) {
    const claim = await this.db.stationClaim.findUniqueOrThrow({ where: { id } });
    if (!claim.document_r2_key) throw new NotFoundException('No document on this claim');

    const url = await this.storageService.getPresignedUrl(claim.document_r2_key, 30 * 60);
    return { url };
  }

  /** POST /v1/admin/claims/{id}/approve */
  @Post(':id/approve')
  async approveClaim(@Param('id') id: string, @CurrentUser() admin: User) {
    const claim = await this.db.stationClaim.findUniqueOrThrow({
      where: { id },
      include: {
        station: { select: { name: true } },
        user: { select: { email: true } },
      },
    });

    await this.db.$transaction([
      this.db.stationClaim.update({
        where: { id },
        data: { status: 'APPROVED', reviewed_by: admin.id, reviewed_at: new Date() },
      }),
      this.db.user.update({
        where: { id: claim.user_id },
        data: { role: UserRole.STATION_MANAGER },
      }),
    ]);

    // Delete document from R2 (best-effort)
    if (claim.document_r2_key) {
      this.storageService.deleteObject(claim.document_r2_key).catch(() => undefined);
    }

    // Send approval email (best-effort)
    if (claim.user.email) {
      this.claimEmailService
        .sendApproval(claim.user.email, claim.station.name, claim.station_id)
        .catch(() => undefined);
    }

    return { status: 'approved' };
  }

  /** POST /v1/admin/claims/{id}/reject */
  @Post(':id/reject')
  async rejectClaim(
    @Param('id') id: string,
    @CurrentUser() admin: User,
    @Body() dto: RejectClaimDto,
  ) {
    const claim = await this.db.stationClaim.findUniqueOrThrow({
      where: { id },
      include: {
        station: { select: { name: true } },
        user: { select: { email: true } },
      },
    });

    await this.db.stationClaim.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewed_by: admin.id,
        reviewed_at: new Date(),
        rejection_reason: dto.reason,
      },
    });

    // Delete document from R2 (best-effort)
    if (claim.document_r2_key) {
      this.storageService.deleteObject(claim.document_r2_key).catch(() => undefined);
    }

    // Send rejection email (best-effort)
    if (claim.user.email) {
      this.claimEmailService
        .sendRejection(claim.user.email, claim.station.name, dto.reason)
        .catch(() => undefined);
    }

    return { status: 'rejected' };
  }
}
```

```typescript
// dto/reject-claim.dto.ts
import { IsString, MinLength, MaxLength } from 'class-validator';

export class RejectClaimDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
```

Register `AdminClaimsController` in `AdminModule` and ensure `StorageModule` and `ClaimEmailService` are imported there.

---

## Partner App: Hard Path Pages

### app/(partner)/claim/[stationId]/hard-path/page.tsx

Server Component. Shows two options: phone (if available) and document upload.

```typescript
// Server Component
import { partnerFetch } from '../../../../../lib/partner-api';
import HardPathPanel from '../../../../../components/HardPathPanel';

export default async function HardPathPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  const phone = await partnerFetch<{ exists: boolean; masked: string | null }>(
    `/v1/partner/claims/${stationId}/phone/lookup`,
  );

  const station = await partnerFetch<{ name: string; address: string | null }>(
    `/v1/partner/stations/${stationId}`,
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Manual verification</h1>
      <p className="mb-8 text-sm text-gray-500">{station.name}</p>
      <HardPathPanel stationId={stationId} phone={phone} />
    </main>
  );
}
```

### components/HardPathPanel.tsx (Client Component)

Handles:
- Phone option: "Send code" → masked number shown → code input → POST confirm → redirect to `/login?message=verified&redirect=/station/{id}`
- Document upload: `<input type="file" accept=".pdf,.jpg,.jpeg,.png">` → `fetch POST /v1/partner/claims/{id}/document` (multipart) → success state with "Under review" message
- Loading/error states for both paths

---

## `PartnerModule` updates

```typescript
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    SmsModule,
    BullModule.forFeature([{ name: CLAIM_REMINDER_QUEUE }]),
  ],
  controllers: [PartnerController],
  providers: [PartnerService, ClaimEmailService, ClaimReminderWorker],
  exports: [PartnerService, ClaimEmailService],
})
export class PartnerModule {}
```

---

## Environment Variables

### apps/api — new vars

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=+48...         # Twilio-provided sender number
OPS_EMAIL=ops@desert.app          # recipient for ops alerts and 48h reminders
GOOGLE_PLACES_API_KEY=            # already exists from Story 2.1 — reuse
```

---

## Dev Notes

### Multipart on Fastify
Fastify requires `@fastify/multipart` to be registered before multipart routes are used. Check `apps/api/src/main.ts` — if the photo pipeline already registers it (likely for photo uploads), no additional registration is needed. If not, add:

```typescript
// main.ts
import fastifyMultipart from '@fastify/multipart';
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
```

### Phone lookup: Google Places API v1 (New)
Use the **New Places API** (v1), not the legacy Maps JavaScript API. The endpoint is `https://places.googleapis.com/v1/places/{placeId}?fields=internationalPhoneNumber`. The `GOOGLE_PLACES_API_KEY` is already used for the station sync (Story 2.1) — reuse the same key. No additional OAuth is needed.

### Code re-entrancy on document re-upload
If an owner uploads a document, then uploads again (replaced file), `upsert` updates `document_r2_key` on the existing `StationClaim` record. The old R2 key is overwritten in the DB but the old file remains in R2. For MVP this orphan is acceptable (the amount is tiny). Add a cleanup step on re-upload if desired post-MVP.

### Role upgrade + re-login (phone SMS path)
Same pattern as 7.1's GBP path: after successful phone verification, `confirmPhoneCode` approves the claim and upgrades the role. The controller returns `{ success: true, stationId }`. The client-side `HardPathPanel` detects this and redirects to `/login?message=verified&redirect=/station/{stationId}`. The user logs in again to get a fresh token with `STATION_MANAGER` role.

### Conflict claims: document required
When `initiateConflictClaim` is called, a `CONFLICT` status claim is created. The new claimant should still be directed to upload a document (as evidence for ops to adjudicate). The partner app should show the document upload form after the conflict warning message.

### `initiateClaim` update (Story 7.1 method)
Story 7.1's `initiateClaim` returns `{ outcome: 'already_claimed' }` for APPROVED stations. In Story 7.2, the partner app should check this outcome and, instead of blocking the user, offer the hard path with conflict warning. Update the `ClaimOptionsPanel` (from 7.1) to handle `already_claimed` by showing: "This station already has a verified owner. If you believe you are the rightful owner, submit documentation for our team to review." and linking to the document upload (conflict flow).

On the API side, add a `conflict` path to `initiateClaim`:

```typescript
// In PartnerService.initiateClaim, replace the early return for already_claimed:
if (existingApproved) {
  // Trigger conflict flow — story 7.2 adds this
  await this.initiateConflictClaim(userId, stationId, existingApproved.user_id);
  return { outcome: 'conflict' };
}
```

### Twilio trial account limitation
On a Twilio trial account, SMS can only be sent to verified numbers. For local dev/staging, either use a Twilio test account (logs SMS without sending) or add `TWILIO_DRY_RUN=true` to skip the actual send and log the code instead.

---

## Tasks

- [ ] **Schema:** Add `CONFLICT` to `ClaimStatus` enum; add `document_r2_key`, `phone_last4`, `rejection_reason` to `StationClaim`; run `prisma migrate dev --name add_station_claim_hard_path_fields`
- [ ] **API:** Install `twilio` package: `pnpm add twilio --filter @desert/api`
- [ ] **API:** Create `apps/api/src/sms/sms.service.ts` + `sms.module.ts`
- [ ] **API:** Create `apps/api/src/partner/claim-email.service.ts`
- [ ] **API:** Extend `PartnerService` with phone lookup, SMS send/confirm, document upload, conflict claim methods
- [ ] **API:** Update `PartnerController` with phone and document endpoints
- [ ] **API:** Create `claim-reminder.worker.ts` with BullMQ 48h delayed job
- [ ] **API:** Update `PartnerModule` to import `SmsModule`, `StorageModule`, register `CLAIM_REMINDER_QUEUE`
- [ ] **API:** Create `apps/api/src/admin/admin-claims.controller.ts` with list/document/approve/reject endpoints
- [ ] **API:** Create `RejectClaimDto`; register `AdminClaimsController` in `AdminModule`
- [ ] **API:** Add `TWILIO_*` and `OPS_EMAIL` env vars to `.env.example` and Railway production env
- [ ] **API:** Update `initiateClaim` in `PartnerService` — replace `already_claimed` early return with conflict flow
- [ ] **API:** Verify `@fastify/multipart` is registered in `main.ts` for document upload route
- [ ] **Admin:** Add `ClaimRow` / `ClaimListResult` types to `apps/admin/lib/types.ts`
- [ ] **Admin:** Create `apps/admin/app/(protected)/claims/` with `page.tsx`, `actions.ts`, `[id]/page.tsx`
- [ ] **Admin:** Add "Claims" to admin sidebar nav items and i18n strings (pl/en/uk)
- [ ] **Partner app:** Create `app/(partner)/claim/[stationId]/hard-path/page.tsx`
- [ ] **Partner app:** Create `components/HardPathPanel.tsx` (Client Component — phone flow + document upload)
- [ ] **Partner app:** Update `ClaimOptionsPanel` (from 7.1) to handle `conflict` outcome → show document upload with conflict warning
- [ ] **Sprint status:** Mark 7.2 ready-for-dev in sprint-status.yaml
