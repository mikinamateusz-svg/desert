import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceRiseAlertWorker } from '../alert/alert.worker.js';
import { PriceRiseAlertService } from '../alert/alert.service.js';
import { AlertsExpiryWarningWorker } from '../alert/alerts-expiry-warning.worker.js';
import { AlertsExpiryWarningService } from '../alert/alerts-expiry-warning.service.js';
import { REDIS_QUEUE_CLIENT } from './redis.module.js';

/**
 * Hardening-2 — cross-worker invariants verified at one place:
 *
 *   AC3 — each worker's BLOCKING (Worker-side) ioredis instance is its
 *         own physical socket; never shared with another worker. This
 *         is load-bearing because BullMQ's BRPOPLPUSH blocks the
 *         connection for the worker's lifetime — sharing it across
 *         workers locks one out while the other waits for a job.
 *
 *   AC4 — onModuleDestroy on a worker closes only its OWN blocking
 *         ioredis. The shared `REDIS_QUEUE_CLIENT` (provided by RedisModule)
 *         stays alive for other workers + services.
 *
 * The 15 per-worker specs each verify their own Queue uses the shared
 * client + their own Worker uses a dedicated client. This spec proves
 * the property holds ACROSS workers — that two workers wired against
 * the same shared client get DIFFERENT blocking instances and don't
 * accidentally close each other's plumbing.
 */

// ── BullMQ / ioredis mocks ─────────────────────────────────────────────────

