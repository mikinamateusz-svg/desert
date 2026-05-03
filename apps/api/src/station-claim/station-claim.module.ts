import { Module } from '@nestjs/common';
import { StationClaimService } from './station-claim.service.js';
import { StationClaimController } from './station-claim.controller.js';
import { StationClaimAdminController } from './station-claim-admin.controller.js';

@Module({
  controllers: [StationClaimController, StationClaimAdminController],
  providers: [StationClaimService],
  // Exported so future Epic 7 stories (7.3 self-service price update,
  // 7.4 station performance metrics) can check claim ownership without
  // re-importing the controller plumbing.
  exports: [StationClaimService],
})
export class StationClaimModule {}
