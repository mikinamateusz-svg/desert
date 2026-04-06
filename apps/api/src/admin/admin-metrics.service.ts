import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetricsCounterService } from '../metrics/metrics-counter.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

export type MetricsPeriod = 'today' | '7d' | '30d';

export interface PipelineHealthDto {
  successRate1h: number | null;
  processingTimeP50Seconds: number | null;
  processingTimeP95Seconds: number | null;
  queueDepth: number;
  activeJobs: number;
  dlqCount: number;
  errorBreakdown: { reason: string; count: number }[];
}

export interface FunnelMetricsDto {
  period: MetricsPeriod;
  totalSubmissions: number;
  verified: number;
  verifiedPct: number;
  rejected: number;
  rejectedPct: number;
  shadowRejected: number;
  shadowRejectedPct: number;
  pending: number;
  dlqCount: number;
  rejectionBreakdown: { reason: string; count: number }[];
}

export interface FunnelDrilldownDto {
  data: {
    id: string;
    stationId: string | null;
    stationName: string | null;
    createdAt: string;
    flagReason: string | null;
  }[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductMetricsDayDto {
  date: string;
  mapViews: number;
  authPct: number;
  newRegistrations: number;
}

export interface ProductMetricsDto {
  period: MetricsPeriod;
  days: ProductMetricsDayDto[];
  totalMapViews: number;
  avgAuthPct: number;
  totalNewRegistrations: number;
}

@Injectable()
export class AdminMetricsService implements OnModuleInit {
  private readonly logger = new Logger(AdminMetricsService.name);
  private queue!: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsCounter: MetricsCounterService,
    private readonly photoPipelineWorker: PhotoPipelineWorker,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.photoPipelineWorker.getQueue();
  }

  // ── Pipeline Health ────────────────────────────────────────────────────────

  async getPipelineHealth(): Promise<PipelineHealthDto> {
    const [counts, statsRows, errorRows] = await Promise.all([
      this.queue.getJobCounts('waiting', 'active', 'failed'),
      this.prisma.$queryRaw<{
        verified_count: bigint;
        total_count: bigint;
        p50_seconds: number | null;
        p95_seconds: number | null;
      }[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'verified')  AS verified_count,
          COUNT(*)                                      AS total_count,
          PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)))  AS p50_seconds,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)))  AS p95_seconds
        FROM "Submission"
        WHERE updated_at > NOW() - INTERVAL '1 hour'
          AND status IN ('verified', 'rejected', 'shadow_rejected')
      `,
      this.prisma.$queryRaw<{ flag_reason: string; count: bigint }[]>`
        SELECT flag_reason, COUNT(*) AS count
        FROM "Submission"
        WHERE updated_at > NOW() - INTERVAL '1 hour'
          AND status IN ('rejected', 'shadow_rejected')
          AND flag_reason IS NOT NULL
        GROUP BY flag_reason
        ORDER BY count DESC
      `,
    ]);

    const stats = statsRows[0];
    const total = Number(stats?.total_count ?? 0);
    const verified = Number(stats?.verified_count ?? 0);

    return {
      successRate1h: total > 0 ? Math.round((verified / total) * 1000) / 1000 : null,
      processingTimeP50Seconds: stats?.p50_seconds ? Math.round(stats.p50_seconds * 10) / 10 : null,
      processingTimeP95Seconds: stats?.p95_seconds ? Math.round(stats.p95_seconds * 10) / 10 : null,
      queueDepth: counts.waiting ?? 0,
      activeJobs: counts.active ?? 0,
      dlqCount: counts.failed ?? 0,
      errorBreakdown: errorRows.map(r => ({ reason: r.flag_reason, count: Number(r.count) })),
    };
  }

  // ── Contribution Funnel ───────────────────────────────────────────────────

  async getFunnelMetrics(period: MetricsPeriod): Promise<FunnelMetricsDto> {
    const startDate = this.periodStart(period);

    const [rows, dlqCounts] = await Promise.all([
      this.prisma.$queryRaw<{ status: string; flag_reason: string | null; count: bigint }[]>`
        SELECT status, flag_reason, COUNT(*) AS count
        FROM "Submission"
        WHERE created_at >= ${startDate}
        GROUP BY status, flag_reason
      `,
      this.queue.getJobCounts('failed'),
    ]);

    let total = 0;
    let verified = 0;
    let rejected = 0;
    let shadowRejected = 0;
    let pending = 0;
    const rejBreakdownMap = new Map<string, number>();

    for (const row of rows) {
      const count = Number(row.count);
      total += count;
      switch (row.status) {
        case 'verified':
          verified += count;
          break;
        case 'rejected':
          rejected += count;
          if (row.flag_reason) {
            rejBreakdownMap.set(row.flag_reason, (rejBreakdownMap.get(row.flag_reason) ?? 0) + count);
          }
          break;
        case 'shadow_rejected':
          shadowRejected += count;
          if (row.flag_reason) {
            rejBreakdownMap.set(row.flag_reason, (rejBreakdownMap.get(row.flag_reason) ?? 0) + count);
          }
          break;
        default:
          pending += count;
      }
    }

    const pct = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

    return {
      period,
      totalSubmissions: total,
      verified,
      verifiedPct: pct(verified),
      rejected,
      rejectedPct: pct(rejected),
      shadowRejected,
      shadowRejectedPct: pct(shadowRejected),
      pending,
      dlqCount: dlqCounts.failed ?? 0,
      rejectionBreakdown: Array.from(rejBreakdownMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async getFunnelDrilldown(
    reason: string,
    period: MetricsPeriod,
    page: number,
    limit: number,
  ): Promise<FunnelDrilldownDto> {
    const startDate = this.periodStart(period);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.submission.findMany({
        where: { flag_reason: reason, created_at: { gte: startDate } },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          station_id: true,
          station: { select: { name: true } },
          created_at: true,
          flag_reason: true,
        },
      }),
      this.prisma.submission.count({
        where: { flag_reason: reason, created_at: { gte: startDate } },
      }),
    ]);

    return {
      data: rows.map(r => ({
        id: r.id,
        stationId: r.station_id,
        stationName: r.station?.name ?? null,
        createdAt: r.created_at.toISOString(),
        flagReason: r.flag_reason,
      })),
      total,
      page,
      limit,
    };
  }

  // ── Product Metrics ────────────────────────────────────────────────────────

  async getProductMetrics(period: MetricsPeriod): Promise<ProductMetricsDto> {
    const dates = this.periodDates(period);

    const [mapViewsData, regRows] = await Promise.all([
      this.metricsCounter.getMapViewsByDate(dates).catch((err: unknown) => {
        this.logger.warn(`getProductMetrics: Redis error fetching map views — returning zeros`, err);
        return new Map<string, { total: number; auth: number }>();
      }),
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at AT TIME ZONE 'UTC') AS date, COUNT(*) AS count
        FROM "User"
        WHERE created_at >= ${new Date(dates[0] + 'T00:00:00Z')}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date
      `,
    ]);

    const regByDate = new Map<string, number>(
      regRows.map(r => [String(r.date).slice(0, 10), Number(r.count)]),
    );

    let totalMapViews = 0;
    let totalAuth = 0;

    const days: ProductMetricsDayDto[] = dates.map(date => {
      const mv = mapViewsData.get(date) ?? { total: 0, auth: 0 };
      totalMapViews += mv.total;
      totalAuth += mv.auth;
      return {
        date,
        mapViews: mv.total,
        authPct: mv.total > 0 ? Math.round((mv.auth / mv.total) * 1000) / 10 : 0,
        newRegistrations: regByDate.get(date) ?? 0,
      };
    });

    return {
      period,
      days,
      totalMapViews,
      avgAuthPct: totalMapViews > 0 ? Math.round((totalAuth / totalMapViews) * 1000) / 10 : 0,
      totalNewRegistrations: days.reduce((s, d) => s + d.newRegistrations, 0),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private periodStart(period: MetricsPeriod): Date {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'today') return todayUtc;
    const days = period === '7d' ? 7 : 30;
    return new Date(todayUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  }

  private periodDates(period: MetricsPeriod): string[] {
    const start = this.periodStart(period);
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dates: string[] = [];
    const cur = new Date(start);
    while (cur <= todayUtc) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}
