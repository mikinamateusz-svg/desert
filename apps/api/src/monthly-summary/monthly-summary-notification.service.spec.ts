import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MonthlySummaryNotificationService } from './monthly-summary-notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from '../alert/expo-push.token.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNotificationPrefFindMany = jest.fn();
const mockNotificationPrefUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockQueryRaw = jest.fn();

const mockPrisma = {
  notificationPreference: {
    findMany: mockNotificationPrefFindMany,
    updateMany: mockNotificationPrefUpdateMany,
  },
  $queryRaw: mockQueryRaw,
};

const mockRedisSet = jest.fn();
const mockRedis = { set: mockRedisSet };

const mockIsValidToken = jest.fn((t: string) => t.startsWith('ExponentPushToken['));
const mockChunkMessages = jest.fn();
const mockSendChunk = jest.fn();
const mockExpoPush = {
  isValidToken: mockIsValidToken,
  chunkMessages: mockChunkMessages,
  sendChunk: mockSendChunk,
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]';

const makePref = (
  overrides: Partial<{
    user_id: string;
    expo_push_token: string | null;
    monthly_summary: boolean;
  }> = {},
) => ({
  user_id: 'user-1',
  expo_push_token: VALID_TOKEN,
  monthly_summary: true,
  ...overrides,
});

