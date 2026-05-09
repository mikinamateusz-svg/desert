import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

const mockPrismaService = {
  notificationPreference: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// Story 6.6 — Redis read for monthly:summary:calculated:{userId}
const mockRedisGet = jest.fn();
const mockRedis = { get: mockRedisGet };

// expo_push_token is excluded from GET/PATCH responses (P7)
const basePreference = {
  id: 'pref-uuid-1',
  user_id: 'user-uuid',
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
  created_at: new Date('2026-03-23T12:00:00Z'),
  updated_at: new Date('2026-03-23T12:00:00Z'),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('getPreferences', () => {
    it('should call upsert with create defaults, empty update, and select without token', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);

      await service.getPreferences('user-uuid');

      expect(mockPrismaService.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-uuid' },
          create: { user_id: 'user-uuid' },
          update: {},
          select: expect.objectContaining({ id: true, user_id: true, price_drops: true }),
        }),
      );
    });

    it('should NOT include expo_push_token in select', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);

      await service.getPreferences('user-uuid');

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        select: Record<string, unknown>;
      };
      expect(call.select).not.toHaveProperty('expo_push_token');
    });

    it('should return the upserted preference row', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);

      const result = await service.getPreferences('user-uuid');

      expect(result).toEqual(basePreference);
    });
  });

  describe('updatePreferences', () => {
    it('should include only price_drops in update when only price_drops is provided', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce({
        ...basePreference,
        price_drops: false,
      });
      const dto: UpdateNotificationPreferencesDto = { price_drops: false };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).toEqual({ price_drops: false });
      expect(call.update).not.toHaveProperty('sharp_rise');
      expect(call.update).not.toHaveProperty('monthly_summary');
      expect(call.update).not.toHaveProperty('expo_push_token');
    });

    it('should include expo_push_token: null in update when explicitly passed as null', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { expo_push_token: null };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).toEqual({ expo_push_token: null });
    });

    it('should NOT include expo_push_token in update when it is not in the DTO', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { price_drops: true };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).not.toHaveProperty('expo_push_token');
    });

    it('should NOT include expo_push_token in create when not in DTO (unified defaults — P8)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { price_drops: false };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(call.create).toEqual({
        user_id: 'user-uuid',
        price_drops: false,
        sharp_rise: true,
        monthly_summary: true,
      });
      expect(call.create).not.toHaveProperty('expo_push_token');
    });

    it('should include expo_push_token in create when provided in DTO', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { expo_push_token: 'ExponentPushToken[abc]' };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(call.create).toHaveProperty('expo_push_token', 'ExponentPushToken[abc]');
    });

    // ── Story 6.4: Phase 2 alert preferences ─────────────────────────────

    it('updates each Phase 2 field independently — non-provided fields are not overwritten', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { price_drop_enabled: true };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).toEqual({ price_drop_enabled: true });
      // Critical: every Phase 2 sibling stays absent so Prisma doesn't reset it.
      expect(call.update).not.toHaveProperty('price_drop_mode');
      expect(call.update).not.toHaveProperty('price_drop_target_pln');
      expect(call.update).not.toHaveProperty('price_drop_fuel_types');
      expect(call.update).not.toHaveProperty('alert_radius_km');
      expect(call.update).not.toHaveProperty('rise_community_enabled');
      expect(call.update).not.toHaveProperty('rise_predictive_enabled');
      // And Phase 1 columns also stay untouched.
      expect(call.update).not.toHaveProperty('price_drops');
    });

    it('passes price_drop_target_pln number through to Prisma (Decimal column accepts it)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      // 6.50 PLN/L target — common driver expectation.
      const dto: UpdateNotificationPreferencesDto = {
        price_drop_mode: 'target_price',
        price_drop_target_pln: 6.5,
      };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).toEqual({
        price_drop_mode: 'target_price',
        price_drop_target_pln: 6.5,
      });
    });

    it('passes price_drop_target_pln: null when user clears the target (mode flip back)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { price_drop_target_pln: null };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      // null is a meaningful value here — !== undefined gate must let it through.
      expect(call.update).toEqual({ price_drop_target_pln: null });
    });

    it('passes price_drop_fuel_types array through verbatim (multi-select)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = {
        price_drop_fuel_types: ['PB_95', 'ON'],
      };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: { price_drop_fuel_types?: unknown };
      };
      expect(call.update.price_drop_fuel_types).toEqual(['PB_95', 'ON']);
    });

    it('passes empty fuel_types array through (user de-selected last chip)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = { price_drop_fuel_types: [] };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: { price_drop_fuel_types?: unknown };
      };
      // Empty array is a real intent — "no fuel types selected" — distinct
      // from "field not provided." Must reach the DB.
      expect(call.update.price_drop_fuel_types).toEqual([]);
    });

    it('updates rise toggles independently of each other and of drop alerts', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);
      const dto: UpdateNotificationPreferencesDto = {
        rise_community_enabled: true,
      };

      await service.updatePreferences('user-uuid', dto);

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(call.update).toEqual({ rise_community_enabled: true });
      expect(call.update).not.toHaveProperty('rise_predictive_enabled');
      expect(call.update).not.toHaveProperty('price_drop_enabled');
    });

    it('SELECT projection includes all Phase 2 columns (UI needs them on every read)', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValueOnce(basePreference);

      await service.getPreferences('user-uuid');

      const call = mockPrismaService.notificationPreference.upsert.mock.calls[0][0] as {
        select: Record<string, unknown>;
      };
      expect(call.select).toMatchObject({
        price_drop_enabled: true,
        price_drop_mode: true,
        price_drop_target_pln: true,
        price_drop_fuel_types: true,
        alert_radius_km: true,
        rise_community_enabled: true,
        rise_predictive_enabled: true,
      });
      // expo_push_token must still be excluded.
      expect(call.select).not.toHaveProperty('expo_push_token');
    });
  });

  // ── Story 6.6 — getSummaryReprompt ──────────────────────────────────────────

  describe('getSummaryReprompt', () => {
    it('returns pending=false when user already has a push token (re-prompt is moot)', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: 'ExponentPushToken[xxx]',
      });

      const result = await service.getSummaryReprompt('user-uuid');

      expect(result).toEqual({ pending: false, savedPln: null });
      // Did NOT proceed to Redis or savings query
      expect(mockRedisGet).not.toHaveBeenCalled();
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns pending=false when no Story 6.5 Redis key exists', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: null,
      });
      mockRedisGet.mockResolvedValueOnce(null); // no key set

      const result = await service.getSummaryReprompt('user-uuid');

      expect(result).toEqual({ pending: false, savedPln: null });
      expect(mockRedisGet).toHaveBeenCalledWith('monthly:summary:calculated:user-uuid');
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns pending=true with rounded savedPln when key exists and savings >= 1 PLN', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: null,
      });
      mockRedisGet.mockResolvedValueOnce('1');
      mockPrismaService.$queryRaw.mockResolvedValueOnce([{ total_savings: 93.6 }]);

      const result = await service.getSummaryReprompt('user-uuid');

      expect(result).toEqual({ pending: true, savedPln: 94 });
    });

    it('returns pending=true with savedPln=null when savings round to 0 PLN (avoids "you saved 0 PLN" copy)', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: null,
      });
      mockRedisGet.mockResolvedValueOnce('1');
      mockPrismaService.$queryRaw.mockResolvedValueOnce([{ total_savings: 0.3 }]);

      const result = await service.getSummaryReprompt('user-uuid');

      // pending stays true (Story 6.5 calculated something) — UI falls
      // back to generic copy without the personalised PLN amount.
      expect(result).toEqual({ pending: true, savedPln: null });
    });

    it('returns pending=true with savedPln=null when previous month had no fillups', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: null,
      });
      mockRedisGet.mockResolvedValueOnce('1');
      mockPrismaService.$queryRaw.mockResolvedValueOnce([{ total_savings: null }]);

      const result = await service.getSummaryReprompt('user-uuid');

      expect(result).toEqual({ pending: true, savedPln: null });
    });

    it('returns pending=true when user has no NotificationPreference row at all', async () => {
      // Lazy-create pattern from notifications.service: rows only exist
      // after first GET/PATCH. Missing row = no token = re-prompt eligible.
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce(null);
      mockRedisGet.mockResolvedValueOnce('1');
      mockPrismaService.$queryRaw.mockResolvedValueOnce([{ total_savings: 50 }]);

      const result = await service.getSummaryReprompt('user-uuid');

      expect(result).toEqual({ pending: true, savedPln: 50 });
    });

    it('fail-closes (no re-prompt) when Redis read errors', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValueOnce({
        expo_push_token: null,
      });
      mockRedisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.getSummaryReprompt('user-uuid');

      // Better to suppress than to surface a stale "you saved X" claim
      // with no Redis backing.
      expect(result).toEqual({ pending: false, savedPln: null });
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
