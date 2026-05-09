import { Module } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PriceRiseAlertWorker } from './alert.worker.js';
import { PremiumAlertsService } from './premium-alerts.service.js';
import { PremiumExpiryWarningService } from './premium-expiry-warning.service.js';
import { PremiumExpiryWarningWorker } from './premium-expiry-warning.worker.js';
import { PriceDropAlertService } from './price-drop-alert.service.js';
import { PriceDropAlertWorker } from './price-drop-alert.worker.js';
import { CommunityRiseAlertService } from './community-rise-alert.service.js';
import { CommunityRiseAlertWorker } from './community-rise-alert.worker.js';
import { PredictiveRiseAlertService } from './predictive-rise-alert.service.js';
import { PredictiveRiseAlertWorker } from './predictive-rise-alert.worker.js';
import { AlertsInboxController } from './alerts-inbox.controller.js';
import { AlertsInboxService } from './alerts-inbox.service.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AlertsInboxController],
  providers: [
    { provide: EXPO_PUSH_CLIENT, useClass: ExpoPushProvider },
    PriceRiseAlertService,
    PriceRiseAlertWorker,
    PremiumAlertsService,
    PremiumExpiryWarningService,
    PremiumExpiryWarningWorker,
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
  ],
  // PriceDropAlertWorker + CommunityRiseAlertWorker are exported so
  // PhotoPipelineWorker (in PhotoModule) can call enqueueCheck() on each
  // after a verified price lands. PhotoModule already imports AlertModule.
  // CommunityRiseAlertService is exported so Story 6.3 (predictive rise)
  // can read the predictive-sent Redis key contract via the same module.
  exports: [
    PriceRiseAlertService,
    PremiumAlertsService,
    PriceDropAlertWorker,
    CommunityRiseAlertService,
    CommunityRiseAlertWorker,
  ],
})
export class AlertModule {}
