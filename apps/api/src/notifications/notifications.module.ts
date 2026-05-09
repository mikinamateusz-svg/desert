import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  // RedisModule needed by Story 6.6's getSummaryReprompt — checks the
  // monthly:summary:calculated:{userId} key set by Story 6.5.
  imports: [RedisModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
