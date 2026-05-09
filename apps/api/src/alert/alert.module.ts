import { Module } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PriceRiseAlertWorker } from './alert.worker.js';
import { PremiumAlertsService } from './premium-alerts.service.js';
import { PremiumExpiryWarningService } from './premium-expiry-warning.service.js';
import { PremiumExpiryWarningWorker } from './premium-expiry-warning.worker.js';
import { PriceDropAlertService } from './price-drop-alert.service.js';
import { PriceDropAlertWorker } from './price-drop-alert.worker.js';
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
    AlertsInboxService,
  ],
  // PriceDropAlertWorker is exported so PhotoPipelineWorker (in PhotoModule)
  // can call enqueueCheck() after a verified price lands. PhotoModule
  // already imports AlertModule.
  exports: [PriceRiseAlertService, PremiumAlertsService, PriceDropAlertWorker],
})
export class AlertModule {}
