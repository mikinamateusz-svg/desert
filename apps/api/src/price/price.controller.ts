import { Controller, Get, Query, Headers } from '@nestjs/common';
import { PriceService } from './price.service.js';
import { PriceHistoryService } from './price-history.service.js';
import { MetricsCounterService } from '../metrics/metrics-counter.service.js';
import { GetNearbyPricesDto } from './dto/get-nearby-prices.dto.js';
import { GetPriceHistoryDto } from './dto/get-price-history.dto.js';
import { GetRegionalAverageDto } from './dto/get-regional-average.dto.js';
import { StationPriceDto } from './dto/station-price.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('v1/prices')
export class PriceController {
  constructor(
    private readonly priceService: PriceService,
    private readonly priceHistoryService: PriceHistoryService,
    private readonly metricsCounter: MetricsCounterService,
  ) {}

  @Public()
  @Get('nearby')
  async getNearby(
    @Query() dto: GetNearbyPricesDto,
    @Headers('authorization') authorization?: string,
  ): Promise<StationPriceDto[]> {
    // Fire-and-forget map-view counter — never blocks the response.
    // A Bearer token in Authorization header indicates an authenticated session.
    const authenticated = Boolean(authorization?.startsWith('Bearer '));
    this.metricsCounter.incrementMapView(authenticated);

    const rows = await this.priceService.findPricesInArea(dto.lat, dto.lng, dto.radius ?? 25000);
    return rows.map(r => ({
      stationId: r.stationId,
      prices: r.prices,
      ...(r.priceRanges   ? { priceRanges:   r.priceRanges   } : {}),
      ...(r.estimateLabel ? { estimateLabel: r.estimateLabel } : {}),
      sources: r.sources,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  @Public()
  @Get('history')
  async getHistory(@Query() dto: GetPriceHistoryDto) {
    const history = await this.priceHistoryService.getHistory(dto.stationId, dto.fuelType, dto.limit);
    return {
      history: history.map(e => ({
        price: e.price,
        source: e.source,
        recordedAt: e.recordedAt.toISOString(),
      })),
    };
  }

  @Public()
  @Get('regional')
  async getRegional(@Query() dto: GetRegionalAverageDto) {
    return this.priceHistoryService.getRegionalAverage(dto.voivodeship, dto.fuelType);
  }
}
