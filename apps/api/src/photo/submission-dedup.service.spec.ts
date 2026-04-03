import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// ── Redis mock ───────────────────────────────────────────────────────────────

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('SubmissionDedupService', () => {
  let service: SubmissionDedupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

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
});
