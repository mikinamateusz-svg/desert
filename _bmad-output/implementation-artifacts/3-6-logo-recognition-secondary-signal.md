# Story 3.6: Logo Recognition as Secondary Signal

**Status:** review
**Epic:** 3 — Photo Contribution Pipeline
**Created:** 2026-04-02

---

## User Story

As a **developer**,
I want the pipeline to use logo recognition to resolve ambiguous GPS matches only when two stations are close together at similar distances,
So that station attribution is accurate in dense urban areas without wasting cost on unambiguous matches.

**Why:** GPS matching alone is reliable when one station is clearly nearest. Logo recognition is only worth the cost and latency when the match is genuinely ambiguous — two stations within 200m at similar distances. The 50% threshold (nearest must be >50% closer than second nearest to skip logo recognition) was chosen to cover real-world dense urban edge cases while avoiding unnecessary API calls in the vast majority of submissions.

---

## Acceptance Criteria

### AC1 — Skip when only one candidate
**Given** a submission has been GPS-matched with only one station within 200m
**When** the logo recognition step evaluates
**Then** it is skipped entirely — GPS match is unambiguous

### AC2 — Skip when nearest is clearly closer
**Given** a submission has been GPS-matched with two or more stations within 200m
**When** the nearest station is more than 50% closer than the second nearest
**Then** logo recognition is skipped — GPS match is sufficiently clear

*Example: nearest at 60m, second at 140m. Difference = 80m. 50% of 140m = 70m. 80m > 70m → skip.*

### AC3 — Run when match is genuinely ambiguous
**Given** a submission has been GPS-matched with two or more stations within 200m
**When** the nearest station is NOT more than 50% closer than the second nearest
**Then** logo recognition runs to resolve the ambiguity

*Example: nearest at 80m, second at 120m. Difference = 40m. 50% of 120m = 60m. 40m < 60m → run logo recognition.*

### AC4 — Confirmed match: pipeline continues
**Given** logo recognition runs and the result matches the GPS-matched station's brand
**When** confidence is sufficient (>0)
**Then** the match is confirmed, the result is logged, and the pipeline continues

### AC5 — Brand mismatch: flag for ops review
**Given** logo recognition runs and the result contradicts the GPS-matched station's brand
**When** the mismatch is detected
**Then** the submission is flagged for ops review rather than auto-published — not rejected outright
**And** the pipeline continues (Story 3.7 will handle the ops_review status)

### AC6 — Inconclusive: proceed on GPS match
**Given** logo recognition cannot identify a brand (logo not visible, obscured, or unrecognised)
**When** the result is inconclusive (brand is null or confidence is 0)
**Then** the pipeline proceeds using GPS match alone — logo recognition failure is not a rejection reason

### AC7 — API failure: proceed on GPS match
**Given** the logo recognition Claude API call fails (network error, 5xx, timeout)
**When** the failure is caught
**Then** the submission proceeds on GPS match alone and the failure is logged — it does not block the pipeline or trigger a BullMQ retry

---

## Out of Scope (Story 3.6)

- Ops review queue UI — admin panel handled in a separate epic
- Updating `station_id` to a different candidate when logo recognition disagrees with GPS — GPS match is always primary; logo only confirms or flags
- Logo recognition when GPS found zero candidates — not reachable (submission already rejected in Story 3.4)
- Logo recognition for preselected station path (candidates = []) — skip (AC1 covers: single/zero candidates → skip)
- Pipeline cost throttling → Story 3.9
- Dynamic brand lists — brand list is hardcoded in this story; extensible config is a post-MVP concern

---

## Technical Specification

### 1. Key architectural rules

