import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { StationClaimService } from './station-claim.service.js';
import { CreateClaimDto } from './dto/create-claim.dto.js';

// Any authenticated user may submit a station claim. The service layer
// handles role granting (DRIVER → STATION_MANAGER on auto-approve).
const ANY_AUTHENTICATED_ROLE = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

/**
 * Applicant-facing endpoints (Story 7.1). Used by `apps/partner` to
 * submit and track station ownership claims.
 *
 * Note: STATION_MANAGER role grants happen inside the service, not via
 * a dedicated endpoint — keeps the auto-approve transaction atomic
 * with the role bump.
 */
@Controller('v1/me/station-claims')
export class StationClaimController {
  constructor(private readonly claims: StationClaimService) {}

  /**
   * Submit (or re-submit) a claim. Returns the created/updated claim
   * with current status:
   *   - 201 + status=APPROVED  → auto-approved via DOMAIN_MATCH
   *   - 201 + status=PENDING   → queued for manual review
   * Conflict (409) when:
   *   - The station already has an APPROVED claim from another user
   *   - The applicant already has a PENDING / AWAITING_DOCS claim for it
   *   - The applicant has already been approved as manager
   */
  @Post()
  @Roles(...ANY_AUTHENTICATED_ROLE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateClaimDto) {
    return this.claims.createClaim(userId, dto);
  }

  /** Applicant's own claims, newest first. */
  @Get()
  @Roles(...ANY_AUTHENTICATED_ROLE)
  list(@CurrentUser('id') userId: string) {
    return this.claims.listMyClaims(userId);
  }
}
