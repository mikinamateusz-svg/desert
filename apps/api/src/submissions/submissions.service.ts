import { Injectable } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

type PriceEntry = { fuel_type: string; price_per_litre: number };

type MappedSubmission = {
  id: string;
  station: { id: string; name: string } | null;
  price_data: PriceEntry[];
  status: 'pending' | 'verified' | 'rejected';
  created_at: Date;
};

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
