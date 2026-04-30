import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedPrice {
  fuel_type: string; // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  price_per_litre: number;
}

export interface OcrResult {
  prices: ExtractedPrice[];
  confidence_score: number; // 0.0 – 1.0
  raw_response: string; // for debugging; not stored in DB
  input_tokens: number; // Gemini API usage — for spend tracking (Story 3.9)
  output_tokens: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
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

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash';

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
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
  }

  /**
   * Sends a photo buffer to Gemini Flash and extracts fuel prices.
   * Throws on transient API failure (429, 5xx, network error) — BullMQ retries.
   * Returns OcrResult with confidence 0.0 on non-retriable 4xx errors.
   * Returns OcrResult with empty prices array if no prices found (not a throw).
   */
  async extractPrices(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<OcrResult> {
    const base64Image = photoBuffer.toString('base64');
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: mediaType, data: base64Image } },
              { text: OCR_PROMPT },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.0,
          },
        }),
      });
    } catch (err: unknown) {
      // Network / DNS error — throw for BullMQ retry
      throw err;
    }

    if (!res.ok) {
      const httpStatus = res.status;
      const body = await res.text();
      // 429 Too Many Requests is retriable — BullMQ will back off and retry.
      // 5xx server errors are also retriable.
      if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) {
        this.logger.warn(`OCR: Gemini ${httpStatus} — non-retriable, rejecting submission: ${body}`);
        return { prices: [], confidence_score: 0.0, raw_response: body, input_tokens: 0, output_tokens: 0 };
      }
      throw new Error(`Gemini ${httpStatus}: ${body}`);
    }

    const responseBody = (await res.json()) as GeminiResponse;
    const rawText = responseBody.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const result = this.parseResponse(rawText);
    return {
      ...result,
      input_tokens: responseBody.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: responseBody.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  /**
   * Parses Gemini's JSON response. Returns a safe default on parse failure
   * (confidence 0.0, empty prices) — do not throw here, let the caller handle
   * low confidence as a rejection.
   */
  parseResponse(rawText: string): OcrResult {
    try {
      // Strip markdown code fences if the model wraps the JSON
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
      this.logger.warn(`OCR: failed to parse Gemini response: ${rawText}`);
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
