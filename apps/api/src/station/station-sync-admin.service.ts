import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationSyncWorker, STATION_SYNC_JOB, JOB_OPTIONS } from './station-sync.worker.js';

export type SyncStatus = 'idle' | 'running' | 'failed';

export interface TriggerSyncResult {
  status: 'queued' | 'already_running';
  jobId: string;
}

export interface SyncStatusResult {
  status: SyncStatus;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  stationCount: number;
}

@Injectable()
export class StationSyncAdminService {
  constructor(
    private readonly worker: StationSyncWorker,
    private readonly prisma: PrismaService,
  ) {}

  async triggerSync(): Promise<TriggerSyncResult> {
    const queue = this.worker.getQueue();
    const counts = await queue.getJobCounts('active', 'waiting');

    if (counts.active > 0 || counts.waiting > 0) {
      const active = await queue.getJobs(['active', 'waiting'], 0, 0);
      return { status: 'already_running', jobId: active[0]?.id ?? 'unknown' };
    }

    const job = await queue.add(STATION_SYNC_JOB, {}, JOB_OPTIONS);
    return { status: 'queued', jobId: job.id ?? 'unknown' };
  }

  async getStatus(): Promise<SyncStatusResult> {
    const queue = this.worker.getQueue();
    const counts = await queue.getJobCounts('active', 'waiting');
    const isRunning = counts.active > 0 || counts.waiting > 0;

    const [completed, failed, stationCount] = await Promise.all([
      queue.getJobs(['completed'], 0, 0, false),
      queue.getJobs(['failed'], 0, 0, false),
      this.prisma.station.count(),
    ]);

    const lastCompletedAt = completed[0]?.finishedOn
      ? new Date(completed[0].finishedOn).toISOString()
      : null;

    const lastFailedAt = failed[0]?.finishedOn
      ? new Date(failed[0].finishedOn).toISOString()
      : null;

    let status: SyncStatus;
    if (isRunning) {
      status = 'running';
    } else if (
      lastFailedAt !== null &&
      (lastCompletedAt === null || lastFailedAt > lastCompletedAt)
    ) {
      status = 'failed';
    } else {
      status = 'idle';
    }

    return { status, lastCompletedAt, lastFailedAt, stationCount };
  }
}
