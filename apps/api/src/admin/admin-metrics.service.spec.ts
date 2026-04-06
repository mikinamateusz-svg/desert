import { Test, TestingModule } from '@nestjs/testing';
import { AdminMetricsService } from './admin-metrics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsCounterService } from '../metrics/metrics-counter.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQueue = {
  getJobCounts: jest.fn(),
};

const mockPhotoPipelineWorker = {
  getQueue: jest.fn().mockReturnValue(mockQueue),
};

const mockQueryRaw = jest.fn();
const mockSubmissionFindMany = jest.fn();
const mockSubmissionCount = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
  submission: {
    findMany: mockSubmissionFindMany,
    count: mockSubmissionCount,
  },
};

const mockGetMapViewsByDate = jest.fn();

const mockMetricsCounter = {
  getMapViewsByDate: mockGetMapViewsByDate,
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
});
