import { Module } from '@nestjs/common';
import { OdometerService } from './odometer.service.js';
import { OdometerOcrService } from './odometer-ocr.service.js';
import { OdometerController } from './odometer.controller.js';
import { PhotoModule } from '../photo/photo.module.js';

@Module({
  // PhotoModule → OcrSpendService.recordSpend / getDailySpend / getSpendCap /
  //               computeCostUsd. Shared daily cap with price-board OCR
  //               (Story 3.5) and pump-meter OCR (Story 5.2).
  imports: [PhotoModule],
  controllers: [OdometerController],
  providers: [OdometerService, OdometerOcrService],
  // Exported for Story 5.6 (per-vehicle consumption benchmarks) which will
  // consume the same business logic without re-importing the controller.
  exports: [OdometerService],
})
export class OdometerModule {}
