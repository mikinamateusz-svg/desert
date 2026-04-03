import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrService, PRICE_BANDS, type ExtractedPrice } from './ocr.service.js';

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

const makeApiResponse = (text: string, inputTokens = 1000, outputTokens = 200) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: inputTokens, output_tokens: outputTokens },
});

const validJsonResponse = JSON.stringify({
  prices: [
    { fuel_type: 'PB_95', price_per_litre: 6.19 },
    { fuel_type: 'ON', price_per_litre: 6.49 },
  ],
  confidence_score: 0.92,
});

// ── Test suite ──────────────────────────────────────────────────────────────

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'sk-ant-test-key' } },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
  });

  // ── extractPrices ──────────────────────────────────────────────────────────

  describe('extractPrices', () => {
    it('calls claude-haiku-4-5 with base64 image and structured prompt', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));
      const buffer = Buffer.from('fake-image-data');

      await service.extractPrices(buffer);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'image' }),
                expect.objectContaining({ type: 'text' }),
              ]),
            }),
          ]),
        }),
      );
    });

    it('returns parsed prices and confidence score on success', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.prices).toHaveLength(2);
      expect(result.prices[0]).toEqual({ fuel_type: 'PB_95', price_per_litre: 6.19 });
      expect(result.confidence_score).toBe(0.92);
    });

    it('throws when Anthropic API returns an error (allows BullMQ retry)', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('API 503 Service Unavailable'));

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow(
        'API 503 Service Unavailable',
      );
    });

    it('encodes photoBuffer as base64 in the API request', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));
      const buffer = Buffer.from('test-image-bytes');

      await service.extractPrices(buffer);

      const call = mockMessagesCreate.mock.calls[0][0];
      const imageContent = call.messages[0].content.find(
        (c: { type: string }) => c.type === 'image',
      );
      expect(imageContent.source.data).toBe(buffer.toString('base64'));
      expect(imageContent.source.type).toBe('base64');
    });

    it('uses image/jpeg media type by default', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.extractPrices(Buffer.from('img'));

      const call = mockMessagesCreate.mock.calls[0][0];
      const imageContent = call.messages[0].content.find(
        (c: { type: string }) => c.type === 'image',
      );
      expect(imageContent.source.media_type).toBe('image/jpeg');
    });

    it('accepts image/png media type override', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.extractPrices(Buffer.from('img'), 'image/png');

      const call = mockMessagesCreate.mock.calls[0][0];
      const imageContent = call.messages[0].content.find(
        (c: { type: string }) => c.type === 'image',
      );
      expect(imageContent.source.media_type).toBe('image/png');
    });

    // ── Story 3.9: token usage and 4xx handling ─────────────────────────────

    it('returns input_tokens and output_tokens from API response usage', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse, 1500, 300));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.input_tokens).toBe(1500);
      expect(result.output_tokens).toBe(300);
    });

    it('returns zero tokens on Anthropic 4xx error (non-retriable path)', async () => {
      const httpErr = Object.assign(new Error('Bad request'), { status: 400 });
      mockMessagesCreate.mockRejectedValueOnce(httpErr);

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.input_tokens).toBe(0);
      expect(result.output_tokens).toBe(0);
      expect(result.confidence_score).toBe(0.0);
      expect(result.prices).toEqual([]);
    });

    it('returns empty prices and confidence 0.0 on Anthropic 4xx (graceful rejection path)', async () => {
      const httpErr = Object.assign(new Error('Request too large'), { status: 413 });
      mockMessagesCreate.mockRejectedValueOnce(httpErr);

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.prices).toEqual([]);
      expect(result.confidence_score).toBe(0.0);
    });

    it('re-throws Anthropic 5xx errors so BullMQ can retry', async () => {
      const httpErr = Object.assign(new Error('Internal Server Error'), { status: 500 });
      mockMessagesCreate.mockRejectedValueOnce(httpErr);

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('Internal Server Error');
    });

    it('re-throws errors without a status field (network errors, etc.)', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('ECONNRESET');
    });

    it('re-throws Anthropic 429 so BullMQ can retry with backoff (P-3)', async () => {
      const httpErr = Object.assign(new Error('Too Many Requests'), { status: 429 });
      mockMessagesCreate.mockRejectedValueOnce(httpErr);

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('Too Many Requests');
    });
  });

  // ── parseResponse ──────────────────────────────────────────────────────────

  describe('parseResponse', () => {
    it('parses valid JSON response with multiple fuel types', () => {
      const result = service.parseResponse(validJsonResponse);

      expect(result.prices).toHaveLength(2);
      expect(result.prices[0]).toEqual({ fuel_type: 'PB_95', price_per_litre: 6.19 });
      expect(result.prices[1]).toEqual({ fuel_type: 'ON', price_per_litre: 6.49 });
      expect(result.confidence_score).toBe(0.92);
    });

    it('returns confidence 0.0 and empty prices on JSON parse failure', () => {
      const result = service.parseResponse('not valid json at all');

      expect(result.prices).toEqual([]);
      expect(result.confidence_score).toBe(0.0);
    });

    it('strips markdown code fences before parsing', () => {
      const fenced = '```json\n' + validJsonResponse + '\n```';

      const result = service.parseResponse(fenced);

      expect(result.prices).toHaveLength(2);
      expect(result.confidence_score).toBe(0.92);
    });

    it('filters out unknown fuel types', () => {
      const json = JSON.stringify({
        prices: [
          { fuel_type: 'PB_95', price_per_litre: 6.19 },
          { fuel_type: 'HYDROGEN', price_per_litre: 40.0 },
        ],
        confidence_score: 0.8,
      });

      const result = service.parseResponse(json);

      expect(result.prices).toHaveLength(1);
      expect(result.prices[0].fuel_type).toBe('PB_95');
    });

    it('filters out prices with non-numeric price_per_litre', () => {
      const json = JSON.stringify({
        prices: [{ fuel_type: 'PB_95', price_per_litre: 'six-nineteen' }],
        confidence_score: 0.8,
      });

      const result = service.parseResponse(json);

      expect(result.prices).toEqual([]);
    });

    it('filters out prices where price_per_litre is 0 or negative', () => {
      const json = JSON.stringify({
        prices: [
          { fuel_type: 'PB_95', price_per_litre: 0 },
          { fuel_type: 'ON', price_per_litre: -1.5 },
        ],
        confidence_score: 0.8,
      });

      const result = service.parseResponse(json);

      expect(result.prices).toEqual([]);
    });

    it('filters out prices where price_per_litre is Infinity', () => {
      const json = JSON.stringify({
        prices: [{ fuel_type: 'PB_95', price_per_litre: Infinity }],
        confidence_score: 0.8,
      });

      // JSON.stringify converts Infinity to null
      const result = service.parseResponse(json);

      expect(result.prices).toEqual([]);
    });

    it('clamps confidence_score to [0, 1] range', () => {
      const jsonAbove = JSON.stringify({ prices: [], confidence_score: 1.5 });
      const jsonBelow = JSON.stringify({ prices: [], confidence_score: -0.3 });

      expect(service.parseResponse(jsonAbove).confidence_score).toBe(1.0);
      expect(service.parseResponse(jsonBelow).confidence_score).toBe(0.0);
    });

    it('returns empty prices array when prices field is missing', () => {
      const json = JSON.stringify({ confidence_score: 0.7 });

      const result = service.parseResponse(json);

      expect(result.prices).toEqual([]);
      expect(result.confidence_score).toBe(0.7);
    });

    it('returns empty prices array when prices is not an array', () => {
      const json = JSON.stringify({ prices: 'none', confidence_score: 0.5 });

      const result = service.parseResponse(json);

      expect(result.prices).toEqual([]);
    });
  });

  // ── validatePriceBands ────────────────────────────────────────────────────

  describe('validatePriceBands', () => {
    const validPrices: ExtractedPrice[] = [
      { fuel_type: 'PB_95', price_per_litre: 6.19 },
      { fuel_type: 'ON', price_per_litre: 6.49 },
      { fuel_type: 'LPG', price_per_litre: 3.50 },
    ];

    it('returns null when all prices are within bands', () => {
      expect(service.validatePriceBands(validPrices)).toBeNull();
    });

    it('returns fuel_type when PB_95 price is below 4.00', () => {
      const prices: ExtractedPrice[] = [{ fuel_type: 'PB_95', price_per_litre: 3.99 }];
      expect(service.validatePriceBands(prices)).toBe('PB_95');
    });

    it('returns fuel_type when PB_95 price is above 12.00', () => {
      const prices: ExtractedPrice[] = [{ fuel_type: 'PB_95', price_per_litre: 12.01 }];
      expect(service.validatePriceBands(prices)).toBe('PB_95');
    });

    it('returns fuel_type when LPG price is above 6.00', () => {
      const prices: ExtractedPrice[] = [{ fuel_type: 'LPG', price_per_litre: 6.01 }];
      expect(service.validatePriceBands(prices)).toBe('LPG');
    });

    it('returns null for empty prices array', () => {
      expect(service.validatePriceBands([])).toBeNull();
    });

    it('ignores unknown fuel types not in PRICE_BANDS', () => {
      // validatePriceBands should only check known fuel types
      const prices: ExtractedPrice[] = [{ fuel_type: 'UNKNOWN', price_per_litre: 999.0 }];
      expect(service.validatePriceBands(prices)).toBeNull();
    });

    it('PRICE_BANDS covers all expected fuel types', () => {
      expect(Object.keys(PRICE_BANDS)).toEqual(
        expect.arrayContaining(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG']),
      );
    });
  });
});
