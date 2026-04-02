import { Injectable } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

type PriceEntry = { fuel_type: string; price_per_litre: number | null };

type MappedSubmission = {
  id: string;
  station: { id: string; name: string } | null;
  price_data: PriceEntry[];
  status: 'pending' | 'verified' | 'rejected';
  created_at: Date;
};

export interface CreateSubmissionFields {
  fuelType: string;
  gpsLat: number | null;
  gpsLng: number | null;
  manualPrice: number | null;
  preselectedStationId: string | null;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly photoPipelineWorker: PhotoPipelineWorker,
  ) {}

  async getMySubmissions(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.submission.findMany({
        where: { user_id: userId },
        include: { station: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.submission.count({ where: { user_id: userId } }),
    ]);

    const data: MappedSubmission[] = items.map((item) => ({
      id: item.id,
      station: item.station,
      price_data: Array.isArray(item.price_data) ? (item.price_data as PriceEntry[]) : [],
      // shadow_rejected → pending: driver must not know about shadow bans.
      // Exhaustive map: any unrecognised future status defaults to 'pending'.
      status: (
        ({
          [SubmissionStatus.pending]: 'pending',
          [SubmissionStatus.verified]: 'verified',
          [SubmissionStatus.rejected]: 'rejected',
          [SubmissionStatus.shadow_rejected]: 'pending',
        } as Record<SubmissionStatus, 'pending' | 'verified' | 'rejected'>)[item.status] ?? 'pending'
      ),
      created_at: item.created_at,
    }));

    return { data, total, page, limit };
  }

  /**
   * AC1: Upload photo to R2 first — if this fails, no Submission record is created (AC3).
   * AC2: Create Submission with status=pending, then enqueue BullMQ job (AC4).
   * Returns void; caller returns 202 Accepted.
   */
  async createSubmission(
    userId: string,
    photoBuffer: Buffer,
    fields: CreateSubmissionFields,
  ): Promise<void> {
    const submissionId = randomUUID();
    const r2Key = `submissions/${userId}/${submissionId}.jpg`;

    // AC3: R2 upload BEFORE DB insert — failure propagates, no orphan Submission record
    await this.storageService.uploadBuffer(r2Key, photoBuffer, 'image/jpeg');

    try {
      await this.prisma.submission.create({
        data: {
          id: submissionId,
          user_id: userId,
          station_id: fields.preselectedStationId ?? null,
          photo_r2_key: r2Key,
          gps_lat: fields.gpsLat,
          gps_lng: fields.gpsLng,
          price_data: [{ fuel_type: fields.fuelType, price_per_litre: fields.manualPrice }],
          status: SubmissionStatus.pending,
        },
      });
    } catch (dbErr) {
      // DB failed after R2 succeeded — best-effort cleanup to avoid orphan R2 object
      await this.storageService.deleteObject(r2Key).catch(() => {});
      throw dbErr;
    }

    try {
      // AC4: job payload is submissionId only — worker fetches all data from DB
      await this.photoPipelineWorker.enqueue(submissionId);
    } catch (queueErr) {
      // Queue failed after DB create — roll back both DB record and R2 object
      await this.prisma.submission.delete({ where: { id: submissionId } }).catch(() => {});
      await this.storageService.deleteObject(r2Key).catch(() => {});
      throw queueErr;
    }
  }
}
