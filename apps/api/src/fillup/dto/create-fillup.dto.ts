import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// Allowed fuel types at the API boundary. Vehicles can have a broader enum
// (EV/PHEV/CNG) but a fill-up only makes sense for liquid/LPG products that a
// pump dispenses. Keep this list aligned with the OCR prompt + mobile picker.
export const FILLUP_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;

export class CreateFillupDto {
  @IsUUID()
  vehicleId!: string;

  @IsIn(FILLUP_FUEL_TYPES)
  fuelType!: (typeof FILLUP_FUEL_TYPES)[number];

  @IsNumber()
  @Min(0.1)
  @Max(500)
  litres!: number;

  @IsNumber()
  @Min(1)
  @Max(10000)
  totalCostPln!: number;

  @IsNumber()
  @Min(1)
  @Max(50)
  pricePerLitrePln!: number;

  // GPS captured at the moment of the photo. Used server-side for station
  // matching (200m radius), then NOT persisted on the FillUp record — same
  // privacy pattern as Submission. Optional: when omitted (e.g. user denied
  // location post-capture, or manual-entry path with no location), the
  // fill-up still saves but no station match / community price write occurs.
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;

  // Manual numeric entry in this story. Story 5.4 adds the OCR path which
  // hits the same column.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerKm?: number;

  // ISO datetime; service falls back to `now()` when omitted. Useful for
  // backfilled entries (driver logs a fill-up after the fact).
  @IsOptional()
  @IsISO8601()
  filledAt?: string;
}
