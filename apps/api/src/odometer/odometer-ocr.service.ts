import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface OdometerOcrResult {
  km: number | null;
  /**
   * 0.0 – 1.0. Caller advances to confirmation when km !== null AND
   * confidence >= 0.6; otherwise routes the user to manual entry.
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

// 10s wall-clock cap per AC9. The mobile client expects to never wait
// longer than this for the OCR endpoint; on abort we return confidence: 0
// so the user is routed straight to manual entry.
const GEMINI_TIMEOUT_MS = 10_000;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Same model as price-board OCR (Story 3.5) and pump-meter OCR (Story 5.2
// after the 2026-05-02 swap). All vision call sites in the API now run on
// Gemini Flash; spend tracking shares the same daily cap (project memory:
// project_ocr_spend_cap.md). Future shared-helper refactor logged in
// project_vision_model_refactor.md.
const GEMINI_MODEL = 'gemini-2.5-flash';

const ODOMETER_OCR_PROMPT = `You are reading an odometer display from a vehicle dashboard.

Extract the total odometer reading in kilometres.

Look for:
- A digital or analogue odometer display showing total distance
- The number may be labelled "ODO", "km", or appear unlabelled as the largest distance number
- Ignore trip meters (labelled "TRIP A", "TRIP B", or showing small values like "0342.1")
- Ignore fuel range estimates

Return a JSON object:
- "km": integer | null — the total odometer reading rounded to the nearest whole kilometre; null if unreadable
- "confidence": number 0.0–1.0
    0.9–1.0: odometer clearly visible, digits unambiguous
    0.6–0.89: readable with minor blur or partial occlusion
    below 0.6: unable to read reliably

Return only valid JSON — no markdown, no code fences:
{"km": integer|null, "confidence": number}`;

// ── Service ────────────────────────────────────────────────────────────────

/**
 * Sends a dashboard odometer photo to Gemini Flash and extracts the total
 * km reading.
 *
 * NEVER throws — all errors (timeout, network, parse failure, low
 * confidence, spend cap reached) collapse to `{ km: null, confidence: 0 }`
 * so the controller can return 200 and the mobile client routes the user
 * to manual entry per AC8 / AC9.
 *
 * Spend tracking shares the daily cap with price-board + pump-meter OCR
 * pipelines. Cost computation uses `OcrSpendService.computeCostUsd`
 * directly since all three pipelines use Gemini Flash rates.
 */
@Injectable()
export class OdometerOcrService {
  private readonly logger = new Logger(OdometerOcrService.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly spend: OcrSpendService,
  ) {
    this.apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
  }

  async extractKm(
    photoBuffer: Buffer,
    mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<OdometerOcrResult> {
    // Spend-cap precheck — same fail-closed kill switch shared across all
    // vision OCR pipelines (project memory: project_ocr_spend_cap.md).
    // Bail BEFORE the paid call when the day's spend is already at or
    // above the cap. Fail-open on Redis blip so infra outage doesn't
    // block the entire OCR feature.
    try {
      const [dailySpend, spendCap] = await Promise.all([
        this.spend.getDailySpend(),
        this.spend.getSpendCap(),
      ]);
      if (Number.isFinite(dailySpend) && Number.isFinite(spendCap) && dailySpend >= spendCap) {
        this.logger.warn(
          `OdometerOcr: daily spend cap reached ($${dailySpend.toFixed(2)} / $${spendCap.toFixed(2)}) — refusing to call Gemini, returning empty result.`,
        );
        return this.emptyResult();
      }
    } catch (e) {
      this.logger.warn(
        `OdometerOcr: spend-cap precheck failed (${e instanceof Error ? e.message : String(e)}) — proceeding fail-open.`,
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
                { text: ODOMETER_OCR_PROMPT },
              ],
            },
          ],
          generationConfig: {
            // JSON-mode output forces Gemini to emit only the JSON shape we
            // asked for — no preamble, no markdown fences.
            responseMimeType: 'application/json',
            // Deterministic decoding for OCR — temperature 0 gives the
            // model's most-confident reading every time.
            temperature: 0.0,
          },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `OdometerOcr: Gemini ${res.status} — falling back to manual: ${body.slice(0, 200)}`,
        );
        return this.emptyResult();
      }

      const responseBody = (await res.json()) as GeminiResponse;
      const inputTokens = responseBody.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = responseBody.usageMetadata?.candidatesTokenCount ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        // Best-effort — never fail an OCR call because spend tracking blipped.
        const costUsd = this.spend.computeCostUsd(inputTokens, outputTokens);
        void this.spend.recordSpend(costUsd).catch((e) =>
          this.logger.warn(
            `recordSpend failed (Gemini $${costUsd.toFixed(4)}): ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      } else {
        this.logger.warn('OdometerOcr: response.usageMetadata missing token counts — skipping spend record.');
      }

      const rawText =
        responseBody.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return this.parseResponse(rawText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OdometerOcr: API call failed — ${message}. Falling back to manual.`);
      return this.emptyResult();
    }
  }

  /**
   * Parses Gemini's JSON response. Returns the empty result on any parse
   * failure or non-integer km — never throws. The controller surfaces
   * `confidence: 0` to the mobile client which then routes to manual entry.
   */
  parseResponse(rawText: string): OdometerOcrResult {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const km = this.coerceKm(parsed['km']);

      const confRaw = parsed['confidence'];
      const confidence =
        typeof confRaw === 'number' && Number.isFinite(confRaw)
          ? Math.max(0, Math.min(1, confRaw))
          : 0;

      return { km, confidence };
    } catch {
      this.logger.warn(`OdometerOcr: failed to parse response: ${rawText.slice(0, 200)}`);
      return this.emptyResult();
    }
  }

  private coerceKm(value: unknown): number | null {
    // Accepts integers (the prompt asks for integer km). Floor any
    // floating-point Gemini occasionally returns. Reject zero, negatives,
    // non-finite values, and anything above the DTO's upper bound — a
    // hallucinated 9-digit reading would otherwise round-trip to the
    // mobile client and only fail at DTO validation on submit, after
    // wasting a confirmation screen.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    if (value > 2_000_000) return null;
    return Math.floor(value);
  }

  private emptyResult(): OdometerOcrResult {
    return { km: null, confidence: 0 };
  }
}