- **Logo recognition is a secondary signal — it never blocks the pipeline.** All failure modes (API error, inconclusive, no logo visible) fall through to: proceed using GPS match.
- **Only run when genuinely ambiguous** — the 50% distance threshold avoids unnecessary Claude calls. Estimated ~10–20% of submissions will actually trigger logo recognition (urban areas with dense station coverage).
- **Use Claude Haiku 4.5** — same model as OCR (Story 3.5). Do NOT use Sonnet. The prompt is simpler than OCR (brand ID vs price extraction).
- **Throw-free step** — unlike OCR (which throws on transient failure to trigger BullMQ retry), logo recognition catches ALL exceptions and logs them. Transient API errors are logged but the pipeline proceeds. Rationale: this is an optional enrichment step; a BullMQ retry would re-run OCR unnecessarily.
- **No new schema migration needed — with a caveat.** The `Submission` model has no field for logo recognition result (brand detected, confidence). The epics spec only mentions flagging for ops review; it does not require storing the logo result on the record. The pipeline logs the brand recognition result and, if there is a mismatch, sets `status: shadow_rejected` (for ops review flagging — see §4 below) or a dedicated flag. See the open question on `status` values.
- **`candidates` variable threading** — this is the key gap from the current worker. `runGpsMatching()` returns `candidates: NearbyStationWithDistance[]` but `processJob` does not pass it to `runOcrExtraction()`. Story 3.5 did not need it (OCR only uses `submission.photo_r2_key`). Logo recognition DOES need `candidates` to evaluate the ambiguity threshold. The fix: pass `candidates` as an argument to `runLogoRecognition()`.
- **`station.brand` field exists** — the `Station` model has a `brand String?` field (populated by Story 2.14 classification). Logo recognition compares the detected brand against `Station.brand` of the GPS-matched station. The worker must fetch the station's brand from the DB (or from the candidates list — see §5).
- **The `photo_r2_key` is still in R2** at this point — Story 3.7 deletes it. Logo recognition reuses the same photo buffer that OCR already fetched, if practical. If not, fetch again from R2 (the key is still valid).
- **Cost:** ~$0.0009/image (Claude Haiku 4.5, same as OCR). This adds up to ~$0.0018/image total for ambiguous cases (~10–20% of all submissions). At 13.5K photos/month mid-case: ~1,350–2,700 logo recognition calls → ~$1.20–$2.43/month additional. Flag this to Mateusz before implementing.

### 2. Files to modify or create

```
apps/api/src/
├── photo/
│   ├── photo-pipeline.worker.ts     MODIFY — add runLogoRecognition(); pass candidates through; inject LogoService
│   └── photo.module.ts              MODIFY — add LogoModule to imports
├── logo/
│   ├── logo.module.ts               CREATE — NestJS module
│   ├── logo.service.ts              CREATE — Claude Haiku brand recognition logic
│   └── logo.service.spec.ts         CREATE — unit tests
```

**No schema migration.** See §4 for how ops-review flagging is handled without a new column.

**No new npm package.** `@anthropic-ai/sdk` is already installed (Story 3.5). `LogoService` uses the same SDK.

### 3. The ambiguity threshold — exact formula

```typescript
function isAmbiguous(candidates: NearbyStationWithDistance[]): boolean {
  if (candidates.length < 2) return false; // AC1: single candidate → skip

  const nearest = candidates[0].distance_m;
  const secondNearest = candidates[1].distance_m;

  // AC2: nearest is >50% closer than second nearest → unambiguous
  // "50% closer" means: (second - nearest) > 50% of second
  // i.e. second - nearest > 0.5 * second
  // i.e. nearest < 0.5 * second
  const isUnambiguous = nearest < 0.5 * secondNearest;
  return !isUnambiguous; // AC3: ambiguous → run logo recognition
}
```

Edge case: `secondNearest === 0` (two stations at the same location — impossible in practice but handle gracefully: return false / skip logo recognition).

### 4. Ops review flagging — status values

**Critical design decision:** The `SubmissionStatus` enum in Prisma currently has: `pending`, `verified`, `rejected`, `shadow_rejected`.

The epics spec (AC5) says: brand mismatch → "flagged for ops review rather than auto-published — not rejected outright." The admin panel story (epics line ~1714) shows ops can view submissions with reason `logo_mismatch`.

**There is no `needs_review` or `ops_review` status in the current schema.**

Two implementation options:

**Option A (recommended for Story 3.6):** Use `shadow_rejected` status with a logged reason of `logo_mismatch`. This is the closest existing status to "held back from publication." The admin panel (future story) can query `status = shadow_rejected` + `rejection_reason = logo_mismatch`. Story 3.7 then skips setting `status: verified` if the status is already `shadow_rejected`.

**Option B:** Add a new `needs_review` value to the `SubmissionStatus` enum and add a `rejection_reason String?` column to `Submission`. This is the more correct data model but requires a schema migration. Defer to Story 3.7, which already owns "final status update."

**This story spec recommends Option A** to avoid a schema migration in Story 3.6. The rejection_reason is logged (not stored in DB) — the ops admin panel is a future epic. Flag as Open Question OQ1.

Regardless of option chosen: if logo recognition determines `logo_mismatch`, the worker updates `status: shadow_rejected` and returns early (pipeline complete, no further steps for this submission). Story 3.7 is NOT called in the mismatch path.

### 5. Fetching station brand for comparison

`NearbyStationWithDistance` (from `station.service.ts`) currently returns: `id`, `name`, `address`, `google_places_id`, `distance_m`. It does NOT return `brand`.

**Option A (recommended):** Add `brand` to `findNearbyWithDistance()` query in `station.service.ts`. No schema change — `brand` already exists on `Station`. This keeps the brand available in-memory from the GPS step without a second DB query.

```sql
-- Add to existing SELECT in findNearbyWithDistance:
brand,
```

Update `NearbyStationWithDistance` interface to add `brand: string | null`.

