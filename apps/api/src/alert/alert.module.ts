import { Module } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PriceRiseAlertWorker } from './alert.worker.js';
import { PremiumAlertsService } from './premium-alerts.service.js';
import { PremiumExpiryWarningService } from './premium-expiry-warning.service.js';
import { PremiumExpiryWarningWorker } from './premium-expiry-warning.worker.js';
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
    AlertsInboxService,
  ],
  exports: [PriceRiseAlertService, PremiumAlertsService],
})
export class AlertModule {}
