import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VehiclesService } from './vehicles.service.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

// Vehicles are a per-driver resource — every authenticated role that can drive
// should be able to manage them. Admin included so admins can debug their own
// account end-to-end (mirrors the bypass pattern in photo-pipeline.worker).
const ALL_DRIVING_ROLES = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

@Controller('v1/me/vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  /** List all vehicles owned by the authenticated user. */
  @Get()
  @Roles(...ALL_DRIVING_ROLES)
  list(@CurrentUser('id') userId: string) {
    return this.vehiclesService.listVehicles(userId);
  }

  /** Get a single vehicle. 404 (not 403) on cross-user access — don't leak existence. */
  @Get(':id')
  @Roles(...ALL_DRIVING_ROLES)
  get(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) vehicleId: string) {
    return this.vehiclesService.getVehicle(userId, vehicleId);
  }

  /** Create a vehicle. Returns the created record (no separate Location header — 200 OK with body). */
  @Post()
  @Roles(...ALL_DRIVING_ROLES)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.createVehicle(userId, dto);
  }

  /**
   * Update a vehicle. While locked (Story 5.2 set is_locked on first FillUp),
   * the service rejects make/model/year changes with 409 — nickname and
   * engine_variant remain editable.
   */
  @Patch(':id')
  @Roles(...ALL_DRIVING_ROLES)
  update(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) vehicleId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.updateVehicle(userId, vehicleId, dto);
  }

  /** Delete a vehicle. 409 if locked (FillUp history would orphan). */
  @Delete(':id')
  @Roles(...ALL_DRIVING_ROLES)
  @HttpCode(204)
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) vehicleId: string,
  ) {
    await this.vehiclesService.deleteVehicle(userId, vehicleId);
  }
}
