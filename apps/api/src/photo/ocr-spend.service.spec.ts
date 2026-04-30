import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrSpendService } from './ocr-spend.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ── Redis mock ───────────────────────────────────────────────────────────────

const mockRedisIncrbyfloat = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

const mockRedis = {
  incrbyfloat: mockRedisIncrbyfloat,
  expire: mockRedisExpire,
  get: mockRedisGet,
  set: mockRedisSet,
  del: mockRedisDel,
};

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockDailyApiCostUpsert = jest.fn();
const mockDailyApiCostFindMany = jest.fn();

const mockPrisma = {
  dailyApiCost: {
    upsert: mockDailyApiCostUpsert,
    findMany: mockDailyApiCostFindMany,
  },
};

// ── Config mock that returns specific values for specific keys ───────────────

function configWith(overrides: Record<string, string> = {}) {
  return {
    get: (key: string, defaultVal?: string) => overrides[key] ?? defaultVal ?? '',
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('OcrSpendService', () => {
  let service: OcrSpendService;
  let configOverrides: Record<string, string> = {};

  async function buildService(overrides: Record<string, string> = {}): Promise<OcrSpendService> {
    configOverrides = overrides;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrSpendService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: configWith(configOverrides) },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    return module.get<OcrSpendService>(OcrSpendService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRedisIncrbyfloat.mockResolvedValue('1.5');
    mockRedisExpire.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockDailyApiCostUpsert.mockResolvedValue({ date: new Date(), spend_usd: 0, image_count: 0 });
    mockDailyApiCostFindMany.mockResolvedValue([]);

    service = await buildService();
  });

  // ── computeCostUsd ──────────────────────────────────────────────────────────

  describe('computeCostUsd', () => {
    it('computes cost using Gemini Flash input and output token rates', () => {
      // 1M input tokens = $0.30, 1M output tokens = $2.50
      const cost = service.computeCostUsd(1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(2.80, 5);
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
      // (1000/1_000_000)*0.30 + (200/1_000_000)*2.50 = 0.0003 + 0.0005 = 0.0008
      expect(cost).toBeCloseTo(0.0008, 6);
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
          { provide: PrismaService, useValue: mockPrisma },
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
          { provide: PrismaService, useValue: mockPrisma },
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
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();
      const svc = module.get<OcrSpendService>(OcrSpendService);
      // parseFloat('$20') = NaN → fallback to 20
      expect(await svc.getSpendCap()).toBe(20);
    });
  });

  // ── persistDailySpend ───────────────────────────────────────────────────────

  describe('persistDailySpend', () => {
    it('upserts DailyApiCost keyed by today UTC date', async () => {
      await service.persistDailySpend(0.42);
      expect(mockDailyApiCostUpsert).toHaveBeenCalledTimes(1);
      const args = mockDailyApiCostUpsert.mock.calls[0][0];
      expect(args.where.date).toBeInstanceOf(Date);
      expect(args.create).toEqual(
        expect.objectContaining({ spend_usd: 0.42, image_count: 1 }),
      );
      expect(args.update.spend_usd).toEqual({ increment: 0.42 });
      expect(args.update.image_count).toEqual({ increment: 1 });
    });

    it('image_count increments by 1 on each call (accumulates across same-day calls)', async () => {
      await service.persistDailySpend(0.10);
      await service.persistDailySpend(0.20);
      await service.persistDailySpend(0.05);
      expect(mockDailyApiCostUpsert).toHaveBeenCalledTimes(3);
      for (const call of mockDailyApiCostUpsert.mock.calls) {
        expect(call[0].update.image_count).toEqual({ increment: 1 });
      }
    });
  });

  // ── recordSpend fire-and-forget safety ──────────────────────────────────────

  describe('recordSpend — fire-and-forget side effects', () => {
    it('returns the total even when persistDailySpend throws', async () => {
      mockRedisIncrbyfloat.mockResolvedValue('0.42');
      mockDailyApiCostUpsert.mockRejectedValueOnce(new Error('DB down'));
      // Wait for microtasks so the .catch path runs before we assert
      const total = await service.recordSpend(0.42);
      await new Promise(resolve => setImmediate(resolve));
      expect(total).toBeCloseTo(0.42, 5);
    });

    it('returns the total even when checkMonthlyAlert throws', async () => {
      mockRedisIncrbyfloat.mockResolvedValue('1.00');
      // Force checkMonthlyAlert onto a code path that would throw when fetching
      const svc = await buildService({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx' });
      mockDailyApiCostFindMany.mockRejectedValueOnce(new Error('DB down'));
      const total = await svc.recordSpend(1.00);
      await new Promise(resolve => setImmediate(resolve));
      expect(total).toBeCloseTo(1.00, 5);
    });
  });

  // ── getMonthlySpend ─────────────────────────────────────────────────────────

  describe('getMonthlySpend', () => {
    it('sums spend_usd over the requested UTC month', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([
        { spend_usd: 0.10 },
        { spend_usd: 0.25 },
        { spend_usd: 0.05 },
      ]);
      const total = await service.getMonthlySpend(2026, 4);
      expect(total).toBeCloseTo(0.40, 5);
      const callArg = mockDailyApiCostFindMany.mock.calls[0][0];
      expect(callArg.where.date.gte).toEqual(new Date(Date.UTC(2026, 3, 1)));
      expect(callArg.where.date.lt).toEqual(new Date(Date.UTC(2026, 4, 1)));
    });

    it('returns 0 when no rows match', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([]);
      expect(await service.getMonthlySpend(2026, 4)).toBe(0);
    });
  });

  // ── checkMonthlyAlert ───────────────────────────────────────────────────────

  describe('checkMonthlyAlert', () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
      (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('no-ops when SLACK_WEBHOOK_URL is not set', async () => {
      const svc = await buildService({}); // no webhook
      await svc.checkMonthlyAlert();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('no-ops when SLACK_WEBHOOK_URL does not start with hooks.slack.com (SSRF guard)', async () => {
      const svc = await buildService({ SLACK_WEBHOOK_URL: 'https://evil.example.com/hook' });
      await svc.checkMonthlyAlert();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-ops when Redis flag for the current month is already set', async () => {
      mockRedisGet.mockResolvedValueOnce('1');
      const svc = await buildService({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx' });
      await svc.checkMonthlyAlert();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-ops when monthly spend is below threshold', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 5 }]);
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await svc.checkMonthlyAlert();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('claims the dedup flag with SET NX before posting to Slack', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await svc.checkMonthlyAlert();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/xxx');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('[COST-ALERT]');
      // SET NX claim happens before fetch — guards against duplicate alerts under concurrency
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^ocr:cost_alert:\d{4}-\d{2}$/),
        '1',
        'EX',
        32 * 24 * 3600,
        'NX',
      );
      // Successful post: claim is kept (not deleted)
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('skips the Slack post when SET NX returns null (a concurrent caller beat us)', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      mockRedisSet.mockResolvedValueOnce(null); // someone else claimed the flag first
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await svc.checkMonthlyAlert();
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('releases the dedup flag (DEL) when Slack returns a non-2xx response', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await svc.checkMonthlyAlert();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      // Claim was released so the next OCR call can retry
      expect(mockRedisDel).toHaveBeenCalledWith(
        expect.stringMatching(/^ocr:cost_alert:\d{4}-\d{2}$/),
      );
    });

    it('releases the dedup flag (DEL) when fetch throws (network error / timeout)', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      fetchMock.mockRejectedValueOnce(new Error('AbortError: timeout'));
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await expect(svc.checkMonthlyAlert()).resolves.toBeUndefined();
      expect(mockRedisDel).toHaveBeenCalledWith(
        expect.stringMatching(/^ocr:cost_alert:\d{4}-\d{2}$/),
      );
    });

    it('omits the dashboard link from the Slack message when ADMIN_DASHBOARD_URL is unset', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '50',
      });
      await svc.checkMonthlyAlert();
      const [, opts] = fetchMock.mock.calls[0];
      // No dangling '/metrics' suffix
      expect(opts.body).not.toContain('/metrics');
    });
  });

  // ── getCostAlertThreshold (private, exercised via checkMonthlyAlert) ────────

  describe('getCostAlertThreshold (P-3)', () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
      (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('falls back to default $50 when COST_ALERT_THRESHOLD_USD is "Infinity"', async () => {
      // With Infinity passed through, the alert would never fire; the guard must prevent that.
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 75 }]);
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: 'Infinity',
      });
      await svc.checkMonthlyAlert();
      // $75 > $50 default → alert fires
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to default $50 when COST_ALERT_THRESHOLD_USD is partial-numeric ("5dollars" → 5 silently passes parseFloat)', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([{ spend_usd: 30 }]);
      const svc = await buildService({
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx',
        COST_ALERT_THRESHOLD_USD: '5dollars',
      });
      await svc.checkMonthlyAlert();
      // $30 < $50 default (would have been > '5dollars'→5) → alert does NOT fire
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── recordSpend NaN guard (P-2) ────────────────────────────────────────────

  describe('recordSpend NaN guard (P-2)', () => {
    it('returns 0 (not NaN) when INCRBYFLOAT returns a non-numeric value', async () => {
      mockRedisIncrbyfloat.mockResolvedValueOnce('corrupted');
      const result = await service.recordSpend(0.001);
      expect(result).toBe(0);
      expect(Number.isNaN(result)).toBe(false);
    });

    it('does not throw when redis.expire fails (P-1)', async () => {
      mockRedisExpire.mockRejectedValueOnce(new Error('redis blip'));
      await expect(service.recordSpend(0.001)).resolves.not.toThrow();
    });
  });
});