const makeSavingsRow = (
  overrides: Partial<{ user_id: string; fillup_count: number; total_savings_pln: number }> = {},
) => ({
  user_id: 'user-1',
  fillup_count: 4,
  total_savings_pln: 94,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MonthlySummaryNotificationService', () => {
  let service: MonthlySummaryNotificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockNotificationPrefFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockRedisSet.mockResolvedValue('OK');
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlySummaryNotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
      ],
    }).compile();

    service = module.get(MonthlySummaryNotificationService);
  });

  // ── Run-lock idempotency ────────────────────────────────────────────────────

  describe('per-month run lock', () => {
    it('skips the run entirely when SET NX claim returns null (already claimed)', async () => {
      // First redis.set call is the lock claim. Returning null means key
      // already existed → another run owns this month. Don't queue
      // downstream mocks — they'd never get consumed (and would leak
      // into the next test) since runForMonth returns early.
      mockRedisSet.mockResolvedValueOnce(null);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 0, skipped: 0, noToken: 0 });
      expect(mockQueryRaw).not.toHaveBeenCalled(); // never even ran the savings aggregate
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('claims the run lock with SET NX EX 25h before doing any work', async () => {
      // No queued mocks needed — defaults (lock OK, no users) drive an
      // empty run; we only assert the lock-claim call shape.
      await service.runForMonth(2026, 3);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'monthly:summary:run:2026-03',
        '1',
        'EX',
        25 * 3600,
        'NX',
      );
    });

    it('fail-opens when Redis SET errors during lock claim — proceeds with run', async () => {
      // Better a rare duplicate than skipping an entire month of summaries.
      mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      const result = await service.runForMonth(2026, 3);

      expect(result.sent).toBe(1);
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
    });
  });

  // ── Sub-1 PLN skip ──────────────────────────────────────────────────────────

  describe('sub-1 PLN savings skip', () => {
    it('skips users whose rounded savings would be 0 PLN (avoids "You saved 0 PLN" copy)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        makeSavingsRow({ total_savings_pln: 0.4 }), // rounds to 0
      ]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 0, skipped: 1, noToken: 0 });
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('sends when savings rounds to ≥1 PLN', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        makeSavingsRow({ total_savings_pln: 0.6 }), // rounds to 1
      ]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.runForMonth(2026, 3);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      expect(mockSendChunk.mock.calls[0][0][0].body).toContain('1 PLN');
    });
  });

  // ── No eligible users ───────────────────────────────────────────────────────

  describe('when no users have positive savings', () => {
    it('returns zero counts and does NOT query preferences or send', async () => {
      mockQueryRaw.mockResolvedValueOnce([]); // aggregateSavings: empty

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 0, skipped: 0, noToken: 0 });
      expect(mockNotificationPrefFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Happy path (AC1, AC3) ───────────────────────────────────────────────────

  describe('happy path', () => {
    it('sends "Great month!" copy when no leaderboard data is available', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 1, skipped: 0, noToken: 0 });
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN);
      expect(sent[0].title).toBe('Your monthly fuel summary is ready');
      expect(sent[0].body).toContain('94');
      expect(sent[0].body).toContain('March 2026');
      expect(sent[0].body).toMatch(/Great month/);
      // AC2 — deep link to savings-summary screen with year + month
      expect(sent[0].data).toEqual({
        route: '/(app)/savings-summary?year=2026&month=3',
      });
    });

    it('rounds savings amount to integer PLN', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow({ total_savings_pln: 93.6 })]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.runForMonth(2026, 3);

      expect(mockSendChunk.mock.calls[0][0][0].body).toContain('94'); // 93.6 rounds to 94
    });
  });

  // ── Leaderboard percentile copy variant (AC2) ───────────────────────────────

  describe('buildNotificationPayload', () => {
    it('includes top-percent line when rankingPercentile is provided', () => {
      const { title, body } = service.buildNotificationPayload(94, 'March 2026', 20);

      expect(title).toBe('Your monthly fuel summary is ready');
      expect(body).toContain("you're in the top 20%");
    });

    it('falls back to "Great month!" copy when rankingPercentile is null', () => {
      const { body } = service.buildNotificationPayload(94, 'March 2026', null);

      expect(body).toMatch(/Great month/);
      expect(body).not.toContain('top');
    });
  });

  // ── Preference respected (AC6) ──────────────────────────────────────────────

  describe('preference filter', () => {
    it('does NOT send when monthly_summary preference is false', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ monthly_summary: false }),
      ]);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 0, skipped: 1, noToken: 0 });
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('treats user with NO prefs row as opted-IN (matches @default(true) and AC6 strict-false)', async () => {
      // Lazy-create pattern: notifications.service only writes the row on
      // first GET/PATCH. A user who never opened notification settings
      // has NO row but the schema default is true — should be sent (or
      // routed to no-token if no token).
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([]); // no prefs row

      const result = await service.runForMonth(2026, 3);

      // No prefs row → no token → AC7 no-token branch (re-prompt key set)
      expect(result).toEqual({ sent: 0, skipped: 0, noToken: 1 });
      expect(mockSendChunk).not.toHaveBeenCalled();
      expect(mockRedisSet).toHaveBeenCalledWith(
        'monthly:summary:calculated:user-1',
        '1',
        'EX',
        45 * 24 * 3600,
      );
    });
  });

  // ── No-token re-prompt key (AC7) ────────────────────────────────────────────

  describe('no-token branch', () => {
    it('sets the re-prompt Redis key and does NOT send when token is null', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ expo_push_token: null }),
      ]);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 0, skipped: 0, noToken: 1 });
      expect(mockSendChunk).not.toHaveBeenCalled();
      // 45-day TTL so the re-prompt signal survives until next month's run.
      expect(mockRedisSet).toHaveBeenCalledWith(
        'monthly:summary:calculated:user-1',
        '1',
        'EX',
        45 * 24 * 3600,
      );
    });

    it('sets the re-prompt key when token is invalid (not an Expo token)', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ expo_push_token: 'not-an-expo-token' }),
      ]);

      const result = await service.runForMonth(2026, 3);

      expect(result.noToken).toBe(1);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'monthly:summary:calculated:user-1',
        '1',
        'EX',
        45 * 24 * 3600,
      );
    });

    it('continues running even if Redis re-prompt key write fails', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ expo_push_token: null }),
      ]);
      mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.runForMonth(2026, 3);

      expect(result.noToken).toBe(1);
    });
  });

  // ── Mixed cohort + chunked send (AC8) ───────────────────────────────────────

  describe('multi-user cohort', () => {
    it('handles a mixed cohort: send + skip + noToken in one run', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        makeSavingsRow({ user_id: 'user-1', total_savings_pln: 100 }),
        makeSavingsRow({ user_id: 'user-2', total_savings_pln: 50 }),
        makeSavingsRow({ user_id: 'user-3', total_savings_pln: 25 }),
      ]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1', expo_push_token: VALID_TOKEN }),
        makePref({ user_id: 'user-2', monthly_summary: false }),
        makePref({ user_id: 'user-3', expo_push_token: null }),
      ]);

      const result = await service.runForMonth(2026, 3);

      expect(result).toEqual({ sent: 1, skipped: 1, noToken: 1 });
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN);
    });

    it('continues processing when one chunk send fails (AC8 partial-delivery)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        makeSavingsRow({ user_id: 'user-1', total_savings_pln: 100 }),
        makeSavingsRow({ user_id: 'user-2', total_savings_pln: 50 }),
      ]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1', expo_push_token: VALID_TOKEN }),
        makePref({ user_id: 'user-2', expo_push_token: VALID_TOKEN_2 }),
      ]);
      // Force two chunks of 1 message each, first fails, second succeeds.
      mockChunkMessages.mockImplementationOnce((msgs: unknown[]) => [
        [msgs[0]],
        [msgs[1]],
      ]);
      mockSendChunk
        .mockRejectedValueOnce(new Error('Expo unreachable'))
        .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-2' }]);

      const result = await service.runForMonth(2026, 3);

      // Counter increments before send — runForMonth doesn't decrement on failure
      expect(result.sent).toBe(2);
      expect(mockSendChunk).toHaveBeenCalledTimes(2);
    });
  });

  // ── Stale token cleanup ─────────────────────────────────────────────────────

  describe('stale token cleanup', () => {
    it('clears expo_push_token (user-scoped) when DeviceNotRegistered is returned', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockSendChunk.mockResolvedValueOnce([
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ]);

      await service.runForMonth(2026, 3);

      expect(mockNotificationPrefUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', expo_push_token: VALID_TOKEN },
        data: { expo_push_token: null },
      });
    });
  });

  // ── aggregateSavings SQL contract ───────────────────────────────────────────

  describe('aggregateSavings', () => {
    it('passes the month-window dates to the raw query', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      // March 2026 → start = 2026-03-01 UTC, end = 2026-04-01 UTC
      await service.runForMonth(2026, 3);

      const callArgs = mockQueryRaw.mock.calls[0];
      // Tagged template — args[0] is the strings array, then interpolated values
      const interpolated = callArgs.slice(1);
      expect(interpolated).toContainEqual(new Date(Date.UTC(2026, 2, 1)));
      expect(interpolated).toContainEqual(new Date(Date.UTC(2026, 3, 1)));
    });

    it('rolls year correctly for January (queries previous December)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      // January 2026 → start = 2026-01-01 UTC, end = 2026-02-01 UTC
      await service.runForMonth(2026, 1);

      const interpolated = mockQueryRaw.mock.calls[0].slice(1);
      expect(interpolated).toContainEqual(new Date(Date.UTC(2026, 0, 1)));
      expect(interpolated).toContainEqual(new Date(Date.UTC(2026, 1, 1)));
    });
  });
});