**Option B:** Fetch the station record separately in `runLogoRecognition()` via `prisma.station.findUnique`. Adds an extra DB round-trip.

Use Option A.

### 6. `LogoService` — create new service

Create `apps/api/src/logo/logo.service.ts`. Do NOT add logo recognition logic to `OcrService` — they are separate concerns with different prompts and retry semantics. `LogoService` shares the same `@anthropic-ai/sdk` package but maintains its own client instance.

```typescript
// apps/api/src/logo/logo.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LogoResult {
  brand: string | null;      // recognised brand key (e.g. 'orlen', 'bp', 'shell') — null if unrecognised
  confidence: number;        // 0.0 – 1.0
  raw_response: string;      // for debugging; not stored in DB
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Polish fuel brand keys — lowercase, normalised.
 * Must match the brand values stored by Story 2.14 classification in Station.brand.
 * Source: Story 2.14 brand list + architecture doc knowledge of Polish fuel market.
 *
 * IMPORTANT: if Story 2.14 uses different casing or spellings, align with that.
 * Check apps/api/src/station/station-classification.service.ts for the authoritative list.
 */
export const KNOWN_BRANDS = [
  'orlen',
  'bp',
  'shell',
  'lotos',       // now rebranded as PKN Orlen but may appear as 'lotos' in DB
  'circle_k',    // formerly Statoil
  'neste',
  'amic',
  'moya',
  'lukoil',
  'total',       // TotalEnergies
] as const;

export type KnownBrand = typeof KNOWN_BRANDS[number];

const LOGO_PROMPT = `You are analyzing a photo taken at a fuel station in Poland.
Your task: identify which fuel station brand/chain this is, based on visible logos, signage, colours, and branding.

Polish fuel station brands to recognise:
- Orlen (red and white, PKN Orlen logo, "ORLEN" text) → "orlen"
- BP (green and yellow shield logo, "bp" text) → "bp"
- Shell (yellow shell logo, "Shell" text) → "shell"
- Lotos (formerly "LOTOS", now often rebranded as Orlen — if the sign still says Lotos) → "lotos"
- Circle K (red and white, circle K logo — formerly Statoil) → "circle_k"
- Neste (green logo, "Neste" text) → "neste"
- Amic (orange and white, "AMIC" text) → "amic"
- Moya (blue and white, "MOYA" text) → "moya"
- Lukoil (red logo, "LUKOIL" text) → "lukoil"
- Total / TotalEnergies (red and white, "Total" text) → "total"

Provide a confidence score from 0.0 to 1.0:
- 1.0: logo is clearly visible and unmistakable
- 0.7–0.9: logo partially visible or slightly obscured but identifiable
- 0.4–0.69: uncertain — logo not clearly visible but branding cues (colour scheme, signage style) suggest a brand
- 0.0–0.39: cannot identify — no logo visible, price board only, interior shot, or unrecognised independent station

Respond ONLY with valid JSON:
{
  "brand": "orlen",
  "confidence": 0.95
}

If the brand cannot be identified, respond with:
{
  "brand": null,
  "confidence": 0.0
}`;

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class LogoService {
  private readonly logger = new Logger(LogoService.name);
  private readonly client: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  /**
   * Identifies the fuel station brand from a photo buffer.
   * Returns { brand: null, confidence: 0 } if the brand cannot be determined.
   * DOES NOT THROW — all API errors are caught and logged. Caller proceeds on GPS match.
   */
  async recogniseBrand(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<LogoResult> {
    try {
      const base64Image = photoBuffer.toString('base64');

      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 128, // brand name + confidence only — much smaller than OCR
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
                text: LOGO_PROMPT,
              },
            ],
          },
        ],
      });

      const rawText =
        response.content[0]?.type === 'text' ? response.content[0].text : '';
      return this.parseResponse(rawText);
    } catch (err) {
      // API errors are NOT re-thrown — logo recognition is optional, never blocks pipeline
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`LogoService: API call failed — ${message}. Proceeding on GPS match.`);
      return { brand: null, confidence: 0, raw_response: '' };
    }
  }

  /**
   * Parses Claude's JSON response for brand recognition.
   * Returns safe defaults on parse failure — never throws.
   */
  parseResponse(rawText: string): LogoResult {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as {
        brand?: string | null;
        confidence?: number;
      };

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.0;

      // Validate brand is one of the known brands (or null)
      const brandRaw = parsed.brand;
      const brand =
        typeof brandRaw === 'string' &&
        (KNOWN_BRANDS as readonly string[]).includes(brandRaw)
          ? brandRaw
          : null;

      if (brandRaw !== null && brandRaw !== undefined && brand === null) {
        this.logger.warn(`LogoService: unknown brand in response: "${brandRaw}" — treating as null`);
      }

      return { brand, confidence, raw_response: rawText };
    } catch {
      this.logger.warn(`LogoService: failed to parse response: ${rawText}`);
      return { brand: null, confidence: 0.0, raw_response: rawText };
    }
  }

  /**
   * Compares detected brand with station's DB brand.
   * Returns 'match' | 'mismatch' | 'inconclusive'.
   * 'inconclusive' when brand is null or confidence is 0.
   */
  evaluateMatch(
    logoResult: LogoResult,
    stationBrand: string | null,
  ): 'match' | 'mismatch' | 'inconclusive' {
    if (!logoResult.brand || logoResult.confidence === 0) {
      return 'inconclusive';
    }
    if (!stationBrand) {
      // Station has no brand (independent or unclassified) — inconclusive
      return 'inconclusive';
    }
    // Normalise: both to lowercase for comparison
    const detected = logoResult.brand.toLowerCase();
    const expected = stationBrand.toLowerCase();

    // Handle the Lotos/Orlen rebrand: both resolve to orlen family
    if (
      (detected === 'lotos' || detected === 'orlen') &&
      (expected === 'lotos' || expected === 'orlen')
    ) {
      return 'match';
    }

    return detected === expected ? 'match' : 'mismatch';
  }
}
```

