import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PredictiveRiseAlertService } from './predictive-rise-alert.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import { NotificationSendLogService } from './notification-send-log.service.js';
import type { PriceRiseSignalJobData } from '../market-signal/types.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockNotificationPrefFindMany = jest.fn();
const mockNotificationPrefUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

const mockPrisma = {
  notificationPreference: {
    findMany: mockNotificationPrefFindMany,
    updateMany: mockNotificationPrefUpdateMany,
  },
};

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedis = { get: mockRedisGet, set: mockRedisSet };

const mockIsValidToken = jest.fn((t: string) => t.startsWith('ExponentPushToken['));
const mockChunkMessages = jest.fn();
const mockSendChunk = jest.fn();
const mockExpoPush = {
  isValidToken: mockIsValidToken,
  chunkMessages: mockChunkMessages,
  sendChunk: mockSendChunk,
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]';

const orlenJob: PriceRiseSignalJobData = {
  signalSource: 'orlen_rack',
  signalType: 'orlen_rack_pb95',
  fuelTypes: ['PB_95', 'PB_98'],
  pctMovement: 0.04,
  recordedAt: '2026-05-09T06:00:00Z',
};

const brentJob: PriceRiseSignalJobData = {
  signalSource: 'brent_crude_pln',
  signalType: 'brent_crude_pln',
  fuelTypes: ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM'],
  pctMovement: 0.05,
  recordedAt: '2026-05-09T06:00:00Z',
};

const makePref = (overrides: Partial<{ user_id: string; expo_push_token: string | null }> = {}) => ({
  user_id: 'user-1',
  expo_push_token: VALID_TOKEN,
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PredictiveRiseAlertService', () => {
  let service: PredictiveRiseAlertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    mockNotificationPrefFindMany.mockResolvedValue([]);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PredictiveRiseAlertService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
        // Story 6.8 — service injected for per-send telemetry; no-op
        // stub keeps the existing test surface unchanged.
        { provide: NotificationSendLogService, useValue: { recordSend: jest.fn() } },
      ],
    }).compile();

    service = module.get(PredictiveRiseAlertService);
  });

  // ── AC1 — happy path ────────────────────────────────────────────────────────

  describe('processSignal — happy path', () => {
    it('sends one push per opted-in user with valid token for an ORLEN signal', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(orlenJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN);
      // AC2 — copy mirrors Phase 1 exactly
      expect(sent[0].title).toBe('Fuel prices may be rising');
      expect(sent[0].body).toMatch(/may rise soon/);
      // AC2 — deep-link to map root, source data not surfaced
      // Story 6.8 — alertType added for notification_opened labelling.
      expect(sent[0].data).toEqual({ route: '/', alertType: 'predictive_rise' });
    });

    it('sends for a brent_crude_pln signal with the same copy as ORLEN (AC2)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(brentJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent[0].title).toBe('Fuel prices may be rising');
      expect(sent[0].body).toMatch(/may rise soon/);
    });
  });

  // ── AC4 — 72h dedup per fuel type (atomic SET NX claim) ────────────────────

  describe('72h dedup (atomic SET NX claim)', () => {
    it('claims one Story-6.2 contract dedup slot per NEW fuel type via SET NX EX', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(orlenJob);

      // Two fuel types in the orlen_rack_pb95 signal → two atomic claims.
      // Value is the Unix-ms timestamp string (Story 6.2 reads + parses it).
      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:predictive:PB_95',
        expect.stringMatching(/^\d+$/),
        'EX',
        72 * 3600,
        'NX',
      );
      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:predictive:PB_98',
        expect.stringMatching(/^\d+$/),
        'EX',
        72 * 3600,
        'NX',
      );
    });

    it('writes the timestamp as a Unix-ms STRING (Story 6.2 contract)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      const before = Date.now();

      await service.processSignal(orlenJob);

      const call = mockRedisSet.mock.calls.find((c) => c[0] === 'alert:rise:predictive:PB_95');
      expect(call).toBeDefined();
      const value = call![1] as string;
      const parsed = Number(value);
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(Date.now());
    });

    it('SKIPS fuel types whose SET NX returns null (concurrent job already claimed)', async () => {
      // PB_95 SET NX returns null (already claimed); PB_98 wins
      mockRedisSet.mockImplementation(async (key: string) => {
        if (key === 'alert:rise:predictive:PB_95') return null;
        return 'OK';
      });
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(orlenJob);

      // Send still fires (PB_98 is fresh)
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
    });

    it('skips ENTIRELY (no send) when ALL fuel types are already claimed', async () => {
      // Every claim returns null
      mockRedisSet.mockResolvedValue(null);

      await service.processSignal(orlenJob);

      expect(mockNotificationPrefFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('AC5 — claim still wins (slot taken) even when no eligible users (prevents re-alerting after opt-in)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([]); // nobody opted in

      await service.processSignal(orlenJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
      // Atomic claim happened BEFORE the opt-in check — slot is held for
      // 72h regardless of whether anyone received the push.
      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:predictive:PB_95',
        expect.any(String),
        'EX',
        72 * 3600,
        'NX',
      );
    });
  });

  // ── Eligible-user filter (AC5, AC6) ──────────────────────────────────────────

  describe('getEligibleUsers / opt-in filter', () => {
    it('queries WHERE rise_predictive_enabled = true and excludes soft-deleted users', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(orlenJob);

      expect(mockNotificationPrefFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rise_predictive_enabled: true,
            expo_push_token: { not: null },
            user: expect.objectContaining({ deleted_at: null }),
          }),
        }),
      );
    });

    it('drops users with invalid push tokens (AC6 strict-token-format requirement)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-bad', expo_push_token: 'not-an-expo-token' }),
      ]);

      await service.processSignal(orlenJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Stale token cleanup ───────────────────────────────────────────────────

  describe('stale token cleanup', () => {
    it('clears expo_push_token (user-scoped) when DeviceNotRegistered ticket returned', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockSendChunk.mockResolvedValueOnce([
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ]);

      await service.processSignal(orlenJob);

      expect(mockNotificationPrefUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', expo_push_token: VALID_TOKEN },
        data: { expo_push_token: null },
      });
    });
  });

  // ── Multi-user batch ──────────────────────────────────────────────────────

  describe('multi-user', () => {
    it('sends to every opted-in user in one chunked call', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1', expo_push_token: VALID_TOKEN }),
        makePref({ user_id: 'user-2', expo_push_token: VALID_TOKEN_2 }),
      ]);

      await service.processSignal(orlenJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent.map((m: { to: string }) => m.to)).toEqual([VALID_TOKEN, VALID_TOKEN_2]);
    });
  });

  // ── Fail-open dedup ────────────────────────────────────────────────────────

  describe('Redis dedup error handling', () => {
    it('fail-opens (proceeds with send) when Redis SET NX errors', async () => {
      // claimDedup catches and returns true on Redis errors so a Redis
      // outage doesn't suppress predictive alerts entirely.
      mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.processSignal(orlenJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
    });
  });
});
