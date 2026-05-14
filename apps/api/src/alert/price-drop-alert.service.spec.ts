import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PriceDropAlertService } from './price-drop-alert.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import { NotificationSendLogService } from './notification-send-log.service.js';
import type { PriceDropCheckJobData } from './price-drop-alert.constants.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockStationFindUnique = jest.fn();
const mockNotificationPrefFindMany = jest.fn();
const mockNotificationPrefUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockFillUpFindFirst = jest.fn();
const mockPriceHistoryFindMany = jest.fn().mockResolvedValue([]);
const mockQueryRaw = jest.fn();

const mockPrisma = {
  station: { findUnique: mockStationFindUnique },
  notificationPreference: {
    findMany: mockNotificationPrefFindMany,
    updateMany: mockNotificationPrefUpdateMany,
  },
  fillUp: { findFirst: mockFillUpFindFirst },
  priceHistory: { findMany: mockPriceHistoryFindMany },
  $queryRaw: mockQueryRaw,
};

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedis = { get: mockRedisGet, set: mockRedisSet, del: mockRedisDel };

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

const baseStation = {
  id: 'station-1',
  name: 'Orlen Centrum',
  voivodeship: 'Mazowieckie',
};

const baseJob: PriceDropCheckJobData = {
  stationId: 'station-1',
  fuelType: 'PB_95',
  newPricePln: 6.14,
  stationVoivodeship: 'Mazowieckie',
  verifiedAt: '2026-05-09T12:00:00.000Z',
};