### 7. `LogoModule` — create

Create `apps/api/src/logo/logo.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LogoService } from './logo.service.js';

@Module({
  providers: [LogoService],
  exports: [LogoService],
})
export class LogoModule {}
```

### 8. `photo.module.ts` — add LogoModule

```typescript
import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { LogoModule } from '../logo/logo.module.js';

@Module({
  imports: [StationModule, StorageModule, OcrModule, LogoModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
```

### 9. `station.service.ts` — add `brand` to `findNearbyWithDistance()`

Add `brand` to the SELECT and to the `NearbyStationWithDistance` interface:

```typescript
// Update interface:
export interface NearbyStationWithDistance {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  brand: string | null;   // ADD — from Station.brand (Story 2.14 classification)
  distance_m: number;
}

// Update query in findNearbyWithDistance — add brand to SELECT:
return this.prisma.$queryRaw<NearbyStationWithDistance[]>`
  SELECT
    id,
    name,
    address,
    google_places_id,
    brand,                    -- ADD THIS LINE
    ST_Distance(location, ST_Point(${lng}, ${lat})::geography) AS distance_m
  FROM "Station"
  WHERE ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
  ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
  LIMIT ${limit}
`;
```

> Note: `brand` is `String?` in the Prisma schema — it can be NULL for unclassified or independent stations. The `NearbyStationWithDistance` interface correctly types it as `string | null`. Existing tests for `findNearbyWithDistance` need their mock results updated to include `brand: null` (or a brand value) to avoid TypeScript errors.

### 10. `photo-pipeline.worker.ts` — add logo recognition step

**Constructor change** — add `LogoService` injection:
```typescript
constructor(
  private readonly config: ConfigService,
  private readonly prisma: PrismaService,
  private readonly stationService: StationService,
  private readonly storageService: StorageService,
  private readonly ocrService: OcrService,
  private readonly logoService: LogoService,  // ADD
) {}
```

**Import to add:**
```typescript
import { LogoService } from '../logo/logo.service.js';
```

**`processJob` — the candidates threading problem:** `candidates` is already in scope in `processJob` after `runGpsMatching()`. Pass it to `runLogoRecognition()`. Also pass `submission` (still needed for `photo_r2_key` and `id`).

**Replace the Story 3.6 stub in `processJob`:**

```typescript
// BEFORE (stub from Story 3.5):
// Stories 3.6 (logo recognition), 3.7 (validation) — stubs
this.logger.log(
  `Submission ${submissionId}: OCR complete — logo/validation deferred to Stories 3.6+`,
);

// AFTER (Story 3.6 implementation):
// Story 3.6: logo recognition (secondary signal — never blocks pipeline)
const logoFlagged = await this.runLogoRecognition(submission, candidates);
if (logoFlagged) {
  return; // submission flagged for ops review — do not proceed to Story 3.7
}

// Story 3.7 stub
this.logger.log(
  `Submission ${submissionId}: logo recognition complete — validation deferred to Story 3.7`,
);
```

**New `runLogoRecognition()` private method:**

