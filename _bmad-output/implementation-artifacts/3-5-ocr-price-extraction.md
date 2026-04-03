# Story 3.5: OCR Price Extraction

**Status:** ready-for-dev
**Epic:** 3 — Photo Contribution Pipeline
**Created:** 2026-04-02

---

## User Story

As a **developer**,
I want the pipeline worker to extract fuel prices from the submitted photo using Claude Haiku 4.5,
So that price data is automatically populated without any manual review for the majority of submissions.

**Why:** OCR is the core AI capability of the product — validated in the PoC at 80% pass rate (100% on usable images). Claude Haiku 4.5 is the production choice: cost-validated at ~$0.0009/image (~$12/month at mid-case volume of 13.5K photos/month). All PoC failures were composition failures (no price board in frame), not model failures.

---

## Acceptance Criteria

### AC1 — OCR runs after successful GPS matching
**Given** a BullMQ worker has successfully matched a station (Story 3.4)
**When** it runs the OCR step
**Then** it fetches the photo from R2 and sends it to Claude Haiku 4.5 with a prompt to extract fuel prices by type

### AC2 — Successful extraction stores structured price data
**Given** Claude Haiku returns a successful extraction
**When** the response is parsed
**Then** each detected fuel type and its price per litre is stored as structured data (`price_data` JSONB) on the `Submission` record
**And** an `ocr_confidence_score` is recorded alongside the extracted prices

### AC3 — Low confidence triggers rejection
**Given** an OCR confidence score below 40%
**When** the extraction is evaluated
**Then** the submission is marked `status: rejected` with reason `low_ocr_confidence`
**And** the photo is deleted from R2 — no retry attempted

### AC4 — Out-of-range prices flagged for review
**Given** a successful OCR extraction
**When** prices are parsed
**Then** each price is validated against a plausible range for the Polish market (PB_95, PB_98, ON, ON_PREMIUM: 4.00–12.00 PLN/litre; LPG: 2.00–6.00 PLN/litre)
**And** if any extracted price falls outside this range, the submission is marked `status: rejected` with reason `price_out_of_range` (price validation; Story 3.7 extends this to dynamic bands)

### AC5 — Transient Claude API failure triggers BullMQ retry
**Given** the Claude Haiku API is unavailable (network error, 5xx response, timeout)
**When** the OCR step is attempted
**Then** the job throws so BullMQ retries per the existing backoff strategy (30s → 2m → 10m)
**And** the photo is NOT deleted — it must remain in R2 for the retry

### AC6 — No OCR if submission is already rejected
**Given** GPS matching marked the submission as rejected (Story 3.4)
**When** the job reaches the OCR step
**Then** OCR is not called — the `processJob` early-exit pattern from Story 3.4 prevents this

### AC7 — No OCR if photo_r2_key is null
**Given** the submission's `photo_r2_key` is null (photo already deleted or never uploaded)
**When** the OCR step is reached
**Then** the submission is rejected with reason `missing_photo` and the job completes without throwing

---

## Out of Scope (Story 3.5)

- Logo recognition for station disambiguation → **Story 3.6**
- Full price validation with dynamic bands and DB price update → **Story 3.7**
- Pipeline cost throttling (daily/hourly OCR limits) → **Story 3.9**
- Darkness/blur pre-checks on photo → deferred (D5 from Story 3.1, not needed for OCR path)
- MIME type validation on stored photo → deferred from Story 3.3, not blocking OCR

---

## Technical Specification

### 1. Key architectural rules

