import { ConflictException, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
// ^^ used both at class level (@Roles(ADMIN)) and method level (@Roles() to override)
import { Public } from '../auth/decorators/public.decorator.js';
import { StationSyncAdminService, SyncStatusResult, TriggerSyncResult } from './station-sync-admin.service.js';
import { StationClassificationWorker } from './station-classification.worker.js';

@Controller('v1/admin/stations')
@Roles(UserRole.ADMIN)
export class StationSyncAdminController {
  constructor(
    private readonly syncAdminService: StationSyncAdminService,
    private readonly classificationWorker: StationClassificationWorker,
    private readonly config: ConfigService,
  ) {}

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

  /** Enqueue a classification job. Protected by X-Admin-Secret header. */
  @Public()
  @Roles()
  @Post('classify')
  @HttpCode(202)
  async triggerClassify(@Headers('x-admin-secret') secret: string): Promise<{ status: string; jobId: string }> {
    const expected = this.config.getOrThrow<string>('ADMIN_SECRET');
    if (secret !== expected) throw new UnauthorizedException();
    const queue = this.classificationWorker.getQueue();
    const job = await queue.add('classify-stations', {}, { attempts: 1 });
    return { status: 'queued', jobId: job.id ?? 'unknown' };
  }
}
