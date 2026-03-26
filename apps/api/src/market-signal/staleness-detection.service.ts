import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Maps ORLEN rack signal types to app fuel type strings */
export const SIGNAL_TO_FUEL_TYPE: Readonly<Record<string, string>> = {
  orlen_rack_pb95: 'PB_95',
  orlen_rack_on: 'ON',
  orlen_rack_lpg: 'LPG',
};

const STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class StalenessDetectionService {
  private readonly logger = new Logger(StalenessDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads MarketSignal records with significant_movement: true in the last 24h,
   * maps each to its fuel type, then flags all (station × fuel_type) combinations
   * that have no recent verified submission as stale.
   *
   * Idempotent: existing stale flags are left untouched via createMany skipDuplicates.
   * Silent data operation — never sends push notifications (AC5).
   */
  async detectStaleness(): Promise<void> {
    const cutoff = new Date(Date.now() - STALENESS_WINDOW_MS);

    // AC7: DB error reading signals propagates — no stale writes proceed
    const signals = await this.prisma.marketSignal.findMany({
      where: { significant_movement: true, recorded_at: { gte: cutoff } },
      select: { signal_type: true },
    });

    if (signals.length === 0) {
      this.logger.log('No significant market movements in last 24h — nothing to flag');
      return;
    }

    // Collect unique fuel types from affected signals
    const fuelTypes = [
      ...new Set(
        signals
          .map((s) => SIGNAL_TO_FUEL_TYPE[s.signal_type as string])
          .filter((ft): ft is string => !!ft),
      ),
    ];

    if (fuelTypes.length === 0) {
      this.logger.log('No known fuel type mappings for affected signals — nothing to flag');
      return;
    }

    // For each fuel type: find stations with no recent verified submission, then flag them
    for (const fuelType of fuelTypes) {
      await this.flagStaleStationsForFuelType(fuelType, cutoff);
    }
  }

  private async flagStaleStationsForFuelType(
    fuelType: string,
    cutoff: Date,
  ): Promise<void> {
    // Find all stations that have NO verified submission for this fuel type in the last 24h.
    // Submission.price_data is a JSON array: [{ fuel_type: string; price_per_litre: number }]
    // AC8: if this query throws, the error propagates (no partial writes)
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "Station" s
      WHERE NOT EXISTS (
        SELECT 1 FROM "Submission" sub
        WHERE sub.station_id = s.id
          AND sub.status = 'verified'
          AND sub.created_at > ${cutoff}
          AND sub.price_data::jsonb @> ${JSON.stringify([{ fuel_type: fuelType }])}::jsonb
      )
    `;

    if (rows.length === 0) {
      this.logger.log(`All stations have recent ${fuelType} submissions — nothing to flag`);
      return;
    }

    // Idempotent batch write — AC1 (skipDuplicates leaves existing flags untouched)
    // AC8: if createMany throws, the error propagates
    const result = await this.prisma.stationFuelStaleness.createMany({
      data: rows.map((r) => ({
        station_id: r.id,
        fuel_type: fuelType,
        reason: 'orlen_movement',
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Flagged ${result.count} (station × fuel_type) combinations as stale for ${fuelType}`,
    );
  }

  /**
   * Clears the stale flag for a specific (station × fuel_type) pair.
   * Called by the price submission verification flow (Epic 3).
   * Silent no-op if record does not exist (AC2).
   */
  async clearStaleFlag(stationId: string, fuelType: string): Promise<void> {
    await this.prisma.stationFuelStaleness.deleteMany({
      where: { station_id: stationId, fuel_type: fuelType },
    });
  }

  /**
   * Returns all currently stale fuel types for a station.
   * Used by future story (2.9/3.x) to include stale status in API responses.
   */
  async getStaleFuelTypes(stationId: string): Promise<string[]> {
    const records = await this.prisma.stationFuelStaleness.findMany({
      where: { station_id: stationId },
      select: { fuel_type: true },
    });
    return records.map((r) => r.fuel_type);
  }
}
