import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { User, UserRole } from '@prisma/client';
import { SubmissionsService } from './submissions.service.js';
import { GetSubmissionsDto } from './dto/get-submissions.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Throttle } from '@nestjs/throttler';

@Controller('v1/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  getMySubmissions(
    @CurrentUser('id') userId: string,
    @Query() dto: GetSubmissionsDto,
  ) {
    return this.submissionsService.getMySubmissions(userId, dto.page, dto.limit);
  }

  @Post()
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() req: FastifyRequest,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    let photoBuffer: Buffer | null = null;
    const fields: Record<string, string> = {};

    const parts = req.parts({ limits: { fileSize: 5 * 1024 * 1024, fields: 10 } }); // 5 MB / 10 fields max
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'photo' && !photoBuffer) {
        photoBuffer = await part.toBuffer();
      } else if (part.type === 'file') {
        // Drain any unexpected file parts to avoid stalling the multipart stream
        await part.toBuffer();
      } else if (part.type === 'field') {
        fields[part.fieldname] = part.value as string;
      }
    }

    if (!photoBuffer || photoBuffer.length === 0) {
      throw new BadRequestException('photo field is required');
    }

    const fuelType = fields['fuel_type'];
    if (!fuelType) {
      throw new BadRequestException('fuel_type field is required');
    }

    await this.submissionsService.createSubmission(userId, photoBuffer, {
      fuelType,
      gpsLat: parseOptionalFloat(fields['gps_lat']),
      gpsLng: parseOptionalFloat(fields['gps_lng']),
      manualPrice: parseOptionalFloat(fields['manual_price']),
      preselectedStationId: fields['preselected_station_id'] || null,
    });
  }

  /**
   * Story 3.14 — driver-initiated flag for an own verified submission with
   * wrong prices. Withdraws the submission, restores previous prices, lifts
   * dedup so the driver can retake immediately, and routes the submission to
   * admin review.
   *
   * Rate limited at 5 actions / hour per user via Throttle (admins still
   * subject to the throttle by decorator placement, but bypass the per-action
   * 24h-window check inside the service).
   */
  @Post(':id/flag-wrong')
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3600, limit: 5 } })
  async flagWrong(
    @Param('id') submissionId: string,
    @CurrentUser() user: User,
  ): Promise<{ status: 'withdrawn' }> {
    await this.submissionsService.flagWrong(submissionId, user.id, user.role);
    return { status: 'withdrawn' };
  }
}

function parseOptionalFloat(val: string | undefined): number | null {
  if (!val || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) || !isFinite(n) ? null : n;
}
