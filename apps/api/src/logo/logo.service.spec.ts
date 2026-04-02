import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LogoService, KNOWN_BRANDS } from './logo.service.js';

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

const makeApiResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

const validJsonResponse = JSON.stringify({ brand: 'orlen', confidence: 0.95 });

// ── Test suite ──────────────────────────────────────────────────────────────

describe('LogoService', () => {
  let service: LogoService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogoService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'sk-ant-test-key' } },
      ],
    }).compile();

    service = module.get<LogoService>(LogoService);
  });

  // ── recogniseBrand ─────────────────────────────────────────────────────────

  describe('recogniseBrand', () => {
    it('calls claude-haiku-4-5 with base64 image and the logo prompt', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));
      const buffer = Buffer.from('fake-image-data');

      await service.recogniseBrand(buffer);

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

    it('uses max_tokens: 128 (smaller than OCR)', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.recogniseBrand(Buffer.from('img'));

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 128 }),
      );
    });

    it('returns parsed brand and confidence on success', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      const result = await service.recogniseBrand(Buffer.from('img'));

      expect(result.brand).toBe('orlen');
      expect(result.confidence).toBe(0.95);
    });

    it('returns { brand: null, confidence: 0 } when API throws — does NOT re-throw', async () => {
      mockMessagesCreate.mockRejectedValueOnce(new Error('API 503 Service Unavailable'));

      const result = await service.recogniseBrand(Buffer.from('img'));

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns { brand: null, confidence: 0 } when API returns non-text content', async () => {
      mockMessagesCreate.mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'tu_1' }] });

      const result = await service.recogniseBrand(Buffer.from('img'));

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('uses image/jpeg media type by default', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.recogniseBrand(Buffer.from('img'));

      const call = mockMessagesCreate.mock.calls[0][0];
      const imageContent = call.messages[0].content.find(
        (c: { type: string }) => c.type === 'image',
      );
      expect(imageContent.source.media_type).toBe('image/jpeg');
    });

    it('accepts image/png media type override', async () => {
      mockMessagesCreate.mockResolvedValueOnce(makeApiResponse(validJsonResponse));

      await service.recogniseBrand(Buffer.from('img'), 'image/png');

      const call = mockMessagesCreate.mock.calls[0][0];
      const imageContent = call.messages[0].content.find(
        (c: { type: string }) => c.type === 'image',
      );
      expect(imageContent.source.media_type).toBe('image/png');
    });
  });

  // ── parseResponse ──────────────────────────────────────────────────────────

  describe('parseResponse', () => {
    it('parses valid JSON with known brand and confidence', () => {
      const result = service.parseResponse(validJsonResponse);

      expect(result.brand).toBe('orlen');
      expect(result.confidence).toBe(0.95);
      expect(result.raw_response).toBe(validJsonResponse);
    });

    it('returns null brand for unknown brand string', () => {
      const json = JSON.stringify({ brand: 'neste', confidence: 0.9 });

      const result = service.parseResponse(json);

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0.9);
    });

    it('returns null brand when brand is null in response', () => {
      const json = JSON.stringify({ brand: null, confidence: 0.0 });

      const result = service.parseResponse(json);

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0.0);
    });

    it('clamps confidence to [0, 1]', () => {
      const above = JSON.stringify({ brand: 'orlen', confidence: 1.5 });
      const below = JSON.stringify({ brand: 'orlen', confidence: -0.3 });

      expect(service.parseResponse(above).confidence).toBe(1.0);
      expect(service.parseResponse(below).confidence).toBe(0.0);
    });

    it('strips markdown code fences before parsing', () => {
      const fenced = '```json\n' + validJsonResponse + '\n```';

      const result = service.parseResponse(fenced);

      expect(result.brand).toBe('orlen');
      expect(result.confidence).toBe(0.95);
    });

    it('returns safe default on JSON parse failure — does not throw', () => {
      const result = service.parseResponse('not valid json at all');

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0.0);
    });

    it('returns safe default when response is empty string', () => {
      const result = service.parseResponse('');

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0.0);
    });
  });

  // ── evaluateMatch ──────────────────────────────────────────────────────────

  describe('evaluateMatch', () => {
    it('returns "match" when detected brand equals station brand', () => {
      const result = service.evaluateMatch(
        { brand: 'bp', confidence: 0.9, raw_response: '' },
        'bp',
      );
      expect(result).toBe('match');
    });

    it('returns "mismatch" when detected brand differs from station brand', () => {
      const result = service.evaluateMatch(
        { brand: 'shell', confidence: 0.9, raw_response: '' },
        'bp',
      );
      expect(result).toBe('mismatch');
    });

    it('returns "inconclusive" when brand is null', () => {
      const result = service.evaluateMatch(
        { brand: null, confidence: 0.0, raw_response: '' },
        'orlen',
      );
      expect(result).toBe('inconclusive');
    });

    it('returns "inconclusive" when confidence is 0', () => {
      const result = service.evaluateMatch(
        { brand: 'orlen', confidence: 0, raw_response: '' },
        'orlen',
      );
      expect(result).toBe('inconclusive');
    });

    it('returns "inconclusive" when confidence is below 0.4 (cannot-identify band)', () => {
      const result = service.evaluateMatch(
        { brand: 'orlen', confidence: 0.3, raw_response: '' },
        'orlen',
      );
      expect(result).toBe('inconclusive');
    });

    it('returns "match" when confidence is exactly 0.4 (threshold boundary)', () => {
      const result = service.evaluateMatch(
        { brand: 'orlen', confidence: 0.4, raw_response: '' },
        'orlen',
      );
      expect(result).toBe('match');
    });

    it('returns "inconclusive" when stationBrand is null (unclassified station)', () => {
      const result = service.evaluateMatch(
        { brand: 'orlen', confidence: 0.9, raw_response: '' },
        null,
      );
      expect(result).toBe('inconclusive');
    });

    it('returns "match" for lotos/orlen cross-match (rebrand handling)', () => {
      const result = service.evaluateMatch(
        { brand: 'lotos', confidence: 0.9, raw_response: '' },
        'orlen',
      );
      expect(result).toBe('match');
    });

    it('returns "match" for orlen/lotos cross-match (rebrand handling)', () => {
      const result = service.evaluateMatch(
        { brand: 'orlen', confidence: 0.9, raw_response: '' },
        'lotos',
      );
      expect(result).toBe('match');
    });

    it('is case-insensitive in comparison', () => {
      const result = service.evaluateMatch(
        { brand: 'shell', confidence: 0.9, raw_response: '' },
        'Shell',
      );
      expect(result).toBe('match');
    });

    it('KNOWN_BRANDS covers expected Polish fuel brands', () => {
      expect(KNOWN_BRANDS).toEqual(
        expect.arrayContaining(['orlen', 'bp', 'shell', 'lotos', 'circle_k', 'amic', 'moya']),
      );
    });
  });
});
