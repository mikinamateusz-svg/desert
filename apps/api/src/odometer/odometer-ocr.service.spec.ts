import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OdometerOcrService } from './odometer-ocr.service.js';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function geminiResponse(text: string, inputTokens = 1500, outputTokens = 30) {
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

describe('OdometerOcrService', () => {
  let service: OdometerOcrService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecordSpend.mockResolvedValue(0);
    mockGetDailySpend.mockResolvedValue(0);
    mockGetSpendCap.mockResolvedValue(20);
    mockComputeCostUsd.mockReturnValue(0.0005);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OdometerOcrService,
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

    service = module.get<OdometerOcrService>(OdometerOcrService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('extractKm', () => {
    it('calls Gemini Flash with the odometer prompt + 10s AbortSignal', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450, confidence: 0.95 })),
      );

      await service.extractKm(Buffer.from('odo-img'));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('gemini-2.5-flash');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.temperature).toBe(0.0);
      // The prompt is supposed to ask for an integer km — sanity check.
      const promptText = body.contents[0].parts[1].text as string;
      expect(promptText.toLowerCase()).toContain('odometer');
      expect(promptText.toLowerCase()).toContain('km');
    });

    it('returns parsed km + confidence on a clean response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450, confidence: 0.92 })),
      );

      const result = await service.extractKm(Buffer.from('img'));

      expect(result).toEqual({ km: 87450, confidence: 0.92 });
    });

    it('floors fractional km values (Gemini sometimes emits 87450.7)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450.7, confidence: 0.85 })),
      );

      const result = await service.extractKm(Buffer.from('img'));

      expect(result.km).toBe(87450);
    });

    it('coerces non-positive / non-finite km to null', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: -5, confidence: 0.8 })),
      );
      expect((await service.extractKm(Buffer.from('img'))).km).toBeNull();

      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 0, confidence: 0.8 })),
      );
      expect((await service.extractKm(Buffer.from('img'))).km).toBeNull();
    });

    it('returns the empty result on AbortError (10s timeout, AC9)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

      const result = await service.extractKm(Buffer.from('img'));

      expect(result).toEqual({ km: null, confidence: 0 });
      expect(mockRecordSpend).not.toHaveBeenCalled();
    });

    it('returns the empty result on Gemini 5xx', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      const result = await service.extractKm(Buffer.from('img'));

      expect(result.confidence).toBe(0);
      expect(result.km).toBeNull();
    });

    it('returns the empty result on generic network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));

      const result = await service.extractKm(Buffer.from('img'));

      expect(result.confidence).toBe(0);
    });

    it('records Gemini spend via shared OcrSpendService.computeCostUsd', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450, confidence: 0.95 }), 1500, 30),
      );
      mockComputeCostUsd.mockReturnValueOnce(0.000525);

      await service.extractKm(Buffer.from('img'));

      expect(mockComputeCostUsd).toHaveBeenCalledWith(1500, 30);
      expect(mockRecordSpend).toHaveBeenCalledWith(0.000525);
    });

    it('does not propagate spend tracking failures', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450, confidence: 0.9 })),
      );
      mockRecordSpend.mockRejectedValueOnce(new Error('Redis down'));

      await expect(service.extractKm(Buffer.from('img'))).resolves.toEqual({
        km: 87450,
        confidence: 0.9,
      });
    });

    it('refuses to call Gemini when daily spend cap is already reached', async () => {
      mockGetDailySpend.mockResolvedValueOnce(20.5);
      mockGetSpendCap.mockResolvedValueOnce(20);
      global.fetch = jest.fn();

      const result = await service.extractKm(Buffer.from('img'));

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result).toEqual({ km: null, confidence: 0 });
    });

    it('proceeds fail-open on Redis blip in the precheck', async () => {
      mockGetDailySpend.mockRejectedValueOnce(new Error('Redis timeout'));
      global.fetch = jest.fn().mockResolvedValue(
        geminiResponse(JSON.stringify({ km: 87450, confidence: 0.9 })),
      );

      const result = await service.extractKm(Buffer.from('img'));

      expect(result.km).toBe(87450);
    });

    it('skips spend recording when usageMetadata is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ km: 87450, confidence: 0.9 }) }] } }],
        }),
      });

      const result = await service.extractKm(Buffer.from('img'));

      expect(result.km).toBe(87450);
      expect(mockRecordSpend).not.toHaveBeenCalled();
    });
  });

  describe('parseResponse', () => {
    it('parses a clean JSON response', () => {
      const result = service.parseResponse(JSON.stringify({ km: 87450, confidence: 0.92 }));
      expect(result).toEqual({ km: 87450, confidence: 0.92 });
    });

    it('strips markdown code fences', () => {
      const fenced = '```json\n' + JSON.stringify({ km: 87450, confidence: 0.92 }) + '\n```';
      expect(service.parseResponse(fenced).km).toBe(87450);
    });

    it('returns km null when km field is missing', () => {
      const result = service.parseResponse(JSON.stringify({ km: null, confidence: 0.4 }));
      expect(result.km).toBeNull();
      expect(result.confidence).toBe(0.4);
    });

    it('clamps confidence to [0, 1]', () => {
      expect(service.parseResponse(JSON.stringify({ km: 100, confidence: 1.7 })).confidence).toBe(1);
      expect(service.parseResponse(JSON.stringify({ km: 100, confidence: -0.4 })).confidence).toBe(0);
    });

    it('returns the empty result on JSON parse failure', () => {
      const result = service.parseResponse('not JSON {{');
      expect(result).toEqual({ km: null, confidence: 0 });
    });
  });
});
