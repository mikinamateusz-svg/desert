import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  AdminMetricsService,
  type MetricsPeriod,
  type FreshnessSortBy,
  type FreshnessSortOrder,
} from './admin-metrics.service.js';
import { isValidVoivodeship } from '../station/config/voivodeship-slugs.js';

const VALID_PERIODS: MetricsPeriod[] = ['today', '7d', '30d'];
const VALID_FRESHNESS_SORTS: FreshnessSortBy[] = ['lastPriceAt', 'voivodeship', 'priceSource'];

function parsePeriod(raw: string | undefined): MetricsPeriod {
  return VALID_PERIODS.includes(raw as MetricsPeriod) ? (raw as MetricsPeriod) : 'today';
}

function parseFreshnessSort(raw: string | undefined): FreshnessSortBy {
  return VALID_FRESHNESS_SORTS.includes(raw as FreshnessSortBy)
    ? (raw as FreshnessSortBy)
    : 'lastPriceAt';
}

function parseOrder(raw: string | undefined): FreshnessSortOrder {
  return raw === 'desc' ? 'desc' : 'asc';
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

  /** Claude API spend aggregated by today / current-week / current-month / last-3-months. */
  @Get('cost')
  async cost() {
    return this.service.getApiCostMetrics();
  }

  /**
   * Per-station price freshness for the admin coverage-gap dashboard. Paginated;
   * stale stations (no price ever, or last price > 30 days old) are flagged in
   * the response. Voivodeship filter is sanitised against the canonical slug list.
   */
  @Get('freshness')
  async freshness(
    @Query('voivodeship') voivodeship?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const safeVoivodeship = isValidVoivodeship(voivodeship) ? voivodeship : null;
    const safeSortBy = parseFreshnessSort(sortBy);
    const safeOrder = parseOrder(order);
    const safePage = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    return this.service.getFreshnessDashboard(
      safeVoivodeship,
      safeSortBy,
      safeOrder,
      safePage,
      safeLimit,
    );
  }
}
