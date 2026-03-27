import { Test, TestingModule } from '@nestjs/testing';
import { PriceCacheService, StationPriceRow } from './price-cache.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const mockMulti = {
  del: jest.fn().mockReturnThis(),
  setex: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  mget: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  multi: jest.fn().mockReturnValue(mockMulti),
};

const makeRow = (stationId: string): StationPriceRow => ({
  stationId,
  prices: { PB_95: 6.42, ON: 6.89 },
  sources: { PB_95: 'community', ON: 'community' },
  updatedAt: new Date('2026-03-01T10:00:00.000Z'),
});

describe('PriceCacheService', () => {
  let service: PriceCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.multi.mockReturnValue(mockMulti);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceCacheService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<PriceCacheService>(PriceCacheService);
  });

  describe('getMany', () => {
    it('returns cached rows for all hits', async () => {
      const row = makeRow('station-1');
      const serialized = JSON.stringify({ ...row, updatedAt: row.updatedAt.toISOString() });
      mockRedis.mget.mockResolvedValueOnce([serialized]);

      const result = await service.getMany(['station-1']);

      expect(result.get('station-1')).toMatchObject({
        stationId: 'station-1',
        prices: { PB_95: 6.42, ON: 6.89 },
        sources: { PB_95: 'community', ON: 'community' },
      });
    });

    it('returns null for cache misses', async () => {
      mockRedis.mget.mockResolvedValueOnce([null]);

      const result = await service.getMany(['station-1']);

      expect(result.get('station-1')).toBeNull();
    });

    it('handles mixed hits and misses', async () => {
      const row = makeRow('station-1');
      const serialized = JSON.stringify({ ...row, updatedAt: row.updatedAt.toISOString() });
      mockRedis.mget.mockResolvedValueOnce([serialized, null]);

      const result = await service.getMany(['station-1', 'station-2']);

      expect(result.get('station-1')).not.toBeNull();
      expect(result.get('station-2')).toBeNull();
    });

    it('returns empty map for empty input without calling mget (P2)', async () => {
      const result = await service.getMany([]);

      expect(result.size).toBe(0);
      expect(mockRedis.mget).not.toHaveBeenCalled(); // guard: never sends 0-arg MGET to Redis
    });

    it('deserializes updatedAt as a Date object', async () => {
      const row = makeRow('station-1');
      const serialized = JSON.stringify({ ...row, updatedAt: row.updatedAt.toISOString() });
      mockRedis.mget.mockResolvedValueOnce([serialized]);

      const result = await service.getMany(['station-1']);

      expect(result.get('station-1')?.updatedAt).toBeInstanceOf(Date);
      expect(result.get('station-1')?.updatedAt.toISOString()).toBe('2026-03-01T10:00:00.000Z');
    });

    it('propagates Redis errors (caller handles fallback)', async () => {
      mockRedis.mget.mockRejectedValueOnce(new Error('Redis down'));

      await expect(service.getMany(['station-1'])).rejects.toThrow('Redis down');
    });

    it('treats corrupt JSON as a cache miss and invalidates the key (P1)', async () => {
      mockRedis.mget.mockResolvedValueOnce(['not-valid-json{{{']);
      mockRedis.del.mockResolvedValueOnce(1);

      const result = await service.getMany(['station-1']);

      expect(result.get('station-1')).toBeNull(); // treated as miss
      expect(mockRedis.del).toHaveBeenCalledWith('price:station:station-1'); // bad key invalidated
    });

    it('continues processing remaining stations after a corrupt entry (P1)', async () => {
      const row = makeRow('station-2');
      const serialized = JSON.stringify({ ...row, updatedAt: row.updatedAt.toISOString() });
      mockRedis.mget.mockResolvedValueOnce(['not-valid-json{{{', serialized]);
      mockRedis.del.mockResolvedValueOnce(1);

      const result = await service.getMany(['station-1', 'station-2']);

      expect(result.get('station-1')).toBeNull();
      expect(result.get('station-2')).not.toBeNull();
    });

    it('calls mget with correct key prefix', async () => {
      mockRedis.mget.mockResolvedValueOnce([null, null]);

      await service.getMany(['station-1', 'station-2']);

      expect(mockRedis.mget).toHaveBeenCalledWith([
        'price:station:station-1',
        'price:station:station-2',
      ]);
    });
  });

  describe('set', () => {
    it('calls setex with correct key, TTL, and serialized value', async () => {
      mockRedis.setex.mockResolvedValueOnce('OK');
      const row = makeRow('station-1');

      await service.set('station-1', row);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'price:station:station-1',
        86400,
        expect.stringContaining('"stationId":"station-1"'),
      );
    });

    it('serializes updatedAt as ISO string', async () => {
      mockRedis.setex.mockResolvedValueOnce('OK');
      const row = makeRow('station-1');

      await service.set('station-1', row);

      const [, , serialized] = mockRedis.setex.mock.calls[0] as [string, number, string];
      const parsed = JSON.parse(serialized) as { updatedAt: string };
      expect(typeof parsed.updatedAt).toBe('string');
      expect(parsed.updatedAt).toBe('2026-03-01T10:00:00.000Z');
    });

    it('swallows Redis errors silently', async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error('Redis down'));
      const row = makeRow('station-1');

      await expect(service.set('station-1', row)).resolves.not.toThrow();
    });
  });

  describe('setAtomic', () => {
    it('executes DEL then SETEX in a MULTI block', async () => {
      const row = makeRow('station-1');

      await service.setAtomic('station-1', row);

      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockMulti.del).toHaveBeenCalledWith('price:station:station-1');
      expect(mockMulti.setex).toHaveBeenCalledWith(
        'price:station:station-1',
        86400,
        expect.stringContaining('"stationId":"station-1"'),
      );
      expect(mockMulti.exec).toHaveBeenCalled();
    });

    it('propagates errors (atomic write failure is critical)', async () => {
      mockMulti.exec.mockRejectedValueOnce(new Error('EXEC failed'));
      const row = makeRow('station-1');

      await expect(service.setAtomic('station-1', row)).rejects.toThrow('EXEC failed');
    });
  });

  describe('invalidate', () => {
    it('calls DEL with the correct key', async () => {
      mockRedis.del.mockResolvedValueOnce(1);

      await service.invalidate('station-1');

      expect(mockRedis.del).toHaveBeenCalledWith('price:station:station-1');
    });

    it('propagates Redis errors', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Redis down'));

      await expect(service.invalidate('station-1')).rejects.toThrow('Redis down');
    });
  });
});