```typescript
/**
 * Logo recognition — secondary signal for station disambiguation.
 * Runs ONLY when GPS match is ambiguous (two candidates at similar distances).
 * Never throws — all failures fall through to "proceed on GPS match".
 *
 * Returns true if the submission was flagged for ops review (caller should return).
 * Returns false in all other cases (pipeline continues to Story 3.7).
 *
 * NOTE: Photo is NOT deleted here — Story 3.7 handles deletion.
 */
private async runLogoRecognition(
  submission: Pick<Submission, 'id' | 'photo_r2_key'>,
  candidates: NearbyStationWithDistance[],
): Promise<boolean> {
  // AC1 + AC2: evaluate ambiguity threshold
  if (!this.isAmbiguousMatch(candidates)) {
    this.logger.log(
      `Submission ${submission.id}: logo recognition skipped — GPS match is unambiguous`,
    );
    return false;
  }

  this.logger.log(
    `Submission ${submission.id}: logo recognition running — ` +
    `${candidates.length} candidates, nearest=${candidates[0]?.distance_m.toFixed(0)}m, ` +
    `second=${candidates[1]?.distance_m.toFixed(0)}m`,
  );

  // No photo — skip logo recognition silently (already handled by OCR step's missing_photo check,
  // but guard defensively in case photo_r2_key was nulled between steps)
  if (!submission.photo_r2_key) {
    this.logger.warn(
      `Submission ${submission.id}: logo recognition skipped — photo_r2_key is null`,
    );
    return false;
  }

  // Fetch photo from R2 — catch all errors (logo recognition is optional)
  let photoBuffer: Buffer;
  try {
    photoBuffer = await this.storageService.getObjectBuffer(submission.photo_r2_key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `Submission ${submission.id}: logo recognition — R2 fetch failed: ${message}. Proceeding on GPS match.`,
    );
    return false;
  }

  // Call Claude Haiku for brand recognition (errors caught inside recogniseBrand — returns null brand)
  const logoResult = await this.logoService.recogniseBrand(photoBuffer);

  this.logger.log(
    `Submission ${submission.id}: logo recognition result — ` +
    `brand=${logoResult.brand ?? 'null'}, confidence=${logoResult.confidence.toFixed(2)}`,
  );

  // GPS-matched station's brand (from candidates list — brand was added to findNearbyWithDistance in §9)
  const matchedStationBrand = candidates[0]?.brand ?? null;

  const evaluation = this.logoService.evaluateMatch(logoResult, matchedStationBrand);

  if (evaluation === 'mismatch') {
    // AC5: contradicting signal — flag for ops review
    this.logger.warn(
      `Submission ${submission.id}: logo mismatch — ` +
      `detected "${logoResult.brand}", GPS-matched station brand "${matchedStationBrand}". ` +
      `Flagging for ops review.`,
    );
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.shadow_rejected },
    });
    return true; // flagged — caller returns early
  }

  // AC4: match confirmed, or AC6: inconclusive — both proceed on GPS match
  if (evaluation === 'match') {
    this.logger.log(`Submission ${submission.id}: logo recognition confirmed GPS match`);
  } else {
    this.logger.log(
      `Submission ${submission.id}: logo recognition inconclusive — proceeding on GPS match`,
    );
  }
  return false;
}

/**
 * Returns true if the GPS match is ambiguous (logo recognition should run).
 * Ambiguous = 2+ candidates AND nearest is NOT >50% closer than second nearest.
 */
private isAmbiguousMatch(candidates: NearbyStationWithDistance[]): boolean {
  if (candidates.length < 2) return false;

  const nearest = candidates[0].distance_m;
  const secondNearest = candidates[1].distance_m;

  if (secondNearest === 0) return false; // guard against divide-by-zero (impossible in practice)

  // Unambiguous: nearest is >50% closer than second nearest
  // i.e. nearest < 0.5 * secondNearest
  const isUnambiguous = nearest < 0.5 * secondNearest;
  return !isUnambiguous;
}
```

**Updated `onModuleInit` log line:**
```typescript
this.logger.log('PhotoPipelineWorker initialised (Stories 3.4 GPS + 3.5 OCR + 3.6 Logo active)');
```

### 11. Execution flow after Story 3.6

```
processJob(submissionId)
  │
  ├── fetch Submission from DB (throws → BullMQ retry)
  ├── idempotency check (already non-pending? → return)
  │
  ├── runGpsMatching()             [Story 3.4]
  │     ├── preselected? → null GPS, return []
  │     ├── no GPS? → rejectSubmission('no_gps_coordinates'), return null
  │     ├── no match? → rejectSubmission('no_station_match'), return null
  │     └── match found → update station_id + null GPS, return candidates
  │
  ├── (candidates === null? → return, already rejected)
  │
  ├── runOcrExtraction()           [Story 3.5]
  │     ├── no photo_r2_key? → rejectSubmission('missing_photo'), return false
  │     ├── getObjectBuffer() throws → propagate (BullMQ retry)
  │     ├── extractPrices() throws → propagate (BullMQ retry)
  │     ├── confidence < 0.4? → rejectSubmission('low_ocr_confidence'), return false
  │     ├── prices.length === 0? → rejectSubmission('no_prices_extracted'), return false
  │     ├── price out of band? → rejectSubmission('price_out_of_range'), return false
  │     └── success → update price_data + ocr_confidence_score, return true
  │
  ├── (ocrComplete === false? → return, already rejected)
  │
  ├── runLogoRecognition()         [Story 3.6]
  │     ├── candidates.length < 2? → skip, return false
  │     ├── nearest < 50% of second? → skip (unambiguous), return false
  │     ├── no photo_r2_key? → skip (logged), return false
  │     ├── R2 fetch fails? → log error, proceed, return false
  │     ├── recogniseBrand() fails? → caught inside logoService, returns null brand
  │     ├── evaluation === 'mismatch'? → update status:shadow_rejected, return true
  │     └── match or inconclusive → log, return false
  │
  ├── (logoFlagged === true? → return, flagged for ops review)
  │
  └── [Story 3.7 stub] final validation + status → verified + photo delete
```

