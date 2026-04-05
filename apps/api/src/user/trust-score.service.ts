import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);

  static readonly DELTA_AUTO_VERIFIED = 5;
  static readonly DELTA_ADMIN_APPROVED = 10;
  static readonly DELTA_ADMIN_REJECTED = -10;
  static readonly DELTA_SHADOW_REJECTED = -25;
  static readonly MIN = 0;
  static readonly MAX = 500;

  constructor(private readonly prisma: PrismaService) {}

  async updateScore(userId: string, delta: number): Promise<void> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "User"
      SET trust_score = GREATEST(0, LEAST(500, trust_score + ${delta}))
      WHERE id = ${userId}
    `;
    if (affected === 0) {
      this.logger.warn(`User ${userId} not found — trust score update skipped`);
    }
  }
}
