import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface SummaryRow {
  signal_type: string;
  value: number;
  pct_change: number | null;
  recorded_at: Date;
}

@Controller('v1/market-signal')
export class MarketSignalController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('summary')
  async getSummary(): Promise<{ signals: object[] }> {
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT DISTINCT ON (signal_type)
        signal_type, value, pct_change, recorded_at
      FROM "MarketSignal"
      WHERE signal_type IN ('orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg')
      ORDER BY signal_type, recorded_at DESC
    `;
    return {
      signals: rows.map(r => ({
        signalType:  r.signal_type,
        value:       r.value,
        pctChange:   r.pct_change ?? null,
        recordedAt:  r.recorded_at.toISOString(),
      })),
    };
  }
}