---

## Schema Analysis

### No migration required for Story 3.6 — with caveats

The current `Submission` schema (`packages/db/prisma/schema.prisma`):

```
model Submission {
  id                   String
  user_id              String
  station_id           String?
  price_data           Json
  photo_r2_key         String?
  ocr_confidence_score Float?
  gps_lat              Float?
  gps_lng              Float?
  source               PriceSource
  status               SubmissionStatus    ← pending | verified | rejected | shadow_rejected
  created_at           DateTime
  updated_at           DateTime
}
```

**Observations:**
1. No `recognized_brand` field — the logo result is NOT persisted to DB. It is logged only. This is acceptable for MVP.
2. No `rejection_reason` field — the reason (e.g. `logo_mismatch`) is logged but not stored. The admin panel (future story) can infer it from `status = shadow_rejected`.
3. `shadow_rejected` status exists — this is used for ops-review flagging per AC5.

**What Story 3.6 sets on the DB:**
- On mismatch: `status = shadow_rejected` only.
- On match/inconclusive/skip: no DB update.

**Known limitation:** When Story 3.7 is implemented, it needs to check `if submission.status === shadow_rejected → do not overwrite with verified`. Ensure Story 3.7 spec accounts for this.

**`NearbyStationWithDistance` change in `station.service.ts`:** This is an interface change, not a schema migration. The `brand` column already exists on `Station`. No SQL migration needed.

---

## Test Requirements

### `apps/api/src/logo/logo.service.spec.ts` — new file

Mock the Anthropic SDK client (same pattern as `ocr.service.spec.ts`).

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
describe('LogoService')

  describe('recogniseBrand')
    it('calls claude-haiku-4-5 with base64 image and the logo prompt')
    it('uses max_tokens: 128 (smaller than OCR)')
    it('returns parsed brand and confidence on success')
    it('returns { brand: null, confidence: 0 } when API throws — does NOT re-throw')
    it('returns { brand: null, confidence: 0 } when API returns non-text content')
    it('uses image/jpeg media type by default')
    it('accepts image/png media type override')

  describe('parseResponse')
    it('parses valid JSON with known brand and confidence')
    it('returns null brand for unknown brand string')
    it('returns null brand when brand is null in response')
    it('clamps confidence to [0, 1]')
    it('strips markdown code fences before parsing')
    it('returns safe default on JSON parse failure — does not throw')
    it('returns safe default when response is empty string')

  describe('evaluateMatch')
    it('returns "match" when detected brand equals station brand')
    it('returns "mismatch" when detected brand differs from station brand')
    it('returns "inconclusive" when brand is null')
    it('returns "inconclusive" when confidence is 0')
    it('returns "inconclusive" when stationBrand is null (unclassified station)')
    it('returns "match" for lotos/orlen cross-match (rebrand handling)')
    it('returns "match" for orlen/lotos cross-match (rebrand handling)')
    it('is case-insensitive in comparison')
```

### `apps/api/src/photo/photo-pipeline.worker.spec.ts` — extend existing file

Add mock for `LogoService` and extend the existing test module.

**New mock to add:**
```typescript
const mockLogoService = {
  recogniseBrand: jest.fn(),
  evaluateMatch: jest.fn(),
};
```

**Add to `Test.createTestingModule` providers:**
```typescript
{ provide: LogoService, useValue: mockLogoService },
```

**Add import at top of spec:**
```typescript
import { LogoService } from '../logo/logo.service.js';
```

**Default mock return values in `beforeEach`** (safe defaults — most tests use unambiguous candidates so logo recognition is skipped):
```typescript
// Default: logo recognition not needed (single candidate or unambiguous)
// Override in specific logo test blocks
mockLogoService.recogniseBrand.mockResolvedValue({
  brand: 'orlen',
  confidence: 0.9,
  raw_response: '{"brand":"orlen","confidence":0.9}',
});
mockLogoService.evaluateMatch.mockReturnValue('match');
```

**Fixture for ambiguous candidates** (two candidates at similar distances — triggers logo recognition):
```typescript
const ambiguousCandidates: NearbyStationWithDistance[] = [
  { id: 'station-1', name: 'Orlen Krakowska', address: null, google_places_id: null, brand: 'orlen', distance_m: 80 },
  { id: 'station-2', name: 'BP Centrum', address: null, google_places_id: null, brand: 'bp', distance_m: 120 },
];
// 80 vs 120: diff=40, 50% of 120=60, 40 < 60 → ambiguous → logo runs

