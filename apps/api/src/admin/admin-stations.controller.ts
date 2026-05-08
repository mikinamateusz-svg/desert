import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminStationsService } from './admin-stations.service.js';
import { OverridePriceDto } from './dto/override-price.dto.js';

class RenameStationDto {
  @IsString()
  @IsNotEmpty()
  // P1 (3.19 review) — defence-in-depth: reject obviously over-long bodies at
  // the validation layer before they reach the service. Service still trims +
  // re-validates so fast-path rejection here is purely a hot-loop guard.
  @MaxLength(200)
  // Reject whitespace-only payloads at the DTO so the service doesn't have to
  // distinguish "missing key" from "all-whitespace string". Service still
  // trims and re-checks empty after trim.
  @Matches(/\S/, { message: 'name must contain at least one non-whitespace character' })
  name!: string;
}

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

  @Get('hidden')
  async listHidden() {
    return this.service.findHidden();
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

  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  async hide(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.hideStation(id);
  }

  @Post(':id/unhide')
  @HttpCode(HttpStatus.OK)
  async unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.unhideStation(id);
  }

  @Patch(':id/rename')
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameStationDto,
    @CurrentUser() admin: User,
  ) {
    return this.service.renameStation(id, body.name, admin.id);
  }
}
