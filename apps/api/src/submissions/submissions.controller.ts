import {
  Controller,
  Get,
  Post,
  Req,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { SubmissionsService } from './submissions.service.js';
import { GetSubmissionsDto } from './dto/get-submissions.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@Controller('v1/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @Roles(UserRole.DRIVER)
  getMySubmissions(
    @CurrentUser('id') userId: string,
    @Query() dto: GetSubmissionsDto,
  ) {
    return this.submissionsService.getMySubmissions(userId, dto.page, dto.limit);
  }

  @Post()
  @Roles(UserRole.DRIVER)
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

    const parts = req.parts({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB cap
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        photoBuffer = await part.toBuffer();
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
}

function parseOptionalFloat(val: string | undefined): number | null {
  if (!val || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