const unambiguousCandidates: NearbyStationWithDistance[] = [
  { id: 'station-1', name: 'Orlen Krakowska', address: null, google_places_id: null, brand: 'orlen', distance_m: 60 },
  { id: 'station-2', name: 'BP Centrum', address: null, google_places_id: null, brand: 'bp', distance_m: 140 },
];
// 60 vs 140: diff=80, 50% of 140=70, 80 > 70 → unambiguous → skip
```

Also update the existing `mockStationService.findNearbyWithDistance` return values to include `brand: null` (or a brand value) to satisfy the updated `NearbyStationWithDistance` interface.

**New test blocks to add:**

```
describe('processJob — logo recognition step (Story 3.6)')

  describe('ambiguity threshold — skip cases')
    it('skips logo recognition when only one candidate (preselected path — candidates = [])')
    it('skips logo recognition when nearest is >50% closer than second nearest')
    it('does not call recogniseBrand when logo recognition is skipped')
    it('does not call recogniseBrand when GPS matching returned a single unambiguous candidate')

  describe('ambiguity threshold — run cases')
    it('calls recogniseBrand when match is ambiguous (nearest not >50% closer)')
    it('fetches photo from R2 for logo recognition when ambiguous')

  describe('match outcome — confirmed')
    it('does not update status when logo recognition confirms GPS match')
    it('does not set shadow_rejected when evaluateMatch returns "match"')
    it('proceeds to Story 3.7 stub after logo match')

  describe('match outcome — mismatch')
    it('sets status: shadow_rejected when evaluateMatch returns "mismatch"')
    it('returns early (does not reach Story 3.7 stub) on logo mismatch')
    it('does not delete photo from R2 on logo mismatch (Story 3.7 handles deletion)')

  describe('match outcome — inconclusive')
    it('does not update status when logo recognition is inconclusive')
    it('proceeds to Story 3.7 stub when inconclusive')

  describe('failure resilience')
    it('proceeds when R2 fetch fails (logo recognition is optional)')
    it('does not throw when R2 fetch fails')
    it('proceeds when recogniseBrand returns null brand (API failure fallback)')
    it('does not call recogniseBrand when photo_r2_key is null at logo step')

  describe('isAmbiguousMatch helper')
    it('returns false for empty candidates array')
    it('returns false for single candidate')
    it('returns true for two candidates where nearest is NOT >50% closer')
    it('returns false for two candidates where nearest IS >50% closer')
    it('handles secondNearest === 0 without throwing')

  describe('brand field threading')
    it('passes candidates[0].brand to evaluateMatch (not a separate DB lookup)')
    it('handles null brand on GPS-matched station (evaluateMatch returns inconclusive)')

  describe('GPS-rejected path — logo skipped')
    it('does not call recogniseBrand when GPS matching rejected the submission')

  describe('OCR-rejected path — logo skipped')
    it('does not call recogniseBrand when OCR rejected the submission')
