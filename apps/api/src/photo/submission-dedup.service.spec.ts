import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// ── Redis mock ───────────────────────────────────────────────────────────────

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisTtl = jest.fn();

const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
  del: mockRedisDel,
  ttl: mockRedisTtl,
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('SubmissionDedupService', () => {
  let service: SubmissionDedupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockRedisTtl.mockResolvedValue(-2); // -2 = key absent (default)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionDedupService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<SubmissionDedupService>(SubmissionDedupService);
  });

  // ── computePhotoHash ────────────────────────────────────────────────────────

  describe('computePhotoHash', () => {
    it('returns a 64-char hex SHA-256 string', () => {
      const hash = SubmissionDedupService.computePhotoHash(Buffer.from('test'));
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic — same buffer always produces same hash', () => {
      const buf = Buffer.from('photo-bytes');
      expect(SubmissionDedupService.computePhotoHash(buf)).toBe(
        SubmissionDedupService.computePhotoHash(buf),
      );
    });

    it('produces different hashes for different buffers', () => {
      const h1 = SubmissionDedupService.computePhotoHash(Buffer.from('photo-a'));
      const h2 = SubmissionDedupService.computePhotoHash(Buffer.from('photo-b'));
      expect(h1).not.toBe(h2);
    });
  });

  // ── checkStationDedup ───────────────────────────────────────────────────────

  describe('checkStationDedup', () => {
    it('returns false when no dedup key exists (cache miss)', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      expect(await service.checkStationDedup('station-abc')).toBe(false);
    });

    it('returns true when dedup key exists (cache hit)', async () => {
      mockRedisGet.mockResolvedValueOnce('1');
      expect(await service.checkStationDedup('station-abc')).toBe(true);
    });

    it('reads from the correct Redis key', async () => {
      await service.checkStationDedup('station-xyz');
      expect(mockRedisGet).toHaveBeenCalledWith('dedup:station:station-xyz');
    });
  });

  // ── recordStationDedup ──────────────────────────────────────────────────────

  describe('recordStationDedup', () => {
    it('sets the correct Redis key with 12-hour TTL', async () => {
      await service.recordStationDedup('station-abc');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'dedup:station:station-abc',
        '1',
        'EX',
        12 * 3600,
      );
    });
  });

  // ── checkHashDedup ──────────────────────────────────────────────────────────

  describe('checkHashDedup', () => {
    it('returns false when no hash key exists', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      expect(await service.checkHashDedup('abc123')).toBe(false);
    });

    it('returns true when hash key exists', async () => {
      mockRedisGet.mockResolvedValueOnce('1');
      expect(await service.checkHashDedup('abc123')).toBe(true);
    });

    it('reads from the correct Redis key', async () => {
      await service.checkHashDedup('deadbeef');
      expect(mockRedisGet).toHaveBeenCalledWith('dedup:hash:deadbeef');
    });
  });

  // ── recordHashDedup ─────────────────────────────────────────────────────────

  describe('recordHashDedup', () => {
    it('sets the correct Redis key with 24-hour TTL', async () => {
      await service.recordHashDedup('deadbeef');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'dedup:hash:deadbeef',
        '1',
        'EX',
        24 * 3600,
      );
    });
  });

  // ── liftDedup (Story 3.14 — flag-wrong) ─────────────────────────────────────

  describe('liftDedup', () => {
    it('deletes both station and hash dedup keys when both are provided', async () => {
      await service.liftDedup('station-abc', 'deadbeef');
      expect(mockRedisDel).toHaveBeenCalledWith('dedup:station:station-abc');
      expect(mockRedisDel).toHaveBeenCalledWith('dedup:hash:deadbeef');
      expect(mockRedisDel).toHaveBeenCalledTimes(2);
    });

    it('skips station delete when stationId is null', async () => {
      await service.liftDedup(null, 'deadbeef');
      expect(mockRedisDel).toHaveBeenCalledTimes(1);
      expect(mockRedisDel).toHaveBeenCalledWith('dedup:hash:deadbeef');
    });

    it('skips hash delete when photoHash is null', async () => {
      await service.liftDedup('station-abc', null);
      expect(mockRedisDel).toHaveBeenCalledTimes(1);
      expect(mockRedisDel).toHaveBeenCalledWith('dedup:station:station-abc');
    });

    it('is a no-op when both args are null', async () => {
      await service.liftDedup(null, null);
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('does not throw when one Redis delete fails', async () => {
      mockRedisDel.mockRejectedValueOnce(new Error('Redis down'));
      mockRedisDel.mockResolvedValueOnce(1);
      await expect(service.liftDedup('station-abc', 'deadbeef')).resolves.toBeUndefined();
      // Both attempts should be made even if the first fails
      expect(mockRedisDel).toHaveBeenCalledTimes(2);
    });

    it('does not throw when both Redis deletes fail (best-effort semantics)', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      await expect(service.liftDedup('station-abc', 'deadbeef')).resolves.toBeUndefined();
    });
  });

  // ── Story 3.16: hashPriceData ──────────────────────────────────────────────

  describe('hashPriceData', () => {
    it('produces the same hash for identical price sets regardless of input order', () => {
      const a = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
        { fuel_type: 'ON', price_per_litre: 6.99 },
      ]);
      const b = SubmissionDedupService.hashPriceData([
        { fuel_type: 'ON', price_per_litre: 6.99 },
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
      ]);
      expect(a).toBe(b);
    });

    it('rounds to 2 decimal places before hashing (6.490 == 6.49)', () => {
      const rounded = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
      ]);
      const trailing = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.490 },
      ]);
      const verbose = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.494 },
      ]);
      expect(rounded).toBe(trailing);
      expect(rounded).toBe(verbose);
    });

    it('drops null and non-finite prices from the hash', () => {
      const withNulls = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
        { fuel_type: 'ON', price_per_litre: null },
        { fuel_type: 'LPG', price_per_litre: NaN },
      ]);
      const withoutNulls = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
      ]);
      expect(withNulls).toBe(withoutNulls);
    });

    it('treats different fuel sets as different scenes (different hashes)', () => {
      const small = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
      ]);
      const big = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
        { fuel_type: 'ON', price_per_litre: 6.99 },
      ]);
      expect(small).not.toBe(big);
    });

    it('uppercases fuel_type so a casing drift does not falsely mismatch (P-15)', () => {
      const upper = SubmissionDedupService.hashPriceData([
        { fuel_type: 'ON', price_per_litre: 6.99 },
      ]);
      const lower = SubmissionDedupService.hashPriceData([
        { fuel_type: 'on', price_per_litre: 6.99 },
      ]);
      expect(upper).toBe(lower);
    });

    it('returns a unique sentinel for an empty / all-null price set (P-17)', () => {
      const a = SubmissionDedupService.hashPriceData([]);
      const b = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: null },
      ]);
      // Both fall through to the empty branch and must NOT collide.
      expect(a).not.toBe(b);
      expect(a.startsWith('empty:')).toBe(true);
      expect(b.startsWith('empty:')).toBe(true);
    });

    it('produces a 64-char SHA-256 hex for non-empty inputs', () => {
      const h = SubmissionDedupService.hashPriceData([
        { fuel_type: 'PB_95', price_per_litre: 6.49 },
      ]);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Story 3.16: compareWithinNoise ─────────────────────────────────────────

  describe('compareWithinNoise', () => {
    it('returns within-noise for identical prices', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
          [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
        ),
      ).toBe('within-noise');
    });

    it('returns within-noise when every fuel agrees within ±0.05 PLN/l', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [
            { fuel_type: 'PB_95', price_per_litre: 6.49 },
            { fuel_type: 'ON', price_per_litre: 6.99 },
          ],
          [
            { fuel_type: 'PB_95', price_per_litre: 6.52 },
            { fuel_type: 'ON', price_per_litre: 6.96 },
          ],
        ),
      ).toBe('within-noise');
    });

    it('treats exactly ±0.05 as within-noise (inclusive boundary, AC2)', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
          [{ fuel_type: 'PB_95', price_per_litre: 6.54 }],
        ),
      ).toBe('within-noise');
    });

    it('returns beyond-noise when any single fuel differs by more than ±0.05', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [
            { fuel_type: 'PB_95', price_per_litre: 6.49 },
            { fuel_type: 'ON', price_per_litre: 6.99 },
          ],
          [
            { fuel_type: 'PB_95', price_per_litre: 6.49 },
            { fuel_type: 'ON', price_per_litre: 7.10 }, // 0.11 — beyond noise
          ],
        ),
      ).toBe('beyond-noise');
    });

    it('returns fuel-set-mismatch when fuel keys differ', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
          [
            { fuel_type: 'PB_95', price_per_litre: 6.49 },
            { fuel_type: 'LPG', price_per_litre: 3.49 },
          ],
        ),
      ).toBe('fuel-set-mismatch');
    });

    it('normalizes fuel_type case for the compare (P-15)', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [{ fuel_type: 'ON', price_per_litre: 6.99 }],
          [{ fuel_type: 'on', price_per_litre: 6.99 }],
        ),
      ).toBe('within-noise');
    });

    it('drops null prices from both sides before comparing', () => {
      expect(
        SubmissionDedupService.compareWithinNoise(
          [
            { fuel_type: 'PB_95', price_per_litre: 6.49 },
            { fuel_type: 'ON', price_per_litre: null },
          ],
          [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
        ),
      ).toBe('within-noise');
    });
  });

  // ── Story 3.16: parseDedupRecord ───────────────────────────────────────────

  describe('parseDedupRecord', () => {
    it("treats legacy '1' value as count: 1, confirmed: false, prices_hash: null", () => {
      const r = SubmissionDedupService.parseDedupRecord('1', 12 * 3600);
      expect(r).not.toBeNull();
      expect(r!.count).toBe(1);
      expect(r!.confirmed).toBe(false);
      expect(r!.prices_hash).toBeNull();
    });

    it("derives last_at from remaining TTL when input is legacy '1' (AC11)", () => {
      const r = SubmissionDedupService.parseDedupRecord('1', 12 * 3600);
      // Full TTL remaining → last_at ≈ now (within 5s)
      expect(Math.abs(Date.now() - r!.last_at)).toBeLessThan(5_000);
    });

    it("falls back to STATION_DEDUP_WINDOW_SECONDS when ttlSeconds <= 0 (P-7 race protection)", () => {
      const r = SubmissionDedupService.parseDedupRecord('1', -2);
      // Negative TTL → safe fallback to full window → last_at ≈ now
      expect(Math.abs(Date.now() - r!.last_at)).toBeLessThan(5_000);
    });

    it('parses a valid JSON record', () => {
      const raw = JSON.stringify({
        count: 2,
        confirmed: true,
        prices_hash: 'abc',
        last_at: 1234567890,
      });
      const r = SubmissionDedupService.parseDedupRecord(raw, 6 * 3600);
      expect(r).toEqual({
        count: 2,
        confirmed: true,
        prices_hash: 'abc',
        last_at: 1234567890,
      });
    });

    it('rejects records with negative count (P-8)', () => {
      const raw = JSON.stringify({
        count: -1,
        confirmed: true,
        prices_hash: 'abc',
        last_at: Date.now(),
      });
      expect(SubmissionDedupService.parseDedupRecord(raw, 3600)).toBeNull();
    });

    it('rejects records with count > 2 (P-8)', () => {
      const raw = JSON.stringify({
        count: 99,
        confirmed: true,
        prices_hash: 'abc',
        last_at: Date.now(),
      });
      expect(SubmissionDedupService.parseDedupRecord(raw, 3600)).toBeNull();
    });

    it('rejects records with non-integer count (P-8)', () => {
      const raw = JSON.stringify({
        count: 1.5,
        confirmed: false,
        prices_hash: null,
        last_at: Date.now(),
      });
      expect(SubmissionDedupService.parseDedupRecord(raw, 3600)).toBeNull();
    });

    it('rejects records with NaN/Infinity last_at (P-8)', () => {
      const rawNaN = JSON.stringify({
        count: 1,
        confirmed: false,
        prices_hash: null,
        // JSON.stringify replaces NaN with null in spec, but defensive against
        // hand-written keys: build the raw string directly.
        last_at: 'NaN',
      }).replace('"NaN"', 'NaN');
      expect(SubmissionDedupService.parseDedupRecord(rawNaN, 3600)).toBeNull();
    });

    it('rejects records with far-future last_at (clock-skew protection)', () => {
      const raw = JSON.stringify({
        count: 1,
        confirmed: false,
        prices_hash: null,
        last_at: Date.now() + 24 * 3600 * 1000, // 24h ahead → reject
      });
      expect(SubmissionDedupService.parseDedupRecord(raw, 3600)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(SubmissionDedupService.parseDedupRecord('not-json{{', 3600)).toBeNull();
    });

    it('returns null for unknown shape', () => {
      expect(
        SubmissionDedupService.parseDedupRecord(
          JSON.stringify({ unrelated: 'object' }),
          3600,
        ),
      ).toBeNull();
    });
  });

  // ── Story 3.16: checkStationConsensus ──────────────────────────────────────

  describe('checkStationConsensus', () => {
    it("returns 'fresh' with record: null when no key exists", async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockRedisTtl.mockResolvedValueOnce(-2);

      const result = await service.checkStationConsensus('station-1');

      expect(result).toEqual({ skip: false, reason: 'fresh', record: null });
    });

    it("returns 'corroborate-candidate' when count: 1 record exists", async () => {
      const record = { count: 1, confirmed: false, prices_hash: 'h', last_at: Date.now() };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(record));
      mockRedisTtl.mockResolvedValueOnce(6 * 3600);

      const result = await service.checkStationConsensus('station-1');

      expect(result.skip).toBe(false);
      expect(result.reason).toBe('corroborate-candidate');
      if (result.reason === 'corroborate-candidate') {
        expect(result.record.count).toBe(1);
      }
    });

    it("returns skip: true when record is confirmed", async () => {
      const record = { count: 2, confirmed: true, prices_hash: 'h', last_at: Date.now() };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(record));
      mockRedisTtl.mockResolvedValueOnce(6 * 3600);

      const result = await service.checkStationConsensus('station-1');

      expect(result.skip).toBe(true);
      expect(result.reason).toBe('duplicate');
    });

    it("falls open to 'fresh' when Redis throws (fail-open semantics)", async () => {
      mockRedisGet.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.checkStationConsensus('station-1');

      expect(result).toEqual({ skip: false, reason: 'fresh', record: null });
    });

    it("treats unparseable raw value as 'fresh'", async () => {
      mockRedisGet.mockResolvedValueOnce('garbage{{{');
      mockRedisTtl.mockResolvedValueOnce(3600);

      const result = await service.checkStationConsensus('station-1');

      expect(result).toEqual({ skip: false, reason: 'fresh', record: null });
    });

    it("migrates legacy '1' value lazily to corroborate-candidate", async () => {
      mockRedisGet.mockResolvedValueOnce('1');
      mockRedisTtl.mockResolvedValueOnce(6 * 3600);

      const result = await service.checkStationConsensus('station-1');

      expect(result.reason).toBe('corroborate-candidate');
      if (result.reason === 'corroborate-candidate') {
        expect(result.record.count).toBe(1);
        expect(result.record.confirmed).toBe(false);
        expect(result.record.prices_hash).toBeNull();
      }
    });
  });

  // ── Story 3.16: recordStationConsensus ─────────────────────────────────────

  describe('recordStationConsensus', () => {
    it('writes JSON record with 12h TTL', async () => {
      const record = { count: 2, confirmed: true, prices_hash: 'abc', last_at: 12345 };
      await service.recordStationConsensus('station-1', record);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'dedup:station:station-1',
        JSON.stringify(record),
        'EX',
        12 * 3600,
      );
    });
  });
});
