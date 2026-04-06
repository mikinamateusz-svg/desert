import { IsString, IsNumber, IsPositive, Max, MinLength, MaxLength, IsIn } from 'class-validator';

const KNOWN_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

export class OverridePriceDto {
  @IsString()
  @IsIn(KNOWN_FUEL_TYPES)
  fuelType!: string;

  @IsNumber()
  @IsPositive()
  @Max(50)
  price!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