- **OCR model:** Claude Haiku 4.5 (`claude-haiku-4-5`) — do NOT use a different model. Haiku was PoC-validated; Sonnet is reserved for pump meter OCR (different story).
- **Throw on transient API failure** — Claude 429, 5xx, network timeouts must throw so BullMQ retries. Do not swallow these.
- **Complete (don't throw) on data-quality rejections** — low confidence, missing photo, no prices found. These mark the submission rejected and return.
- **Photo must stay in R2 through retries** — only delete photo in `rejectSubmission()` or on final successful OCR completion (which Story 3.7 handles). Story 3.5 does NOT delete the photo on success — that is Story 3.7's responsibility.
- **price_data shape is validated before storing** — the `price_data` field is `Json` type in Prisma (JSONB in Postgres). Validate the parsed array before writing.
- **No new GDPR concern** — GPS was already nulled in Story 3.4. Photo is in R2 and will be deleted by Story 3.7 after verification. No new PII is introduced.
- **API cost:** ~$0.0009/image at mid-case volume. Do NOT call Claude if submission is already rejected (see AC6, AC7). Story 3.9 will add rate caps — Story 3.5 must not pre-empt that design.

### 2. Files to modify or create

```
apps/api/src/
├── photo/
│   ├── photo-pipeline.worker.ts     MODIFY — add runOcrExtraction() step; inject OcrService
│   └── photo.module.ts              MODIFY — add OcrModule to imports
├── ocr/
│   ├── ocr.module.ts                CREATE — NestJS module
│   ├── ocr.service.ts               CREATE — Claude Haiku client + extraction logic
│   └── ocr.service.spec.ts          CREATE — unit tests
├── storage/
│   └── storage.service.ts           MODIFY — add getObjectBuffer() method
apps/api/.env.example                MODIFY — add ANTHROPIC_API_KEY
```

**No schema changes needed.** `price_data` (Json), `ocr_confidence_score` (Float?), and `status` all exist on `Submission` in `schema.prisma`. `photo_r2_key` (String?) also exists.

**Install required:** `@anthropic-ai/sdk` is not currently in `apps/api/package.json`. Add it:
```
pnpm add @anthropic-ai/sdk --filter @desert/api
```

### 3. `StorageService` — add `getObjectBuffer()`

The existing service has no method to download a file as a Buffer. Add one. Do not modify existing methods.

```typescript
// apps/api/src/storage/storage.service.ts — add this method

import { GetObjectCommand } from '@aws-sdk/client-s3'; // already imported via getPresignedUrl

async getObjectBuffer(key: string): Promise<Buffer> {
  const response = await this.client.send(
    new GetObjectCommand({ Bucket: this.bucket, Key: key }),
  );
  // response.Body is a ReadableStream in Node.js (AWS SDK v3)
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
```

> Note: `response.Body` is typed as `SdkStreamMixin & Readable` in AWS SDK v3 Node.js. The `for await...of` iteration pattern is the canonical approach. No additional cast should be needed with `@types/node` already in devDependencies.

### 4. `OcrService` — full implementation

Create `apps/api/src/ocr/ocr.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedPrice {
  fuel_type: string; // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  price_per_litre: number;
}

export interface OcrResult {
  prices: ExtractedPrice[];
  confidence_score: number; // 0.0 – 1.0
  raw_response: string;     // for debugging; not stored in DB
}

// ── Constants ──────────────────────────────────────────────────────────────

// Plausible Polish market price bands (PLN/litre).
// Source: architecture doc AC4. Story 3.7 extends with dynamic voivodeship bands.
export const PRICE_BANDS: Record<string, { min: number; max: number }> = {
  PB_95:      { min: 4.00, max: 12.00 },
  PB_98:      { min: 4.00, max: 12.00 },
  ON:         { min: 4.00, max: 12.00 },
  ON_PREMIUM: { min: 4.00, max: 12.00 },
  LPG:        { min: 2.00, max: 6.00  },
};

const VALID_FUEL_TYPES = new Set(Object.keys(PRICE_BANDS));

const OCR_PROMPT = `You are analyzing a photo of a fuel station price board in Poland.
Extract all visible fuel prices. For each price you find, return:
- fuel_type: one of PB_95, PB_98, ON, ON_PREMIUM, LPG
- price_per_litre: the price as a decimal number in PLN

Polish fuel labels to recognize:
- "Pb 95", "95", "Benzyna 95" → PB_95
- "Pb 98", "98", "Benzyna 98" → PB_98
- "ON", "Diesel", "Olej napędowy" → ON
- "ON Premium", "Diesel Premium", "V-Power Diesel", "Ultimate Diesel" → ON_PREMIUM
- "LPG", "Autogas" → LPG

Price formats you may encounter: "6,19", "6.19", "6,189", "PLN 6.19", "6.19 PLN/l"
Always return price as a plain decimal (e.g., 6.19).

Also provide a confidence_score from 0.0 to 1.0:
- 1.0: price board is clearly visible, all text sharp, prices unambiguous
- 0.7–0.9: minor blur/angle but prices readable
- 0.4–0.69: some uncertainty (partial occlusion, motion blur, low light)
- 0.0–0.39: cannot reliably read prices (too blurry, no price board visible, wrong subject)

Respond ONLY with valid JSON in this exact format:
{
  "prices": [
    { "fuel_type": "PB_95", "price_per_litre": 6.19 },
    { "fuel_type": "ON", "price_per_litre": 6.49 }
  ],
  "confidence_score": 0.92
}

If no prices are visible, return: { "prices": [], "confidence_score": 0.0 }`;

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly client: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  /**
   * Sends a photo buffer to Claude Haiku 4.5 and extracts fuel prices.
   * Throws on transient API failure (Claude 429, 5xx, network error) — BullMQ retries.
   * Returns OcrResult with empty prices array if no prices found (not a throw).
   */
  async extractPrices(photoBuffer: Buffer, mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<OcrResult> {
    const base64Image = photoBuffer.toString('base64');

    // This call throws on API error — intentional, allows BullMQ retry
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: OCR_PROMPT,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return this.parseResponse(rawText);
  }

  /**
   * Parses Claude's JSON response. Returns a safe default on parse failure
   * (confidence 0.0, empty prices) — do not throw here, let the caller handle
   * low confidence as a rejection.
   */
  parseResponse(rawText: string): OcrResult {
    try {
      // Strip markdown code fences if Claude wraps the JSON
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as {
        prices?: Array<{ fuel_type: string; price_per_litre: number }>;
        confidence_score?: number;
      };

      const confidence_score =
        typeof parsed.confidence_score === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence_score))
          : 0.0;

      const prices: ExtractedPrice[] = [];
      if (Array.isArray(parsed.prices)) {
        for (const item of parsed.prices) {
          if (
            typeof item.fuel_type === 'string' &&
            VALID_FUEL_TYPES.has(item.fuel_type) &&
            typeof item.price_per_litre === 'number' &&
            isFinite(item.price_per_litre) &&
            item.price_per_litre > 0
          ) {
            prices.push({
              fuel_type: item.fuel_type,
              price_per_litre: item.price_per_litre,
            });
          } else {
            this.logger.warn(`OCR: skipping invalid price entry: ${JSON.stringify(item)}`);
          }
        }
      }

      return { prices, confidence_score, raw_response: rawText };
    } catch (err) {
      this.logger.warn(`OCR: failed to parse Claude response: ${rawText}`);
      return { prices: [], confidence_score: 0.0, raw_response: rawText };
    }
  }

  /**
   * Validates extracted prices against Polish market plausibility bands.
   * Returns the first out-of-range fuel type found, or null if all are valid.
   */
  validatePriceBands(prices: ExtractedPrice[]): string | null {
    for (const { fuel_type, price_per_litre } of prices) {
      const band = PRICE_BANDS[fuel_type];
      if (!band) continue; // unknown type already filtered in parseResponse
      if (price_per_litre < band.min || price_per_litre > band.max) {
        return fuel_type;
      }
    }
    return null;
  }
}
```

### 5. `OcrModule` — create

Create `apps/api/src/ocr/ocr.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OcrService } from './ocr.service.js';

@Module({
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
```

### 6. `photo.module.ts` — add OcrModule

```typescript
import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';

@Module({
  imports: [StationModule, StorageModule, OcrModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
```

### 7. `photo-pipeline.worker.ts` — add OCR step

The worker's `processJob` method currently has a stub log after GPS matching. Replace that stub with the OCR step. Inject `OcrService` alongside the existing services.

**Constructor change** — add `OcrService` injection:
```typescript
constructor(
  private readonly config: ConfigService,
  private readonly prisma: PrismaService,
  private readonly stationService: StationService,
  private readonly storageService: StorageService,
  private readonly ocrService: OcrService,   // ADD
) {}
```

**Import to add:**
```typescript
import { OcrService } from '../ocr/ocr.service.js';
```

**`processJob` method** — replace the stub section:

```typescript
// BEFORE (stub from Story 3.4):
// Stories 3.5 (OCR), 3.6 (logo recognition), 3.7 (validation) — stubs
this.logger.log(
  `Submission ${submissionId}: GPS matched to ${candidates[0]?.name ?? 'preselected'} — OCR/logo/validation deferred to Stories 3.5+`,
);

// AFTER (Story 3.5 implementation):
// Story 3.5: OCR price extraction
const ocrComplete = await this.runOcrExtraction(submission);
if (!ocrComplete) {
  return; // rejected inside runOcrExtraction — do not proceed
}

// Stories 3.6 (logo recognition), 3.7 (validation) — stubs
this.logger.log(
  `Submission ${submissionId}: OCR complete — logo/validation deferred to Stories 3.6+`,
);
```

> Note: `submission` is the object fetched at the top of `processJob` — it has `photo_r2_key` needed by the OCR step. No re-fetch needed.

**New `runOcrExtraction()` private method** — add to the worker class:

```typescript
/**
 * Fetches photo from R2, calls Claude Haiku for OCR, validates result.
 * Returns true if OCR succeeded and the submission should proceed.
 * Returns false if the submission was rejected (caller should return).
 * Throws on transient API/infra failure (BullMQ retries).
 *
 * IMPORTANT: does NOT delete the photo on success — that is Story 3.7's responsibility.
 */
private async runOcrExtraction(
  submission: Pick<Submission, 'id' | 'photo_r2_key'>,
): Promise<boolean> {
  // AC7: no photo — reject without calling Claude (saves API cost)
  if (!submission.photo_r2_key) {
    await this.rejectSubmission(submission, 'missing_photo');
    return false;
  }

  // Fetch photo from R2 — throws on S3 error (transient → BullMQ retries)
  const photoBuffer = await this.storageService.getObjectBuffer(submission.photo_r2_key);

  // Call Claude Haiku — throws on API error (transient → BullMQ retries)
  const ocrResult = await this.ocrService.extractPrices(photoBuffer);

  this.logger.log(
    `Submission ${submission.id}: OCR confidence=${ocrResult.confidence_score.toFixed(2)}, ` +
    `prices found=${ocrResult.prices.length}`,
  );

  // AC3: low confidence → reject, delete photo, no retry
  if (ocrResult.confidence_score < 0.4) {
    await this.rejectSubmission(submission, 'low_ocr_confidence');
    return false;
  }

  // AC7 edge case: no prices extracted but confidence is not low (e.g. 0.5 — readable board, no prices visible)
  // Treat as needs_review rather than a hard reject — price board may exist but no fuel types matched our list
  // For MVP: reject to keep data quality high; Story 3.7 may add a needs_review status
  if (ocrResult.prices.length === 0) {
    await this.rejectSubmission(submission, 'no_prices_extracted');
    return false;
  }

  // AC4: validate price bands
  const invalidFuelType = this.ocrService.validatePriceBands(ocrResult.prices);
  if (invalidFuelType) {
    this.logger.warn(
      `Submission ${submission.id}: price out of range for ${invalidFuelType} — rejecting`,
    );
    await this.rejectSubmission(submission, 'price_out_of_range');
    return false;
  }

  // AC2: store extracted prices and confidence score
  // price_data shape: [{ fuel_type: string, price_per_litre: number }]
  // Note: do NOT change status to 'verified' here — Story 3.7 does that after full validation
  await this.prisma.submission.update({
    where: { id: submission.id },
    data: {
      price_data: ocrResult.prices,
      ocr_confidence_score: ocrResult.confidence_score,
    },
  });

  return true;
}
```

**Updated `onModuleInit` log line** — update the initialisation message to reflect 3.5 is active:
```typescript
this.logger.log('PhotoPipelineWorker initialised (Stories 3.4 GPS + 3.5 OCR active)');
```

### 8. `.env.example` — add Anthropic key

Add to `apps/api/.env.example`:
```
# Anthropic Claude API (for OCR price extraction — Story 3.5)
# Get key at: https://console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key
```

### 9. Execution flow after Story 3.5

```
processJob(submissionId)
  │
  ├── fetch Submission from DB (throws → BullMQ retry)
  ├── idempotency check (already non-pending? → return)
  │
  ├── runGpsMatching()             [Story 3.4]
  │     ├── preselected? null GPS, return []
  │     ├── no GPS? rejectSubmission('no_gps_coordinates') → return null
  │     ├── no match? rejectSubmission('no_station_match') → return null
  │     └── match found → update station_id + null GPS, return candidates
  │
  ├── (candidates === null? → return, already rejected)
  │
  ├── runOcrExtraction()           [Story 3.5]
  │     ├── no photo_r2_key? rejectSubmission('missing_photo') → return false
  │     ├── getObjectBuffer() throws → propagate (BullMQ retry)
  │     ├── extractPrices() throws → propagate (BullMQ retry)
  │     ├── confidence < 0.4? rejectSubmission('low_ocr_confidence') → return false
  │     ├── prices.length === 0? rejectSubmission('no_prices_extracted') → return false
  │     ├── price out of band? rejectSubmission('price_out_of_range') → return false
  │     └── success → update price_data + ocr_confidence_score, return true
  │
  ├── (ocrComplete === false? → return, already rejected)
  │
  ├── [Story 3.6 stub] logo recognition
  └── [Story 3.7 stub] final validation + status → verified + photo delete
```

### 10. `rejectSubmission()` — already handles photo deletion

The existing `rejectSubmission()` private method in the worker already:
- Sets `status: rejected`
- Nulls `gps_lat`/`gps_lng`
- Deletes the R2 photo (best-effort, catch logged)

No changes needed to this method. It handles all rejection reasons from Story 3.5 correctly.

---

## Test Requirements

### `apps/api/src/ocr/ocr.service.spec.ts` — new file

Mock the Anthropic SDK client. Do not make real API calls.

```typescript
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));
```

**Test cases:**

```
describe('OcrService')

  describe('extractPrices')
    it('calls claude-haiku-4-5 with base64 image and structured prompt')
    it('returns parsed prices and confidence score on success')
    it('throws when Anthropic API returns an error (allows BullMQ retry)')
    it('encodes photoBuffer as base64 in the API request')
    it('uses image/jpeg media type by default')
    it('accepts image/png media type override')

  describe('parseResponse')
    it('parses valid JSON response with multiple fuel types')
    it('returns confidence 0.0 and empty prices on JSON parse failure')
    it('strips markdown code fences before parsing')
    it('filters out unknown fuel types')
    it('filters out prices with non-numeric price_per_litre')
    it('filters out prices where price_per_litre is 0 or negative')
    it('filters out prices where price_per_litre is Infinity')
    it('clamps confidence_score to [0, 1] range')
    it('returns empty prices array when prices field is missing')
    it('returns empty prices array when prices is not an array')

  describe('validatePriceBands')
    it('returns null when all prices are within bands')
    it('returns fuel_type when PB_95 price is below 4.00')
    it('returns fuel_type when PB_95 price is above 12.00')
    it('returns fuel_type when LPG price is above 6.00')
    it('returns null for empty prices array')
    it('ignores unknown fuel types not in PRICE_BANDS')
```

### `apps/api/src/photo/photo-pipeline.worker.spec.ts` — extend existing file

Add to the existing test file. The `capturedProcessor` pattern is already established. Add mock for `OcrService` and extend `pendingSubmission` fixture as needed.

**New mock to add:**
```typescript
const mockOcrService = {
  extractPrices: jest.fn(),
  validatePriceBands: jest.fn(),
};
```

**Add to `Test.createTestingModule` providers:**
```typescript
{ provide: OcrService, useValue: mockOcrService },
```

**Add import at top of spec:**
```typescript
import { OcrService } from '../ocr/ocr.service.js';
```

**Default mock return values in `beforeEach`** (safe defaults so GPS tests are unaffected):
```typescript
mockOcrService.extractPrices.mockResolvedValue({
  prices: [{ fuel_type: 'PB_95', price_per_litre: 6.19 }],
  confidence_score: 0.92,
  raw_response: '{"prices":[...],"confidence_score":0.92}',
});
mockOcrService.validatePriceBands.mockReturnValue(null); // all prices in range
mockStorageService.getObjectBuffer = jest.fn().mockResolvedValue(Buffer.from('fake-image'));
```

> Important: `mockStorageService` already exists but only has `deleteObject`. Add `getObjectBuffer` to it.

**New test blocks to add:**

```
describe('processJob — OCR step (Story 3.5)')

  describe('successful OCR')
    it('calls getObjectBuffer with the submission photo_r2_key')
    it('calls extractPrices with the photo buffer')
    it('updates price_data and ocr_confidence_score on the Submission')
    it('does NOT delete R2 photo on OCR success (Story 3.7 handles deletion)')
    it('does NOT change status to verified (Story 3.7 handles verification)')

  describe('low confidence rejection')
    it('rejects submission when confidence_score < 0.4')
    it('deletes photo from R2 on low-confidence rejection')
    it('completes job without throwing on low confidence')
    it('does not update price_data when confidence is low')

  describe('no prices extracted')
    it('rejects submission when prices array is empty')
    it('deletes photo from R2 on no-prices rejection')
    it('completes job without throwing when no prices found')

  describe('price out of range')
    it('rejects submission when validatePriceBands returns a fuel type')
    it('deletes photo from R2 on price-out-of-range rejection')
    it('completes job without throwing on price range rejection')

  describe('missing photo_r2_key')
    it('rejects submission without calling Claude when photo_r2_key is null')
    it('does not call getObjectBuffer when photo_r2_key is null')
    it('completes job without throwing on missing photo')

  describe('transient OCR failure')
    it('throws when getObjectBuffer fails so BullMQ retries')
    it('throws when extractPrices throws so BullMQ retries')
    it('does NOT delete photo when extractPrices throws (photo needed for retry)')

  describe('OCR skipped for already-rejected submission')
    it('does not call extractPrices when GPS matching rejected the submission')
```

> Note: The GPS-rejected path (candidates === null → early return) means OCR is never reached. Test this by mocking `findNearbyWithDistance` to return `[]` and asserting `mockOcrService.extractPrices` was not called.

---

## Dev Notes & Guardrails

### API cost
- **~$0.0009 per image** (Claude Haiku 4.5) — verified in PoC, ~$12/month at 13.5K photos/month mid-case volume.
- Do NOT switch to `claude-sonnet-4-6` — that is reserved for pump meter OCR (fill-up flow, different story). Sonnet is ~10x more expensive for price board extraction where Haiku is sufficient.
- Story 3.9 (Pipeline Cost Controls) will add daily/hourly OCR caps. Do not implement cost controls here — but do not call OCR if already rejected (AC6, AC7) as this is a correctness requirement independent of cost controls.

### Anthropic SDK
- `@anthropic-ai/sdk` is not yet installed. Must be added via `pnpm add @anthropic-ai/sdk --filter @desert/api`.
- Initialise the client once in `OcrService` constructor (not in `onModuleInit`) — the SDK does not need async setup. `ConfigService` is available via NestJS DI in the constructor.
- The SDK throws `Anthropic.APIError` on 4xx/5xx responses. Let these propagate — BullMQ will retry.
- `claude-haiku-4-5` is the correct model ID string for the Anthropic messages API.

### StorageService — getObjectBuffer gap
- The existing `StorageService` has `uploadBuffer`, `deleteObject`, `getPresignedUrl` but no method to download a file as a Buffer. The new `getObjectBuffer()` method uses the AWS SDK v3 streaming pattern (`for await...of` on `response.Body`).
- `response.Body` from `GetObjectCommand` in Node.js is `Readable & SdkStreamMixin`. The stream is async iterable. Do NOT use `.pipe()` — use the `for await` pattern shown above.
- R2 is S3-compatible — `GetObjectCommand` works identically against R2 and AWS S3.

### price_data JSON shape
- Prisma schema: `price_data Json` (JSONB in Postgres). This stores any JSON value.
- Story 3.3 seeds it as `[{ fuel_type: 'PB_95', price_per_litre: null }]` (mobile-submitted fuel type with null price pre-OCR).
- Story 3.5 overwrites it with the OCR result: `[{ fuel_type: 'PB_95', price_per_litre: 6.19 }]`.
- Do not merge with the existing array — replace entirely with OCR output. The mobile-submitted fuel type hint is an input signal to the prompt but we trust OCR output over it.
- Valid `fuel_type` values: `'PB_95'`, `'PB_98'`, `'ON'`, `'ON_PREMIUM'`, `'LPG'` — these match `StationFuelStaleness.fuel_type` and `PriceHistory.fuel_type` column values in the schema.

### Retry semantics recap
| Failure type | Action |
|---|---|
| Claude 429 / 5xx / network timeout | Throw → BullMQ retries (30s → 2m → 10m) |
| R2 GetObject failure | Throw → BullMQ retries |
| JSON parse failure from Claude | Return confidence 0.0 → rejection path (no retry) |
| Confidence < 0.4 | Mark rejected, delete photo, return false (no throw) |
| No prices extracted | Mark rejected, delete photo, return false (no throw) |
| Price out of range | Mark rejected, delete photo, return false (no throw) |
| photo_r2_key is null | Mark rejected, return false (no throw, no R2 delete) |

### GDPR note
- No new PII introduced in Story 3.5. GPS was already nulled in Story 3.4.
- Photo is fetched from R2 in-memory and sent to Anthropic's API. Anthropic's API does not persist input data beyond the request (verify in Anthropic's data processing terms). No additional GDPR concern vs using any other external API.
- Photo deletion on rejection is handled by the existing `rejectSubmission()` method.

### BullMQ and idempotency
- The idempotency check (`if submission.status !== pending → skip`) at the top of `processJob` protects against duplicate job delivery. If a job is retried after a successful `price_data` update (before the job completes), the worker will skip processing silently. This is safe because the status remains `pending` until Story 3.7 sets it to `verified`.
- Consider: if `price_data` is updated but the job crashes before completing, on retry the OCR will run again (same photo, same Claude call). This is fine — idempotent by nature (same image → same result), just wastes one Claude call per crash mid-step.

---

## Open Questions / Assumptions

### Q1 — `no_prices_extracted` path: reject or needs_review?
**Assumption (for Story 3.5):** Reject. A readable photo (confidence ≥ 0.4) with no recognisable prices is likely a non-price-board photo that passed GPS matching. Rejecting is safe. If ops data shows high false-positive rejection of valid photos, Story 3.7 can introduce a `needs_review` status.

### Q2 — Anthropic data processing terms
**Assumption:** Anthropic does not retain API message content for training purposes (enterprise API). Confirm before production launch. Not blocking for PoC/MVP.

### Q3 — `media_type` for photos stored in R2
**Assumption:** All photos stored by Story 3.3 are JPEG (`image/jpeg`). The `photo_r2_key` uses `.jpg` extension (hardcoded in Story 3.3). The `extractPrices` method defaults to `'image/jpeg'` accordingly. If MIME type is later stored on the Submission record (deferred from Story 3.3), pass it through.

### Q4 — Maximum image size for Anthropic API
**Assumption:** Photos are pre-compressed client-side to ~200–500KB (1920px max, 75% JPEG quality per architecture doc). This is well within Anthropic's image size limits (~5MB per image base64-encoded). No server-side re-compression needed.

---

## Dependencies

- **Story 3.4 complete** ✓ — GPS matching step runs first; `station_id` is set before OCR
- **Story 3.3 complete** ✓ — `photo_r2_key` is stored on Submission; `StorageService` exists
- **Story 3.9 (Pipeline Cost Controls)** — downstream; Story 3.5 is a prerequisite for cost controls
- **Story 3.7 (Price Validation & DB Update)** — downstream; Story 3.5 stores raw OCR output, Story 3.7 does final validation and sets `status: verified`
- **Story 3.6 (Logo Recognition)** — downstream; runs after OCR step
