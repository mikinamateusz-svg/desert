import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { GuestNudgeService, GUEST_MARKET_EVENT_KEY } from './guest-nudge.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from '../alert/expo-push.token.js';

const mockGuestTokenFindMany = jest.fn();
const mockGuestTokenUpsert = jest.fn();
const mockEventCreate = jest.fn();

const mockPrisma = {
  guestPushToken: {
    findMany: mockGuestTokenFindMany,
    upsert: mockGuestTokenUpsert,
  },
  notificationEvent: { create: mockEventCreate },
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

const VALID_TOKEN = 'ExponentPushToken[abc]';

describe('GuestNudgeService', () => {
  let service: GuestNudgeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Defaults: SET NX wins (no prior key), chunk pass-through, push ok.
    mockRedisSet.mockResolvedValue('OK');
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestNudgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
      ],
    }).compile();
    service = module.get(GuestNudgeService);
  });

  // ── maybeNotifyGuests ────────────────────────────────────────────────

  describe('maybeNotifyGuests', () => {
    it('claims the 48h dedup slot via SET NX EX and sends to all tokens', async () => {
      mockGuestTokenFindMany.mockResolvedValue([
        { token: VALID_TOKEN },
        { token: 'ExponentPushToken[bbb]' },
      ]);

      await service.maybeNotifyGuests();

      // Atomic claim via SET NX EX with 48h TTL.
      expect(mockRedisSet).toHaveBeenCalledWith(
        GUEST_MARKET_EVENT_KEY,
        expect.any(String),
        'EX',
        48 * 3600,
        'NX',
      );
      // Both valid tokens sent.
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sentMessages = mockSendChunk.mock.calls[0][0];
      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0]).toMatchObject({
        title: 'Fuel prices moved today',
        data: expect.objectContaining({
          alertType: 'guest_market_event',
          route: '/(auth)/login',
        }),
      });
    });

    it('skips push when the dedup key is already claimed (SET NX returns null)', async () => {
      mockRedisSet.mockResolvedValue(null);

      await service.maybeNotifyGuests();

      // No further work after the failed claim.
      expect(mockGuestTokenFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('still claims the slot when no guest push tokens are registered (banner fallback only)', async () => {
      mockGuestTokenFindMany.mockResolvedValue([]);

      await service.maybeNotifyGuests();

      // The slot IS claimed so subsequent calls within 48h are deduped.
      // The banner fallback (GET /v1/nudge/market-event) reads the key.
      expect(mockRedisSet).toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('filters out malformed Expo tokens before sending', async () => {
      mockGuestTokenFindMany.mockResolvedValue([
        { token: VALID_TOKEN },
        { token: 'not-a-real-token' },
      ]);

      await service.maybeNotifyGuests();

      expect(mockSendChunk).toHaveBeenCalledTimes(1);
      const sentMessages = mockSendChunk.mock.calls[0][0];
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].to).toBe(VALID_TOKEN);
    });

    it('does not throw if Redis SET NX errors — fail-CLOSED to prevent re-spam', async () => {
      mockRedisSet.mockRejectedValue(new Error('redis down'));

      await expect(service.maybeNotifyGuests()).resolves.not.toThrow();
      expect(mockGuestTokenFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('does not throw if the Expo push send fails — guest analytics never block callers', async () => {
      mockGuestTokenFindMany.mockResolvedValue([{ token: VALID_TOKEN }]);
      mockSendChunk.mockRejectedValue(new Error('expo unreachable'));

      await expect(service.maybeNotifyGuests()).resolves.not.toThrow();
      // Slot still claimed even though push failed (matches the
      // codebase's other alert pipelines' fail-forward semantics).
      expect(mockRedisSet).toHaveBeenCalled();
    });
  });

  // ── getActiveMarketEvent ────────────────────────────────────────────

  describe('getActiveMarketEvent', () => {
    it('returns active=true with the eventId when the dedup key is alive', async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ eventId: 'evt-123', triggeredAt: '2026-05-09T10:00:00Z' }),
      );

      const result = await service.getActiveMarketEvent();

      expect(result).toEqual({ active: true, eventId: 'evt-123' });
    });

    it('returns inactive when the key is absent (TTL expired or never set)', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await service.getActiveMarketEvent();

      expect(result).toEqual({ active: false, eventId: null });
    });

    it('fails-CLOSED on malformed JSON — never surfaces a misleading banner', async () => {
      mockRedisGet.mockResolvedValue('{not-json');

      const result = await service.getActiveMarketEvent();

      expect(result).toEqual({ active: false, eventId: null });
    });

    it('fails-CLOSED on Redis errors', async () => {
      mockRedisGet.mockRejectedValue(new Error('redis timeout'));

      const result = await service.getActiveMarketEvent();

      expect(result).toEqual({ active: false, eventId: null });
    });
  });

  // ── logEvent + registerToken ────────────────────────────────────────

  describe('logEvent', () => {
    it('writes a NotificationEvent row with user_id null', async () => {
      await service.logEvent('guest_nudge_shown', 'engagement');

      expect(mockEventCreate).toHaveBeenCalledWith({
        data: {
          user_id: null,
          event_type: 'guest_nudge_shown',
          trigger: 'engagement',
          alert_type: null,
        },
      });
    });

    it('swallows DB errors silently', async () => {
      mockEventCreate.mockRejectedValue(new Error('db down'));

      await expect(service.logEvent('x', 'y')).resolves.not.toThrow();
    });
  });

  describe('registerToken', () => {
    it('upserts on the token unique key (idempotent re-registrations)', async () => {
      await service.registerToken(VALID_TOKEN);

      expect(mockGuestTokenUpsert).toHaveBeenCalledWith({
        where: { token: VALID_TOKEN },
        create: { token: VALID_TOKEN },
        update: {},
      });
    });
  });
});
