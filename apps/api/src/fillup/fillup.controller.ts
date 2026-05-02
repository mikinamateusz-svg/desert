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
import { FillupService } from './fillup.service.js';
import { FillupOcrService, type FillupOcrResult } from './fillup-ocr.service.js';
import { CreateFillupDto } from './dto/create-fillup.dto.js';

// Mirrors the Vehicle controller's allow-list — every authenticated role that
// can drive needs to log fill-ups. Admin included so admins can debug their
// own account end-to-end without role juggling.
const ALL_DRIVING_ROLES = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

// 5 MB — same cap as price-board submissions (apps/api/src/submissions/...)
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Controller('v1/me/fillups')
export class FillupController {
  constructor(
    private readonly fillups: FillupService,
    private readonly ocr: FillupOcrService,
  ) {}

  /**
   * Synchronous pump-meter OCR. Per AC3 / AC9 / AC10:
   *   - Always returns 200 with a FillupOcrResult body.
   *   - On parse failure, low confidence, timeout, or API error: returns
   *     `{ confidence: 0, ...nulls }` so the mobile client falls back to
   *     manual entry without ever seeing a 500 / spinning indefinitely.
   *
   * No queue — fill-ups are pre-confirmed by the driver on the next screen,
   * so there's nothing to defer. The 10s timeout lives inside the service
   * via AbortSignal.timeout.
   */
  @Post('ocr')
  @Roles(...ALL_DRIVING_ROLES)
  @HttpCode(HttpStatus.OK)
  async runOcr(@Req() req: FastifyRequest): Promise<FillupOcrResult> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected multipart/form-data');
    }

    let photoBuffer: Buffer | null = null;

    // `files: 1` blocks the DoS amplifier where a malicious client appends
    // multiple file parts to a single request — fastify rejects the second
    // file before the iterator yields it, so we never buffer extra megabytes
    // into memory. `fields: 5` keeps the existing field cap (this endpoint
    // doesn't read any fields, but defence in depth).
    const parts = req.parts({ limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 5 } });
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'photo' && !photoBuffer) {
        photoBuffer = await part.toBuffer();
      } else if (part.type === 'file') {
        // Drain the unexpected file part to avoid stalling the multipart
        // stream — `files: 1` should make this branch unreachable in
        // practice, but keep the drain as a belt-and-suspenders guard
        // against future limit changes (same pattern as submissions.controller).
        await part.toBuffer();
      }
      // Fields are intentionally ignored on this endpoint — OCR only reads
      // the image. The confirm step (POST /v1/me/fillups) carries the
      // structured data.
    }

    if (!photoBuffer || photoBuffer.length === 0) {
      throw new BadRequestException('photo field is required');
    }

    return this.ocr.extractFromPumpMeter(photoBuffer);
  }

  /**
   * Persist a confirmed fill-up. Returns the FillUp record + station-match
   * metadata for the celebration screen.
   */
  @Post()
  @Roles(...ALL_DRIVING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateFillupDto) {
    return this.fillups.createFillup(userId, dto);
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
    return this.fillups.listFillups(userId, vehicleId, page, limit);
  }
}
