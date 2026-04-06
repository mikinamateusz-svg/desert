import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AdminMetricsService, type MetricsPeriod } from './admin-metrics.service.js';

const VALID_PERIODS: MetricsPeriod[] = ['today', '7d', '30d'];

function parsePeriod(raw: string | undefined): MetricsPeriod {
  return VALID_PERIODS.includes(raw as MetricsPeriod) ? (raw as MetricsPeriod) : 'today';
}

@Controller('v1/admin/metrics')
@Roles(UserRole.ADMIN)
export class AdminMetricsController {
  constructor(private readonly service: AdminMetricsService) {}

  /** Real-time pipeline health — refreshed every 60 s from the admin UI. */
  @Get('pipeline')
  async pipeline() {
    return this.service.getPipelineHealth();
  }

  /** Contribution funnel aggregates for the selected period. */
  @Get('funnel')
  async funnel(@Query('period') period?: string) {
    return this.service.getFunnelMetrics(parsePeriod(period));
  }

  /**
   * Drill-down: list of submissions for a specific flag_reason in the selected period.
   * Used when admin clicks a rejection reason in the Funnel tab.
   */
  @Get('funnel/drilldown')
  async drilldown(
    @Query('reason') reason: string,
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const safeReason = String(reason ?? '').slice(0, 100);
    const safePage = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    return this.service.getFunnelDrilldown(safeReason, parsePeriod(period), safePage, safeLimit);
  }

  /** Server-side aggregate product counters for the selected period. */
  @Get('product')
  async product(@Query('period') period?: string) {
    return this.service.getProductMetrics(parsePeriod(period));
  }
}
