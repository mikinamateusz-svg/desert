import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OdometerReading, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOdometerDto } from './dto/create-odometer.dto.js';

// 30 minutes — same window used in mobile capture timing intuition. A
// reading captured within this window of a matching-vehicle fill-up is
// auto-linked. Wider would risk attaching unrelated readings; narrower
// would miss the common "log fill-up, walk to car, take odo photo" flow.
const AUTO_LINK_WINDOW_MS = 30 * 60 * 1000;

// Grace allowed on user-supplied `recordedAt` vs server clock — covers
// minor mobile/server clock skew without letting a caller backdate a
// reading into the future to corrupt the segment baseline.
const RECORDED_AT_FUTURE_GRACE_MS = 5 * 60 * 1000;

export interface CreateReadingResult {
  reading: OdometerReading;
  consumption: ConsumptionResult | null;
}

/**
 * Returned only when there IS a previous reading (i.e. not the baseline).
 * Baseline reads return `consumption: null` on `CreateReadingResult` and
 * skip this object entirely. So `kmDelta` is always populated here; the
 * consumption / litres pair is null only when no fill-ups fell in the
 * segment between the two readings (AC5).
 */
export interface ConsumptionResult {
  /** Null when no fill-ups in segment. */
  consumptionL100km: number | null;
  kmDelta: number;
  /** Null when no fill-ups in segment. */
  litresInSegment: number | null;
}

