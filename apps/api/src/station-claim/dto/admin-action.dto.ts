import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ClaimMethod } from '@prisma/client';

export class ApproveClaimDto {
  /**
   * Verification method that was actually used. DOMAIN_MATCH is rejected
   * by the service — that path is reserved for the auto-approve branch
   * at submission time so the audit log distinguishes automated from
   * human-verified approvals.
   */
  @IsEnum(ClaimMethod)
  method!: ClaimMethod;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewerNotes?: string;

  /**
   * Free-form bag for method-specific evidence — call summary, doc URL,
   * head-office email subject. Not surfaced to the applicant.
   */
  @IsOptional()
  @IsObject()
  verificationEvidence?: Record<string, unknown>;
}

export class RejectClaimDto {
  /**
   * Surfaced verbatim to the applicant — they see this when looking at
   * their REJECTED claim in the partner portal. Keep actionable.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  rejectionReason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewerNotes?: string;
}

export class RequestDocsDto {
  /**
   * Reviewer notes typically explain what documents are needed. Story
   * 7.2 will wire the upload UI; for now this is informational.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewerNotes?: string;
}
