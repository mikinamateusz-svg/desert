import { IsString, IsNotEmpty, IsIn, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { VALID_FUEL_TYPES } from '../config/price-modifiers.js';

export class GetPriceHistoryDto {
  @IsUUID('4')
  stationId!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_FUEL_TYPES)
  fuelType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;
}
