import { Module } from '@nestjs/common';
import { PriceController } from './price.controller.js';
import { PriceService } from './price.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [RedisModule],
  controllers: [PriceController],
  providers: [PriceService, PriceCacheService],
  exports: [PriceService],
})
export class PriceModule {}
