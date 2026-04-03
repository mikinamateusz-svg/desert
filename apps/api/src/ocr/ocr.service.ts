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
  raw_response: string; // for debugging; not stored in DB
  input_tokens: number; // Claude API usage — for spend tracking (Story 3.9)
  output_tokens: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

// Plausible Polish market price bands (PLN/litre).
// Source: architecture doc AC4. Story 3.7 extends with dynamic voivodeship bands.
export const PRICE_BANDS: Record<string, { min: number; max: number }> = {
  PB_95: { min: 4.0, max: 12.0 },
  PB_98: { min: 4.0, max: 12.0 },
  ON: { min: 4.0, max: 12.0 },
  ON_PREMIUM: { min: 4.0, max: 12.0 },
  LPG: { min: 2.0, max: 6.0 },
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
   * Returns OcrResult with confidence 0.0 on Anthropic 4xx (non-retriable bad request).
   * Returns OcrResult with empty prices array if no prices found (not a throw).
   */
  async extractPrices(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<OcrResult> {
    const base64Image = photoBuffer.toString('base64');

    let response: Awaited<ReturnType<typeof this.client.messages.create>>;
    try {
      response = await this.client.messages.create({
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
    } catch (err: unknown) {
      // 4xx errors are non-retriable (bad request, invalid image, etc.)
      // Return confidence 0.0 so the low_ocr_confidence path rejects gracefully.
      // 5xx / network errors still throw → BullMQ retries.
      const httpStatus = (err as { status?: number }).status;
      // 429 Too Many Requests is retriable — BullMQ will back off and retry.
      if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) {
        const message = (err as Error).message ?? String(err);
        this.logger.warn(
          `OCR: Anthropic ${httpStatus} error — non-retriable, rejecting submission: ${message}`,
        );
        return { prices: [], confidence_score: 0.0, raw_response: message, input_tokens: 0, output_tokens: 0 };
      }
      throw err;
    }

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const result = this.parseResponse(rawText);
    return {
      ...result,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }

  /**
   * Parses Claude's JSON response. Returns a safe default on parse failure
   * (confidence 0.0, empty prices) — do not throw here, let the caller handle
   * low confidence as a rejection.
   */
  parseResponse(rawText: string): OcrResult {
    try {
      // Strip markdown code fences if Claude wraps the JSON
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
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

      return { prices, confidence_score, raw_response: rawText, input_tokens: 0, output_tokens: 0 };
    } catch {
      this.logger.warn(`OCR: failed to parse Claude response: ${rawText}`);
      return { prices: [], confidence_score: 0.0, raw_response: rawText, input_tokens: 0, output_tokens: 0 };
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
