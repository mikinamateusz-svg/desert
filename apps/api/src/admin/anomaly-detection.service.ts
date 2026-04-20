import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface ExtractedPrice {
  fuel_type: string;
  price_per_litre: number | null;
}

@Injectable()
export class AnomalyDetectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnomalyDetectionService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env['DISABLE_ANOMALY_DETECTION'] === 'true') {
      this.logger.log('AnomalyDetectionService skipped (DISABLE_ANOMALY_DETECTION=true)');
      return;
    }

    // 60-min cadence lets Neon's free-tier compute autosuspend for long stretches between ticks.
    // Both checks scan a 60-min window to avoid gaps at this cadence.
    this.intervalHandle = setInterval(() => {
      this.runChecks().catch((e: Error) =>
        this.logger.error(`AnomalyDetectionService runChecks error: ${e.message}`),
      );
    }, 60 * 60_000);

    this.runDetection().catch((e: unknown) =>
      this.logger.error(`Anomaly detection startup run failed: ${e instanceof Error ? e.message : String(e)}`)
    );

    this.logger.log('AnomalyDetectionService started (runs every 60 minutes)');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runChecks(): Promise<void> {
    await Promise.all([
      this.checkHighFrequency(),
      this.checkPriceVariance(),
      this.checkStationSpread(),
    ]);
  }

  private async runDetection(): Promise<void> {
    await this.runChecks();
  }

  // Rule 1: >20 submissions in any 60-minute window
  private async checkHighFrequency(): Promise<void> {
    try {
      const since = new Date(Date.now() - 60 * 60_000);
      const rows = await this.prisma.$queryRaw<Array<{ user_id: string; cnt: bigint }>>`
        SELECT user_id, COUNT(*) AS cnt
        FROM "Submission"
        WHERE created_at >= ${since}
          AND status != 'shadow_rejected'
        GROUP BY user_id
        HAVING COUNT(*) > 20
      `;
      for (const row of rows) {
        await this.upsertAlert(row.user_id, 'high_frequency', {
          count: Number(row.cnt),
          window_minutes: 60,
        });
      }
    } catch (e: unknown) {
      this.logger.error(
        `checkHighFrequency error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Rule 2: 3+ submissions for same user+station+fuel_type in 60min with prices varying >15%
  private async checkPriceVariance(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 60 * 60_000);
      const rows = await this.prisma.$queryRaw<Array<{
        user_id: string;
        station_id: string;
        fuel_type: string;
        min_price: number;
        max_price: number;
        count: bigint;
      }>>`
        SELECT user_id, station_id,
               (price_entry->>'fuel_type') as fuel_type,
               MIN((price_entry->>'price_per_litre')::float) as min_price,
               MAX((price_entry->>'price_per_litre')::float) as max_price,
               COUNT(DISTINCT id) as count
        FROM "Submission",
             jsonb_array_elements(price_data) as price_entry
        WHERE created_at >= ${cutoff}
          AND station_id IS NOT NULL
          AND status != 'shadow_rejected'
        GROUP BY user_id, station_id, (price_entry->>'fuel_type')
        HAVING COUNT(DISTINCT id) >= 3
          AND MAX((price_entry->>'price_per_litre')::float) > MIN((price_entry->>'price_per_litre')::float) * 1.15
      `;

      for (const row of rows) {
        const variance = (row.max_price - row.min_price) / row.min_price;
        await this.upsertAlert(row.user_id, 'price_variance', {
          station_id: row.station_id,
          fuel_type: row.fuel_type,
          min_price: row.min_price,
          max_price: row.max_price,
          variance_pct: Math.round(variance * 100),
          window_minutes: 60,
        });
      }
    } catch (e: unknown) {
      this.logger.error(
        `checkPriceVariance error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Rule 3: same price for 5+ stations in 60min
  private async checkStationSpread(): Promise<void> {
    try {
      const since = new Date(Date.now() - 60 * 60_000);
      const rows = await this.prisma.submission.findMany({
        where: {
          created_at: { gte: since },
          station_id: { not: null },
          status: { not: 'shadow_rejected' },
        },
        select: { user_id: true, station_id: true, price_data: true },
      });

      // Group by user_id — track unique (station, price) pairs
      const userMap = new Map<
        string,
        Map<string, Set<string>> // stationId → Set of price strings
      >();

      for (const row of rows) {
        if (!row.station_id) continue;
        if (!userMap.has(row.user_id)) userMap.set(row.user_id, new Map());
        const stationMap = userMap.get(row.user_id)!;

        const priceData = row.price_data as unknown as ExtractedPrice[];
        if (Array.isArray(priceData)) {
          for (const p of priceData) {
            if (typeof p.price_per_litre === 'number') {
              const priceKey = `${p.fuel_type}:${p.price_per_litre.toFixed(2)}`;
              if (!stationMap.has(row.station_id)) stationMap.set(row.station_id, new Set());
              stationMap.get(row.station_id)!.add(priceKey);
            }
          }
        }
      }

      for (const [userId, stationMap] of userMap.entries()) {
        // Count how many stations share the exact same price per fuel type
        const priceToStations = new Map<string, Set<string>>();
        for (const [stationId, priceKeys] of stationMap.entries()) {
          for (const priceKey of priceKeys) {
            if (!priceToStations.has(priceKey)) priceToStations.set(priceKey, new Set());
            priceToStations.get(priceKey)!.add(stationId);
          }
        }

        for (const [priceKey, stations] of priceToStations.entries()) {
          if (stations.size >= 5) {
            await this.upsertAlert(userId, 'station_spread', {
              price_key: priceKey,
              station_count: stations.size,
              window_minutes: 60,
            });
          }
        }
      }
    } catch (e: unknown) {
      this.logger.error(
        `checkStationSpread error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async upsertAlert(userId: string, alertType: string, detail: object): Promise<void> {
    try {
      // Only create if no undismissed alert of the same type already exists for this user
      const recent = await this.prisma.anomalyAlert.findFirst({
        where: {
          user_id: userId,
          alert_type: alertType,
          dismissed_at: null,
        },
      });
      if (!recent) {
        await this.prisma.anomalyAlert.create({
          data: { user_id: userId, alert_type: alertType, detail },
        });
        this.logger.warn(
          `AnomalyAlert created: user=${userId} type=${alertType} detail=${JSON.stringify(detail)}`,
        );
      }
    } catch (e: unknown) {
      this.logger.error(
        `upsertAlert error for user=${userId} type=${alertType}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
