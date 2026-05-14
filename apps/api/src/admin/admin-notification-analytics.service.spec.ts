import { Test, TestingModule } from '@nestjs/testing';
import { AdminNotificationAnalyticsService } from './admin-notification-analytics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockUserCount = jest.fn();
const mockPrefFindMany = jest.fn();
const mockEventFindMany = jest.fn();
const mockSendLogGroupBy = jest.fn();
const mockEventGroupBy = jest.fn();

const mockPrisma = {
  user: { count: mockUserCount },
  notificationPreference: { findMany: mockPrefFindMany },
  notificationEvent: { findMany: mockEventFindMany, groupBy: mockEventGroupBy },
  notificationSendLog: { groupBy: mockSendLogGroupBy },
};

describe('AdminNotificationAnalyticsService', () => {
  let service: AdminNotificationAnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminNotificationAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AdminNotificationAnalyticsService);
  });

  describe('permissions + opt-in (snapshot, period-independent)', () => {
    it('computes push grant rate over total users', async () => {
      mockUserCount.mockResolvedValue(100);
      mockPrefFindMany.mockResolvedValue([
        pref({ expo_push_token: 'tok1', price_drop_enabled: true }),
        pref({ expo_push_token: 'tok2', price_drop_enabled: false }),
        pref({ expo_push_token: null }), // no token
      ]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      expect(result.totalUsers).toBe(100);
      expect(result.pushGrantedUsers).toBe(2);
      expect(result.pushGrantRate).toBe(0.02); // 2/100
    });

    it('opt-in rates are percentages of push-granted users (not total)', async () => {
      mockUserCount.mockResolvedValue(10);
      mockPrefFindMany.mockResolvedValue([
        pref({ expo_push_token: 'a', price_drop_enabled: true, rise_predictive_enabled: true }),
        pref({ expo_push_token: 'b', price_drop_enabled: true, rise_predictive_enabled: false }),
        pref({ expo_push_token: 'c', price_drop_enabled: false, rise_predictive_enabled: false }),
        // No-token users should NOT inflate the opt-in denominator.
        pref({ expo_push_token: null, price_drop_enabled: true, rise_predictive_enabled: true }),
      ]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      // 2 of 3 granted users have price-drop enabled.
      expect(result.optInRates.priceDrop).toBe(0.667);
      // 1 of 3 has predictive rise.
      expect(result.optInRates.predictiveRise).toBe(0.333);
    });

    it('config breakdown is over price-drop-enabled users only', async () => {
      mockUserCount.mockResolvedValue(10);
      mockPrefFindMany.mockResolvedValue([
        pref({ expo_push_token: 'a', price_drop_enabled: true, alert_radius_km: 10, price_drop_mode: 'cheaper_than_now' }),
        pref({ expo_push_token: 'b', price_drop_enabled: true, alert_radius_km: 25, price_drop_mode: 'target_price' }),
        pref({ expo_push_token: 'c', price_drop_enabled: false, alert_radius_km: 5, price_drop_mode: 'target_price' }),
      ]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      // Disabled user must NOT be counted.
      expect(result.configBreakdown.radius.km5).toBe(0);
      expect(result.configBreakdown.radius.km10).toBe(1);
      expect(result.configBreakdown.radius.km25).toBe(1);
      expect(result.configBreakdown.dropMode.cheaperThanNow).toBe(1);
      expect(result.configBreakdown.dropMode.targetPrice).toBe(1);
    });

    it('returns zero rates when no users exist (no divide-by-zero)', async () => {
      mockUserCount.mockResolvedValue(0);
      mockPrefFindMany.mockResolvedValue([]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      expect(result.pushGrantRate).toBe(0);
      expect(result.optInRates.priceDrop).toBe(0);
    });
  });

  describe('reprompt conversion (time-filtered)', () => {
    it('computes shown / dismissed / granted / rate per trigger', async () => {
      mockUserCount.mockResolvedValue(50);
      mockPrefFindMany.mockResolvedValue([]);
      mockEventFindMany.mockResolvedValue([
        { event_type: 'reprompt_shown', trigger: 'photo' },
        { event_type: 'reprompt_shown', trigger: 'photo' },
        { event_type: 'reprompt_shown', trigger: 'photo' },
        { event_type: 'reprompt_dismissed', trigger: 'photo' },
        { event_type: 'reprompt_granted', trigger: 'photo' },
        { event_type: 'reprompt_shown', trigger: 'monthly' },
        { event_type: 'reprompt_granted', trigger: 'monthly' },
      ]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');
      const photo = result.repromptStats.find((s) => s.trigger === 'photo')!;
      const monthly = result.repromptStats.find((s) => s.trigger === 'monthly')!;

      expect(photo.shown).toBe(3);
      expect(photo.dismissed).toBe(1);
      expect(photo.granted).toBe(1);
      expect(photo.conversionRate).toBe(0.333); // 1/3
      expect(monthly.shown).toBe(1);
      expect(monthly.granted).toBe(1);
      expect(monthly.conversionRate).toBe(1); // 1/1
    });

    it('returns zero stats for a trigger with no events (always present in response)', async () => {
      mockUserCount.mockResolvedValue(10);
      mockPrefFindMany.mockResolvedValue([]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      // Both triggers always appear, even with zero data.
      expect(result.repromptStats).toHaveLength(2);
      expect(result.repromptStats.every((s) => s.shown === 0)).toBe(true);
    });
  });

  describe('alert engagement (sends + opens)', () => {
    it('always returns one row per known alert type with sent/opened/rate', async () => {
      mockUserCount.mockResolvedValue(100);
      mockPrefFindMany.mockResolvedValue([]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([
        { alert_type: 'price_drop', _sum: { recipient_count: 100 } },
        { alert_type: 'community_rise', _sum: { recipient_count: 50 } },
      ]);
      mockEventGroupBy.mockResolvedValue([
        { alert_type: 'price_drop', _count: { id: 25 } },
        // No opens for community_rise — engagement should be 0.
      ]);

      const result = await service.getMetrics('30d');

      // All 4 known alert types present even when DB rows are partial.
      expect(result.alertEngagement.map((r) => r.alertType).sort()).toEqual([
        'community_rise',
        'monthly_summary',
        'predictive_rise',
        'price_drop',
      ]);
      const drop = result.alertEngagement.find((r) => r.alertType === 'price_drop')!;
      expect(drop.sent).toBe(100);
      expect(drop.opened).toBe(25);
      expect(drop.engagementRate).toBe(0.25);
      const comm = result.alertEngagement.find((r) => r.alertType === 'community_rise')!;
      expect(comm.sent).toBe(50);
      expect(comm.opened).toBe(0);
      expect(comm.engagementRate).toBe(0);
    });
  });

  describe('trend bucketing', () => {
    it('uses daily buckets for 7d/30d periods', async () => {
      mockUserCount.mockResolvedValue(10);
      // Permission/opt-in findMany call.
      mockPrefFindMany.mockResolvedValueOnce([]);
      // Trend findMany call (separate, with date filter).
      mockPrefFindMany.mockResolvedValueOnce([
        { updated_at: new Date('2026-05-08T10:00:00Z') },
        { updated_at: new Date('2026-05-08T15:00:00Z') }, // same day → same bucket
        { updated_at: new Date('2026-05-09T12:00:00Z') },
      ]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('30d');

      // Bucket keys are YYYY-MM-DD; should have 2 distinct buckets.
      expect(result.pushGrantTrend.map((p) => p.date)).toEqual(['2026-05-08', '2026-05-09']);
      expect(result.pushGrantTrend.find((p) => p.date === '2026-05-08')?.value).toBe(2);
      expect(result.pushGrantTrend.find((p) => p.date === '2026-05-09')?.value).toBe(1);
    });

    it('uses weekly buckets for 90d/all periods', async () => {
      mockUserCount.mockResolvedValue(10);
      mockPrefFindMany.mockResolvedValueOnce([]); // permissions call
      mockPrefFindMany.mockResolvedValueOnce([
        { updated_at: new Date('2026-05-08T10:00:00Z') },
      ]);
      mockEventFindMany.mockResolvedValue([]);
      mockSendLogGroupBy.mockResolvedValue([]);
      mockEventGroupBy.mockResolvedValue([]);

      const result = await service.getMetrics('90d');

      expect(result.pushGrantTrend).toHaveLength(1);
      expect(result.pushGrantTrend[0]!.date).toMatch(/^2026-W\d{2}$/);
    });
  });
});

function pref(overrides: {
  expo_push_token?: string | null;
  price_drop_enabled?: boolean;
  rise_community_enabled?: boolean;
  rise_predictive_enabled?: boolean;
  monthly_summary?: boolean;
  alert_radius_km?: number;
  price_drop_mode?: string;
  updated_at?: Date;
}) {
  // `in` check distinguishes "explicit null" (no token) from "absent" (default token).
  // Using `??` would coalesce explicit `null` to the default and break test intent.
  const tokenSet = 'expo_push_token' in overrides;
  return {
    expo_push_token: tokenSet ? overrides.expo_push_token : 'ExponentPushToken[default]',
    price_drop_enabled: overrides.price_drop_enabled ?? false,
    rise_community_enabled: overrides.rise_community_enabled ?? false,
    rise_predictive_enabled: overrides.rise_predictive_enabled ?? false,
    monthly_summary: overrides.monthly_summary ?? true,
    alert_radius_km: overrides.alert_radius_km ?? 10,
    price_drop_mode: overrides.price_drop_mode ?? 'cheaper_than_now',
    // Prisma populates this on every write — tests that mock NotificationPreference
    // rows should keep parity so trend bucketing doesn't crash on undefined.
    updated_at: overrides.updated_at ?? new Date('2026-05-08T10:00:00Z'),
  };
}
