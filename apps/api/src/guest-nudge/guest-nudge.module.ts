import { Module } from '@nestjs/common';
import { GuestNudgeService } from './guest-nudge.service.js';
import { GuestNudgeController } from './guest-nudge.controller.js';
import { ExpoPushProvider } from '../alert/expo-push.provider.js';
import { EXPO_PUSH_CLIENT } from '../alert/expo-push.token.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';

/**
 * Story 6.9 — guest conversion nudges (3 unauthenticated endpoints +
 * a service callable from CommunityRiseAlertService). Self-provides
 * EXPO_PUSH_CLIENT rather than depending on AlertModule, matching the
 * MonthlySummaryModule pattern — keeps this module independent of the
 * alert pipeline's lifecycle and avoids a circular import (AlertModule
 * imports GuestNudgeModule).
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [GuestNudgeController],
  providers: [
    { provide: EXPO_PUSH_CLIENT, useClass: ExpoPushProvider },
    GuestNudgeService,
  ],
  exports: [GuestNudgeService],
})
export class GuestNudgeModule {}
