import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OdometerService } from './odometer.service.js';
import { OdometerOcrService, type OdometerOcrResult } from './odometer-ocr.service.js';
import { CreateOdometerDto } from './dto/create-odometer.dto.js';

// Mirror of FillupController's allow-list — every authenticated role that
// can drive needs to log odometer readings.
const ALL_DRIVING_ROLES = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

// 5 MB — same cap as price-board and pump-meter photos.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Controller('v1/me/odometer')
export class OdometerController {
  constructor(
    private readonly odometer: OdometerService,
    private readonly ocr: OdometerOcrService,
  ) {}

  /**
   * Synchronous odometer OCR. Per AC8 / AC9:
   *   - Always returns 200 with an OdometerOcrResult body.
   *   - On parse failure, low confidence, timeout, or API error: returns
   *     `{ km: null, confidence: 0 }` so the mobile client falls back to
   *     manual entry without ever seeing a 500 / spinning indefinitely.
   *
   * No queue — readings are pre-confirmed by the driver on the next
   * screen, so there's nothing to defer. The 10s timeout lives inside
   * the service via AbortSignal.timeout.
   */
  @Post('ocr')
  @Roles(...ALL_DRIVING_ROLES)
  @HttpCode(HttpStatus.OK)
  async runOcr(@Req() req: FastifyRequest): Promise<OdometerOcrResult> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    let photoBuffer: Buffer | null = null;

    // files: 1 mirrors the FillupController DoS guard — caps the multipart
    // stream to a single file part so a malicious caller can't push us to
    // buffer N×5MB of garbage.
    const parts = req.parts({ limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 5 } });
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'photo' && !photoBuffer) {
        photoBuffer = await part.toBuffer();
      } else if (part.type === 'file') {
        await part.toBuffer();
      }
    }

    if (!photoBuffer || photoBuffer.length === 0) {
      throw new BadRequestException('photo field is required');
    }

    return this.ocr.extractKm(photoBuffer);
  }

  /**
   * Persist a confirmed reading. Returns the reading + consumption result
   * (or null when baseline / no fill-ups in segment).
   */
  @Post()
  @Roles(...ALL_DRIVING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateOdometerDto) {
    return this.odometer.createReading(userId, dto);
  }

  /**
   * Paginated history. Optional ?vehicleId= filter scoped to the caller.
   */
  @Get()
  @Roles(...ALL_DRIVING_ROLES)
  list(
    @CurrentUser('id') userId: string,
    @Query('vehicleId') vehicleId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.odometer.listReadings(userId, vehicleId, page, limit);
  }
}
