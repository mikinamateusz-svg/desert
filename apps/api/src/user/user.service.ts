import { Injectable, Logger } from '@nestjs/common';
import Session from 'supertokens-node/recipe/session/index.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
