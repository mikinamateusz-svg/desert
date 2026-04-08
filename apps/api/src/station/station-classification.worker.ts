import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationClassificationService } from './station-classification.service.js';

export const STATION_CLASSIFICATION_QUEUE = 'station-classification';
export const STATION_CLASSIFICATION_JOB = 'classify-stations';
export const STATION_LOCAL_RECLASSIFY_JOB = 'local-reclassify-stations';

// 1,100ms between Nearby Search calls = ~54 req/min (safely under 60 req/min limit)
const NEARBY_SEARCH_DELAY_MS = 1_100;
const BATCH_SIZE = 50;

interface StationRow {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

@Injectable()
export class StationClassificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StationClassificationWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly classificationService: StationClassificationService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(STATION_CLASSIFICATION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    });

    this.worker = new Worker(
      STATION_CLASSIFICATION_QUEUE,
      async (job: Job) => {
        if (job.name === STATION_LOCAL_RECLASSIFY_JOB) {
          await this.processLocalReclassification();
        } else {
          await this.processClassification();
        }
      },
      { connection: workerConnection },
    );

    this.worker.on('completed', () =>
      this.logger.log('Station classification job completed'),
    );
    this.worker.on('failed', (_job: Job | undefined, err: Error) =>
      this.logger.error('Station classification job failed', err.stack),
    );

    this.logger.log('StationClassificationWorker initialised');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
  }

  /** Exposed for enqueueing from StationSyncWorker after sync completes */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Re-derives brand, station_type, and is_border_zone_de for all already-classified
   * stations using only locally available data — no Google API calls.
   * voivodeship and settlement_tier are left untouched.
   */
  async processLocalReclassification(): Promise<void> {
    const BATCH = 500;
    let offset = 0;
    let total = 0;
    let updated = 0;

    interface ClassifiedRow extends StationRow {
      current_brand: string | null;
      current_station_type: string | null;
      current_is_border_zone_de: boolean;
    }

    while (true) {
      const rows = await this.prisma.$queryRaw<ClassifiedRow[]>`
        SELECT id, name, address,
          brand                            AS current_brand,
          station_type::text               AS current_station_type,
          is_border_zone_de                AS current_is_border_zone_de,
          CAST(ST_Y(location::geometry) AS FLOAT) AS lat,
          CAST(ST_X(location::geometry) AS FLOAT) AS lng
        FROM "Station"
        WHERE classification_version >= 1
          AND location IS NOT NULL
        ORDER BY id
        LIMIT ${BATCH} OFFSET ${offset}
      `;

      if (rows.length === 0) break;

      for (const row of rows) {
        const local = this.classificationService.reclassifyLocal(row);

        if (
          local.brand !== row.current_brand ||
          local.station_type !== row.current_station_type ||
          local.is_border_zone_de !== row.current_is_border_zone_de
        ) {
          await this.prisma.$executeRaw`
            UPDATE "Station" SET
              brand             = ${local.brand},
              station_type      = ${local.station_type}::"StationType",
              is_border_zone_de = ${local.is_border_zone_de},
              updated_at        = NOW()
            WHERE id = ${row.id}
          `;
          updated++;
        }
        total++;
      }

      offset += BATCH;
    }

    this.logger.log(`Local reclassification complete: ${updated}/${total} stations updated`);
  }

  async processClassification(): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('GOOGLE_PLACES_API_KEY');
    let processed = 0;

    while (true) {
      // No OFFSET — as stations are classified (version 0→1) they drop out of
      // the WHERE clause, so the next query always starts from the new front.
      // Using OFFSET while mutating the filtered set causes stations to be skipped.
      const stations = await this.prisma.$queryRaw<StationRow[]>`
        SELECT id, name, address,
          CAST(ST_Y(location::geometry) AS FLOAT) AS lat,
          CAST(ST_X(location::geometry) AS FLOAT) AS lng
        FROM "Station"
        WHERE classification_version = 0
          AND location IS NOT NULL
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (stations.length === 0) break;

      for (const station of stations) {
        try {
          const c = await this.classificationService.classifyStation(station, apiKey);
          await this.prisma.$executeRaw`
            UPDATE "Station" SET
              brand                  = ${c.brand},
              station_type           = ${c.station_type}::"StationType",
              voivodeship            = ${c.voivodeship},
              settlement_tier        = ${c.settlement_tier}::"SettlementTier",
              is_border_zone_de      = ${c.is_border_zone_de},
              classification_version = classification_version + 1,
              updated_at             = NOW()
            WHERE id = ${station.id}
          `;
          processed++;
        } catch (err) {
          const msg = (err as Error).message;
          // REQUEST_DENIED means the API key is disabled or invalid — no point
          // continuing through thousands of stations. Abort the whole run so
          // BullMQ retries after backoff rather than spamming per-station WARNs.
          if (msg.includes('REQUEST_DENIED')) {
            throw new Error(`Google Places API disabled (REQUEST_DENIED) — aborting classification run`);
          }
          this.logger.warn(`Classification failed for station ${station.id}: ${msg}`);
          // Continue — one transient failure must not block remaining stations
        }

        // Rate-limiting delay between Nearby Search calls
        await new Promise((r) => setTimeout(r, NEARBY_SEARCH_DELAY_MS));
      }
    }

    this.logger.log(`Classification complete: ${processed} stations classified`);
  }
}
