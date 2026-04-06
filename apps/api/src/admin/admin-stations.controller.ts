import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminStationsService } from './admin-stations.service.js';
import { OverridePriceDto } from './dto/override-price.dto.js';

@Controller('v1/admin/stations')
@Roles(UserRole.ADMIN)
export class AdminStationsController {
  constructor(private readonly service: AdminStationsService) {}

  @Get()
  async search(
    @Query('search') search: string = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.service.searchStations(search, page, limit);
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getStationDetail(id);
  }

  @Post(':id/override-price')
  @HttpCode(HttpStatus.OK)
  async overridePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OverridePriceDto,
    @CurrentUser() admin: User,
  ) {
    await this.service.overridePrice(id, body.fuelType, body.price, body.reason, admin.id);
    return { status: 'overridden' };
  }

  @Post(':id/refresh-cache')
  @HttpCode(HttpStatus.OK)
  async refreshCache(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: User) {
    await this.service.refreshCache(id, admin.id);
    return { status: 'cache_refreshed' };
  }
}