export interface ListReadingsResult {
  data: OdometerReading[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Per-driver odometer CRUD + consumption calculation (Story 5.4).
 *
 * Two save paths:
 *   1. Explicit fill-up link — caller passes `fillupId` from the fill-up
 *      celebration flow. The reading attaches to that record and the
 *      FillUp.odometer_km column updates to the reading's km.
 *   2. Auto-link — caller omits fillupId. Service searches for a fill-up
 *      within AUTO_LINK_WINDOW_MS of recorded_at for the same vehicle
 *      that doesn't already have a linked reading; attaches if found.
 *      Standalone-capture flow uses this path.
 *
 * Consumption math (AC4):
 *   l/100km = (sum of litres from FillUps between two consecutive
 *             OdometerReadings for the vehicle) / kmDelta * 100
 *   The result is stored on the most recent FillUp in the segment. First
 *   reading per vehicle is a baseline — no calculation, no result returned.
 *
 * Validation (AC6): km must be strictly greater than the previous reading
 * for the same vehicle. Throws 422 with `code: 'NEGATIVE_DELTA'` so the
 * mobile client can surface the targeted error message.
 */
@Injectable()
export class OdometerService {
  private readonly logger = new Logger(OdometerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createReading(userId: string, dto: CreateOdometerDto): Promise<CreateReadingResult> {
    // Vehicle ownership check — same convention as FillupService: 404 when
    // the resource doesn't exist, 403 when it belongs to a different user.
    // 403 over 404-everywhere because the caller explicitly named the
    // resource (no existence-leak concern here).
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { id: true, user_id: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.user_id !== userId) {
      throw new ForbiddenException('Vehicle does not belong to the authenticated user');
    }

    // Find the most recent prior reading for the vehicle. Used twice below:
    //   - validation (AC6: new km must be > previous km)
    //   - consumption baseline check (AC3: first reading skips calc)
    const prevReading = await this.prisma.odometerReading.findFirst({
      where: { vehicle_id: dto.vehicleId },
      orderBy: { recorded_at: 'desc' },
      select: { id: true, km: true, recorded_at: true },
    });

    // AC6: zero or negative delta. Throw 422 with a structured code so the
    // mobile client can render the previousKm-aware error string instead
    // of the generic "save failed".
    if (prevReading && dto.km <= prevReading.km) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'NEGATIVE_DELTA',
        message: 'Odometer reading must be greater than the previous reading.',
        previousKm: prevReading.km,
      });
    }

    // OCR-artifact heuristic — log only, do not block. All-same-digit
    // readings of 5+ characters (111111, 222222, etc.) are a classic
    // OCR failure mode where the model averages over a blurred display.
    // Don't block the user (the value passed validation), but flag for
    // post-hoc review if support tickets pile up.
    const digits = String(dto.km).split('');
    if (digits.length >= 5 && digits.every((d) => d === digits[0])) {
      this.logger.warn(
        `[OdometerService] Possible OCR artifact: all-same-digit reading ${dto.km} for vehicle ${dto.vehicleId}`,
      );
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    // Bound caller-supplied `recordedAt`. The DTO only validates ISO format,
    // so without these checks a client could backdate a reading below the
    // previous one (scrambling the consumption baseline) or future-date it
    // (the auto-link window slides into a region where no fill-ups exist
    // and consumption math divides by an inflated kmDelta on the next save).
    const futureCeiling = Date.now() + RECORDED_AT_FUTURE_GRACE_MS;
    if (recordedAt.getTime() > futureCeiling) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'INVALID_RECORDED_AT',
        message: 'recordedAt cannot be in the future.',
      });
    }
    if (prevReading && recordedAt.getTime() <= prevReading.recorded_at.getTime()) {
      // The km validation alone (above) only enforces ordering by km, not
      // by time. A reading dated before the previous one would slot into
      // the wrong place in `orderBy: recorded_at desc` and corrupt all
      // future consumption queries. Reject explicitly.
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'INVALID_RECORDED_AT',
        message: 'recordedAt must be after the previous reading.',
      });
    }

    // Save the reading first. Auto-link runs after so we have a
    // reading.id to point fillup_id at. If no fillup_id is resolved
    // (neither explicit nor auto-link), reading stands alone.
    const reading = await this.prisma.odometerReading.create({
      data: {
        user_id: userId,
        vehicle_id: dto.vehicleId,
        km: dto.km,
        recorded_at: recordedAt,
        // fillup_id assigned in the link step below to keep the create
        // simple and so an auto-link FK collision (extremely unlikely
        // given uniqueness of fill-up id) doesn't fail the reading save.
      },
    });

    // Resolve the fill-up to link to (AC7).
    let linkedFillupId: string | null = null;
    if (dto.fillupId) {
      // Explicit link — verify the fill-up belongs to this user + vehicle
      // before attaching, so a malicious caller can't link their reading
      // to someone else's fill-up.
      const fillup = await this.prisma.fillUp.findUnique({
        where: { id: dto.fillupId },
        select: { id: true, user_id: true, vehicle_id: true, odometerReading: { select: { id: true } } },
      });
      if (!fillup) {
        // Caller passed a fillupId that doesn't resolve. Could be a stale
        // mobile cache or a deleted fill-up. Logged so the case is visible
        // in telemetry — silent fall-through to stand-alone save would
        // mask a client-side bug indefinitely.
        this.logger.warn(
          `[OdometerService] Explicit fillupId=${dto.fillupId} not found — saving stand-alone.`,
        );
      } else if (fillup.user_id !== userId || fillup.vehicle_id !== dto.vehicleId) {
        // Caller passed a fillupId that resolves to someone else's fill-up
        // OR to a different vehicle of the same user. Either way the link
        // is structurally inconsistent — log + drop. We don't throw because
        // the reading itself is still a valid record; refusing the whole
        // save over a bad link would be over-strict.
        this.logger.warn(
          `[OdometerService] Explicit fillupId=${dto.fillupId} does not match user=${userId} vehicle=${dto.vehicleId} — saving stand-alone.`,
        );
      } else if (fillup.odometerReading) {
        // Already linked — possible cause: double-tap on the celebration
        // "Save reading" button. The reading itself is still valid
        // stand-alone.
        this.logger.warn(
          `[OdometerService] FillUp ${dto.fillupId} already has a linked reading — saving stand-alone.`,
        );
      } else {
        linkedFillupId = fillup.id;
      }
    } else {
      // Auto-link — search for an unlinked fill-up within ±AUTO_LINK_WINDOW.
      // Symmetric so the standalone-capture flow catches the common pattern
      // of "take odometer photo at the pump → walk to register → log fill-up
      // a minute later" where the fill-up's filled_at is *after* the
      // reading's recordedAt. A one-sided lookback would miss it.
      const earliest = new Date(recordedAt.getTime() - AUTO_LINK_WINDOW_MS);
      const latest = new Date(recordedAt.getTime() + AUTO_LINK_WINDOW_MS);
      const recentFillup = await this.prisma.fillUp.findFirst({
        where: {
          vehicle_id: dto.vehicleId,
          user_id: userId,
          filled_at: { gte: earliest, lte: latest },
          odometerReading: null,
        },
        // Prefer the fill-up closest in time. Postgres can't sort by absolute
        // delta natively without a raw expression, so we order by descending
        // filled_at and let the LIMIT 1 pick the most recent — same heuristic
        // as before. Good enough since the window is only 30 minutes.
        orderBy: { filled_at: 'desc' },
        select: { id: true },
      });
      linkedFillupId = recentFillup?.id ?? null;
    }

    // Apply the link in a transaction so the reading.fillup_id and the
    // FillUp.odometer_km updates either both succeed or both fail together
    // — no half-linked state where the reading points at a fill-up but
    // the fill-up still shows the old odometer_km.
    //
    // Concurrency: two readings created back-to-back can both pass the
    // `odometerReading: null` check above (TOCTOU) and both attempt to set
    // OdometerReading.fillup_id = X here. The unique index on fillup_id
    // makes the second one throw P2002. We swallow the unique violation
    // and let the reading stand alone — the first writer wins the link.
    if (linkedFillupId) {
      try {
        await this.prisma.$transaction([
          this.prisma.odometerReading.update({
            where: { id: reading.id },
            data: { fillup_id: linkedFillupId },
          }),
          this.prisma.fillUp.update({
            where: { id: linkedFillupId },
            data: { odometer_km: dto.km },
          }),
        ]);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.warn(
            `[OdometerService] FillUp ${linkedFillupId} link lost a race with a concurrent reading — saving stand-alone.`,
          );
          linkedFillupId = null;
        } else {
          throw err;
        }
      }
    }

    // Compute consumption only if there was a previous reading (AC3).
    // Returns the populated result OR null when baseline / no fill-ups.
    const consumption = prevReading
      ? await this.calculateConsumption(dto.vehicleId, reading.id, prevReading)
      : null;

    // Re-fetch the reading so the caller sees the post-link state
    // (fillup_id reflected). Cheap — same row by primary key.
    const updatedReading = await this.prisma.odometerReading.findUniqueOrThrow({
      where: { id: reading.id },
    });

    return { reading: updatedReading, consumption };
  }

  /**
   * Compute l/100km for the segment between `prevReading` and the just-
   * saved reading, write it to the most recent FillUp in the segment,
   * return the result.
   *
   * Caller has already validated that prevReading exists (AC3 baseline
   * is handled at the call site by passing null instead of invoking this).
   * km_delta is guaranteed > 0 by createReading's NEGATIVE_DELTA check.
   *
   * Returns null when no FillUps lie within the segment (AC5) — the
   * segment is recorded by the reading itself, but there's no consumption
   * value to compute or store.
   */
  private async calculateConsumption(
    vehicleId: string,
    newReadingId: string,
    prevReading: { km: number; recorded_at: Date },
  ): Promise<ConsumptionResult | null> {
    const newReading = await this.prisma.odometerReading.findUniqueOrThrow({
      where: { id: newReadingId },
      select: { km: true, recorded_at: true },
    });

    const kmDelta = newReading.km - prevReading.km;
    // kmDelta > 0 guaranteed by createReading validation; defensive check
    // covers the impossible case where this method is invoked from a
    // future caller that bypasses validation.
    if (kmDelta <= 0) return null;

    const fillUps = await this.prisma.fillUp.findMany({
      where: {
        vehicle_id: vehicleId,
        // gt prev / lte new: a fill-up at the exact moment of the previous
        // reading belongs to the prior segment; one at the moment of the
        // new reading belongs to this segment. Half-open interval matches
        // the spec.
        filled_at: { gt: prevReading.recorded_at, lte: newReading.recorded_at },
      },
      orderBy: { filled_at: 'desc' },
      select: { id: true, litres: true },
    });

    if (fillUps.length === 0) {
      // AC5: distance is retained (the reading itself records it) but
      // no consumption is computed.
      return { consumptionL100km: null, kmDelta, litresInSegment: null };
    }

    const sumLitres = fillUps.reduce((acc, f) => acc + f.litres, 0);
    // Round to 1dp — driver-facing display precision. Grosz-integer style
    // not needed because the result is per-100km not per-grosz; 1dp tail
    // FP drift is below display threshold.
    const consumption = Math.round((sumLitres / kmDelta) * 100 * 10) / 10;

    // Store on the most recent fill-up in the segment. Future history
    // queries can surface the consumption as the "rate at which this
    // tank was burned through" annotation on the latest pump record.
    const latestFillupId = fillUps[0]!.id;
    await this.prisma.fillUp.update({
      where: { id: latestFillupId },
      data: { consumption_l_per_100km: consumption },
    });

    return { consumptionL100km: consumption, kmDelta, litresInSegment: sumLitres };
  }

  /**
   * Paginated history, newest first. Optional `vehicleId` filter scoped
   * to the caller (cross-user vehicles silently return zero rows because
   * the user_id filter is the outer predicate).
   */
  async listReadings(
    userId: string,
    vehicleId: string | undefined,
    page: number,
    limit: number,
  ): Promise<ListReadingsResult> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const skip = (safePage - 1) * safeLimit;

    const where = vehicleId
      ? { user_id: userId, vehicle_id: vehicleId }
      : { user_id: userId };

    const [data, total] = await Promise.all([
      this.prisma.odometerReading.findMany({
        where,
        orderBy: { recorded_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.odometerReading.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }
}
