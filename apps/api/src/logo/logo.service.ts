import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LogoResult {
  brand: string | null;  // recognised brand key (e.g. 'orlen', 'bp') — null if unrecognised
  confidence: number;    // 0.0 – 1.0
  raw_response: string;  // for debugging; not stored in DB
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Polish fuel brand keys — lowercase, normalised.
 * Must match the brand values stored by Story 2.14 classification in Station.brand.
 * Source: apps/api/src/station/config/brand-patterns.ts
 */
export const KNOWN_BRANDS = [
  'orlen',
  'bp',
  'shell',
  'lotos',       // now rebranded as PKN Orlen but may appear as 'lotos' in DB
  'circle_k',    // formerly Statoil
  'amic',
  'moya',
  'huzar',
  'auchan',
  'carrefour',
] as const;

export type KnownBrand = (typeof KNOWN_BRANDS)[number];

const LOGO_PROMPT = `You are analyzing a photo taken at a fuel station in Poland.
Your task: identify which fuel station brand/chain this is, based on visible logos, signage, colours, and branding.

Polish fuel station brands to recognise:
- Orlen (red and white, PKN Orlen logo, "ORLEN" text) → "orlen"
- BP (green and yellow shield logo, "bp" text) → "bp"
- Shell (yellow shell logo, "Shell" text) → "shell"
- Lotos (formerly "LOTOS", now often rebranded as Orlen — if the sign still says Lotos) → "lotos"
- Circle K (red and white, circle K logo — formerly Statoil) → "circle_k"
- Amic (orange and white, "AMIC" text) → "amic"
- Moya (blue and white, "MOYA" text) → "moya"
- Huzar ("HUZAR" text) → "huzar"
- Auchan (hypermarket fuel station) → "auchan"
- Carrefour (hypermarket fuel station) → "carrefour"

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
      this.logger.error(
        `LogoService: API call failed — ${message}. Proceeding on GPS match.`,
      );
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

      const brandRaw = parsed.brand;
      const brand =
        typeof brandRaw === 'string' &&
        (KNOWN_BRANDS as readonly string[]).includes(brandRaw)
          ? brandRaw
          : null;

      if (brandRaw !== null && brandRaw !== undefined && brand === null) {
        this.logger.warn(
          `LogoService: unknown brand in response: "${brandRaw}" — treating as null`,
        );
      }

      return { brand, confidence, raw_response: rawText };
    } catch {
      this.logger.warn(`LogoService: failed to parse response: ${rawText}`);
      return { brand: null, confidence: 0.0, raw_response: rawText };
    }
  }

  /**
   * Compares detected brand with the GPS-matched station's DB brand.
   * Returns 'match' | 'mismatch' | 'inconclusive'.
   * 'inconclusive' when brand is null, confidence < 0.4, or station has no brand.
   */
  evaluateMatch(
    logoResult: LogoResult,
    stationBrand: string | null,
  ): 'match' | 'mismatch' | 'inconclusive' {
    if (!logoResult.brand || logoResult.confidence < 0.4) {
      // confidence < 0.4 mirrors the OCR threshold — "cannot identify" band in the prompt
      return 'inconclusive';
    }
    if (!stationBrand) {
      // Station has no brand (independent or unclassified) — inconclusive
      return 'inconclusive';
    }

    const detected = logoResult.brand.toLowerCase();
    const expected = stationBrand.toLowerCase();

    // Handle the Lotos/Orlen rebrand: stations may show Orlen sign but still have 'lotos' in DB
    if (
      (detected === 'lotos' || detected === 'orlen') &&
      (expected === 'lotos' || expected === 'orlen')
    ) {
      return 'match';
    }

    return detected === expected ? 'match' : 'mismatch';
  }
}
