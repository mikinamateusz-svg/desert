import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { REDIS_CLIENT, RedisModule } from './redis.module.js';

// ── ioredis mock ────────────────────────────────────────────────────────────

const mockOn = jest.fn();
const mockQuit = jest.fn().mockResolvedValue('OK');
const mockRedisCtor = jest.fn();

jest.mock('ioredis', () =>
  jest.fn().mockImplementation((url: string, opts: Record<string, unknown>) => {
    mockRedisCtor(url, opts);
    return { on: mockOn, quit: mockQuit };
  }),
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a test module with RedisModule wired against a forRoot
 * ConfigModule that returns the given env-var values. Using
 * ConfigModule.forRoot via `load: [() => ({ ... })]` is the cleanest
 * way to put ConfigService in the same scope as RedisModule's
 * `inject: [ConfigService]` factory.
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
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('REDIS_CLIENT factory', () => {
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
      expect(mockRedisCtor).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.any(Object),
      );
    });

    it('Hardening-2 F1 — sets maxRetriesPerRequest: null on the shared client (required for BullMQ Queue)', () => {
      module.get(REDIS_CLIENT);
      const [, opts] = mockRedisCtor.mock.calls[0] as [string, Record<string, unknown>];
      // Without `null` here, BullMQ-recent throws at Queue construction
      // and BullMQ-older silently loses commands after 3 retries.
      expect(opts.maxRetriesPerRequest).toBeNull();
      expect(opts.enableReadyCheck).toBe(false);
    });

    it('registers connect and error event listeners', () => {
      module.get(REDIS_CLIENT);
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Hardening-2 F2 — REDIS_URL / BULL_REDIS_URL mismatch assertion', () => {
    it('throws at factory time when REDIS_URL and BULL_REDIS_URL point at different instances', async () => {
      // Diverging URLs is the load-bearing failure mode the assertion
      // protects against: BullMQ Queue.add() would go to one broker,
      // Worker BRPOPLPUSH would block on a different one, and every
      // job would be silently lost.
      await expect(buildModule('redis://cache:6379', 'redis://queue:6379')).rejects.toThrow(
        /must point at the same Redis instance/,
      );
    });

    it('boots cleanly when REDIS_URL and BULL_REDIS_URL match (the happy path)', async () => {
      const module = await buildModule('redis://shared:6379', 'redis://shared:6379');
      expect(module.get(REDIS_CLIENT)).toBeDefined();
      await module.close();
    });
  });

  describe('Hardening-2 F3 — onModuleDestroy quits the shared client', () => {
    it('calls .quit() on the shared client when the module is destroyed', async () => {
      const module = await buildModule('redis://localhost:6379', 'redis://localhost:6379');

      module.get(REDIS_CLIENT); // force factory eval
      mockQuit.mockClear();

      await module.close();

      // The shared client's quit() is fired exactly once by the
      // module's OnModuleDestroy hook. Workers' onModuleDestroy
      // implementations deliberately do NOT call it — this is where
      // the close actually happens.
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('swallows quit() failures during shutdown (non-fatal)', async () => {
      mockQuit.mockRejectedValueOnce(new Error('Redis already disconnected'));

      const module = await buildModule('redis://localhost:6379', 'redis://localhost:6379');
      module.get(REDIS_CLIENT);

      // Should not throw — a Redis already-disconnected error during
      // graceful shutdown is logged but doesn't fail the destroy chain.
      await expect(module.close()).resolves.toBeUndefined();
    });
  });
});

// Suppress unused import warning — ConfigService re-exported for any
// future test additions that need to reach into it directly.
void ConfigService;
