import { Controller, Get, Query } from '@nestjs/common';
import { PriceService } from './price.service.js';
import { GetNearbyPricesDto } from './dto/get-nearby-prices.dto.js';
import { StationPriceDto } from './dto/station-price.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('v1/prices')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Public()
  @Get('nearby')
  async getNearby(@Query() dto: GetNearbyPricesDto): Promise<StationPriceDto[]> {
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
}
