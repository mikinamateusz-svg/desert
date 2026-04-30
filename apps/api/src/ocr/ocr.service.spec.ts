import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrService, PRICE_BANDS, type ExtractedPrice } from './ocr.service.js';

// ── Global fetch mock ────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Helpers ──────────────────────────────────────────────────────────────────

const validJsonResponse = JSON.stringify({
  prices: [
    { fuel_type: 'PB_95', price_per_litre: 6.19 },
    { fuel_type: 'ON', price_per_litre: 6.49 },
  ],
  confidence_score: 0.92,
});

function makeGeminiResponse(
  text: string,
  promptTokens = 1000,
  candidateTokens = 200,
): Response {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: {
        promptTokenCount: promptTokens,
        candidatesTokenCount: candidateTokens,
      },
    }),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'error'): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-gemini-key' } },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
  });

  // ── extractPrices ────────────────────────────────────────────────────────

  describe('extractPrices', () => {
    it('calls Gemini 2.5 Flash API with base64 image and structured prompt', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));
      const buffer = Buffer.from('fake-image-data');

      await service.extractPrices(buffer);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-2.5-flash'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('inline_data'),
        }),
      );
    });

    it('includes API key as query param in the request URL', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));

      await service.extractPrices(Buffer.from('img'));

      const [url] = mockFetch.mock.calls[0] as [string, unknown];
      expect(url).toContain('key=test-gemini-key');
    });

    it('returns parsed prices and confidence score on success', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.prices).toHaveLength(2);
      expect(result.prices[0]).toEqual({ fuel_type: 'PB_95', price_per_litre: 6.19 });
      expect(result.confidence_score).toBe(0.92);
    });

    it('returns input_tokens and output_tokens from usageMetadata', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse, 1500, 300));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.input_tokens).toBe(1500);
      expect(result.output_tokens).toBe(300);
    });

    it('encodes photoBuffer as base64 in the request body', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));
      const buffer = Buffer.from('test-image-bytes');

      await service.extractPrices(buffer);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        contents: Array<{ parts: Array<{ inline_data?: { data?: string; mime_type?: string } }> }>;
      };
      const inlineData = body.contents[0].parts[0].inline_data;
      expect(inlineData?.data).toBe(buffer.toString('base64'));
    });

    it('uses image/jpeg mime type by default', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));

      await service.extractPrices(Buffer.from('img'));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        contents: Array<{ parts: Array<{ inline_data?: { mime_type?: string } }> }>;
      };
      expect(body.contents[0].parts[0].inline_data?.mime_type).toBe('image/jpeg');
    });

    it('accepts image/png mime type override', async () => {
      mockFetch.mockResolvedValueOnce(makeGeminiResponse(validJsonResponse));

      await service.extractPrices(Buffer.from('img'), 'image/png');

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        contents: Array<{ parts: Array<{ inline_data?: { mime_type?: string } }> }>;
      };
      expect(body.contents[0].parts[0].inline_data?.mime_type).toBe('image/png');
    });

    it('returns zero tokens and empty prices on Gemini 4xx (non-retriable path)', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(400, 'Bad request'));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.input_tokens).toBe(0);
      expect(result.output_tokens).toBe(0);
      expect(result.confidence_score).toBe(0.0);
      expect(result.prices).toEqual([]);
    });

    it('returns empty prices and confidence 0.0 on Gemini 413 (graceful rejection)', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(413, 'Request too large'));

      const result = await service.extractPrices(Buffer.from('img'));

      expect(result.prices).toEqual([]);
      expect(result.confidence_score).toBe(0.0);
    });

    it('throws on Gemini 5xx so BullMQ can retry', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('Gemini 500');
    });

    it('throws on Gemini 429 so BullMQ can retry with backoff', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(429, 'Too Many Requests'));

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('Gemini 429');
    });

    it('throws on network error so BullMQ can retry', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(service.extractPrices(Buffer.from('img'))).rejects.toThrow('ECONNRESET');
    });
  });

  // ── parseResponse ─────────────────────────────────────────────────────────

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
