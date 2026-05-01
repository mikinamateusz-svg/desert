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

    // While locked, reject any change to fields that affect history math
    // (make, model, year, fuel_type, displacement_cc, power_kw). Nickname and
    // engine_variant remain editable per AC7. The check is permissive about
    // no-op writes — sending the existing value is treated as no change.
    if (existing.is_locked) {
      const lockedFieldChange = (
        ['make', 'model', 'year', 'fuel_type', 'displacement_cc', 'power_kw'] as const
      ).some((field) => dto[field] !== undefined && dto[field] !== existing[field]);
      if (lockedFieldChange) {
        throw new ConflictException({
          statusCode: 409,
          error: 'VEHICLE_LOCKED',
          message:
            'Vehicle identity (make, model, year, fuel system) cannot be changed after the first fill-up is recorded.',
        });
      }
    }

    // Atomic write: condition on the lock state we observed in `existing` so a
    // concurrent FillUp lock arriving between read and write either (a) lets the
    // write through because it is nickname/engine_variant only — safe, or
    // (b) flips is_locked, in which case `count` will be 0 and we re-throw
    // VEHICLE_LOCKED with the just-locked state. Closes the TOCTOU window.
    const result = await this.prisma.vehicle.updateMany({
      where: { id: vehicleId, user_id: userId, is_locked: existing.is_locked },
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
    if (result.count === 0) {
      // Lock state must have flipped. Re-evaluate: a now-locked vehicle that
      // received an identity-changing PATCH must surface VEHICLE_LOCKED.
      throw new ConflictException({
        statusCode: 409,
        error: 'VEHICLE_LOCKED',
        message:
          'Vehicle was just locked by a concurrent fill-up; identity-changing fields are no longer editable.',
      });
    }
    return this.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  }

  async deleteVehicle(userId: string, vehicleId: string): Promise<void> {
    // Atomic delete conditioned on is_locked = false closes the TOCTOU race
    // with a concurrent FillUp that would lock the vehicle. If count is 0 we
    // disambiguate via a follow-up read — either it never existed (404) or it
    // is now locked (409).
    const result = await this.prisma.vehicle.deleteMany({
      where: { id: vehicleId, user_id: userId, is_locked: false },
    });
    if (result.count === 0) {
      const stillThere = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, user_id: userId },
      });
      if (!stillThere) {
        throw new NotFoundException('Vehicle not found');
      }
      // is_locked must be true now (the deleteMany only fails on lock or
      // missing record — and the record is here).
      throw new ConflictException({
        statusCode: 409,
        error: 'VEHICLE_LOCKED',
        message:
          'Cannot remove a vehicle with fill-up history. Story 5.2+ may add an archive flow.',
      });
    }
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
