import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FillupOcrService } from './fillup-ocr.service.js';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const validJsonResponse = JSON.stringify({
  totalCostPln: 314.5,
  litres: 47.3,
  pricePerLitrePln: 6.65,
  fuelTypeSuggestion: 'PB_95',
  confidence: 0.92,
});

function geminiResponse(text: string, inputTokens = 1500, outputTokens = 80) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
      },
    }),
    text: jest.fn().mockResolvedValue(text),
  };
}

const mockRecordSpend = jest.fn();
const mockGetDailySpend = jest.fn();
const mockGetSpendCap = jest.fn();
const mockComputeCostUsd = jest.fn();

const originalFetch = global.fetch;

// ── Test suite ──────────────────────────────────────────────────────────────

describe('FillupOcrService', () => {
  let service: FillupOcrService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecordSpend.mockResolvedValue(0);
    mockGetDailySpend.mockResolvedValue(0);
    mockGetSpendCap.mockResolvedValue(20);
    // Default: cost computation returns a non-zero value so spend is
    // recorded. Individual tests can override.
    mockComputeCostUsd.mockReturnValue(0.0007);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillupOcrService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'AIza-test-key' } },
        {
          provide: OcrSpendService,
          useValue: {
            recordSpend: mockRecordSpend,
            getDailySpend: mockGetDailySpend,
            getSpendCap: mockGetSpendCap,
            computeCostUsd: mockComputeCostUsd,
          },
        },
      ],
    }).compile();

    service = module.get<FillupOcrService>(FillupOcrService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── extractFromPumpMeter ─────────────────────────────────────────────────

  describe('extractFromPumpMeter', () => {
    it('calls Gemini Flash with base64 image, JSON-mode generation config, and 10s AbortSignal', async () => {
      global.fetch = jest.fn().mockResolvedValue(geminiResponse(validJsonResponse));

      await service.extractFromPumpMeter(Buffer.from('pump-img'));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('gemini-2.5-flash');
      expect(url).toContain('key=AIza-test-key');
      expect(init.method).toBe('POST');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.temperature).toBe(0.0);
      expect(body.contents[0].parts).toHaveLength(2);
      expect(body.contents[0].parts[0].inline_data.mime_type).toBe('image/jpeg');
    });

    it('returns parsed values from a well-formed Gemini response', async () => {
      global.fetch = jest.fn().mockResolvedValue(geminiResponse(validJsonResponse));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result).toEqual({
        totalCostPln: 314.5,
        litres: 47.3,
        pricePerLitrePln: 6.65,
        fuelTypeSuggestion: 'PB_95',
        confidence: 0.92,
      });
    });

    it('records Gemini spend via shared OcrSpendService.computeCostUsd (Gemini-keyed)', async () => {
      global.fetch = jest.fn().mockResolvedValue(geminiResponse(validJsonResponse, 1500, 80));
      mockComputeCostUsd.mockReturnValueOnce(0.00065);

      await service.extractFromPumpMeter(Buffer.from('img'));

      // computeCostUsd is now the shared rate calculator (Gemini Flash
      // rates) — no per-model pre-computation needed since the price-
      // board OCR also uses Gemini Flash.
      expect(mockComputeCostUsd).toHaveBeenCalledWith(1500, 80);
      expect(mockRecordSpend).toHaveBeenCalledWith(0.00065);
    });

    it('returns the empty result + does NOT throw on AbortError (10s timeout, AC10)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result).toEqual({
        totalCostPln: null,
        litres: null,
        pricePerLitrePln: null,
        fuelTypeSuggestion: null,
        confidence: 0,
      });
      expect(mockRecordSpend).not.toHaveBeenCalled();
    });

    it('returns the empty result on Gemini 5xx (no throw to caller)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result.confidence).toBe(0);
      expect(result.totalCostPln).toBeNull();
      // 5xx still returns empty without recording spend (no successful API call).
      expect(mockRecordSpend).not.toHaveBeenCalled();
    });

    it('returns the empty result on generic network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND generativelanguage.googleapis.com'));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result.confidence).toBe(0);
    });

    it('does not propagate spend tracking failures', async () => {
      global.fetch = jest.fn().mockResolvedValue(geminiResponse(validJsonResponse));
      mockRecordSpend.mockRejectedValueOnce(new Error('Redis down'));

      // Best-effort recordSpend (fire-and-forget) must not break the OCR call.
      await expect(
        service.extractFromPumpMeter(Buffer.from('img')),
      ).resolves.toEqual(
        expect.objectContaining({ totalCostPln: 314.5, litres: 47.3 }),
      );
    });

    it('refuses to call Gemini when daily spend cap is already reached (P-2)', async () => {
      mockGetDailySpend.mockResolvedValueOnce(20.5);
      mockGetSpendCap.mockResolvedValueOnce(20);
      global.fetch = jest.fn();

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockRecordSpend).not.toHaveBeenCalled();
      expect(result).toEqual({
        totalCostPln: null,
        litres: null,
        pricePerLitrePln: null,
        fuelTypeSuggestion: null,
        confidence: 0,
      });
    });

    it('refuses at exact cap boundary (>= comparison)', async () => {
      mockGetDailySpend.mockResolvedValueOnce(20);
      mockGetSpendCap.mockResolvedValueOnce(20);
      global.fetch = jest.fn();

      await service.extractFromPumpMeter(Buffer.from('img'));

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('proceeds fail-open when the spend-cap precheck itself errors (Redis blip)', async () => {
      mockGetDailySpend.mockRejectedValueOnce(new Error('Redis timeout'));
      global.fetch = jest.fn().mockResolvedValue(geminiResponse(validJsonResponse));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(global.fetch).toHaveBeenCalled();
      expect(result.totalCostPln).toBe(314.5);
    });

    it('skips spend recording when usageMetadata token counts are zero', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: validJsonResponse }] } }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
        }),
      });

      await service.extractFromPumpMeter(Buffer.from('img'));

      expect(mockRecordSpend).not.toHaveBeenCalled();
    });

    it('skips spend recording when usageMetadata is missing entirely', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: validJsonResponse }] } }],
          // usageMetadata absent — older API versions or streaming responses
        }),
      });

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      // Result still parsed and returned despite no spend tracking.
      expect(result.totalCostPln).toBe(314.5);
      expect(mockRecordSpend).not.toHaveBeenCalled();
    });
  });

  // ── parseResponse ────────────────────────────────────────────────────────

  describe('parseResponse', () => {
    it('parses a clean JSON response', () => {
      const result = service.parseResponse(validJsonResponse);
      expect(result.totalCostPln).toBe(314.5);
      expect(result.litres).toBe(47.3);
      expect(result.pricePerLitrePln).toBe(6.65);
      expect(result.fuelTypeSuggestion).toBe('PB_95');
      expect(result.confidence).toBe(0.92);
    });

    it('strips markdown code fences', () => {
      const fenced = '```json\n' + validJsonResponse + '\n```';
      const result = service.parseResponse(fenced);
      expect(result.totalCostPln).toBe(314.5);
    });

    it('returns nulls when required values are missing', () => {
      const partial = JSON.stringify({
        totalCostPln: 314.5,
        litres: null,
        pricePerLitrePln: 6.65,
        fuelTypeSuggestion: null,
        confidence: 0.4,
      });
      const result = service.parseResponse(partial);
      expect(result.totalCostPln).toBe(314.5);
      expect(result.litres).toBeNull();
      expect(result.pricePerLitrePln).toBe(6.65);
    });

    it('coerces non-positive / non-finite numbers to null (defends against OCR noise)', () => {
      const noisy = JSON.stringify({
        totalCostPln: -10,
        litres: 0,
        pricePerLitrePln: 'not a number',
        fuelTypeSuggestion: 'PB_95',
        confidence: 0.9,
      });
      const result = service.parseResponse(noisy);
      expect(result.totalCostPln).toBeNull();
      expect(result.litres).toBeNull();
      expect(result.pricePerLitrePln).toBeNull();
    });

    it('rejects unknown fuel_type values', () => {
      const badFuel = JSON.stringify({
        totalCostPln: 100,
        litres: 30,
        pricePerLitrePln: 3.33,
        fuelTypeSuggestion: 'KEROSENE',
        confidence: 0.8,
      });
      const result = service.parseResponse(badFuel);
      expect(result.fuelTypeSuggestion).toBeNull();
    });

    it('clamps confidence into the [0, 1] range', () => {
      const clamped = JSON.stringify({
        totalCostPln: 100,
        litres: 30,
        pricePerLitrePln: 3.33,
        fuelTypeSuggestion: 'PB_95',
        confidence: 1.7,
      });
      expect(service.parseResponse(clamped).confidence).toBe(1);

      const negative = JSON.stringify({
        totalCostPln: 100,
        litres: 30,
        pricePerLitrePln: 3.33,
        fuelTypeSuggestion: 'PB_95',
        confidence: -0.4,
      });
      expect(service.parseResponse(negative).confidence).toBe(0);
    });

    it('returns the empty result on JSON parse failure', () => {
      const result = service.parseResponse('this is not JSON {{');
      expect(result).toEqual({
        totalCostPln: null,
        litres: null,
        pricePerLitrePln: null,
        fuelTypeSuggestion: null,
        confidence: 0,
      });
    });
  });
});
