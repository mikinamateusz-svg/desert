import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { REDIS_CLIENT, REDIS_QUEUE_CLIENT, RedisModule } from './redis.module.js';

// ── ioredis mock ────────────────────────────────────────────────────────────

// `new Redis(url, opts)` is recorded so tests can assert which URL each
// of the two clients connected to. Each call returns a UNIQUE object
// so identity checks (`!== `) can distinguish the two clients.
const mockOn = jest.fn();
const mockRedisCtor = jest.fn();
let mockRedisCounter = 0;
const ioredisQuits: jest.Mock[] = [];

jest.mock('ioredis', () =>
  jest.fn().mockImplementation((url: string, opts: Record<string, unknown>) => {
    mockRedisCtor(url, opts);
    const quit = jest.fn().mockResolvedValue('OK');
    ioredisQuits.push(quit);
    return {
      __id: `redis-${++mockRedisCounter}`,
      __url: url,
      on: mockOn,
      quit,
    };
  }),
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a test module with RedisModule wired against a forRoot
 * ConfigModule that returns the given env-var values. ConfigModule.forRoot
 * with `load:` is the cleanest way to put ConfigService in the same scope
 * as RedisModule's factories (which `inject: [ConfigService]`).
 */
async function buildModule(
  redisUrl: string,
  bullRedisUrl: string,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ REDIS_URL: redisUrl, BULL_REDIS_URL: bullRedisUrl })],
      }),
      RedisModule,
    ],
  }).compile();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RedisModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisCtor.mockClear();
    mockRedisCounter = 0;
    ioredisQuits.length = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('Dual-client factory (same broker — staging-style)', () => {
    let module: TestingModule;

    beforeEach(async () => {
      module = await buildModule('redis://localhost:6379', 'redis://localhost:6379');
    });

    afterEach(async () => {
      await module.close();
    });

    it('provides REDIS_CLIENT built from REDIS_URL', () => {
      const client = module.get(REDIS_CLIENT);
      expect(client).toBeDefined();
      const urls = mockRedisCtor.mock.calls.map((args) => args[0]);
      expect(urls).toContain('redis://localhost:6379');
    });

    it('provides REDIS_QUEUE_CLIENT built from BULL_REDIS_URL', () => {
      const queueClient = module.get(REDIS_QUEUE_CLIENT);
      expect(queueClient).toBeDefined();
      const urls = mockRedisCtor.mock.calls.map((args) => args[0]);
      expect(urls).toContain('redis://localhost:6379');
    });

    it('REDIS_CLIENT and REDIS_QUEUE_CLIENT are DISTINCT ioredis instances', () => {
      // Even when both URLs point at the same broker (staging), the
      // tokens resolve to different ioredis instances. This matters
      // because BullMQ's queue side and the cache side need their own
      // command pipelines — a shared instance could pipeline cache
      // ops behind a slow Queue.add() under load.
      const client = module.get(REDIS_CLIENT) as { __id: string };
      const queueClient = module.get(REDIS_QUEUE_CLIENT) as { __id: string };
      expect(client.__id).not.toBe(queueClient.__id);
    });

    it('both clients use maxRetriesPerRequest: null + enableReadyCheck: false (BullMQ-eligible)', () => {
      module.get(REDIS_CLIENT);
      module.get(REDIS_QUEUE_CLIENT);
      // Both factory calls received the BullMQ-eligible options.
      expect(mockRedisCtor).toHaveBeenCalledTimes(2);
      for (const [, opts] of mockRedisCtor.mock.calls as Array<[string, Record<string, unknown>]>) {
        expect(opts.maxRetriesPerRequest).toBeNull();
        expect(opts.enableReadyCheck).toBe(false);
      }
    });
  });

  describe('Dual-client factory (different brokers — prod-style)', () => {
    // Prod: REDIS_URL → Upstash, BULL_REDIS_URL → Railway Redis. The
    // refactor exists specifically to support this split.
    let module: TestingModule;

    beforeEach(async () => {
      module = await buildModule(
        'rediss://upstash.io:6379',
        'redis://railway.internal:6379',
      );
    });

    afterEach(async () => {
      await module.close();
    });

    it('REDIS_CLIENT connects to REDIS_URL (Upstash)', () => {
      const client = module.get(REDIS_CLIENT) as { __url: string };
      expect(client.__url).toBe('rediss://upstash.io:6379');
    });

    it('REDIS_QUEUE_CLIENT connects to BULL_REDIS_URL (Railway Redis)', () => {
      const queueClient = module.get(REDIS_QUEUE_CLIENT) as { __url: string };
      expect(queueClient.__url).toBe('redis://railway.internal:6379');
    });

    it('does NOT throw at boot time when the two URLs diverge (legacy assertion removed)', async () => {
      // Earlier hardening-2 revision had a boot-time assertion that
      // the two URLs must match. That assertion was load-bearing
      // ONLY when both clients were the same instance — now the
      // split-client architecture supports divergence by design.
      // Asserting absence-of-throw pins the design intent.
      const m = await buildModule(
        'rediss://upstash.io:6379',
        'redis://railway.internal:6379',
      );
      expect(m.get(REDIS_CLIENT)).toBeDefined();
      expect(m.get(REDIS_QUEUE_CLIENT)).toBeDefined();
      await m.close();
    });
  });

  describe('onModuleDestroy quits BOTH clients', () => {
    it('calls .quit() on both REDIS_CLIENT and REDIS_QUEUE_CLIENT when the module is destroyed', async () => {
      const module = await buildModule('redis://localhost:6379', 'redis://localhost:6379');

      module.get(REDIS_CLIENT);
      module.get(REDIS_QUEUE_CLIENT);
      expect(ioredisQuits).toHaveLength(2);
      ioredisQuits.forEach((q) => q.mockClear());

      await module.close();

      // Both shared clients fire their quit() exactly once on destroy.
      // Workers' onModuleDestroy implementations deliberately do NOT
      // call them — this is where the close actually happens.
      expect(ioredisQuits[0]).toHaveBeenCalledTimes(1);
      expect(ioredisQuits[1]).toHaveBeenCalledTimes(1);
    });

    it('swallows quit() failures during shutdown (non-fatal)', async () => {
      const module = await buildModule('redis://localhost:6379', 'redis://localhost:6379');

      module.get(REDIS_CLIENT);
      module.get(REDIS_QUEUE_CLIENT);

      // Force the first client's quit to reject; second resolves OK.
      // Promise.allSettled inside onModuleDestroy must tolerate the
      // failure and still close the second client.
      ioredisQuits[0].mockRejectedValueOnce(new Error('Redis already disconnected'));

      await expect(module.close()).resolves.toBeUndefined();
      expect(ioredisQuits[1]).toHaveBeenCalledTimes(1);
    });
  });
});

// Suppress unused import warning — ConfigService re-exported for any
// future test additions that need to reach into it directly.
void ConfigService;
