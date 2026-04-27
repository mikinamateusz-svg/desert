import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { AdminResearchService } from './admin-research.service.js';

class LabelDto {
  actual_prices?: unknown;
  label_notes?: string | null;
}

@Controller('v1/admin/research/photos')
@Roles(UserRole.ADMIN)
export class AdminResearchController {
  constructor(private readonly service: AdminResearchService) {}

  /**
   * List research photos with presigned download URLs + existing OCR and
   * verified price data. Paginated (limit <= 100).
   * Pass ?unlabeled=true to see only rows without actual_prices yet.
   */
  @Get()
  async list(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('unlabeled') unlabeled?: string,
  ) {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(0, offset);
    return this.service.list(safeLimit, safeOffset, unlabeled === 'true');
  }

  /**
   * Attach ground-truth labels (actual prices off the sign) and optional
   * notes. Used to build the benchmark corpus.
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async label(@Param('id') id: string, @Body() body: LabelDto) {
    await this.service.label(id, body);
    return { status: 'labeled' };
  }

  /**
   * Streams the photo bytes — bypasses R2 presigned URLs entirely so the
   * labeling helper can open photos via authenticated download → local
   * file → browser. Direct R2 GET works reliably; presigned URLs fight
   * AWS SDK v3 + R2 in opaque ways.
   */
  @Get(':id/photo')
  async getPhoto(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const buffer = await this.service.getPhotoBuffer(id);
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=300');
    void reply.send(buffer);
  }
}
