import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type FillupFuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

export interface FillupOcrResult {
  totalCostPln: number | null;
  litres: number | null;
  pricePerLitrePln: number | null;
  fuelTypeSuggestion: FillupFuelType | null;
  /**
   * 0.0 – 1.0. Caller advances to confirmation when >= 0.6 AND all three
   * required values (totalCostPln/litres/pricePerLitrePln) are present;
   * otherwise falls back to manual entry.
   */
  confidence: number;
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

const VALID_FUEL_TYPES: ReadonlySet<string> = new Set([
  'PB_95',
  'PB_98',
  'ON',
  'ON_PREMIUM',
  'LPG',
]);

// 10s wall-clock cap per AC10. The mobile client expects to never wait
// longer than this for the OCR endpoint; on abort we return confidence: 0
// so the user is routed straight to manual entry.
const GEMINI_TIMEOUT_MS = 10_000;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Match the price-board OCR model (Story 3.5) — single Gemini Flash for all
// vision tasks lets us share spend tracking constants in OcrSpendService
// (which were already keyed to Gemini Flash rates). Switched from Claude
// Haiku 4.5 on 2026-05-02; Mateusz to benchmark against Haiku later when
// pump-meter ground-truth photos are collected. See memory:
// project_vision_model_refactor.md for the eventual shared-helper plan.
const GEMINI_MODEL = 'gemini-2.5-flash';

const PUMP_METER_OCR_PROMPT = `You are reading a fuel pump meter display.

Extract exactly three values from the display:
- "totalCostPln": the total amount paid in Polish złoty (the largest number, typically labelled "Suma", "Do zapłaty", or "PLN")
- "litres": volume dispensed in litres (typically labelled "Ilość", "Litry", or "L")
- "pricePerLitrePln": price per litre in PLN/L (typically labelled "Cena", "PLN/L", or "zł/L")
- "fuelTypeSuggestion": one of "PB_95", "PB_98", "ON", "ON_PREMIUM", "LPG" if visible on the display — otherwise null
- "confidence": your certainty 0.0–1.0
    0.9–1.0: all three values clearly readable, sharp display
    0.6–0.89: values readable but some blur or partial occlusion
    0.0–0.59: unable to reliably extract one or more required values

If you cannot reliably read all three required values, set each unreadable field to null.

Return only valid JSON — no markdown, no code fences:
{"totalCostPln": number|null, "litres": number|null, "pricePerLitrePln": number|null, "fuelTypeSuggestion": string|null, "confidence": number}`;

// ── Service ────────────────────────────────────────────────────────────────

/**
 * Sends a pump meter photo to Gemini Flash and extracts cost/volume/price/fuel.
 *
 * NEVER throws — all errors (timeout, network, parse failure, low confidence,
 * spend cap reached) collapse to `{ confidence: 0, ...nulls }` so the
 * controller can return 200 and the mobile client routes the user to manual
 * entry per AC9 / AC10.
 *
 * Spend tracking shares the daily cap with the price-board OCR pipeline
 * (both go through `OcrSpendService.recordSpend`). Cost computation uses
 * `computeCostUsd` directly since both pipelines now use the same Gemini
 * Flash rates.
 */
@Injectable()
export class FillupOcrService {
  private readonly logger = new Logger(FillupOcrService.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly spend: OcrSpendService,
  ) {
    this.apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
  }

  async extractFromPumpMeter(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<FillupOcrResult> {
    // Spend-cap precheck (P-2 from Story 5.2 CR). Per project memory
    // `project_ocr_spend_cap.md` the daily cap is a hard, fail-closed kill
    // switch. Bail BEFORE the paid call when the day's spend is already at
    // or above the cap. Fail-open on Redis blip so infra outage doesn't
    // block the entire OCR feature.
    try {
      const [dailySpend, spendCap] = await Promise.all([
        this.spend.getDailySpend(),
        this.spend.getSpendCap(),
      ]);
      if (Number.isFinite(dailySpend) && Number.isFinite(spendCap) && dailySpend >= spendCap) {
        this.logger.warn(
          `FillupOcr: daily spend cap reached ($${dailySpend.toFixed(2)} / $${spendCap.toFixed(2)}) — refusing to call Gemini, returning empty result.`,
        );
        return this.emptyResult();
      }
    } catch (e) {
      this.logger.warn(
        `FillupOcr: spend-cap precheck failed (${e instanceof Error ? e.message : String(e)}) — proceeding fail-open to avoid blocking the OCR feature on a Redis blip.`,
      );
    }

    try {
      const base64Image = photoBuffer.toString('base64');
      const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: mediaType, data: base64Image } },
                { text: PUMP_METER_OCR_PROMPT },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            // Deterministic decoding for OCR — temperature 0 gives the
            // model's most-confident reading every time. Same as price-
            // board OCR.
            temperature: 0.0,
          },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `FillupOcr: Gemini ${res.status} — falling back to manual: ${body.slice(0, 200)}`,
        );
        return this.emptyResult();
      }

      const responseBody = (await res.json()) as GeminiResponse;
      const inputTokens = responseBody.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = responseBody.usageMetadata?.candidatesTokenCount ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        // OcrSpendService.computeCostUsd is keyed to Gemini Flash rates
        // (matches the model we use here), so we can call it directly
        // instead of pre-computing per-model rates as the previous Haiku
        // implementation had to do. Best-effort recordSpend — never fail
        // an OCR call because spend tracking blipped.
        const costUsd = this.spend.computeCostUsd(inputTokens, outputTokens);
        void this.spend.recordSpend(costUsd).catch((e) =>
          this.logger.warn(
            `recordSpend failed (Gemini $${costUsd.toFixed(4)}): ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      } else {
        this.logger.warn('FillupOcr: response.usageMetadata missing token counts — skipping spend record.');
      }

      const rawText =
        responseBody.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return this.parseResponse(rawText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FillupOcr: API call failed — ${message}. Falling back to manual.`);
      return this.emptyResult();
    }
  }

  /**
   * Parses Gemini's JSON response. Returns the empty result on any parse
   * failure or missing required value — never throws. The controller surfaces
   * `confidence: 0` to the mobile client which then routes to manual entry.
   */
  parseResponse(rawText: string): FillupOcrResult {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const totalCostPln = this.coerceNumber(parsed['totalCostPln']);
      const litres = this.coerceNumber(parsed['litres']);
      const pricePerLitrePln = this.coerceNumber(parsed['pricePerLitrePln']);

      const fuelRaw = parsed['fuelTypeSuggestion'];
      const fuelTypeSuggestion =
        typeof fuelRaw === 'string' && VALID_FUEL_TYPES.has(fuelRaw)
          ? (fuelRaw as FillupFuelType)
          : null;

      const confRaw = parsed['confidence'];
      const confidence =
        typeof confRaw === 'number' && Number.isFinite(confRaw)
          ? Math.max(0, Math.min(1, confRaw))
          : 0;

      return { totalCostPln, litres, pricePerLitrePln, fuelTypeSuggestion, confidence };
    } catch {
      this.logger.warn(`FillupOcr: failed to parse response: ${rawText.slice(0, 200)}`);
      return this.emptyResult();
    }
  }

  private coerceNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return value;
  }

  private emptyResult(): FillupOcrResult {
    return {
      totalCostPln: null,
      litres: null,
      pricePerLitrePln: null,
      fuelTypeSuggestion: null,
      confidence: 0,
    };
  }
}