const queueConnections: unknown[] = [];
const workerConnections: unknown[] = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((_name: string, opts: { connection: unknown }) => {
    queueConnections.push(opts.connection);
    return {
      add: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }),
  Worker: jest.fn().mockImplementation((_name: string, _processor: unknown, opts: { connection: unknown }) => {
    workerConnections.push(opts.connection);
    return {
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Each `new Redis(...)` call returns a UNIQUE object so identity-checks
// across workers can verify the per-worker blocking instances are distinct.
let redisInstanceCounter = 0;
const ioredisQuits: jest.Mock[] = [];

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => {
    const quit = jest.fn().mockResolvedValue('OK');
    ioredisQuits.push(quit);
    return {
      __id: `redis-${++redisInstanceCounter}`,
      quit,
    };
  }),
);

// Reusable shared-client stub. Identity-checked via reference equality
// AND has a `quit` spy so AC4 can assert .quit() was NOT called rather
// than relying on the absence of the property (a tautology — a stub
// without `quit` would always satisfy `not.toHaveProperty`).
const mockQueueClientQuitSpy = jest.fn();
const mockQueueClient = {
  __id: 'shared-queue-client',
  quit: mockQueueClientQuitSpy,
} as never;

// ── Service stubs ─────────────────────────────────────────────────────────

const mockPriceRiseAlertService: jest.Mocked<Partial<PriceRiseAlertService>> = {
  sendRiseAlerts: jest.fn().mockResolvedValue(undefined),
};

const mockAlertsExpiryWarningService = {
  sendExpiryWarnings: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
};

// ── Setup ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildWorker(WorkerClass: any, serviceToken: unknown, serviceMock: unknown): Promise<any> {
  const module = await Test.createTestingModule({
    providers: [
      WorkerClass,
      { provide: serviceToken as never, useValue: serviceMock },
      { provide: ConfigService, useValue: mockConfig },
      { provide: REDIS_QUEUE_CLIENT, useValue: mockQueueClient },
    ],
  }).compile();
  const w = module.get(WorkerClass);
  await w.onModuleInit();
  return w;
}

describe('Hardening-2 cross-worker invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueConnections.length = 0;
    workerConnections.length = 0;
    ioredisQuits.length = 0;
    redisInstanceCounter = 0;
    mockQueueClientQuitSpy.mockReset();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('AC1 — Queue constructors receive the SHARED REDIS_QUEUE_CLIENT (not a per-worker fresh instance)', async () => {
    await buildWorker(PriceRiseAlertWorker, PriceRiseAlertService, mockPriceRiseAlertService);
    await buildWorker(AlertsExpiryWarningWorker, AlertsExpiryWarningService, mockAlertsExpiryWarningService);

    // Two workers booted → at least two Queue() constructions. The
    // AlertsExpiryWarningWorker opens a third, transient Queue under the
    // legacy `premium-expiry-warning` name as part of its 6.13 startup
    // cleanup of the pre-rename repeatable cron — that one is closed
    // immediately after `obliterate({ force: true })`. Hardening-2's
    // load-bearing invariant is that EVERY Queue construction reuses
    // the shared client — count >= 2 is fine, but every entry must be
    // reference-equal to `mockQueueClient`.
    expect(queueConnections.length).toBeGreaterThanOrEqual(2);
    for (const conn of queueConnections) {
      expect(conn).toBe(mockQueueClient);
    }
  });

  it('AC3 — each worker gets a DEDICATED blocking ioredis (never the shared client; never the same as another worker)', async () => {
    await buildWorker(PriceRiseAlertWorker, PriceRiseAlertService, mockPriceRiseAlertService);
    await buildWorker(AlertsExpiryWarningWorker, AlertsExpiryWarningService, mockAlertsExpiryWarningService);

    // Two workers → two Worker() constructions. Each got a distinct
    // blocking ioredis instance. Critical: blocking BRPOPLPUSH locks
    // the connection — sharing would deadlock the second worker
    // behind the first's wait.
    expect(workerConnections).toHaveLength(2);
    expect(workerConnections[0]).not.toBe(workerConnections[1]);
    // Neither blocking connection is the shared client.
    expect(workerConnections[0]).not.toBe(mockQueueClient);
    expect(workerConnections[1]).not.toBe(mockQueueClient);
  });

  it('Hardening-2 invariant — no worker re-introduces a per-worker Queue-side ioredis (`redisForQueue`)', () => {
    // Static safety net: the cross-worker test above only exercises a
    // pair of workers. To guarantee a NEW worker added later doesn't
    // ignorantly re-introduce the pattern we just removed, scan every
    // worker file's source for `redisForQueue` / `new Redis(redisUrl`
    // pairs and assert they're not co-located. The grep is dumb, but
    // catches the only regression shape that matters: someone re-opens
    // a fresh ioredis for the Queue side instead of reusing the
    // injected REDIS_QUEUE_CLIENT. A worker that legitimately needs a
    // dedicated Queue connection (e.g. future cache/queue Redis split)
    // can rename the field or update this assertion explicitly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const apiSrc = path.resolve(__dirname, '..');
    const workerFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.worker\.ts$/.test(entry.name)) workerFiles.push(full);
        else if (entry.isFile() && /publisher\.ts$/.test(entry.name)) workerFiles.push(full);
      }
    };
    walk(apiSrc);

    expect(workerFiles.length).toBeGreaterThanOrEqual(14);

    const offenders: string[] = [];
    for (const file of workerFiles) {
      const content = fs.readFileSync(file, 'utf8');
      // Skip spec files (they don't define workers).
      if (file.endsWith('.spec.ts')) continue;
      // The forbidden pattern: a field named `redisForQueue`. Allow
      // `redisForBlocking` (correct post-refactor name) freely.
      if (/redisForQueue/.test(content)) {
        offenders.push(path.relative(apiSrc, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('AC4 — onModuleDestroy quits only the per-worker blocking ioredis, never the shared REDIS_QUEUE_CLIENT', async () => {
    const w1 = await buildWorker(PriceRiseAlertWorker, PriceRiseAlertService, mockPriceRiseAlertService);
    const w2 = await buildWorker(AlertsExpiryWarningWorker, AlertsExpiryWarningService, mockAlertsExpiryWarningService);

    // 2 workers booted → 2 ioredis instances created → 2 quit fns recorded.
    expect(ioredisQuits).toHaveLength(2);

    await w1.onModuleDestroy();
    await w2.onModuleDestroy();

    // BOTH per-worker quits called exactly once apiece.
    expect(ioredisQuits[0]).toHaveBeenCalledTimes(1);
    expect(ioredisQuits[1]).toHaveBeenCalledTimes(1);

    // Shared client's .quit was NEVER called by either worker —
    // closing it is RedisModule's responsibility, not the workers'.
    expect(mockQueueClientQuitSpy).not.toHaveBeenCalled();
  });
});
