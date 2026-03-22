import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { StorageModule } from './storage/storage.module.js';
import { RedisModule } from './redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    HealthModule,
    StorageModule,
    RedisModule,
    AuthModule,
  ],
})
export class AppModule {}
