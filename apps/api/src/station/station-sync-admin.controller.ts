import { ConflictException, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { StationSyncAdminService, SyncStatusResult, TriggerSyncResult } from './station-sync-admin.service.js';

@Controller('v1/admin/stations')
@Roles(UserRole.ADMIN)
export class StationSyncAdminController {
  constructor(private readonly syncAdminService: StationSyncAdminService) {}

  @Post('sync')
  @HttpCode(202)
  async triggerSync(): Promise<TriggerSyncResult> {
    const result = await this.syncAdminService.triggerSync();
    if (result.status === 'already_running') {
      throw new ConflictException(result);
    }
    return result;
  }

  @Get('sync/status')
  async getSyncStatus(): Promise<SyncStatusResult> {
    return this.syncAdminService.getStatus();
  }
}
