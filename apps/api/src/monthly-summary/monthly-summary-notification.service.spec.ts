import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MonthlySummaryNotificationService } from './monthly-summary-notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from '../alert/expo-push.token.js';
import { NotificationSendLogService } from '../alert/notification-send-log.service.js';
import { SavingsRankingService } from '../fillup/savings-ranking.service.js';

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

const mockGetBulkPercentilesForMonth = jest.fn();
const mockSavingsRanking = {
  getBulkPercentilesForMonth: mockGetBulkPercentilesForMonth,
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]';

// Story 5.8 privacy canary — the notification body MUST NOT contain
// any voivodeship slug. Catches a future regression where someone
// adds "in {{region}}" / "w {{region}}" back to the copy. Lowercased
// so the assertion is case-insensitive.
const POLISH_VOIVODESHIP_SLUGS = [
  'dolnoslaskie',
  'kujawsko-pomorskie',
  'lubelskie',
  'lubuskie',
  'lodzkie',
  'malopolskie',
  'mazowieckie',
  'opolskie',
  'podkarpackie',
  'podlaskie',
  'pomorskie',
  'slaskie',
  'swietokrzyskie',
  'warminsko-mazurskie',
  'wielkopolskie',
  'zachodniopomorskie',
];

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
    // Default: empty percentile map (cohort threshold not met for any
    // user). Tests that exercise the populated-percentile path override.
    mockGetBulkPercentilesForMonth.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlySummaryNotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
        { provide: SavingsRankingService, useValue: mockSavingsRanking },
        // Story 6.8 — per-send telemetry; no-op stub for unit tests.
        { provide: NotificationSendLogService, useValue: { recordSend: jest.fn() } },
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
      // Story 6.8 — alertType added for notification_opened labelling.
      expect(sent[0].data).toEqual({
        route: '/(app)/savings-summary?year=2026&month=3',
        alertType: 'monthly_summary',
      });
    });

    it('rounds savings amount to integer PLN', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow({ total_savings_pln: 93.6 })]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.runForMonth(2026, 3);

      expect(mockSendChunk.mock.calls[0][0][0].body).toContain('94'); // 93.6 rounds to 94
    });
  });

  // ── Percentile copy variant (Story 5.8) ─────────────────────────────────────

  describe('buildNotificationPayload', () => {
    it('includes top-percent line when rankingPercentile is provided', () => {
      const { title, body } = service.buildNotificationPayload(94, 'March 2026', 20);

      expect(title).toBe('Your monthly fuel summary is ready');
      expect(body).toContain("you're in the top 20%");
    });

    it('Story 5.8 — drops "in your area" qualifier (no geographic leak)', () => {
      const { body } = service.buildNotificationPayload(94, 'March 2026', 20);

      // The cohort scoping (voivodeship) MUST stay server-side. These
      // assertions are the canary against a future regression that adds
      // "in your area" / "in {voivodeship}" / a slug name back to the
      // body. Keeping them as negative assertions (rather than an
      // exact-match) lets harmless copy tweaks pass while still
      // catching the privacy regression.
      expect(body).not.toContain('your area');
      expect(body).not.toContain('voivodeship');
      for (const slug of POLISH_VOIVODESHIP_SLUGS) {
        expect(body.toLowerCase()).not.toContain(slug);
      }
      expect(body).toContain("top 20% of savers");
    });

    it('falls back to "Great month!" copy when rankingPercentile is null', () => {
      const { body } = service.buildNotificationPayload(94, 'March 2026', null);

      expect(body).toMatch(/Great month/);
      expect(body).not.toContain('top');
    });
  });

  // ── SavingsRankingService wiring (Story 5.8) ────────────────────────────────

  describe('Story 5.8 — bulk percentile lookup', () => {
    it('enriches notification body with looked-up percentile when user is in the map', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockGetBulkPercentilesForMonth.mockResolvedValueOnce(
        new Map([['user-1', { topPercent: 12 }]]),
      );

      await service.runForMonth(2026, 3);

      expect(mockGetBulkPercentilesForMonth).toHaveBeenCalledTimes(1);
      const sentBody = mockSendChunk.mock.calls[0][0][0].body as string;
      expect(sentBody).toContain('top 12% of savers');
      // Privacy canary on the live notification path (post-bulk-lookup),
      // not just buildNotificationPayload — closes the gap where a
      // future regression in the for-loop could re-introduce a region
      // label without tripping the unit-level test.
      expect(sentBody).not.toContain('your area');
      for (const slug of POLISH_VOIVODESHIP_SLUGS) {
        expect(sentBody.toLowerCase()).not.toContain(slug);
      }
    });

    it('Story 5.8 — suppresses percentile in body when user is below median (topPercent > ceiling)', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      // 75th percentile (below median) → "you're in the top 75% of
      // savers!" reads as discouraging. Should fall through to
      // generic copy instead.
      mockGetBulkPercentilesForMonth.mockResolvedValueOnce(
        new Map([['user-1', { topPercent: 75 }]]),
      );

      await service.runForMonth(2026, 3);

      const sentBody = mockSendChunk.mock.calls[0][0][0].body as string;
      expect(sentBody).toMatch(/Great month/);
      expect(sentBody).not.toContain('top 75%');
    });

    it('Story 5.8 — emits percentile copy at the ceiling boundary (topPercent === 50)', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      // Exact 50th — at-or-above-median is acceptable, so fire the
      // percentile copy (matches the `<=` boundary in the gate).
      mockGetBulkPercentilesForMonth.mockResolvedValueOnce(
        new Map([['user-1', { topPercent: 50 }]]),
      );

      await service.runForMonth(2026, 3);

      const sentBody = mockSendChunk.mock.calls[0][0][0].body as string;
      expect(sentBody).toContain('top 50% of savers');
    });

    it('Story 5.8 — skips bulk lookup entirely when no opted-in users (efficiency)', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      // Single user with monthly_summary explicitly disabled — no
      // opted-in users → bulk cohort scan is wasted DB work, skip it.
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ monthly_summary: false }),
      ]);

      await service.runForMonth(2026, 3);

      expect(mockGetBulkPercentilesForMonth).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('falls back to "Great month!" copy when user is absent from the percentile map', async () => {
      mockQueryRaw.mockResolvedValueOnce([makeSavingsRow()]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      // Empty map — user-1 didn't make the cohort cut.
      mockGetBulkPercentilesForMonth.mockResolvedValueOnce(new Map());

      await service.runForMonth(2026, 3);

      const sentBody = mockSendChunk.mock.calls[0][0][0].body as string;
      expect(sentBody).toMatch(/Great month/);
      expect(sentBody).not.toContain('top');
    });

    it('calls bulk lookup once per run, not per user (efficiency)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        makeSavingsRow({ user_id: 'user-1' }),
        makeSavingsRow({ user_id: 'user-2' }),
        makeSavingsRow({ user_id: 'user-3' }),
      ]);
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1' }),
        makePref({ user_id: 'user-2', expo_push_token: VALID_TOKEN_2 }),
        makePref({ user_id: 'user-3' }),
      ]);

      await service.runForMonth(2026, 3);

      expect(mockGetBulkPercentilesForMonth).toHaveBeenCalledTimes(1);
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
