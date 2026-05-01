import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FillupOcrService } from './fillup-ocr.service.js';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Anthropic SDK mock ──────────────────────────────────────────────────────

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeApiResponse = (text: string, inputTokens = 1500, outputTokens = 80) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: inputTokens, output_tokens: outputTokens },
});

const validJsonResponse = JSON.stringify({
  totalCostPln: 314.5,
  litres: 47.3,
  pricePerLitrePln: 6.65,
  fuelTypeSuggestion: 'PB_95',
  confidence: 0.92,
});

const mockRecordSpend = jest.fn();

// ── Test suite ──────────────────────────────────────────────────────────────

describe('FillupOcrService', () => {
  let service: FillupOcrService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecordSpend.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillupOcrService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'sk-ant-test-key' } },
        { provide: OcrSpendService, useValue: { recordSpend: mockRecordSpend } },
      ],
    }).compile();

    service = module.get<FillupOcrService>(FillupOcrService);
  });

  // ── extractFromPumpMeter ─────────────────────────────────────────────────

  describe('extractFromPumpMeter', () => {
    it('calls claude-haiku-4-5 with base64 image and a 10s AbortSignal', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.extractFromPumpMeter(Buffer.from('pump-img'));

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      const [body, options] = mockMessagesCreate.mock.calls[0]!;
      expect(body).toEqual(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
          max_tokens: 256,
        }),
      );
      // Options must carry an AbortSignal so the 10s timeout actually fires.
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns parsed values from a well-formed Haiku response', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result).toEqual({
        totalCostPln: 314.5,
        litres: 47.3,
        pricePerLitrePln: 6.65,
        fuelTypeSuggestion: 'PB_95',
        confidence: 0.92,
      });
    });

    it('records Haiku spend (input/output tokens × Haiku rates) on success', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse, 1500, 80));

      await service.extractFromPumpMeter(Buffer.from('img'));

      // 1500 in × $1/M  +  80 out × $5/M = 0.0015 + 0.0004 = $0.0019
      expect(mockRecordSpend).toHaveBeenCalledTimes(1);
      const recordedCost = mockRecordSpend.mock.calls[0]![0] as number;
      expect(recordedCost).toBeCloseTo(0.0019, 6);
    });

    it('returns the empty result + does NOT throw when Haiku times out (AC10)', async () => {
      // Simulate AbortError as the SDK would when AbortSignal.timeout fires.
      mockMessagesCreate.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

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

    it('returns the empty result on generic API failure (AC10 — no throw to caller)', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('500 Internal Server Error'));

      const result = await service.extractFromPumpMeter(Buffer.from('img'));

      expect(result.confidence).toBe(0);
      expect(result.totalCostPln).toBeNull();
    });

    it('does not propagate spend tracking failures', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));
      mockRecordSpend.mockRejectedValueOnce(new Error('Redis down'));

      // Best-effort recordSpend (fire-and-forget) must not break the OCR call.
      await expect(
        service.extractFromPumpMeter(Buffer.from('img')),
      ).resolves.toEqual(
        expect.objectContaining({ totalCostPln: 314.5, litres: 47.3 }),
      );
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
