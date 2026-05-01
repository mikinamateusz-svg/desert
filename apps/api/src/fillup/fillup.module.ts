import { Module } from '@nestjs/common';
import { FillupService } from './fillup.service.js';
import { FillupOcrService } from './fillup-ocr.service.js';
import { FillupController } from './fillup.controller.js';
import { StationModule } from '../station/station.module.js';
import { RegionalBenchmarkModule } from '../regional-benchmark/regional-benchmark.module.js';
import { PhotoModule } from '../photo/photo.module.js';

@Module({
  // StationModule           → StationService.findNearestStation (200m GPS match)
  // RegionalBenchmarkModule → RegionalBenchmarkService.getLatestForStation (area_avg snapshot)
  // PhotoModule             → OcrSpendService.recordSpend (Haiku spend tracking,
  //                            shares the daily cap with Gemini OCR per spec T2c)
  imports: [StationModule, RegionalBenchmarkModule, PhotoModule],
  controllers: [FillupController],
  providers: [FillupService, FillupOcrService],
  // Exported for Story 5.3 (savings vs area average) and Story 5.5 (history)
  // to consume the same business logic without re-importing the controller.
  exports: [FillupService],
})
export class FillupModule {}