const makePref = (
  overrides: Partial<{
    user_id: string;
    expo_push_token: string | null;
    price_drop_mode: string;
    price_drop_target_pln: { toString: () => string } | number | null;
    price_drop_fuel_types: string[];
    alert_radius_km: number;
  }> = {},
) => ({
  user_id: 'user-1',
  expo_push_token: VALID_TOKEN,
  price_drop_mode: 'cheaper_than_now',
  price_drop_target_pln: null,
  price_drop_fuel_types: ['PB_95'],
  alert_radius_km: 10,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PriceDropAlertService', () => {
  let service: PriceDropAlertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Defaults
    mockStationFindUnique.mockResolvedValue(baseStation);
    mockNotificationPrefFindMany.mockResolvedValue([]);
    mockFillUpFindFirst.mockResolvedValue(null);
    mockPriceHistoryFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockRedisGet.mockResolvedValue(null);
    // Default: SET NX claim succeeds — returns 'OK'. Tests asserting the
    // already-claimed path explicitly set this to null on the relevant call.
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceDropAlertService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
        // Story 6.8 — per-send telemetry; no-op stub for unit tests.
        { provide: NotificationSendLogService, useValue: { recordSend: jest.fn() } },
      ],
    }).compile();

    service = module.get(PriceDropAlertService);
  });

  // ── Station resolution ──────────────────────────────────────────────────────

  describe('when station does not exist', () => {
    it('returns early without querying preferences or sending push', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);

      await service.checkAndNotify(baseJob);

      expect(mockNotificationPrefFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── cheaper_than_now mode (AC2) ─────────────────────────────────────────────

  describe('cheaper_than_now mode', () => {
    it('sends notification when newPrice < area min and within radius', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      // areaMin query returns 6.50 → 6.14 < 6.50 ⇒ qualifies
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])              // getCurrentAreaMin
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }]) // getUserLocationProxy
        .mockResolvedValueOnce([{ distance_m: 1500 }]);            // distanceWithinRadius

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sentMessages = mockSendChunk.mock.calls[0][0];
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].to).toBe(VALID_TOKEN);
      expect(sentMessages[0].body).toContain('6.14');
      expect(sentMessages[0].body).toContain('PB95');
      // Story 6.8 — alertType added for notification_opened labelling.
      expect(sentMessages[0].data).toEqual({
        route: '/station/station-1',
        alertType: 'price_drop',
      });
    });

    it('does NOT notify when newPrice >= area min', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw.mockResolvedValueOnce([{ min_price: 6.0 }]); // 6.14 > 6.0 ⇒ no alert

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('does NOT notify when area min is null (no historical data)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw.mockResolvedValueOnce([{ min_price: null }]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── target_price mode (AC3) ─────────────────────────────────────────────────

  describe('target_price mode', () => {
    it('sends notification when newPrice <= target_pln and within radius', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_mode: 'target_price', price_drop_target_pln: 6.2 }),
      ]);
      // areaMin is SKIPPED when no cheaper_than_now candidates exist —
      // the only $queryRaw calls are user-location + radius.
      mockQueryRaw
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 800 }]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      expect(mockSendChunk.mock.calls[0][0][0].body).toContain('6.14');
    });

    it('does NOT notify when newPrice > target_pln', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_mode: 'target_price', price_drop_target_pln: 6.0 }),
      ]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('does NOT notify when target_pln is null in target_price mode', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_mode: 'target_price', price_drop_target_pln: null }),
      ]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('SKIPS the area-min query when only target_price candidates exist (lazy)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_mode: 'target_price', price_drop_target_pln: 6.0 }),
      ]);

      await service.checkAndNotify(baseJob);

      // Zero $queryRaw calls — no candidates met threshold so no location/
      // radius queries either. The key assertion is no MIN aggregation.
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });
  });

  // ── Radius (AC5) ────────────────────────────────────────────────────────────

  describe('radius check', () => {
    it('does NOT notify when ST_DWithin returns no rows (outside radius)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([]); // ST_DWithin: no match

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('falls back to voivodeship coarse match when no GPS-located fillup history', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }]) // areaMin
        .mockResolvedValueOnce([]); // getUserLocationProxy GPS query empty
      // Fallback non-GPS fill-up has voivodeship 'Mazowieckie' — matches station
      mockFillUpFindFirst.mockResolvedValueOnce({ station: { voivodeship: 'Mazowieckie' } });

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      // distanceKm is 0 for coarse match → copy says "nearby" not "X km away"
      expect(mockSendChunk.mock.calls[0][0][0].body).toContain('nearby');
    });

    it('does NOT notify when user has no fillup history at all', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([]); // no GPS lookup
      mockFillUpFindFirst.mockResolvedValueOnce(null); // no fillup at all

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('does NOT notify when voivodeship fallback voivodeship differs from station', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([]);
      mockFillUpFindFirst.mockResolvedValueOnce({ station: { voivodeship: 'Małopolskie' } });

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Fuel-type filter (AC7) ──────────────────────────────────────────────────

  describe('fuel-type filter', () => {
    it('does NOT include user whose fuel-type list excludes the dropped fuel', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_fuel_types: ['ON'] }), // not PB_95
      ]);

      await service.checkAndNotify(baseJob); // PB_95 drop

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('treats empty fuel-type list as opt-out (matches UI hint)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ price_drop_fuel_types: [] }),
      ]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Disabled / no token (AC6, AC8) ──────────────────────────────────────────

  describe('disabled or unreachable users', () => {
    it('does NOT include users with invalid push tokens', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ expo_push_token: 'not-an-expo-token' }),
      ]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('queries WHERE price_drop_enabled = true and excludes soft-deleted users', async () => {
      await service.checkAndNotify(baseJob);

      expect(mockNotificationPrefFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            price_drop_enabled: true,
            expo_push_token: { not: null },
            user: expect.objectContaining({ deleted_at: null }),
          }),
        }),
      );
    });
  });

  // ── Dedup (AC4) ─────────────────────────────────────────────────────────────

  describe('dedup', () => {
    it('does NOT notify when atomic SET NX claim returns null (already claimed)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      // Atomic claim returns null = key already existed = another job won
      mockRedisSet.mockResolvedValueOnce(null);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('claims dedup with SET NX EX 4h before sending (atomic)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);

      await service.checkAndNotify(baseJob);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:drop:user-1:PB_95',
        '1',
        'EX',
        4 * 3600,
        'NX',
      );
    });

    it('releases dedup slot when delivery ticket is an error', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      mockSendChunk.mockResolvedValueOnce([{ status: 'error', message: 'rate-limited' }]);

      await service.checkAndNotify(baseJob);

      expect(mockRedisDel).toHaveBeenCalledWith('alert:drop:user-1:PB_95');
    });

    it('releases dedup slot for all chunk recipients when sendChunk throws', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      mockSendChunk.mockRejectedValueOnce(new Error('Expo unreachable'));

      await service.checkAndNotify(baseJob);

      expect(mockRedisDel).toHaveBeenCalledWith('alert:drop:user-1:PB_95');
    });

    it('fail-opens when Redis SET NX errors — sends instead of suppressing', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockRedisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
    });
  });

  // ── Batching (AC4) ──────────────────────────────────────────────────────────

  describe('batching', () => {
    it('folds other recent drops within radius into a single batched notification', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }]) // areaMin
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }]) // location
        .mockResolvedValueOnce([{ distance_m: 1500 }])  // initial radius
        .mockResolvedValueOnce([{ distance_m: 800 }])   // recent drop 1 radius (cached location)
        .mockResolvedValueOnce([{ distance_m: 2200 }]); // recent drop 2 radius
      mockPriceHistoryFindMany.mockResolvedValueOnce([
        {
          station_id: 'station-2',
          price: 6.05,
          station: { name: 'BP Krakowska', voivodeship: 'Mazowieckie' },
        },
        {
          station_id: 'station-3',
          price: 5.99,
          station: { name: 'Shell Mokotów', voivodeship: 'Mazowieckie' },
        },
      ]);

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const message = mockSendChunk.mock.calls[0][0][0];
      expect(message.title).toMatch(/Prices dropped at 3 stations near you/);
      // Cheapest deep-link (station-3 at 5.99)
      // Story 6.8 — alertType added for notification_opened labelling.
      expect(message.data).toEqual({ route: '/station/station-3', alertType: 'price_drop' });
      expect(message.body).toContain('5.99');
    });

    it('does NOT include the source station in recent drops (already in match)', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      // recent-drops contains the source station; the seen-set should skip it
      mockPriceHistoryFindMany.mockResolvedValueOnce([
        { station_id: 'station-1', price: 6.14, station: { name: baseStation.name, voivodeship: 'Mazowieckie' } },
      ]);

      await service.checkAndNotify(baseJob);

      const message = mockSendChunk.mock.calls[0][0][0];
      expect(message.title).toMatch(/PB95 price drop/); // single-station copy
    });

    it('continues with single-station copy when extendWithRecentDrops scan fails', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      mockPriceHistoryFindMany.mockRejectedValueOnce(new Error('DB timeout'));

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      expect(mockSendChunk.mock.calls[0][0][0].title).toMatch(/PB95 price drop/);
    });
  });

  // ── Stale token cleanup ─────────────────────────────────────────────────────

  describe('stale token cleanup', () => {
    it('clears expo_push_token (user-scoped) when DeviceNotRegistered is returned', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([makePref()]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }])
        .mockResolvedValueOnce([{ distance_m: 1500 }]);
      mockSendChunk.mockResolvedValueOnce([
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ]);

      await service.checkAndNotify(baseJob);

      // user_id-scoped clear so a token shared across accounts (device
      // handoff, restore-from-backup) only nulls the user we tried to push to.
      expect(mockNotificationPrefUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', expo_push_token: VALID_TOKEN },
        data: { expo_push_token: null },
      });
      // Failed delivery — dedup released so the next verification can retry.
      expect(mockRedisDel).toHaveBeenCalledWith('alert:drop:user-1:PB_95');
    });
  });

  // ── Multi-user batching with mixed outcomes ────────────────────────────────

  describe('multi-user', () => {
    it('sends one push per qualifying user; skips dedup-claimed users', async () => {
      mockNotificationPrefFindMany.mockResolvedValueOnce([
        makePref({ user_id: 'user-1', expo_push_token: VALID_TOKEN }),
        makePref({ user_id: 'user-2', expo_push_token: VALID_TOKEN_2 }),
      ]);
      mockQueryRaw
        .mockResolvedValueOnce([{ min_price: 6.5 }])                                     // areaMin
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }]) // user-1 location
        .mockResolvedValueOnce([{ distance_m: 1500 }])                                   // user-1 radius
        .mockResolvedValueOnce([{ lat: 52.23, lng: 21.01, voivodeship: 'Mazowieckie' }]) // user-2 location
        .mockResolvedValueOnce([{ distance_m: 1500 }]);                                  // user-2 radius
      // user-1: claim returns null (already taken). user-2: claim wins.
      mockRedisSet.mockResolvedValueOnce(null).mockResolvedValueOnce('OK');

      await service.checkAndNotify(baseJob);

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sent = mockSendChunk.mock.calls[0][0];
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_TOKEN_2);
    });
  });
});
