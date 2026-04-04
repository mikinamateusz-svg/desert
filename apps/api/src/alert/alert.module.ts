import { Module } from '@nestjs/common';
import { PriceRiseAlertService } from './alert.service.js';
import { PriceRiseAlertWorker } from './alert.worker.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { EXPO_PUSH_CLIENT } from './expo-push.token.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    { provide: EXPO_PUSH_CLIENT, useClass: ExpoPushProvider },
    PriceRiseAlertService,
    PriceRiseAlertWorker,
  ],
  exports: [PriceRiseAlertService],
})
export class AlertModule {}
