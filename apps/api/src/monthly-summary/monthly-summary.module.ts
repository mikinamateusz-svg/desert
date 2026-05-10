import { Module } from '@nestjs/common';
import { MonthlySummaryNotificationService } from './monthly-summary-notification.service.js';
import { MonthlySummaryNotificationWorker } from './monthly-summary-notification.worker.js';
import { ExpoPushProvider } from '../alert/expo-push.provider.js';
import { EXPO_PUSH_CLIENT } from '../alert/expo-push.token.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { FillupModule } from '../fillup/fillup.module.js';

/**
 * Story 6.5 — monthly savings summary notifications.
 * Self-contained module: provides its own EXPO_PUSH_CLIENT rather than
 * depending on AlertModule, since the only AlertModule export needed
 * here is the push client (everything else in AlertModule is alert-
 * pipeline-specific). Keeps this module independent of the alert
 * subsystem's lifecycle.
 *
 * FillupModule imported for SavingsRankingService (Story 5.8 bulk
 * percentile lookup used to enrich the notification body).
 */
@Module({
  imports: [PrismaModule, RedisModule, FillupModule],
  providers: [
    { provide: EXPO_PUSH_CLIENT, useClass: ExpoPushProvider },
    MonthlySummaryNotificationService,
    MonthlySummaryNotificationWorker,
  ],
  exports: [MonthlySummaryNotificationService],
})
export class MonthlySummaryModule {}
