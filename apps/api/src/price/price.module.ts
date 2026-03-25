import { Module } from '@nestjs/common';
import { PriceController } from './price.controller.js';
import { PriceService } from './price.service.js';

@Module({
  controllers: [PriceController],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
