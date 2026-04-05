import { Injectable, Logger, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';

export interface DlqJobRow {
  jobId: string;
  submissionId: string;
  stationId: string | null;
  stationName: string | null;
  failureReason: string;
  attemptsMade: number;
  lastAttemptAt: Date | null;
}

const AUDIT_ACTION_DLQ_RETRY = 'DLQ_RETRY';
const AUDIT_ACTION_DLQ_DISCARD = 'DLQ_DISCARD';

const DLQ_ALERT_THRESHOLD = 10;

@Injectable()
export class AdminDlqService implements OnModuleInit {
  private readonly logger = new Logger(AdminDlqService.name);
  private queue!: Queue;
  private lastAlertSentAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly photoPipelineWorker: PhotoPipelineWorker,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = this.photoPipelineWorker.getQueue();
  }

  async listDlq(): Promise<DlqJobRow[]> {
    const failedJobs = await this.queue.getJobs(['failed']);

    const submissionIds = failedJobs
      .map((j) => j.data?.submissionId as string | undefined)
      .filter((id): id is string => Boolean(id));

    const submissions = submissionIds.length > 0
      ? await this.prisma.submission.findMany({
          where: { id: { in: submissionIds } },
          select: {
            id: true,
            station_id: true,
            station: { select: { name: true } },
          },
        })
      : [];

    const submissionMap = new Map(submissions.map((s) => [s.id, s]));

    const rows: DlqJobRow[] = failedJobs.map((job) => {
      const submissionId = (job.data?.submissionId as string | undefined) ?? '';
      const sub = submissionMap.get(submissionId);
      const finishedOn = job.finishedOn ?? job.processedOn ?? null;
      return {
        jobId: String(job.id),
        submissionId,
        stationId: sub?.station_id ?? null,
        stationName: sub?.station?.name ?? null,
        failureReason: job.failedReason ?? 'unknown',
        attemptsMade: job.attemptsMade ?? 0,
        lastAttemptAt: finishedOn != null ? new Date(finishedOn) : null,
      };
    });

    // Sort oldest first by job timestamp — O(n) map avoids O(n²) find
    const tsMap = new Map(failedJobs.map((j) => [String(j.id), j.timestamp ?? 0]));
    rows.sort((a, b) => (tsMap.get(a.jobId) ?? 0) - (tsMap.get(b.jobId) ?? 0));

    return rows;
  }

  async retryJob(jobId: string, adminId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`DLQ job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new ConflictException(`Job ${jobId} is no longer in failed state (current: ${state})`);
    }

    const submissionId = (job.data?.submissionId as string | undefined) ?? '';
    await job.retry();

    await this.writeAuditLog(adminId, AUDIT_ACTION_DLQ_RETRY, submissionId, null);
    await this.checkDlqAlert();
  }

  async discardJob(jobId: string, adminId: string, notes?: string): Promise<void> {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`DLQ job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new ConflictException(`Job ${jobId} is no longer in failed state (current: ${state})`);
    }

    const submissionId = (job.data?.submissionId as string | undefined) ?? '';

    // 1. findUnique to get photo_r2_key BEFORE removing the job
    let photoR2Key: string | null = null;
    if (submissionId) {
      const submission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { photo_r2_key: true },
      });

      if (submission === null) {
        this.logger.warn(`discardJob ${jobId}: submission ${submissionId} not found in DB — skipping status update`);
      }

      photoR2Key = submission?.photo_r2_key ?? null;
    }

    // 2. Remove from queue first
    await job.remove();

    // 3. Update submission status (with guard against terminal states)
    if (submissionId) {
      try {
        const updated = await this.prisma.submission.updateMany({
          where: { id: submissionId, status: { notIn: [SubmissionStatus.rejected, SubmissionStatus.verified] } },
          data: { status: SubmissionStatus.rejected, flag_reason: 'dead_letter_discarded' },
        });
        if (updated.count === 0) {
          this.logger.warn(`discardJob ${jobId}: submission ${submissionId} already in terminal state — skipping status update`);
        }
      } catch (e: unknown) {
        this.logger.error(
          `[OPS-ALERT] discardJob ${jobId}: failed to update submission ${submissionId} status after job removal: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 4. R2 photo delete (best-effort)
    if (photoR2Key) {
      await this.storage.deleteObject(photoR2Key).catch((e: unknown) =>
        this.logger.warn(
          `discardJob ${jobId}: R2 photo delete failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }

    // 5. Audit log
    await this.writeAuditLog(
      adminId,
      AUDIT_ACTION_DLQ_DISCARD,
      submissionId,
      notes ?? null,
    );

    // 6. DLQ alert check
    await this.checkDlqAlert();
  }

  async checkDlqAlert(): Promise<void> {
    try {
      const counts = await this.queue.getJobCounts('failed');
      const failedCount = counts.failed ?? 0;

      if (failedCount < DLQ_ALERT_THRESHOLD) {
        return;
      }

      // Rate limit: at most one alert per hour
      const now = Date.now();
      const ONE_HOUR_MS = 60 * 60 * 1000;
      if (now - this.lastAlertSentAt < ONE_HOUR_MS) {
        return; // already alerted within the last hour
      }
      this.lastAlertSentAt = now;

      const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl) {
        this.logger.warn(
          `DLQ alert: ${failedCount} jobs in dead-letter queue. ` +
            `Set SLACK_WEBHOOK_URL to enable Slack notifications. ` +
            `Check the admin dashboard DLQ section.`,
        );
        return;
      }

      if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
        this.logger.error(`SLACK_WEBHOOK_URL does not look like a valid Slack webhook URL — skipping alert`);
        return;
      }

      const dashboardUrl = process.env['ADMIN_DASHBOARD_URL'] ?? '';
      const dlqLink = dashboardUrl ? ` ${dashboardUrl}/dead-letter` : '';

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `DLQ alert: ${failedCount} jobs in dead-letter queue. Check the admin dashboard DLQ section.${dlqLink}`,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch((e: unknown) =>
        this.logger.error(
          `Failed to send Slack DLQ alert: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    } catch (e: unknown) {
      this.logger.error(
        `checkDlqAlert failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async writeAuditLog(
    adminUserId: string,
    action: string,
    submissionId: string,
    notes: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminUserId,
          action,
          submission_id: submissionId || null,
          notes,
        },
      });
    } catch (e: unknown) {
      this.logger.error(
        `[OPS-ALERT] Failed to write audit log for ${action} on submission ${submissionId} ` +
          `by admin ${adminUserId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
