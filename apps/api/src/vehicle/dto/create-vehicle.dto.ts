import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Allowed fuel types at the API boundary. Schema stores as TEXT (so the catalog
// can grow without a migration); the validator below is the gatekeeper. Keep
// this list in sync with apps/mobile catalog consumer + Story 5.2 FillUp.
export const VEHICLE_FUEL_TYPES = [
  'PB_95',
  'PB_98',
  'ON',
  'ON_PREMIUM',
  'LPG',
  'CNG',
  'EV',
  'PHEV',
] as const;

export class CreateVehicleDto {
  @IsString()
  @MaxLength(100)
  make!: string;

  @IsString()
  @MaxLength(100)
  model!: string;

  @IsInt()
  @Min(1970)
  // Fixed wide ceiling rather than `new Date().getFullYear() + 1` because
  // class-validator decorators evaluate at module load — a long-running
  // process would freeze the cap to last year's "+1" and reject valid
  // current-model-year input on Jan 1. Mobile UI clamps to a tighter range.
  @Max(2100)
  year!: number;

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

  @IsIn(VEHICLE_FUEL_TYPES)
  fuel_type!: (typeof VEHICLE_FUEL_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  // True when any of make/model/engine came via free-text fallback rather than
  // the curated catalog. Mobile sets this; analytics surface popular missing
  // entries for catalog promotion later.
  @IsOptional()
  @IsBoolean()
  user_entered?: boolean;
}
