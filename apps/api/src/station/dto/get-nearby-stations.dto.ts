import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetNearbyStationsDto {
  @IsNumber()
  @Type(() => Number)
  lat!: number;

  @IsNumber()
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(50000)
  @Type(() => Number)
  radius?: number;
}
