import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PredictiveRiseAlertService } from './predictive-rise-alert.service.js';
import {
  PRICE_RISE_SIGNALS_QUEUE,
  type PriceRiseSignalJobData,
} from '../market-signal/types.js';

/**
 * Story 6.3 — consumer of Story 6.0's price-rise-signals queue.
 *
 * Doesn't own the queue (PriceRiseSignalPublisher does, in
 * MarketSignalModule); only owns its own Worker. Mirrors the
 * price-drop-alert.worker.ts pattern: raw BullMQ, terminal-only
 * OPS-ALERT, swallow processor errors so BullMQ doesn't loop.
 */
@Injectable()
export class PredictiveRiseAlertWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PredictiveRiseAlertWorker.name);
  private worker!: Worker;
  private redisForBlocking!: Redis;

  constructor(
    private readonly alertService: PredictiveRiseAlertService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('PredictiveRiseAlertWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBlocking = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForBlocking as any;

    this.worker = new Worker<PriceRiseSignalJobData>(
      PRICE_RISE_SIGNALS_QUEUE,
      async (job: Job<PriceRiseSignalJobData>) => {
        try {
          await this.alertService.processSignal(job.data);
        } catch (err) {
          // Swallow so BullMQ doesn't retry infinitely on logic bugs.
          // Best-effort delivery: a missed predictive alert is worse
          // than no alert, but a runaway loop is worse still.
          this.logger.error(
            `[OPS-ALERT] predictive-rise processSignal failed for ${job.data.signalSource}/` +
              `${job.data.signalType}: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      },
      { connection: workerConnection },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      // BullMQ emits 'failed' per-attempt. Reaching this handler at all
      // means the processor itself threw before its own try/catch (e.g.
      // DI failure) — log once on terminal attempt, warn on retries.
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      if (attemptsMade >= maxAttempts) {
        this.logger.error(
          `[OPS-ALERT] predictive-rise job ${job?.id ?? '?'} failed terminally after ${attemptsMade} attempts: ${err.message}`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `predictive-rise job ${job?.id ?? '?'} attempt ${attemptsMade}/${maxAttempts} failed: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'PredictiveRiseAlertWorker initialised — consuming price-rise-signals queue',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redisForBlocking?.quit().catch(() => undefined);
  }
}
