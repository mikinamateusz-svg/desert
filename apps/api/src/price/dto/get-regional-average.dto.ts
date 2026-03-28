import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { VALID_FUEL_TYPES } from '../config/price-modifiers.js';

export class GetRegionalAverageDto {
  @IsString()
  @IsNotEmpty()
  voivodeship!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_FUEL_TYPES)
  fuelType!: string;
}
