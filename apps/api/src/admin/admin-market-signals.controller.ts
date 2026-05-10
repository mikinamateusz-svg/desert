import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AdminMarketSignalsService } from './admin-market-signals.service.js';

const DEFAULT_HISTORY_LIMIT = 30;

@Controller('v1/admin/market-signals')
@Roles(UserRole.ADMIN)
export class AdminMarketSignalsController {
  constructor(private readonly service: AdminMarketSignalsService) {}

  /**
   * Story 4.12 — latest sample per signal type for the admin dashboard.
   * Always returns all 4 entries (ORLEN×3 + Brent), with null fields
   * when a type has never been ingested. The Brent-null path drives
   * AC5's "Not configured" UI state.
   */
  @Get('summary')
  async summary() {
    const signals = await this.service.getSummary();
    return { signals };
  }

  /**
   * Last N samples for one signal type (newest first). Service clamps
   * limit to [1, 200] so an admin curl with `?limit=999999` doesn't
   * accidentally trigger a full-table scan.
   */
  @Get(':signalType/history')
  async history(
    @Param('signalType') signalType: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : DEFAULT_HISTORY_LIMIT;
    const rows = await this.service.getHistory(signalType, limit);
    return { signalType, rows };
  }
}
