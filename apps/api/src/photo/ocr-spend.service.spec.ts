import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrSpendService } from './ocr-spend.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// ── Redis mock ───────────────────────────────────────────────────────────────

const mockRedisIncrbyfloat = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisGet = jest.fn();

const mockRedis = {
  incrbyfloat: mockRedisIncrbyfloat,
  expire: mockRedisExpire,
  get: mockRedisGet,
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('OcrSpendService', () => {
  let service: OcrSpendService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRedisIncrbyfloat.mockResolvedValue('1.5');
    mockRedisExpire.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrSpendService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        {
          provide: ConfigService,
          useValue: { get: (key: string, defaultVal?: string) => defaultVal ?? '' },
        },
      ],
    }).compile();

    service = module.get<OcrSpendService>(OcrSpendService);
  });

  // ── computeCostUsd ──────────────────────────────────────────────────────────

  describe('computeCostUsd', () => {
    it('computes cost using Haiku input and output token rates', () => {
      // 1M input tokens = $0.80, 1M output tokens = $4.00
      const cost = service.computeCostUsd(1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(4.80, 5);
    });

    it('returns 0 for 0 tokens', () => {
      expect(service.computeCostUsd(0, 0)).toBe(0);
    });

    it('accounts for higher cost of output tokens vs input tokens', () => {
      const inputOnly = service.computeCostUsd(1_000_000, 0);
      const outputOnly = service.computeCostUsd(0, 1_000_000);
      expect(outputOnly).toBeGreaterThan(inputOnly);
    });

    it('computes realistic per-call cost (1000 input + 200 output tokens)', () => {
      const cost = service.computeCostUsd(1000, 200);
      // (1000/1_000_000)*0.80 + (200/1_000_000)*4.00 = 0.0008 + 0.0008 = 0.0016
      expect(cost).toBeCloseTo(0.0016, 6);
    });
  });

  // ── recordSpend ─────────────────────────────────────────────────────────────

  describe('recordSpend', () => {
    it('increments the correct Redis key using INCRBYFLOAT', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await service.recordSpend(0.005);
      expect(mockRedisIncrbyfloat).toHaveBeenCalledWith(`ocr:spend:${today}`, 0.005);
    });

    it('sets a 48-hour TTL on the spend key', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await service.recordSpend(0.001);
      expect(mockRedisExpire).toHaveBeenCalledWith(`ocr:spend:${today}`, 48 * 3600);
    });

    it('returns the new cumulative total as a number', async () => {
      mockRedisIncrbyfloat.mockResolvedValueOnce('3.14');
      const result = await service.recordSpend(1.0);
      expect(result).toBeCloseTo(3.14, 5);
    });

    it('parses the Redis string response to a float', async () => {
      mockRedisIncrbyfloat.mockResolvedValueOnce('0.0016');
      const result = await service.recordSpend(0.0016);
      expect(typeof result).toBe('number');
      expect(result).toBeCloseTo(0.0016, 6);
    });
  });

  // ── getDailySpend ───────────────────────────────────────────────────────────

  describe('getDailySpend', () => {
    it('returns 0 when no spend has been recorded today', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      const result = await service.getDailySpend();
      expect(result).toBe(0);
    });

    it('returns the current cumulative spend as a number', async () => {
      mockRedisGet.mockResolvedValueOnce('12.345');
      const result = await service.getDailySpend();
      expect(result).toBeCloseTo(12.345, 5);
    });

    it('reads from the correct date-keyed Redis entry', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await service.getDailySpend();
      expect(mockRedisGet).toHaveBeenCalledWith(`ocr:spend:${today}`);
    });
  });

  // ── getSpendCap ─────────────────────────────────────────────────────────────

  describe('getSpendCap', () => {
    it('returns the configured cap as a number', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrSpendService,
          { provide: REDIS_CLIENT, useValue: mockRedis },
          {
            provide: ConfigService,
            useValue: { get: (_key: string, _defaultVal?: string) => '50' },
          },
        ],
      }).compile();
      const svc = module.get<OcrSpendService>(OcrSpendService);
      expect(await svc.getSpendCap()).toBe(50);
    });

    it('defaults to $20 when MAX_DAILY_OCR_SPEND_USD is not set', async () => {
      // ConfigService.get returns the default value ('20') when key not configured
      expect(await service.getSpendCap()).toBe(20);
    });

    it('returns $20 default when MAX_DAILY_OCR_SPEND_USD is a non-numeric string (P-1)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrSpendService,
          { provide: REDIS_CLIENT, useValue: mockRedis },
          {
            provide: ConfigService,
            useValue: { get: (_key: string, _defaultVal?: string) => 'disabled' },
          },
        ],
      }).compile();
      const svc = module.get<OcrSpendService>(OcrSpendService);
      expect(await svc.getSpendCap()).toBe(20);
    });

    it('returns $20 default when MAX_DAILY_OCR_SPEND_USD is "$20" with dollar sign (P-1)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrSpendService,
          { provide: REDIS_CLIENT, useValue: mockRedis },
          {
            provide: ConfigService,
            useValue: { get: (_key: string, _defaultVal?: string) => '$20' },
          },
        ],
      }).compile();
      const svc = module.get<OcrSpendService>(OcrSpendService);
      // parseFloat('$20') = NaN → fallback to 20
      expect(await svc.getSpendCap()).toBe(20);
    });
  });
});
