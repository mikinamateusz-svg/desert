import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Session from 'supertokens-node/recipe/session/index.js';
import { ConsentType, UserConsent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

type DataExportPayload = {
  exported_at: string;
  account: {
    id: string;
    email: string | null;
    display_name: string | null;
    role: string;
    trust_score: number;
    created_at: string;
  };
  submissions: Array<{
    id: string;
    station_id: string | null;
    price_data: unknown;
    status: string;
    created_at: string;
  }>;
  notification_preferences: {
    price_drops: boolean;
    sharp_rise: boolean;
    monthly_summary: boolean;
  } | null;
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async deleteAccount(userId: string, supertokensId: string): Promise<void> {
    // Step 1: Null PII on User record (legitimate interest retains user_id on submissions)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: null,
        display_name: null,
        supertokens_id: null, // breaks linkability to SuperTokens identity
        deleted_at: new Date(),
      },
    });

    // Step 2: Revoke all SuperTokens sessions (best-effort — deletion already complete)
    try {
      await Session.revokeAllSessionsForUser(supertokensId);
    } catch (err) {
      // Session revocation failure is non-fatal — sessions will expire naturally (JWT TTL)
      // PII is already nulled. Log for observability only.
      this.logger.error(`Failed to revoke SuperTokens sessions for user ${userId}`, err);
    }
  }

  async exportMyData(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const submissions = await this.prisma.submission.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    const notificationPreference = await this.prisma.notificationPreference.findFirst({
      where: { user_id: userId },
    });

    const payload: DataExportPayload = {
      exported_at: new Date().toISOString(),
      account: {
        id: user?.id ?? userId,
        email: user?.email ?? null,
        display_name: user?.display_name ?? null,
        role: user?.role ?? '',
        trust_score: user?.trust_score ?? 0,
        created_at: user?.created_at ? new Date(user.created_at).toISOString() : '',
      },
      submissions: submissions.map((s) => ({
        id: s.id,
        station_id: s.station_id ?? null,
        price_data: s.price_data,
        status: s.status,
        created_at: new Date(s.created_at).toISOString(),
      })),
      notification_preferences: notificationPreference
        ? {
            price_drops: notificationPreference.price_drops,
            sharp_rise: notificationPreference.sharp_rise,
            monthly_summary: notificationPreference.monthly_summary,
          }
        : null,
    };

    const buffer = Buffer.from(JSON.stringify(payload, null, 2));
    const key = `exports/${userId}/${Date.now()}.json`;

    await this.storage.uploadBuffer(key, buffer, 'application/json');
    return this.storage.getPresignedUrl(key, 86400);
  }

  async createCoreServiceConsent(userId: string): Promise<void> {
    await this.prisma.userConsent.upsert({
      where: { user_id_type: { user_id: userId, type: 'CORE_SERVICE' } },
      update: {},
      create: { user_id: userId, type: 'CORE_SERVICE' },
    });
  }

  async getConsents(userId: string): Promise<UserConsent[]> {
    return this.prisma.userConsent.findMany({
      where: { user_id: userId },
      orderBy: { consented_at: 'asc' },
    });
  }

  async withdrawConsent(userId: string, type: ConsentType): Promise<void> {
    await this.prisma.userConsent.updateMany({
      where: { user_id: userId, type },
      data: { withdrawn_at: new Date() },
    });
  }

  async sendExportEmail(email: string, downloadUrl: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — skipping export email');
      return;
    }

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: 'noreply@desert.app',
        to: email,
        subject: 'Your Desert data export',
        html: `<p>Your personal data export is ready.</p>
<p><a href="${downloadUrl}">Download your data</a></p>
<p>This link expires in 24 hours.</p>`,
      });
    } catch (err) {
      this.logger.error('Failed to send export email', err);
    }
  }
}
