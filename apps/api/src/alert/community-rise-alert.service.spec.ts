import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CommunityRiseAlertService } from './community-rise-alert.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import type { CommunityRiseCheckJobData } from './price-drop-alert.constants.js';

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]';

const baseJob: CommunityRiseCheckJobData = {
  voivodeship: 'Mazowieckie',
  fuelType: 'PB_95',
  triggeredByStationId: 'station-1',
  verifiedAt: '2026-05-09T12:00:00.000Z',
};

const makePref = (overrides: Partial<{ user_id: string; expo_push_token: string | null }> = {}) => ({
  user_id: 'user-1',
  expo_push_token: VALID_TOKEN,
  ...overrides,
});

// Helpers to drive the threshold CTE
const cteRow = (rising: number, total: number) => [{ rising_stations: rising, total_stations: total }];
// Voivodeship-match raw query — returns one row per matching user_id.
const matchRows = (...userIds: string[]) => userIds.map((user_id) => ({ user_id }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommunityRiseAlertService', () => {
  let service: CommunityRiseAlertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    mockNotificationPrefFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityRiseAlertService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
      ],
    }).compile();

    service = module.get(CommunityRiseAlertService);
  });

  // ── Threshold (AC1) ─────────────────────────────────────────────────────────

  describe('evaluateThreshold', () => {
    it('returns thresholdMet=true when ≥30% of ≥3 stations rose ≥2%', async () => {
      mockQueryRaw.mockResolvedValueOnce(cteRow(2, 5)); // 40% rising

      const result = await service.evaluateThreshold('Mazowieckie', 'PB_95');

      expect(result).toEqual({ thresholdMet: true, risingCount: 2, totalCount: 5 });
    });

    it('returns thresholdMet=false when <30% of stations rose', async () => {
      mockQueryRaw.mockResolvedValueOnce(cteRow(1, 10)); // 10% rising

      const result = await service.evaluateThreshold('Mazowieckie', 'PB_95');

      expect(result.thresholdMet).toBe(false);
    });

    it('returns thresholdMet=false when <3 qualifying stations (sparse-data guard)', async () => {
      mockQueryRaw.mockResolvedValueOnce(cteRow(2, 2)); // 100% rising but only 2 stations

      const result = await service.evaluateThreshold('Mazowieckie', 'PB_95');

      expect(result.thresholdMet).toBe(false);
    });

    it('returns thresholdMet=false when CTE returns no rows (no data)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.evaluateThreshold('Mazowieckie', 'PB_95');

      expect(result).toEqual({ thresholdMet: false, risingCount: 0, totalCount: 0 });
    });
  });

  // ── Predictive timing (AC3) ─────────────────────────────────────────────────

  describe('checkPredictiveTiming', () => {
    it('returns "none" when no predictive key exists', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      expect(await service.checkPredictiveTiming('Mazowieckie', 'PB_95')).toBe('none');
    });

    it('returns "too-soon" when predictive sent <6h ago', async () => {
      const fiveHoursAgo = Date.now() - 5 * 3600 * 1000;
      mockRedisGet.mockResolvedValueOnce(String(fiveHoursAgo));

      expect(await service.checkPredictiveTiming('Mazowieckie', 'PB_95')).toBe('too-soon');
    });

    it('returns "eligible" when predictive sent ≥6h ago', async () => {
      const sevenHoursAgo = Date.now() - 7 * 3600 * 1000;
      mockRedisGet.mockResolvedValueOnce(String(sevenHoursAgo));

      expect(await service.checkPredictiveTiming('Mazowieckie', 'PB_95')).toBe('eligible');
    });

    it('returns "none" when redis raw value is unparseable (defensive)', async () => {
      mockRedisGet.mockResolvedValueOnce('not-a-number');

      expect(await service.checkPredictiveTiming('Mazowieckie', 'PB_95')).toBe('none');
    });

    it('returns "none" (fail-open) when Redis errors', async () => {
      mockRedisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      expect(await service.checkPredictiveTiming('Mazowieckie', 'PB_95')).toBe('none');
    });
  });

  // ── evaluateAndNotify orchestration ──────────────────────────────────────────

  describe('evaluateAndNotify — happy path', () => {
    beforeEach(() => {
      // Threshold met: 2/5 rising (40%)
      mockQueryRaw
        .mockResolvedValueOnce(cteRow(2, 5))     // evaluateThreshold
        .mockResolvedValueOnce(matchRows('user-1')); // voivodeship match
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
    });

    it('sends notification with normal copy when no predictive alert exists', async () => {
      mockRedisGet
        .mockResolvedValueOnce(null) // 48h dedup miss
        .mockResolvedValueOnce(null); // predictive timing — none

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN);
      expect(sent[0].title).toMatch(/PB95 prices rising near you/);
      expect(sent[0].body).toMatch(/consider filling up soon/);
      expect(sent[0].data).toEqual({ route: '/map?fuelType=PB_95' });
    });

    it('sends "as-expected" copy when predictive alert ≥6h ago', async () => {
      const sevenHoursAgo = Date.now() - 7 * 3600 * 1000;
      mockRedisGet
        .mockResolvedValueOnce(null)                      // 48h dedup miss
        .mockResolvedValueOnce(String(sevenHoursAgo));    // predictive — eligible

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent[0].title).toMatch(/PB95 prices have risen near you/);
      expect(sent[0].body).toMatch(/^As expected/);
    });

    it('records 48h dedup key after successful send', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await service.evaluateAndNotify(baseJob);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:community:Mazowieckie:PB_95',
        '1',
        'EX',
        48 * 3600,
      );
    });
  });

  describe('evaluateAndNotify — skip paths', () => {
    it('skips when 48h dedup key exists', async () => {
      mockRedisGet.mockResolvedValueOnce('1'); // dedup hit

      await service.evaluateAndNotify(baseJob);

      // Threshold query never runs — nothing to evaluate
      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('skips when threshold not met (and does NOT record dedup — re-evaluate next time)', async () => {
      mockRedisGet.mockResolvedValueOnce(null); // dedup miss
      mockQueryRaw.mockResolvedValueOnce(cteRow(0, 5)); // 0% rising

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('skips ENTIRELY when predictive alert sent <6h ago (no dedup record either)', async () => {
      const fiveHoursAgo = Date.now() - 5 * 3600 * 1000;
      mockRedisGet
        .mockResolvedValueOnce(null)                     // 48h dedup miss
        .mockResolvedValueOnce(String(fiveHoursAgo));    // predictive — too-soon
      mockQueryRaw.mockResolvedValueOnce(cteRow(2, 5));  // threshold met

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
      // No dedup record so the next verification can re-attempt once 6h elapses.
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('records SHORT (1h) dedup, not full 48h, when no eligible users exist', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockQueryRaw.mockResolvedValueOnce(cteRow(2, 5)); // threshold met
      mockNotificationPrefFindMany.mockResolvedValueOnce([]); // no opted-in users

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
      // Short TTL so a user opting in (or whose latest fillup lands here)
      // within the rising cycle still receives the alert. Full 48h would
      // silently consume the threshold-met event.
      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:community:Mazowieckie:PB_95',
        '1',
        'EX',
        60 * 60,
      );
    });
  });

  // ── Eligible-user filter (AC2 / AC5 / AC6) ──────────────────────────────────

  describe('getEligibleUsers / opt-in filter', () => {
    it('queries WHERE rise_community_enabled = true and excludes soft-deleted users', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockQueryRaw
        .mockResolvedValueOnce(cteRow(2, 5))
        .mockResolvedValueOnce(matchRows('user-1'));
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.evaluateAndNotify(baseJob);

      expect(mockNotificationPrefFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rise_community_enabled: true,
            expo_push_token: { not: null },
            user: expect.objectContaining({ deleted_at: null }),
          }),
        }),
      );
    });

    it('drops users with invalid push tokens before voivodeship match', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      // Only the threshold $queryRaw runs — validPrefs is empty after the
      // token filter so getEligibleUsers early-returns without the match
      // query. Queueing matchRows() here would leak into the next test
      // because jest.clearAllMocks() doesn't drain mockResolvedValueOnce
      // queues.
      mockQueryRaw.mockResolvedValueOnce(cteRow(2, 5));
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-bad', expo_push_token: 'not-an-expo-token' }),
      ]);

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('only sends to users whose most-recent fillup voivodeship matches', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockQueryRaw
        .mockResolvedValueOnce(cteRow(2, 5))                         // threshold
        .mockResolvedValueOnce(matchRows('user-1'));                 // user-1 matches; user-2 drops
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1', expo_push_token: VALID_TOKEN }),
        makePref({ user_id: 'user-2', expo_push_token: VALID_TOKEN_2 }),
      ]);

      await service.evaluateAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN);
    });
  });

  // ── Stale token cleanup (mirrors 6.1's user-scoped pattern) ─────────────────

  describe('stale token cleanup', () => {
    it('clears expo_push_token (user-scoped) when DeviceNotRegistered is returned', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockQueryRaw
        .mockResolvedValueOnce(cteRow(2, 5))
        .mockResolvedValueOnce(matchRows('user-1'));
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockSendChunk.mockResolvedValueOnce([
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ]);

      await service.evaluateAndNotify(baseJob);

      expect(mockNotificationPrefUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', expo_push_token: VALID_TOKEN },
        data: { expo_push_token: null },
      });
    });
  });

  // ── Copy variants ───────────────────────────────────────────────────────────

  describe('buildCopy', () => {
    it('uses fuel label fallback to raw enum string for unknown fuels', async () => {
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockQueryRaw
        .mockResolvedValueOnce(cteRow(2, 5))
        .mockResolvedValueOnce(matchRows('user-1'));
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);

      await service.evaluateAndNotify({ ...baseJob, fuelType: 'EXOTIC_FUEL' });

      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent[0].title).toContain('EXOTIC_FUEL');
    });
  });
});
