import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Vehicle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';

/**
 * Per-driver vehicle CRUD.
 *
 * Lock semantics: Story 5.2 sets vehicle.is_locked = true on the first FillUp
 * recorded against the vehicle. While locked:
 *   - PATCH rejects changes to make / model / year (preserves history)
 *   - DELETE is blocked (would orphan FillUp + odometer history)
 * Nickname and engine_variant remain editable while locked — those don't
 * affect history consistency.
 *
 * All queries scoped to user_id so a driver can never read or mutate another
 * driver's vehicles. Controllers MUST pass userId from req.user — never accept
 * it from the request body.
 */
@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listVehicles(userId: string): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
    });
  }

  async getVehicle(userId: string, vehicleId: string): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    // Treat cross-user reads as 404 (don't leak existence to other users).
    if (vehicle.user_id !== userId) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  async createVehicle(userId: string, dto: CreateVehicleDto): Promise<Vehicle> {
    return this.prisma.vehicle.create({
      data: {
        user_id: userId,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        engine_variant: dto.engine_variant ?? null,
        displacement_cc: dto.displacement_cc ?? null,
        power_kw: dto.power_kw ?? null,
        fuel_type: dto.fuel_type,
        nickname: dto.nickname ?? null,
        user_entered: dto.user_entered ?? false,
      },
    });
  }

  async updateVehicle(
    userId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    const existing = await this.getVehicle(userId, vehicleId);

    // While locked, reject any change to identifying fields.
    if (existing.is_locked) {
      const changingMake = dto.make !== undefined && dto.make !== existing.make;
      const changingModel = dto.model !== undefined && dto.model !== existing.model;
      const changingYear = dto.year !== undefined && dto.year !== existing.year;
      if (changingMake || changingModel || changingYear) {
        throw new ConflictException({
          statusCode: 409,
          error: 'VEHICLE_LOCKED',
          message:
            'Make, model, and year cannot be changed after the first fill-up is recorded.',
        });
      }
    }

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        ...(dto.make !== undefined && { make: dto.make }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.engine_variant !== undefined && { engine_variant: dto.engine_variant }),
        ...(dto.displacement_cc !== undefined && { displacement_cc: dto.displacement_cc }),
        ...(dto.power_kw !== undefined && { power_kw: dto.power_kw }),
        ...(dto.fuel_type !== undefined && { fuel_type: dto.fuel_type }),
        ...(dto.nickname !== undefined && { nickname: dto.nickname }),
      },
    });
  }

  async deleteVehicle(userId: string, vehicleId: string): Promise<void> {
    const existing = await this.getVehicle(userId, vehicleId);

    if (existing.is_locked) {
      // Locked vehicles have FillUp / odometer history that would orphan.
      throw new ConflictException({
        statusCode: 409,
        error: 'VEHICLE_LOCKED',
        message:
          'Cannot remove a vehicle with fill-up history. Story 5.2+ may add an archive flow.',
      });
    }

    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
  }

  /**
   * Internal helper for Story 5.2 (FillUpService) — sets is_locked when the
   * first fill-up is recorded. Not exposed via controller.
   *
   * Idempotent: re-locking an already-locked vehicle is a no-op.
   */
  async lockVehicle(vehicleId: string): Promise<void> {
    const result = await this.prisma.vehicle.updateMany({
      where: { id: vehicleId, is_locked: false },
      data: { is_locked: true },
    });
    if (result.count > 0) {
      this.logger.log(`Vehicle ${vehicleId} locked (first fill-up recorded)`);
    }
  }
}
