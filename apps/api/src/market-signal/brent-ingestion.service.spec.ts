import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrentIngestionService } from './brent-ingestion.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockMarketSignalCreate = jest.fn();
const mockMarketSignalFindFirst = jest.fn();

const mockPrisma = {
  marketSignal: {
    create: mockMarketSignalCreate,
    findFirst: mockMarketSignalFindFirst,
  },
};

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedis = { get: mockRedisGet, set: mockRedisSet };

const mockConfigGet = jest.fn();
const mockConfig = { get: mockConfigGet };

// fetch is a global; jest.spyOn it so each test can choose a response.
const fetchSpy = jest.spyOn(global, 'fetch');

// Helper — builds a Response-like object with .ok + .json().
// Arrow form so the api package's babel-jest config doesn't choke on the
// TypeScript-annotated function declaration at module scope.
const jsonResponse = (status: number, body: unknown): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
  statusText: 'OK',
}) as unknown as Response;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BrentIngestionService', () => {
  let service: BrentIngestionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockConfigGet.mockReturnValue('fake-api-key');
    mockMarketSignalFindFirst.mockResolvedValue(null);
    mockMarketSignalCreate.mockResolvedValue({
      id: 'sig-1',
      signal_type: 'brent_crude_pln',
      value: 1.776,
      pct_change: null,
      significant_movement: false,
      rate_source: 'live',
      recorded_at: new Date('2026-05-09T12:00:00Z'),
      created_at: new Date('2026-05-09T12:00:00Z'),
    });
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrentIngestionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(BrentIngestionService);
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  // ── Missing API key ────────────────────────────────────────────────────────

  describe('when ALPHA_VANTAGE_API_KEY is not set', () => {
    it('returns null without attempting fetch (acceptable in dev/staging)', async () => {
      mockConfigGet.mockReturnValueOnce(undefined);

      const result = await service.ingest();

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockMarketSignalCreate).not.toHaveBeenCalled();
    });
  });

  // ── fetchBrentUsd ──────────────────────────────────────────────────────────

  describe('fetchBrentUsd', () => {
    it('parses the latest Brent USD/bbl + bar date from Alpha Vantage response', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { data: [{ date: '2026-05-09', value: '72.42' }] }),
      );

      const result = await service.fetchBrentUsd('fake-api-key');

      expect(result).toEqual({ value: 72.42, date: '2026-05-09' });
    });

    it('sorts data by date desc — does not blindly trust [0] is latest', async () => {
      // If Alpha Vantage returns ascending order, [0] would be the
      // OLDEST entry. The sort guards against that.
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            { date: '2026-05-07', value: '70.00' },
            { date: '2026-05-08', value: '71.00' },
            { date: '2026-05-09', value: '72.42' },
          ],
        }),
      );

      const result = await service.fetchBrentUsd('fake-api-key');

      expect(result).toEqual({ value: 72.42, date: '2026-05-09' });
    });

    it('detects Alpha Vantage rate-limit "Note" response and tags as ops alert', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { Note: 'Thank you for using Alpha Vantage! ... 25 requests/day' }),
      );

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('detects Alpha Vantage "Information" response (rate limit variant)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { Information: 'Our standard API rate limit is 25 requests/day' }),
      );

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('returns null on non-200 response', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}));

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('returns null when latest value is "." (Alpha Vantage missing-value sentinel)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { data: [{ date: '2026-05-09', value: '.' }] }),
      );

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('returns null when latest value is empty string', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '' }] }));

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('returns null when value is outside plausible range (>$300/bbl)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { data: [{ date: '2026-05-09', value: '500.00' }] }),
      );

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });

    it('returns null on fetch exception (network / timeout)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));

      expect(await service.fetchBrentUsd('fake-api-key')).toBeNull();
    });
  });

  // ── fetchNbpRate ───────────────────────────────────────────────────────────

  describe('fetchNbpRate', () => {
    it('returns "live" rate on successful NBP response and writes to Redis', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, { rates: [{ no: '085/A', effectiveDate: '2026-05-09', mid: 3.92 }] }),
      );

      const result = await service.fetchNbpRate();

      expect(result).toEqual({ rate: 3.92, source: 'live' });
      expect(mockRedisSet).toHaveBeenCalledWith('market:nbp:usd_pln', '3.92', 'EX', 24 * 3600);
    });

    it('returns "cached" rate when NBP fails AND Redis has a cached value', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
      mockRedisGet.mockResolvedValueOnce('3.85');

      const result = await service.fetchNbpRate();

      expect(result).toEqual({ rate: 3.85, source: 'cached' });
    });

    it('returns null when NBP fails AND Redis cache is empty', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
      mockRedisGet.mockResolvedValueOnce(null);

      expect(await service.fetchNbpRate()).toBeNull();
    });

    it('returns null when NBP value is implausible (>20 PLN/USD) AND no cache', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 50 }] }));
      mockRedisGet.mockResolvedValueOnce(null);

      expect(await service.fetchNbpRate()).toBeNull();
    });

    it('returns null when cached value is implausible (corrupted)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('NBP down'));
      mockRedisGet.mockResolvedValueOnce('not-a-number');

      expect(await service.fetchNbpRate()).toBeNull();
    });

    it('still returns "live" when Redis SET fails (best-effort cache write)', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 3.9 }] }));
      mockRedisSet.mockRejectedValueOnce(new Error('Redis full'));

      const result = await service.fetchNbpRate();

      expect(result).toEqual({ rate: 3.9, source: 'live' });
    });
  });

  // ── ingest orchestration ──────────────────────────────────────────────────

  describe('ingest', () => {
    it('persists a brent_crude_pln signal with rate_source=live and correct PLN/litre math', async () => {
      // Brent fetch + NBP fetch are sequential — order matters in the mock chain.
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '72.00' }] }))
        .mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 3.92 }] }));

      const result = await service.ingest();

      expect(result).not.toBeNull();
      expect(mockMarketSignalCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signal_type: 'brent_crude_pln',
          // 72 × 3.92 ÷ 158.987 = 1.7754... PLN/litre
          value: expect.closeTo(1.7754, 3),
          pct_change: null, // first ingestion → no previous
          significant_movement: false,
          rate_source: 'live',
        }),
      });
    });

    it('persists rate_source=cached when NBP fails AND cache hits', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '72.00' }] }))
        .mockRejectedValueOnce(new Error('NBP timeout'));
      mockRedisGet.mockResolvedValueOnce('3.92');

      await service.ingest();

      expect(mockMarketSignalCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ rate_source: 'cached' }),
      });
    });

    it('returns null and does NOT persist when Brent fetch fails', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}));

      const result = await service.ingest();

      expect(result).toBeNull();
      expect(mockMarketSignalCreate).not.toHaveBeenCalled();
    });

    it('returns null and does NOT persist when NBP unavailable AND no cache', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '72.00' }] }))
        .mockRejectedValueOnce(new Error('NBP down'));
      mockRedisGet.mockResolvedValueOnce(null);

      const result = await service.ingest();

      expect(result).toBeNull();
      expect(mockMarketSignalCreate).not.toHaveBeenCalled();
    });

    it('SKIPS persisting a duplicate bar when previous signal has the same date', async () => {
      // Cron fires twice/day; Alpha Vantage publishes once/day. Without
      // dedup, the second run would persist the same bar as a duplicate
      // with pct_change = 0, masking a genuine next-day move.
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '72.00' }] }))
        .mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 3.92 }] }));
      mockMarketSignalFindFirst.mockResolvedValueOnce({
        id: 'prev',
        signal_type: 'brent_crude_pln',
        value: 1.7754,
        pct_change: null,
        significant_movement: false,
        rate_source: 'live',
        recorded_at: new Date('2026-05-09T06:00:00Z'),
        created_at: new Date('2026-05-09T06:00:00Z'),
      });

      const result = await service.ingest();

      expect(result).toBeNull();
      expect(mockMarketSignalCreate).not.toHaveBeenCalled();
    });

    it('PROCEEDS when previous signal has a different bar date (next day cron run)', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-10', value: '73.00' }] }))
        .mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 3.92 }] }));
      mockMarketSignalFindFirst.mockResolvedValueOnce({
        id: 'prev',
        signal_type: 'brent_crude_pln',
        value: 1.7754,
        pct_change: null,
        significant_movement: false,
        rate_source: 'live',
        recorded_at: new Date('2026-05-09T06:00:00Z'),
        created_at: new Date('2026-05-09T06:00:00Z'),
      });

      await service.ingest();

      expect(mockMarketSignalCreate).toHaveBeenCalled();
    });

    it('computes pct_change vs previous brent signal and flags significant movement', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ date: '2026-05-09', value: '75.00' }] }))
        .mockResolvedValueOnce(jsonResponse(200, { rates: [{ no: 'x', effectiveDate: 'x', mid: 3.92 }] }));
      // Previous brent signal: 1.7754 PLN/l. New: 75 × 3.92 / 158.987 = 1.8494
      // → +4.2% upward → significant
      mockMarketSignalFindFirst.mockResolvedValueOnce({
        id: 'prev',
        signal_type: 'brent_crude_pln',
        value: 1.7754,
        pct_change: null,
        significant_movement: false,
        rate_source: 'live',
        recorded_at: new Date('2026-05-08T12:00:00Z'),
        created_at: new Date('2026-05-08T12:00:00Z'),
      });

      const result = await service.ingest();

      expect(result?.significantMovement).toBe(true);
      expect(result?.pctChange).toBeGreaterThan(0.03);
      expect(mockMarketSignalCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          significant_movement: true,
          pct_change: expect.any(Number),
        }),
      });
    });
  });
});
