import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VEHICLE_FUEL_TYPES } from './create-vehicle.dto.js';

// All fields optional — caller supplies only what changed. The service rejects
// any change to make/model/year when vehicle.is_locked === true (Story 5.2 sets
// the lock on the first FillUp; locking preserves history consistency).
export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1970)
  // See create-vehicle.dto.ts for why we use a fixed wide ceiling.
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  engine_variant?: string;

  @IsOptional()
  @IsInt()
  @Min(49)
  @Max(10000)
  displacement_cc?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1500)
  power_kw?: number;

  @IsOptional()
  @IsIn(VEHICLE_FUEL_TYPES)
  fuel_type?: (typeof VEHICLE_FUEL_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;
}
