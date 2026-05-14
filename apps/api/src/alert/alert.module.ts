import { Module } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PriceRiseAlertWorker } from './alert.worker.js';
import { AlertsActivationService } from './alerts-activation.service.js';
import { AlertsExpiryWarningService } from './alerts-expiry-warning.service.js';
import { AlertsExpiryWarningWorker } from './alerts-expiry-warning.worker.js';
import { PriceDropAlertService } from './price-drop-alert.service.js';
import { PriceDropAlertWorker } from './price-drop-alert.worker.js';
import { CommunityRiseAlertService } from './community-rise-alert.service.js';
import { CommunityRiseAlertWorker } from './community-rise-alert.worker.js';
import { PredictiveRiseAlertService } from './predictive-rise-alert.service.js';
import { PredictiveRiseAlertWorker } from './predictive-rise-alert.worker.js';
import { AlertsInboxController } from './alerts-inbox.controller.js';
import { AlertsInboxService } from './alerts-inbox.service.js';
import { NotificationSendLogService } from './notification-send-log.service.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { GuestNudgeModule } from '../guest-nudge/guest-nudge.module.js';

@Module({
  // Story 6.9 — AlertModule imports GuestNudgeModule so
  // CommunityRiseAlertService can inject GuestNudgeService and fire
  // the guest market-event nudge after threshold confirmation. One-way
  // dependency (GuestNudgeModule does not import AlertModule) — no
  // circular import risk.
  imports: [PrismaModule, RedisModule, GuestNudgeModule],
  controllers: [AlertsInboxController],
  providers: [
    { provide: EXPO_PUSH_CLIENT, useClass: ExpoPushProvider },
    PriceRiseAlertService,
    PriceRiseAlertWorker,
    // Story 6.10 / 6.13 — price-alerts contribution loop.
    AlertsActivationService,
    AlertsExpiryWarningService,
    AlertsExpiryWarningWorker,
    PriceDropAlertService,
    PriceDropAlertWorker,
    CommunityRiseAlertService,
    CommunityRiseAlertWorker,
    // Story 6.3 — predictive rise alerts. Service + worker; the worker
    // consumes the price-rise-signals queue owned by Story 6.0's
    // PriceRiseSignalPublisher (registered in MarketSignalModule).
    PredictiveRiseAlertService,
    PredictiveRiseAlertWorker,
    AlertsInboxService,
    // Story 6.8 — exported so MonthlySummaryModule (which imports AlertModule)
    // can inject it into MonthlySummaryNotificationService.
    NotificationSendLogService,
  ],
  // PriceDropAlertWorker + CommunityRiseAlertWorker are exported so
  // PhotoPipelineWorker (in PhotoModule) can call enqueueCheck() on each
  // after a verified price lands. PhotoModule already imports AlertModule.
  // CommunityRiseAlertService is exported so Story 6.3 (predictive rise)
  // can read the predictive-sent Redis key contract via the same module.
  // NotificationSendLogService is exported for cross-module injection
  // into MonthlySummaryNotificationService (Story 6.8).
  exports: [
    PriceRiseAlertService,
    AlertsActivationService,
    PriceDropAlertWorker,
    CommunityRiseAlertService,
    CommunityRiseAlertWorker,
    NotificationSendLogService,
  ],
})
export class AlertModule {}
