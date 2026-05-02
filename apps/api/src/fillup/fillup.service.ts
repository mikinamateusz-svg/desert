import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FillUp } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationService } from '../station/station.service.js';
import { RegionalBenchmarkService } from '../regional-benchmark/regional-benchmark.service.js';
import { PRICE_BANDS } from '../ocr/ocr.service.js';
import { CreateFillupDto } from './dto/create-fillup.dto.js';

export interface CreateFillupResult {
  fillUp: FillUp;
  stationMatched: boolean;
  /** Display name for the celebration screen — null when no station matched. */
  stationName: string | null;
  /** True only when we wrote a community PriceHistory entry. */
  communityUpdated: boolean;
}

export interface ListFillupsResult {
  data: FillUp[];
  total: number;
  page: number;
  limit: number;
}

const STATION_MATCH_RADIUS_METRES = 200;

/**
 * Per-driver fill-up CRUD.
 *
 * Fill-ups are pre-confirmed by the driver — the OCR-extracted (or
 * manually-entered) values are reviewed on a confirmation screen before
 * createFillup is called. This means we can:
 *   - Bypass the photo pipeline (no BullMQ, no logo match, no trust score)
 *   - Write directly to PriceHistory when GPS matches a station
 *   - Clear the StationFuelStaleness flag for that station × fuel
 *   - Lock the vehicle so its identity (make/model/year/fuel/displacement)
 *     can no longer change — preserves history consistency
 *
 * GPS coordinates are passed in for station matching and then NOT stored on
 * the FillUp row (privacy — same convention as Submission).
 */
@Injectable()
export class FillupService {
  private readonly logger = new Logger(FillupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stations: StationService,
    private readonly benchmarks: RegionalBenchmarkService,
  ) {}

