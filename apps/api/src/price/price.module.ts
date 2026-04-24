import { Module } from '@nestjs/common';
import { PriceController } from './price.controller.js';
import { PriceService } from './price.service.js';
import { PriceCacheService } from './price-cache.service.js';
import { EstimatedPriceService } from './estimated-price.service.js';
import { PriceHistoryService } from './price-history.service.js';
import { PriceValidationService } from './price-validation.service.js';
import { PriceValidationRuleEvaluator } from './price-validation-rule.evaluator.js';
import { RedisModule } from '../redis/redis.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [RedisModule, MetricsModule],
  controllers: [PriceController],
  providers: [
    PriceService,
    PriceCacheService,
    EstimatedPriceService,
    PriceHistoryService,
    PriceValidationService,
    PriceValidationRuleEvaluator,
  ],
  exports: [PriceService, PriceValidationService, PriceValidationRuleEvaluator, PriceCacheService],
})
export class PriceModule {}
