import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  /**
   * Story 7.1: name/address search for the partner portal claim flow.
   * Public so the partner portal's pre-login claim-search page can use it.
   * Returns up to 50 matches; ?q must be 2+ chars or empty array is
   * returned (saves a wildcard scan).
   *
   * P3 (CR fix): explicit @Throttle override at 30 req/min — the global
   * throttler's 3 req/h would lock out a real partner refining their
   * search after 3 keystrokes. Service layer also escapes ILIKE wildcards
   * and caps q at 100 chars to defend the DB independently.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search')
  async search(@Query('q') q: string = ''): Promise<StationDto[]> {
    return this.stationService.searchByName(q);
  }

  @Public()
  @Get(':id')
  async getById(@Param('id') id: string): Promise<StationDto> {
    const station = await this.stationService.findById(id);
    if (!station) throw new NotFoundException();
    return station;
  }
}