  async createFillup(userId: string, dto: CreateFillupDto): Promise<CreateFillupResult> {
    // Vehicle ownership check — refuse to log a fill-up against a vehicle that
    // doesn't belong to the caller. Cross-user reads / writes are treated as
    // 403 here (rather than the 404 used in vehicles.service.ts) because the
    // payload explicitly references the resource: a 403 surfaces "you don't
    // own this" more clearly than 404, and there's no existence-leak concern
    // (the caller is also providing GPS / cost data — they know the vehicle
    // exists in some sense).
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { id: true, user_id: true, is_locked: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.user_id !== userId) {
      throw new ForbiddenException('Vehicle does not belong to the authenticated user');
    }

    // P-3: shadow-ban check. The community PriceHistory write below is the
    // exact thing the photo pipeline gates on trust score / shadow ban. A
    // shadow-banned user submitting via the fill-up path would otherwise
    // pollute community price data unfiltered — explicitly skip the
    // community write for them. The fill-up itself still saves (driver's
    // own history is theirs to keep regardless of trust state).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { shadow_banned: true },
    });
    const isShadowBanned = user?.shadow_banned === true;

    // GPS station match — only when both coordinates were supplied. Either
    // missing means we save the fill-up without a station link (AC8).
    const gpsAvailable = dto.gpsLat !== undefined && dto.gpsLng !== undefined;
    const matched = gpsAvailable
      ? await this.stations.findNearestStation(dto.gpsLat!, dto.gpsLng!, STATION_MATCH_RADIUS_METRES)
      : null;
    const stationId = matched?.id ?? null;

    // RegionalBenchmark snapshot — only when station matched (otherwise we
    // don't know the voivodeship and can't pick a benchmark). null is a
    // first-class value here; downstream savings calc (Story 5.3) treats it
    // as "no comparable area data" rather than substituting a synthetic.
    const benchmark = stationId
      ? await this.benchmarks.getLatestForStation(stationId, dto.fuelType)
      : null;

    const filledAt = dto.filledAt ? new Date(dto.filledAt) : new Date();

    const fillUp = await this.prisma.fillUp.create({
      data: {
        user_id: userId,
        vehicle_id: dto.vehicleId,
        station_id: stationId,
        fuel_type: dto.fuelType,
        litres: dto.litres,
        total_cost_pln: dto.totalCostPln,
        price_per_litre_pln: dto.pricePerLitrePln,
        area_avg_at_fillup: benchmark?.medianPrice ?? null,
        odometer_km: dto.odometerKm ?? null,
        filled_at: filledAt,
      },
    });

    // P-4: price-plausibility check. The community PriceHistory write
    // depends on driver-supplied price; without a band check, a typo'd
    // 1.00 PLN/L value would clear the staleness flag with garbage data
    // and skew the community map. Reuse the OCR-side `PRICE_BANDS` table
    // so the two contribution paths apply the same plausibility window.
    // Out-of-band → save the fill-up, skip the community side-effects.
    const band = PRICE_BANDS[dto.fuelType];
    const priceWithinBand =
      !!band &&
      dto.pricePerLitrePln >= band.min &&
      dto.pricePerLitrePln <= band.max;

    // Eligibility gates collapsed: station matched + user not shadow-banned +
    // price plausible. All three must hold to write the community price.
    const eligibleForCommunityWrite = !!stationId && !isShadowBanned && priceWithinBand;

    if (stationId && !eligibleForCommunityWrite) {
      this.logger.log(
        `FillUp ${fillUp.id} matched station ${stationId} but skipped community write — ` +
        `${isShadowBanned ? 'user shadow-banned' : ''}` +
        `${!priceWithinBand ? `${isShadowBanned ? '; ' : ''}price ${dto.pricePerLitrePln} out of band for ${dto.fuelType}` : ''}`,
      );
    }

    // Side-effects only when eligible. Failures here are logged but not
    // re-thrown — the FillUp itself is the primary resource and a failed
    // staleness clear or PriceHistory write shouldn't 500 the user.
    let communityUpdated = false;
    if (eligibleForCommunityWrite) {
      try {
        await this.prisma.priceHistory.create({
          data: {
            station_id: stationId,
            fuel_type: dto.fuelType,
            price: dto.pricePerLitrePln,
            source: 'community',
            recorded_at: filledAt,
          },
        });
        communityUpdated = true;
      } catch (e) {
        this.logger.warn(
          `PriceHistory write failed for fill-up ${fillUp.id} → station ${stationId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      try {
        // Clear staleness flag for this fuel: the driver just confirmed a
        // current price by physically refuelling. Mirrors the same write
        // the price-board pipeline does on a verified submission.
        await this.prisma.stationFuelStaleness.deleteMany({
          where: { station_id: stationId, fuel_type: dto.fuelType },
        });
      } catch (e) {
        this.logger.warn(
          `Staleness clear failed for fill-up ${fillUp.id} → station ${stationId}/${dto.fuelType}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Lock the vehicle identity if not already locked. updateMany with
    // `is_locked: false` predicate is atomic — concurrent fill-ups race-
    // safely no-op when the vehicle is already locked.
    if (!vehicle.is_locked) {
      await this.prisma.vehicle.updateMany({
        where: { id: vehicle.id, is_locked: false },
        data: { is_locked: true },
      });
    }

    return {
      fillUp,
      stationMatched: stationId !== null,
      stationName: matched?.name ?? null,
      communityUpdated,
    };
  }

  /**
   * Paginated history, newest first. Optional `vehicleId` filter scoped to
   * the caller (cross-user vehicles silently return zero rows because the
   * user_id filter is the outer predicate).
   */
  async listFillups(
    userId: string,
    vehicleId: string | undefined,
    page: number,
    limit: number,
  ): Promise<ListFillupsResult> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const skip = (safePage - 1) * safeLimit;

    const where = vehicleId
      ? { user_id: userId, vehicle_id: vehicleId }
      : { user_id: userId };

    const [data, total] = await Promise.all([
      this.prisma.fillUp.findMany({
        where,
        orderBy: { filled_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.fillUp.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }
}
