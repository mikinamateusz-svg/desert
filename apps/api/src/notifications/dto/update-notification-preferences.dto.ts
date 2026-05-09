import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ALLOWED_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;
type AllowedFuelType = (typeof ALLOWED_FUEL_TYPES)[number];

const ALLOWED_PRICE_DROP_MODES = ['cheaper_than_now', 'target_price'] as const;
type PriceDropMode = (typeof ALLOWED_PRICE_DROP_MODES)[number];

const ALLOWED_RADII_KM = [5, 10, 25] as const;
type AllowedRadiusKm = (typeof ALLOWED_RADII_KM)[number];

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateIf((o: UpdateNotificationPreferencesDto) => o.expo_push_token !== null)
  @IsString()
  @MaxLength(300)
  expo_push_token?: string | null;

  // ── Phase 1 — retained for back-compat with the existing alert pipeline ─

  @IsOptional()
  @IsBoolean()
  price_drops?: boolean;

  @IsOptional()
  @IsBoolean()
  sharp_rise?: boolean;

  @IsOptional()
  @IsBoolean()
  monthly_summary?: boolean;

  // ── Phase 2 (Story 6.4) ────────────────────────────────────────────────

  @IsOptional()
  @IsBoolean()
  price_drop_enabled?: boolean;

  @IsOptional()
  @IsIn(ALLOWED_PRICE_DROP_MODES)
  price_drop_mode?: PriceDropMode;

  /**
   * PLN/L target. Null clears it (used when user switches mode back to
   * cheaper_than_now). Number-typed at the wire — Prisma's Decimal field
   * accepts a JS number directly. UI validates the 1.00–20.00 range
   * before send; the API enforces it as a defence-in-depth.
   */
  @IsOptional()
  @ValidateIf((o: UpdateNotificationPreferencesDto) => o.price_drop_target_pln !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1.0)
  @Max(20.0)
  price_drop_target_pln?: number | null;

  /**
   * Multi-select. Array length capped at 5 (one per fuel type) +
   * uniqueness so the UI's "toggle on/off" pattern can't accidentally
   * send duplicates. Allowed values pinned to the canonical fuel-type
   * set Story 5.x uses.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALLOWED_FUEL_TYPES.length)
  @ArrayUnique()
  @IsIn(ALLOWED_FUEL_TYPES, { each: true })
  price_drop_fuel_types?: AllowedFuelType[];

  @IsOptional()
  @IsInt()
  @IsIn(ALLOWED_RADII_KM)
  alert_radius_km?: AllowedRadiusKm;

  @IsOptional()
  @IsBoolean()
  rise_community_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  rise_predictive_enabled?: boolean;
}
