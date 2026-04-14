import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService } from '../price/price-cache.service.js';

export interface StationRow {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
  hidden: boolean;
}

export interface StationListResult {
  data: StationRow[];
  total: number;
  page: number;
  limit: number;
}

export interface StationPriceRow {
  fuel_type: string;
  price: number;
  source: string;
  recorded_at: Date;
}

export interface StationDetail extends StationRow {
  prices: StationPriceRow[];
}

const AUDIT_ACTION_PRICE_OVERRIDE = 'PRICE_OVERRIDE';
const AUDIT_ACTION_CACHE_REFRESH = 'CACHE_REFRESH';

const KNOWN_FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

@Injectable()
export class AdminStationsService {
  private readonly logger = new Logger(AdminStationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceCache: PriceCacheService,
  ) {}

  async searchStations(query: string, page: number, limit: number): Promise<StationListResult> {
    const safeQuery = query.slice(0, 200);
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const skip = (safePage - 1) * safeLimit;

    const where = safeQuery
      ? {
          OR: [
            { name: { contains: safeQuery, mode: 'insensitive' as const } },
            { address: { contains: safeQuery, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.station.findMany({
        where,
        select: { id: true, name: true, address: true, brand: true, hidden: true },
        skip,
        take: safeLimit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.station.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }

  async getStationDetail(stationId: string): Promise<StationDetail> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true, address: true, brand: true, hidden: true },
    });

    if (!station) {
      throw new NotFoundException(`Station ${stationId} not found`);
    }

    // Get the most recent PriceHistory record per fuel type
    const priceRows = await this.prisma.$queryRaw<StationPriceRow[]>`
      SELECT DISTINCT ON (fuel_type)
        fuel_type,
        price,
        source,
        recorded_at
      FROM "PriceHistory"
      WHERE station_id = ${stationId}
      ORDER BY fuel_type, recorded_at DESC
    `;

    return {
      ...station,
      prices: priceRows,
    };
  }

  async overridePrice(
    stationId: string,
    fuelType: string,
    price: number,
    reason: string,
    adminId: string,
  ): Promise<void> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true },
    });
    if (!station) {
      throw new NotFoundException(`Station ${stationId} not found`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction([
      this.prisma.priceHistory.create({
        data: {
          station_id: stationId,
          fuel_type: fuelType,
          price,
          source: 'admin_override' as any, // added by migration 20260405000003; Prisma client regenerated on next prisma generate
          recorded_at: new Date(),
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminId,
          action: AUDIT_ACTION_PRICE_OVERRIDE,
          submission_id: null,
          notes: JSON.stringify({ stationId, fuelType, price, reason }),
        },
      }),
    ]);

    try {
      await this.priceCache.invalidate(stationId);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for station ${stationId} after price override`, err);
    }
  }

  async refreshCache(stationId: string, adminId: string): Promise<void> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true },
    });
    if (!station) {
      throw new NotFoundException(`Station ${stationId} not found`);
    }

    try {
      await this.priceCache.invalidate(stationId);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for station ${stationId} during refresh`, err);
    }

    await this.writeAuditLog(
      adminId,
      AUDIT_ACTION_CACHE_REFRESH,
      null,
      JSON.stringify({ stationId }),
    );
  }

  private async writeAuditLog(
    adminUserId: string,
    action: string,
    submissionId: string | null,
    notes: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminUserId,
          action,
          submission_id: submissionId,
          notes,
        },
      });
    } catch (e: unknown) {
      this.logger.error(
        `[OPS-ALERT] Failed to write audit log for ${action} by admin ${adminUserId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async hideStation(stationId: string): Promise<{ status: string; stationId: string; name: string }> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true },
    });
    if (!station) throw new NotFoundException(`Station ${stationId} not found`);

    await this.prisma.station.update({
      where: { id: stationId },
      data: { hidden: true },
    });

    this.logger.log(`Station hidden: ${station.name} (${stationId})`);
    return { status: 'hidden', stationId, name: station.name };
  }

  async unhideStation(stationId: string): Promise<{ status: string; stationId: string; name: string }> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true },
    });
    if (!station) throw new NotFoundException(`Station ${stationId} not found`);

    await this.prisma.station.update({
      where: { id: stationId },
      data: { hidden: false },
    });

    this.logger.log(`Station unhidden: ${station.name} (${stationId})`);
    return { status: 'visible', stationId, name: station.name };
  }

  async findHidden(): Promise<StationRow[]> {
    return this.prisma.station.findMany({
      where: { hidden: true },
      select: { id: true, name: true, address: true, brand: true, hidden: true },
      orderBy: { updated_at: 'desc' },
    });
  }

  /** Exported only for tests */
  get knownFuelTypes(): string[] {
    return KNOWN_FUEL_TYPES;
  }
}
