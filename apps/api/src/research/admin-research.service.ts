import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const PHOTO_URL_TTL_SECONDS = 60 * 60; // 1 hour — enough to browse + label a batch

export interface ResearchPhotoRow {
  id: string;
  submission_id: string;
  station_id: string | null;
  station_name: string | null;
  /** Rounded to 4dp (~10m). Null if the original submission had no GPS or
   *  was retained before the gps columns were added (2026-04-25). */
  gps_lat: number | null;
  gps_lng: number | null;
  ocr_prices: unknown;
  final_prices: unknown;
  actual_prices: unknown;
  label_notes: string | null;
  final_status: string;
  flag_reason: string | null;
  captured_at: Date;
  retained_until: Date;
  photo_url: string | null;
}

export interface ResearchListResult {
  data: ResearchPhotoRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface LabelInput {
  actual_prices?: unknown;
  label_notes?: string | null;
}

@Injectable()
export class AdminResearchService {
  private readonly logger = new Logger(AdminResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(limit: number, offset: number, onlyUnlabeled = false): Promise<ResearchListResult> {
    // `unlabeled` = the row has never been touched by the labeling flow.
    // The column is SQL NULL by default at insert time; the labeling endpoint
    // sets it to either {} (empty-label, photo had no prices) or a non-empty
    // object. Prisma.AnyNull matches both SQL NULL and JSON literal null —
    // covers the SQL-NULL default reliably regardless of how it was written.
    const where: Prisma.ResearchPhotoWhereInput = onlyUnlabeled
      ? { actual_prices: { equals: Prisma.AnyNull } }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.researchPhoto.findMany({
        where,
        orderBy: { captured_at: 'desc' },
        skip: offset,
        take: limit,
        include: { submission: { include: { station: { select: { name: true } } } } },
      }),
      this.prisma.researchPhoto.count({ where }),
    ]);

    // Presigned URLs are generated on demand (1h TTL) — lazy-sign per row so
    // an admin browsing page 5 doesn't burn sign operations on pages 1-4.
    const data: ResearchPhotoRow[] = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        submission_id: r.submission_id,
        station_id: r.station_id,
        station_name: r.submission.station?.name ?? null,
        gps_lat: r.gps_lat,
        gps_lng: r.gps_lng,
        ocr_prices: r.ocr_prices,
        final_prices: r.final_prices,
        actual_prices: r.actual_prices,
        label_notes: r.label_notes,
        final_status: r.final_status,
        flag_reason: r.flag_reason,
        captured_at: r.captured_at,
        retained_until: r.retained_until,
        photo_url: await this.storage
          .getPresignedUrl(r.r2_key, PHOTO_URL_TTL_SECONDS)
          .catch((err: Error) => {
            this.logger.warn(
              `Presign failed for research photo ${r.id} (${r.r2_key}): ${err.message}`,
            );
            return null;
          }),
      })),
    );

    return { data, total, limit, offset };
  }

  /**
   * Streams the actual photo bytes for a research row. Used by the labeling
   * helper to bypass R2 presigned URLs (which fight AWS SDK v3 + R2 in
   * various ways — see commits 8dd3966, 69301e9 for prior attempts). Direct
   * GET from R2 via the storage service works reliably; this endpoint just
   * relays those bytes to the admin caller.
   */
  async getPhotoBuffer(id: string): Promise<Buffer> {
    const photo = await this.prisma.researchPhoto.findUnique({
      where: { id },
      select: { r2_key: true },
    });
    if (!photo) throw new NotFoundException(`Research photo ${id} not found`);
    return this.storage.getObjectBuffer(photo.r2_key);
  }

  /**
   * Re-copy the source Submission's photo into the ResearchPhoto's r2_key.
   * Recovers from the requeue rollback bug that deleted the research R2
   * object while leaving the DB row intact. No-op if the source photo is
   * also gone (cleanup worker may have removed it after retention expired).
   */
  async repairR2(id: string): Promise<void> {
    const photo = await this.prisma.researchPhoto.findUnique({
      where: { id },
      select: {
        r2_key: true,
        submission: { select: { photo_r2_key: true } },
      },
    });
    if (!photo) throw new NotFoundException(`Research photo ${id} not found`);
    const sourceKey = photo.submission?.photo_r2_key;
    if (!sourceKey) {
      throw new BadRequestException(
        `Research photo ${id}: source submission has no photo_r2_key (cleanup worker likely removed it)`,
      );
    }
    await this.storage.copyObject(sourceKey, photo.r2_key);
    this.logger.log(`Research photo ${id}: R2 repaired from ${sourceKey} → ${photo.r2_key}`);
  }

  async label(id: string, input: LabelInput): Promise<void> {
    const existing = await this.prisma.researchPhoto.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Research photo ${id} not found`);

    // Build a patch that only sets fields the caller actually provided.
    // Undefined means "leave as-is"; explicit null clears.
    const data: Prisma.ResearchPhotoUpdateInput = {};
    if ('actual_prices' in input && input.actual_prices !== undefined) {
      data.actual_prices = (input.actual_prices === null
        ? Prisma.JsonNull
        : (input.actual_prices as Prisma.InputJsonValue));
    }
    if ('label_notes' in input) {
      data.label_notes = input.label_notes ?? null;
    }

    await this.prisma.researchPhoto.update({ where: { id }, data });
  }
}
