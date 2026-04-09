import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockMarketSignalFindMany = jest.fn();
const mockNotificationPrefFindMany = jest.fn();

const mockNotificationPrefUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

const mockPrisma = {
  marketSignal: { findMany: mockMarketSignalFindMany },
  notificationPreference: { findMany: mockNotificationPrefFindMany, updateMany: mockNotificationPrefUpdateMany },
};

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
};

const mockIsValidToken = jest.fn((token: string) => token.startsWith('ExponentPushToken['));
const mockChunkMessages = jest.fn();
const mockSendChunk = jest.fn();

const mockExpoPush = {
  isValidToken: mockIsValidToken,
  chunkMessages: mockChunkMessages,
  sendChunk: mockSendChunk,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeSignal = (signal_type: string) => ({
  signal_type,
  recorded_at: new Date(),
});

const makePreference = (token: string) => ({ expo_push_token: token });

const VALID_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PriceRiseAlertService', () => {
  let service: PriceRiseAlertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Default: chunk returns single chunk with all messages
    mockChunkMessages.mockImplementation((msgs: unknown[]) => [msgs]);
    // Default: send returns ok ticket
    mockSendChunk.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
    // Default: Redis dedup miss (no prior alert)
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceRiseAlertService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: EXPO_PUSH_CLIENT, useValue: mockExpoPush },
      ],
    }).compile();

    service = module.get(PriceRiseAlertService);
  });

  // ── No signals ──────────────────────────────────────────────────────────────

  describe('when no significant signals exist in the last 2 hours', () => {
    it('returns early without querying preferences or sending push', async () => {
      mockMarketSignalFindMany.mockResolvedValue([]);

      await service.sendRiseAlerts();

      expect(mockNotificationPrefFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Dedup ───────────────────────────────────────────────────────────────────

  describe('when all signal types have already been alerted within 48h', () => {
    it('returns early without sending push', async () => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockRedisGet.mockResolvedValue('1'); // dedup hit

      await service.sendRiseAlerts();

      expect(mockNotificationPrefFindMany).not.toHaveBeenCalled();
      expect(mockSendChunk).not.toHaveBeenCalled();
    });

    it('deduplicates multiple signals of the same type to one Redis check', async () => {
      mockMarketSignalFindMany.mockResolvedValue([
        makeSignal('orlen_rack_pb95'),
        makeSignal('orlen_rack_pb95'),
      ]);
      mockRedisGet.mockResolvedValue('1');

      await service.sendRiseAlerts();

      expect(mockRedisGet).toHaveBeenCalledTimes(1);
      expect(mockRedisGet).toHaveBeenCalledWith('alert:rise:orlen_rack_pb95');
    });
  });

  describe('when Redis dedup check fails', () => {
    it('treats signal as new (fail-open) and proceeds to send', async () => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockRedisGet.mockRejectedValue(new Error('Redis connection lost'));
      mockNotificationPrefFindMany.mockResolvedValue([makePreference(VALID_TOKEN)]);

      await service.sendRiseAlerts();

      expect(mockSendChunk).toHaveBeenCalled();
    });
  });

  // ── No valid tokens ─────────────────────────────────────────────────────────

  describe('when no opted-in users have valid push tokens', () => {
    it('records dedup keys but sends no push', async () => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockNotificationPrefFindMany.mockResolvedValue([]);

      await service.sendRiseAlerts();

      expect(mockSendChunk).not.toHaveBeenCalled();
      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:orlen_rack_pb95',
        '1',
        'EX',
        48 * 3600,
      );
    });

    it('filters out invalid token formats', async () => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_on')]);
      mockNotificationPrefFindMany.mockResolvedValue([
        makePreference('not-a-valid-expo-token'),
      ]);

      await service.sendRiseAlerts();

      expect(mockSendChunk).not.toHaveBeenCalled();
    });
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('when signals exist and users are opted in', () => {
    beforeEach(() => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockNotificationPrefFindMany.mockResolvedValue([makePreference(VALID_TOKEN)]);
    });

    it('sends push notification with correct copy', async () => {
      await service.sendRiseAlerts();

      expect(mockSendChunk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            to: VALID_TOKEN,
            title: 'Fuel prices may be rising',
            body: expect.stringContaining('worth filling up if you can'),
            data: { route: '/' },
            sound: 'default',
          }),
        ]),
      );
    });

    it('records dedup key with 48h TTL after sending', async () => {
      await service.sendRiseAlerts();

      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:rise:orlen_rack_pb95',
        '1',
        'EX',
        48 * 3600,
      );
    });

    it('records one dedup key per unique signal type', async () => {
      mockMarketSignalFindMany.mockResolvedValue([
        makeSignal('orlen_rack_pb95'),
        makeSignal('orlen_rack_on'),
        makeSignal('orlen_rack_pb95'), // duplicate — deduped
      ]);

      await service.sendRiseAlerts();

      expect(mockRedisSet).toHaveBeenCalledWith('alert:rise:orlen_rack_pb95', '1', 'EX', 48 * 3600);
      expect(mockRedisSet).toHaveBeenCalledWith('alert:rise:orlen_rack_on', '1', 'EX', 48 * 3600);
      expect(mockRedisSet).toHaveBeenCalledTimes(2);
    });

    it('sends messages in chunks', async () => {
      const tokens = ['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]'];
      mockNotificationPrefFindMany.mockResolvedValue(tokens.map(makePreference));
      mockChunkMessages.mockReturnValue([[tokens[0]], [tokens[1]]]);

      await service.sendRiseAlerts();

      expect(mockSendChunk).toHaveBeenCalledTimes(2);
    });
  });

  // ── Push ticket errors ──────────────────────────────────────────────────────

  describe('push ticket error handling', () => {
    beforeEach(() => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockNotificationPrefFindMany.mockResolvedValue([makePreference(VALID_TOKEN)]);
    });

    it('logs DeviceNotRegistered warning without throwing', async () => {
      mockSendChunk.mockResolvedValue([
        { status: 'error', message: 'Not registered', details: { error: 'DeviceNotRegistered' } },
      ]);

      await expect(service.sendRiseAlerts()).resolves.not.toThrow();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('DeviceNotRegistered'),
      );
    });

    it('logs other ticket errors without throwing', async () => {
      mockSendChunk.mockResolvedValue([
        { status: 'error', message: 'MessageTooBig', details: { error: 'MessageTooBig' } },
      ]);

      await expect(service.sendRiseAlerts()).resolves.not.toThrow();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('MessageTooBig'),
      );
    });

    it('continues sending remaining chunks if one chunk throws', async () => {
      const tokens = ['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]'];
      mockNotificationPrefFindMany.mockResolvedValue(tokens.map(makePreference));
      mockChunkMessages.mockReturnValue([[tokens[0]], [tokens[1]]]);
      mockSendChunk
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([{ status: 'ok', id: 'ticket-2' }]);

      await expect(service.sendRiseAlerts()).resolves.not.toThrow();
      expect(mockSendChunk).toHaveBeenCalledTimes(2);
    });
  });

  // ── Dedup key recording failure ─────────────────────────────────────────────

  describe('when Redis set fails during dedup recording', () => {
    it('logs warning but does not throw', async () => {
      mockMarketSignalFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockNotificationPrefFindMany.mockResolvedValue([makePreference(VALID_TOKEN)]);
      mockRedisSet.mockRejectedValue(new Error('Redis write failed'));

      await expect(service.sendRiseAlerts()).resolves.not.toThrow();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record dedup key'),
      );
    });
  });
});
