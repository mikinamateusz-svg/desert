import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateClaimDto {
  @IsUUID()
  stationId!: string;

  /**
   * Free-text — applicant explains who they are / why they own the
   * station. Surfaces in the admin queue. 2000 chars covers any
   * realistic explanation; longer would suggest a different conversation
   * is needed (email support).
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  applicantNotes?: string;
}
