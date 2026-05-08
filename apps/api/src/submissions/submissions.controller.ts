import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
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
import { FlagWrongThrottlerGuard } from './flag-wrong-throttler.guard.js';

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

  /**
   * Account-wide aggregate counts for the Activity-screen summary card.
   * Independent of pagination — fixes the bug where the visible-page
   * counter grew as the driver loaded more rows.
   */
  @Get('summary')
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  getMySubmissionsSummary(@CurrentUser('id') userId: string) {
    return this.submissionsService.getMySubmissionsSummary(userId);
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
      // Story 3.20 — capture-screen telemetry. All four fields are optional;
      // pre-3.20 clients omit them and the row stays null. Per-field bounds
      // reject absurd values (P5 from 3.20 review).
      gpsAcquiredAtCapture: parseOptionalBool(fields['gps_acquired_at_capture']),
      gpsAcquisitionMs: parseOptionalInt(fields['gps_acquisition_ms'], GPS_ACQUISITION_MS_MAX),
      overrideUsed: parseOptionalBool(fields['override_used']),
      nearbyStationsCount: parseOptionalInt(fields['nearby_stations_count'], NEARBY_COUNT_MAX),
    });
  }

  /**
   * Story 3.14 — driver-initiated flag for an own verified submission with
   * wrong prices. Withdraws the submission, restores previous prices, lifts
   * dedup so the driver can retake immediately, and routes the submission to
   * admin review.
   *
   * Rate-limited at 5 actions / hour PER USER via FlagWrongThrottlerGuard
   * (overrides the global IP-keyed ThrottlerGuard for this route only —
   * fixes P-7 CGNAT issue). Admins bypass the rate limit entirely (P-8 /
   * AC10) via the same guard's `shouldSkip` override.
   */
  @Post(':id/flag-wrong')
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  @UseGuards(FlagWrongThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3600, limit: 5 } })
  async flagWrong(
    @Param('id', ParseUUIDPipe) submissionId: string,
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

// Story 3.20 — telemetry parsers. Per-field upper bounds reject absurd
// values (malicious or buggy clients) before they hit the DB. The mobile
// client also clamps `nearby_stations_count` at 99 — server-side bounds
// are defence-in-depth, not the only line.
const NEARBY_COUNT_MAX = 99;
const GPS_ACQUISITION_MS_MAX = 10 * 60 * 1000; // 10 minutes

function parseOptionalBool(val: string | undefined): boolean | null {
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  return null;
}

// P5 (3.20 review) — accept a per-field max so each numeric telemetry
// field can have its own ceiling (`gps_acquisition_ms` and
// `nearby_stations_count` differ by 4 orders of magnitude).
function parseOptionalInt(val: string | undefined, max: number): number | null {
  if (!val || val === '') return null;
  const n = parseInt(val, 10);
  if (isNaN(n) || !isFinite(n) || n < 0 || n > max) return null;
  return n;
}
