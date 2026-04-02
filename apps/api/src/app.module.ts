import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module.js';
import { StorageModule } from './storage/storage.module.js';
import { RedisModule } from './redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UserModule } from './user/user.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { StationModule } from './station/station.module.js';
import { PriceModule } from './price/price.module.js';
import { MarketSignalModule } from './market-signal/market-signal.module.js';
import { PhotoModule } from './photo/photo.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{ ttl: 3600, limit: 3 }]),
    PrismaModule,
    HealthModule,
    StorageModule,
    RedisModule,
    AuthModule,
    SubmissionsModule,
    NotificationsModule,
    UserModule,
    FeedbackModule,
    StationModule,
    PriceModule,
    MarketSignalModule,
    PhotoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
