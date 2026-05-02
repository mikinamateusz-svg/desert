import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateOdometerDto {
  @IsUUID()
  vehicleId!: string;

  // 1 km lower bound — anything below is implausible (new car off the lot
  // already shows ~10–50 km from factory testing).
  // 2,000,000 km upper bound — covers extreme high-mileage cases (some
  // German taxis reach 1M+ km) but rejects typo / OCR garbage.
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  km!: number;

  /**
   * Optional explicit fill-up link from the celebration flow. When the
   * caller (mobile) is the fill-up screen, it passes the just-created
   * fillup_id so the reading attaches to the correct record. When omitted
   * (standalone odometer-capture flow), the service auto-links to a
   * fill-up within 30 minutes for the same vehicle if one exists.
   */
  @IsOptional()
  @IsUUID()
  fillupId?: string;

  /**
   * ISO datetime; service falls back to `now()` when omitted. Useful for
   * backfilled entries (driver records a reading after the fact).
   */
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}
