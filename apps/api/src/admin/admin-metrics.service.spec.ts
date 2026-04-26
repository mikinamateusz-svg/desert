import { Test, TestingModule } from '@nestjs/testing';
import { AdminMetricsService } from './admin-metrics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsCounterService } from '../metrics/metrics-counter.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';
import { OcrSpendService } from '../photo/ocr-spend.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQueue = {
  getJobCounts: jest.fn(),
};

const mockPhotoPipelineWorker = {
  getQueue: jest.fn().mockReturnValue(mockQueue),
};

const mockQueryRaw = jest.fn();
const mockQueryRawUnsafe = jest.fn();
const mockSubmissionFindMany = jest.fn();
const mockSubmissionCount = jest.fn();
const mockDailyApiCostFindMany = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
  $queryRawUnsafe: mockQueryRawUnsafe,
  submission: {
    findMany: mockSubmissionFindMany,
    count: mockSubmissionCount,
  },
  dailyApiCost: {
    findMany: mockDailyApiCostFindMany,
  },
};

const mockGetMapViewsByDate = jest.fn();

const mockMetricsCounter = {
  getMapViewsByDate: mockGetMapViewsByDate,
};

const mockGetDailySpend = jest.fn();
const mockOcrSpend = {
  getDailySpend: mockGetDailySpend,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminMetricsService', () => {
  let service: AdminMetricsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default BullMQ queue counts
    mockQueue.getJobCounts.mockResolvedValue({ waiting: 3, active: 1, failed: 2 });

    // Default empty map views
    mockGetMapViewsByDate.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminMetricsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MetricsCounterService, useValue: mockMetricsCounter },
        { provide: PhotoPipelineWorker, useValue: mockPhotoPipelineWorker },
        { provide: OcrSpendService, useValue: mockOcrSpend },
      ],
    }).compile();

    service = module.get<AdminMetricsService>(AdminMetricsService);
    // Manually trigger onModuleInit since NestJS lifecycle hooks don't run in unit tests
    await service.onModuleInit();
  });

  // ── getPipelineHealth ──────────────────────────────────────────────────────

  describe('getPipelineHealth', () => {
    it('returns queue counts from BullMQ', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ verified_count: 8n, total_count: 10n, p50_seconds: 2.5, p95_seconds: 8.1 }])
        .mockResolvedValueOnce([]);

      const result = await service.getPipelineHealth();

      expect(result.queueDepth).toBe(3);
      expect(result.activeJobs).toBe(1);
      expect(result.dlqCount).toBe(2);
    });

    it('computes success rate correctly', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ verified_count: 8n, total_count: 10n, p50_seconds: 2.5, p95_seconds: 8.1 }])
        .mockResolvedValueOnce([]);

      const result = await service.getPipelineHealth();

      expect(result.successRate1h).toBe(0.8);
    });

    it('returns null success rate when no submissions in last 1h', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ verified_count: 0n, total_count: 0n, p50_seconds: null, p95_seconds: null }])
        .mockResolvedValueOnce([]);

      const result = await service.getPipelineHealth();

      expect(result.successRate1h).toBeNull();
      expect(result.processingTimeP50Seconds).toBeNull();
      expect(result.processingTimeP95Seconds).toBeNull();
    });

    it('includes error breakdown from DB', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ verified_count: 1n, total_count: 5n, p50_seconds: 3, p95_seconds: 10 }])
        .mockResolvedValueOnce([
          { flag_reason: 'logo_mismatch', count: 3n },
          { flag_reason: 'low_trust', count: 1n },
        ]);

      const result = await service.getPipelineHealth();

      expect(result.errorBreakdown).toHaveLength(2);
      expect(result.errorBreakdown[0]).toEqual({ reason: 'logo_mismatch', count: 3 });
    });
  });

  // ── getFunnelMetrics ───────────────────────────────────────────────────────

  describe('getFunnelMetrics', () => {
    it('aggregates submission counts by status', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { status: 'verified',        flag_reason: null,         count: 50n },
        { status: 'rejected',        flag_reason: 'low_trust',  count: 20n },
        { status: 'shadow_rejected', flag_reason: 'logo_mismatch', count: 10n },
        { status: 'pending',         flag_reason: null,         count: 5n  },
      ]);

      const result = await service.getFunnelMetrics('today');

      expect(result.totalSubmissions).toBe(85);
      expect(result.verified).toBe(50);
      expect(result.rejected).toBe(20);
      expect(result.shadowRejected).toBe(10);
      expect(result.pending).toBe(5);
      expect(result.dlqCount).toBe(2); // from default mock
    });

    it('computes percentages correctly', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { status: 'verified', flag_reason: null, count: 80n },
        { status: 'rejected', flag_reason: 'low_trust', count: 20n },
      ]);

      const result = await service.getFunnelMetrics('7d');

      expect(result.verifiedPct).toBe(80);
      expect(result.rejectedPct).toBe(20);
    });

    it('includes merged rejection breakdown across rejected + shadow_rejected', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { status: 'rejected',        flag_reason: 'logo_mismatch', count: 5n },
        { status: 'shadow_rejected', flag_reason: 'logo_mismatch', count: 3n },
        { status: 'shadow_rejected', flag_reason: 'low_trust',     count: 7n },
      ]);

      const result = await service.getFunnelMetrics('30d');

      const logoEntry = result.rejectionBreakdown.find(r => r.reason === 'logo_mismatch');
      expect(logoEntry?.count).toBe(8);
      const trustEntry = result.rejectionBreakdown.find(r => r.reason === 'low_trust');
      expect(trustEntry?.count).toBe(7);
    });
  });

  // ── getFunnelDrilldown ────────────────────────────────────────────────────

  describe('getFunnelDrilldown', () => {
    it('returns paginated submission list for the given reason', async () => {
      const rows = [
        { id: 'sub-1', station_id: 'st-1', station: { name: 'Orlen Testowa' }, created_at: new Date('2026-04-01'), flag_reason: 'logo_mismatch' },
      ];
      mockSubmissionFindMany.mockResolvedValueOnce(rows);
      mockSubmissionCount.mockResolvedValueOnce(1);

      const result = await service.getFunnelDrilldown('logo_mismatch', 'today', 1, 20);

      expect(result.total).toBe(1);
      expect(result.data[0]?.id).toBe('sub-1');
      expect(result.data[0]?.stationName).toBe('Orlen Testowa');
      expect(mockSubmissionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ flag_reason: 'logo_mismatch' }) }),
      );
    });
  });

  // ── getProductMetrics ─────────────────────────────────────────────────────

  describe('getProductMetrics', () => {
    it('returns map views from Redis counter and new registrations from DB', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockGetMapViewsByDate.mockResolvedValueOnce(
        new Map([[today, { total: 120, auth: 90 }]]),
      );
      mockQueryRaw.mockResolvedValueOnce([{ date: today, count: 5n }]);

      const result = await service.getProductMetrics('today');

      expect(result.totalMapViews).toBe(120);
      expect(result.avgAuthPct).toBe(75); // 90/120
      expect(result.totalNewRegistrations).toBe(5);
    });

    it('returns zeros when Redis is unavailable', async () => {
      mockGetMapViewsByDate.mockRejectedValueOnce(new Error('Redis down'));
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.getProductMetrics('today');

      expect(result.totalMapViews).toBe(0);
      expect(result.avgAuthPct).toBe(0);
    });
  });

  // ── getApiCostMetrics ──────────────────────────────────────────────────────

  describe('getApiCostMetrics', () => {
    it('falls back to Redis daily spend when today has no DB row', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([]);
      mockGetDailySpend.mockResolvedValueOnce(0.42);

      const result = await service.getApiCostMetrics();

      expect(result.today.spendUsd).toBeCloseTo(0.42, 5);
      expect(result.today.imageCount).toBe(0);
      expect(mockGetDailySpend).toHaveBeenCalled();
    });

    it('uses the DB row for today when present (does not call Redis fallback)', async () => {
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      mockDailyApiCostFindMany.mockResolvedValueOnce([
        { date: today, spend_usd: 1.25, image_count: 42 },
      ]);

      const result = await service.getApiCostMetrics();

      expect(result.today).toEqual({ spendUsd: 1.25, imageCount: 42 });
      expect(mockGetDailySpend).not.toHaveBeenCalled();
    });

    it('returns 3 monthly buckets oldest-first', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([]);
      mockGetDailySpend.mockResolvedValueOnce(0);

      const result = await service.getApiCostMetrics();

      expect(result.last3Months).toHaveLength(3);
      expect(result.last3Months[0].month < result.last3Months[1].month).toBe(true);
      expect(result.last3Months[1].month < result.last3Months[2].month).toBe(true);
    });

    it('aggregates spend across the current week correctly', async () => {
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);

      mockDailyApiCostFindMany.mockResolvedValueOnce([
        { date: threeDaysAgo, spend_usd: 0.50, image_count: 10 },
        { date: today, spend_usd: 0.20, image_count: 5 },
      ]);

      const result = await service.getApiCostMetrics();

      expect(result.currentWeek.spendUsd).toBeCloseTo(0.70, 5);
      expect(result.currentWeek.imageCount).toBe(15);
    });

    it('P-9: when today has no DB row, Redis fallback feeds week / month / current-month bucket too (consistency)', async () => {
      // No rows in DB at all; Redis says today is $0.42
      mockDailyApiCostFindMany.mockResolvedValueOnce([]);
      mockGetDailySpend.mockResolvedValueOnce(0.42);

      const result = await service.getApiCostMetrics();

      expect(result.today.spendUsd).toBeCloseTo(0.42, 5);
      // Without P-9 these would be 0 and the today card would silently disagree with the period cards.
      expect(result.currentWeek.spendUsd).toBeCloseTo(0.42, 5);
      expect(result.currentMonth.spendUsd).toBeCloseTo(0.42, 5);
      expect(result.last3Months[2].spendUsd).toBeCloseTo(0.42, 5);
      // Older buckets must NOT pick up today's fallback
      expect(result.last3Months[0].spendUsd).toBe(0);
      expect(result.last3Months[1].spendUsd).toBe(0);
    });

    it('P-9: when ocrSpend.getDailySpend throws (Redis down), today falls back to 0 instead of 500ing', async () => {
      mockDailyApiCostFindMany.mockResolvedValueOnce([]);
      mockGetDailySpend.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.getApiCostMetrics();

      expect(result.today.spendUsd).toBe(0);
      expect(result.currentMonth.spendUsd).toBe(0);
    });
  });

  // ── getFreshnessDashboard (Story 4.8) ────────────────────────────────────

  describe('getFreshnessDashboard', () => {
    /**
     * The service runs three queries via $queryRawUnsafe in Promise.all:
     *   1. data rows (LATERAL join)
     *   2. total count
     *   3. stale count
     * Mock them in that exact order via mockResolvedValueOnce x3.
     */

    function queueResponses(rows: unknown[], total: number, stale: number) {
      mockQueryRawUnsafe
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([{ count: total }])
        .mockResolvedValueOnce([{ count: stale }]);
    }

    it('returns rows with isStale=true when lastPriceAt is null (no PriceHistory ever)', async () => {
      queueResponses(
        [
          {
            stationId: 's1',
            stationName: 'No-history station',
            address: 'ul. Test 1',
            voivodeship: 'mazowieckie',
            priceSource: null,
            lastPriceAt: null,
          },
        ],
        1,
        1,
      );

      const result = await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 1, 50);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        stationId: 's1',
        stationName: 'No-history station',
        priceSource: null,
        lastPriceAt: null,
        isStale: true,
      });
      expect(result.total).toBe(1);
      expect(result.staleCount).toBe(1);
    });

    it('returns isStale=true when lastPriceAt is older than 30 days', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      queueResponses(
        [
          {
            stationId: 's2',
            stationName: 'Old data',
            address: null,
            voivodeship: 'mazowieckie',
            priceSource: 'community',
            lastPriceAt: oldDate,
          },
        ],
        1,
        1,
      );

      const result = await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 1, 50);
      expect(result.data[0].isStale).toBe(true);
      expect(result.data[0].lastPriceAt).toBe(oldDate.toISOString());
    });

    it('returns isStale=false when lastPriceAt is within 30 days', async () => {
      const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      queueResponses(
        [
          {
            stationId: 's3',
            stationName: 'Fresh data',
            address: 'ul. Świeża 1',
            voivodeship: 'lodzkie',
            priceSource: 'community',
            lastPriceAt: recent,
          },
        ],
        1,
        0,
      );

      const result = await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 1, 50);
      expect(result.data[0].isStale).toBe(false);
      expect(result.staleCount).toBe(0);
    });

    it('forwards the voivodeship filter as the first parameter to all three queries', async () => {
      queueResponses([], 0, 0);

      await service.getFreshnessDashboard('mazowieckie', 'lastPriceAt', 'asc', 1, 50);

      // All 3 calls should have voivodeship as the first SQL param
      expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(3);
      mockQueryRawUnsafe.mock.calls.forEach(callArgs => {
        // callArgs[0] is the SQL string; callArgs[1] is the first param (voivodeship)
        expect(callArgs[1]).toBe('mazowieckie');
      });
    });

    it('passes null voivodeship through unchanged when no filter is requested', async () => {
      queueResponses([], 0, 0);

      await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 1, 50);

      expect(mockQueryRawUnsafe.mock.calls[0][1]).toBeNull();
      expect(mockQueryRawUnsafe.mock.calls[1][1]).toBeNull();
      expect(mockQueryRawUnsafe.mock.calls[2][1]).toBeNull();
    });

    it('builds the data SQL with the correct ORDER BY column for each sortBy value', async () => {
      // sortBy: 'voivodeship' → ORDER BY s.voivodeship
      queueResponses([], 0, 0);
      await service.getFreshnessDashboard(null, 'voivodeship', 'asc', 1, 50);
      expect(mockQueryRawUnsafe.mock.calls[0][0]).toContain('ORDER BY s.voivodeship ASC');

      mockQueryRawUnsafe.mockReset();

      // sortBy: 'priceSource' → ORDER BY lph.source
      queueResponses([], 0, 0);
      await service.getFreshnessDashboard(null, 'priceSource', 'desc', 1, 50);
      expect(mockQueryRawUnsafe.mock.calls[0][0]).toContain('ORDER BY lph.source DESC');

      mockQueryRawUnsafe.mockReset();

      // sortBy: 'lastPriceAt' → ORDER BY lph.recorded_at NULLS FIRST (so null prices surface first)
      queueResponses([], 0, 0);
      await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 1, 50);
      expect(mockQueryRawUnsafe.mock.calls[0][0]).toContain('ORDER BY lph.recorded_at ASC NULLS FIRST');
    });

    it('translates page/limit to LIMIT/OFFSET correctly', async () => {
      queueResponses([], 100, 5);

      await service.getFreshnessDashboard(null, 'lastPriceAt', 'asc', 3, 25);

      // page 3, limit 25 → LIMIT 25 OFFSET 50
      // params order: voivodeship, limit, skip
      expect(mockQueryRawUnsafe.mock.calls[0][2]).toBe(25);
      expect(mockQueryRawUnsafe.mock.calls[0][3]).toBe(50);
    });

    it('returns 0 staleCount when no stations match the filter', async () => {
      queueResponses([], 0, 0);
      const result = await service.getFreshnessDashboard('opolskie', 'lastPriceAt', 'asc', 1, 50);
      expect(result.staleCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.data).toEqual([]);
    });
  });
});
