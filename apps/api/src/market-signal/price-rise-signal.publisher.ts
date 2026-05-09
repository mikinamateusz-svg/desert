import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  PRICE_RISE_SIGNALS_QUEUE,
  PRICE_RISE_SIGNAL_JOB,
  SIGNAL_FUEL_TYPES,
  type MovementRecord,
  type PriceRiseSignalJobData,
} from './types.js';

// Explicit signal-type → signalSource map. Replaces a fragile
// `startsWith('orlen_rack')` derivation that would silently mis-tag any
// future non-orlen / non-brent signal as 'brent_crude_pln'. Any new
// signal type added to the SignalType enum MUST also be added here or
// publish will skip it.
const SIGNAL_SOURCE: Record<string, PriceRiseSignalJobData['signalSource']> = {
  orlen_rack_pb95: 'orlen_rack',
  orlen_rack_on: 'orlen_rack',
  orlen_rack_lpg: 'orlen_rack',
  brent_crude_pln: 'brent_crude_pln',
};

const RISE_THRESHOLD_PCT = 0.03; // 3% upward

const JOB_OPTIONS = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 20 },
} as const;

/**
 * Story 6.0 — owns the `price-rise-signals` BullMQ queue. Called by
 * OrlenIngestionWorker after both ORLEN rack + Brent crude ingestions
 * complete; filters the combined movement list to upward moves ≥3% and
 * publishes one job per qualifying signal type. Story 6.3's
 * PredictiveRiseAlertWorker consumes the queue.
 *
 * Owns its own Queue lifecycle (raw BullMQ pattern matching the rest of
 * the codebase) — no NestJS Bull integration. Boot-race guard on enqueue
 * mirrors the price-drop / community-rise workers.
 */
@Injectable()
export class PriceRiseSignalPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceRiseSignalPublisher.name);
  private queue!: Queue;
  private redisForQueue!: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;

    this.queue = new Queue(PRICE_RISE_SIGNALS_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    this.logger.log('PriceRiseSignalPublisher initialised — owns price-rise-signals queue');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.redisForQueue?.quit().catch(() => undefined);
  }

  /**
   * Filters movements to upward moves ≥3% and enqueues one
   * price-rise-signal job per qualifying signal. Best-effort: per-job
   * enqueue failures are logged + swallowed (a missed signal means a
   * missed predictive alert chance, not a worker crash).
   *
   * @returns count of jobs successfully published
   */
  async maybePublish(movements: MovementRecord[]): Promise<number> {
    if (!this.queue) {
      this.logger.warn('Queue not yet initialised — dropping rise-signal batch');
      return 0;
    }
    const rising = movements.filter(
      (m) => m.pctChange !== null && m.pctChange >= RISE_THRESHOLD_PCT,
    );
    if (rising.length === 0) return 0;

    let published = 0;
    for (const m of rising) {
      const fuelTypes = SIGNAL_FUEL_TYPES[m.signalType] ?? [];
      const signalSource = SIGNAL_SOURCE[m.signalType];
      if (fuelTypes.length === 0 || !signalSource) {
        this.logger.warn(
          `No fuel-type / source mapping for signal ${m.signalType} — skipping publish`,
        );
        continue;
      }
      // pctChange is filtered to non-null above; the cast just keeps TS
      // honest after the closure boundary.
      const pctMovement = m.pctChange as number;
      const data: PriceRiseSignalJobData = {
        signalSource,
        fuelTypes,
        pctMovement,
        signalType: m.signalType,
        recordedAt: m.recordedAt.toISOString(),
      };
      try {
        await this.queue.add(PRICE_RISE_SIGNAL_JOB, data);
        published += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue price-rise-signal for ${m.signalType}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return published;
  }

  /** Exposed for ops + integration tests. */
  getQueue(): Queue {
    return this.queue;
  }
}
