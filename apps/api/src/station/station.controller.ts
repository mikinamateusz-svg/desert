import { Controller, Get, Query } from '@nestjs/common';
import { StationService } from './station.service.js';
import { GetNearbyStationsDto } from './dto/get-nearby-stations.dto.js';
import { StationDto } from './dto/station.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('v1/stations')
export class StationController {
  constructor(private readonly stationService: StationService) {}

  @Public()
  @Get('nearby')
  async getNearby(@Query() dto: GetNearbyStationsDto): Promise<StationDto[]> {
    return this.stationService.findStationsInArea(dto.lat, dto.lng, dto.radius ?? 25000);
  }
}
