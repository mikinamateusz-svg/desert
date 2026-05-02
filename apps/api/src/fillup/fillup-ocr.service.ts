import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_FUEL_TYPES: ReadonlySet<string> = new Set([
  'PB_95',
  'PB_98',
  'ON',
  'ON_PREMIUM',
  'LPG',
]);

// Claude Haiku 4.5 pricing — input $1/M, output $5/M (USD).
// Independent from the Gemini-rate constants in OcrSpendService so cost
// tracking stays accurate regardless of which model a call uses.
const HAIKU_INPUT_USD_PER_MTOKEN = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOKEN = 5.0;

// 10s wall-clock cap per AC10. The mobile client expects to never wait
// longer than this for the OCR endpoint; on abort we return confidence: 0
// so the user is routed straight to manual entry.
const HAIKU_TIMEOUT_MS = 10_000;

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

@Injectable()
export class FillupOcrService {
  private readonly logger = new Logger(FillupOcrService.name);
  private readonly client: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly spend: OcrSpendService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  /**
   * Sends a pump meter photo to Claude Haiku and extracts cost/volume/price/fuel.
   *
   * NEVER throws — all errors (timeout, network, parse failure, low confidence)
   * collapse to `{ confidence: 0, ...nulls }` so the controller can return 200
   * and the mobile client routes the user to manual entry per AC9 / AC10.
   */
  async extractFromPumpMeter(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<FillupOcrResult> {
    // Spend-cap precheck (P-2). Per project memory `project_ocr_spend_cap.md`
    // the daily cap is a hard, fail-closed kill switch. The original
    // implementation called Anthropic unconditionally and only recorded spend
    // afterwards — a burst could blow past the cap. Now we bail BEFORE the
    // paid call when the day's spend is already at or above the cap. The
    // Gemini-backed price-board OCR shares the same Redis bucket so this
    // protects both pipelines together.
    //
    // On Redis blip the cap reads default to 0 spend → call proceeds (fail-
    // open on infra outage rather than blocking the entire OCR feature).
    // The recordSpend path below also fails open.
    try {
      const [dailySpend, spendCap] = await Promise.all([
        this.spend.getDailySpend(),
        this.spend.getSpendCap(),
      ]);
      if (Number.isFinite(dailySpend) && Number.isFinite(spendCap) && dailySpend >= spendCap) {
        this.logger.warn(
          `FillupOcr: daily spend cap reached ($${dailySpend.toFixed(2)} / $${spendCap.toFixed(2)}) — refusing to call Haiku, returning empty result.`,
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

      const response = await this.client.messages.create(
        {
          model: 'claude-haiku-4-5',
          // 256 tokens fits the JSON object comfortably (~70 tokens for the
          // shape + values). Keeping this tight bounds Haiku output cost.
          max_tokens: 256,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64Image },
                },
                { type: 'text', text: PUMP_METER_OCR_PROMPT },
              ],
            },
          ],
        },
        { signal: AbortSignal.timeout(HAIKU_TIMEOUT_MS) },
      );

      // Track Haiku spend separately from Gemini OCR — Haiku rates ≠ Gemini
      // rates, so we can't use OcrSpendService.computeCostUsd which is keyed
      // to Gemini. Pre-compute and pass the precomputed cost into recordSpend.
      //
      // P-5 hardening: guard against SDK shape drift / streaming variants
      // where `usage` or its token counts could be undefined. Direct
      // `.input_tokens` deref previously masqueraded as a Haiku failure
      // (TypeError swallowed by outer catch) — wasted spend, no result.
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        const costUsd =
          (inputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOKEN +
          (outputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOKEN;
        // Best-effort — never fail an OCR call because spend tracking blipped.
        void this.spend.recordSpend(costUsd).catch((e) =>
          this.logger.warn(
            `recordSpend failed (Haiku $${costUsd.toFixed(4)}): ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      } else {
        this.logger.warn('FillupOcr: response.usage missing token counts — skipping spend record.');
      }

      const rawText =
        response.content[0]?.type === 'text' ? response.content[0].text : '';
      return this.parseResponse(rawText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FillupOcr: API call failed — ${message}. Falling back to manual.`);
      return this.emptyResult();
    }
  }

  /**
   * Parses Haiku's JSON response. Returns the empty result on any parse
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