```

> Note: The GPS-rejected and OCR-rejected paths are guarded by the existing `candidates === null → return` and `ocrComplete === false → return` checks in `processJob`. Logo step is never reached. Test by mocking the upstream step to reject and asserting `mockLogoService.recogniseBrand` was not called.

### `apps/api/src/station/station.service.spec.ts` — update existing tests

The `findNearbyWithDistance` mock return values in existing tests must be updated to include `brand: null` (or a valid brand string). Existing tests should pass with this minor fixture update — the `brand` field is optional in the sense that SQL can return NULL.

---

## Dev Notes & Guardrails

### Cost awareness — READ BEFORE IMPLEMENTING
- Story 3.6 adds a second Claude Haiku call for ~10–20% of submissions (ambiguous GPS matches in urban areas).
- Estimated additional cost: ~$1.20–$2.43/month at mid-case volume (13.5K photos/month). Total per-submission cost for ambiguous cases: ~$0.0018.
- This is acceptable and within expectations per the architecture doc's cost model.
- Story 3.9 (Pipeline Cost Controls) will add daily caps. Do not implement cost controls in Story 3.6.
- `max_tokens: 128` for logo recognition (vs 512 for OCR) — brand + confidence is a tiny response. This is intentional.

### Polish fuel brands — source of truth
The brand list in `KNOWN_BRANDS` must align with Story 2.14's classification brand list (whatever is stored in `Station.brand`). Before finalising `KNOWN_BRANDS`, check `apps/api/src/station/station-classification.service.ts` (or equivalent from Story 2.14) for the exact brand key strings used. If Story 2.14 uses e.g. `"circle-k"` instead of `"circle_k"`, align to that.

### Lotos/Orlen rebrand handling
Lotos was acquired by PKN Orlen and stations are being rebranded. DB records may have `brand = 'lotos'` (old classification) while the photo shows an Orlen sign (new branding), or vice versa. The `evaluateMatch()` method treats lotos and orlen as equivalent. This logic should be kept and explained in code comments.

### No retry on logo API failure
Unlike OCR (which throws on API failure so BullMQ retries), logo recognition catches all errors and proceeds. This is intentional — logo recognition is a secondary signal. Retrying the entire job just because the logo API timed out would re-run OCR unnecessarily, wasting cost and delaying the pipeline.

### Photo buffer reuse
The worker currently fetches the photo buffer separately for OCR (in `runOcrExtraction`) and would fetch it again for logo recognition (in `runLogoRecognition`). This is two R2 fetches for the same object when logo recognition runs. For MVP this is acceptable — R2 egress is free (Cloudflare R2 zero egress fees). Do not optimise buffer sharing in Story 3.6.

### `shadow_rejected` vs new status
The mismatch path sets `status: shadow_rejected`. This reuses an existing status value to avoid a schema migration. The semantic meaning of `shadow_rejected` expands from "shadow ban" to also include "ops review pending." Story 3.7 and the admin panel story must be aware of this dual use. Flag this to Mateusz when Story 3.7 is written.

### Candidates = [] (preselected station path)
When a user preselects a station (GPS step returns `[]`), `isAmbiguousMatch([])` returns false → logo recognition is skipped. This is correct: a preselected station is the most authoritative signal possible.

### GDPR
No new PII is introduced. The photo buffer is fetched in-memory, sent to Anthropic, and discarded. No GPS coordinates are involved at this stage (already nulled in Story 3.4). The logo recognition result is logged but not persisted.

---

## Open Questions

### OQ1 — `shadow_rejected` dual-use semantics
**Issue:** `shadow_rejected` was originally intended for shadow-banned users' submissions. Story 3.6 repurposes it for "logo mismatch — awaiting ops review." These are different concepts (abuse detection vs data quality review) that may need different handling in the admin panel.
**Recommendation:** Before Story 3.7 is written, decide: add a `rejection_reason String?` column to `Submission` to disambiguate (requires migration), OR keep `shadow_rejected` as a catch-all and filter by logs. For MVP, the log-based approach is acceptable.

### OQ2 — Brand list alignment with Story 2.14
**Issue:** Story 2.14 classification populates `Station.brand`. If the brand key strings in Story 2.14 differ from the KNOWN_BRANDS list in Story 3.6 (`'circle_k'` vs `'circle-k'`, `'total'` vs `'totalenergies'`, etc.), the `evaluateMatch()` comparison will produce false mismatches.
**Action required:** Before submitting Story 3.6 for dev, check `apps/api/src/station/station-classification.service.ts` to confirm the exact brand key strings. Update `KNOWN_BRANDS` and the logo prompt accordingly.

### OQ3 — Photo buffer fetch: once or twice?
**Issue:** OCR (`runOcrExtraction`) fetches the photo buffer from R2. Logo recognition (`runLogoRecognition`) fetches it again. This is two identical R2 GET requests when logo runs.
**Decision for Story 3.6:** Accept the double fetch (R2 egress is free). If profiling shows meaningful latency, a future story can thread the buffer through. Do not over-engineer now.

### OQ4 — What happens when logo mismatch AND Story 3.7 validation passes?
**Issue:** If `status = shadow_rejected`, Story 3.7 must not overwrite it with `verified`. The Story 3.7 spec must explicitly handle this.
**Action:** When writing Story 3.7, add: "If submission.status is already shadow_rejected at the validation step, do not update status — exit early."

---

## Dependencies

- **Story 3.5 complete** ✓ — OCR step runs first; `runLogoRecognition` is inserted after OCR
- **Story 3.4 complete** ✓ — `candidates` list from GPS matching is available in `processJob`
- **Story 2.14 complete** ✓ — `Station.brand` field populated; required for `evaluateMatch()` to function
- **Story 3.7 (Price Validation & DB Update)** — downstream; must handle `shadow_rejected` path (OQ4)
- **Story 3.9 (Pipeline Cost Controls)** — downstream; will add rate caps that apply to both OCR and logo recognition calls
- **Admin Panel (future epic)** — ops review queue UI for `shadow_rejected` submissions with reason `logo_mismatch`
