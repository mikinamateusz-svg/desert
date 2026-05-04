import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ExtractedPrice } from '../ocr/ocr.service.js';
import { PriceValidationRuleEvaluator } from './price-validation-rule.evaluator.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidatedPrice extends ExtractedPrice {
  tier: 1 | 3; // Tier 2 (regional benchmark) deferred to Story 5.0
}

export interface InvalidPrice extends ExtractedPrice {
  reason: string;
}

export interface PriceValidationOutput {
  valid: ValidatedPrice[];
  invalid: InvalidPrice[];
  /**
   * Framework outcomes, independent of valid/invalid bucketing above.
   * Populated even when rule fires a flag/log_only (which doesn't move the
   * price to invalid). Pipeline worker uses this to decide whether the whole
   * submission gets shadow_rejected even when per-fuel validation passed.
   */
  rule_overall?: 'reject' | 'shadow_reject' | 'flag' | 'log_only' | 'passed';
  rule_reason_code?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Tier 3 absolute fallback bands (PLN/litre).
 * Source: Epic 3.7 AC3. These are market-calibrated bounds used when no
 * recent price history exists for a station × fuel-type pair.
 *
 * Story 3.5's PRICE_BANDS (in ocr.service.ts) are a broader pre-filter used
 * during OCR to catch hallucinated values; these Tier 3 bands are the
 * authoritative validation ranges for the pipeline.
 */
export const ABSOLUTE_BANDS: Record<string, { min: number; max: number }> = {
  PB_95: { min: 4.0, max: 12.0 },
  PB_98: { min: 4.5, max: 13.0 },
  ON: { min: 4.0, max: 12.0 },
  ON_PREMIUM: { min: 4.5, max: 13.0 },
  LPG: { min: 1.5, max: 5.0 },
  AdBlue: { min: 3.0, max: 15.0 },
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PriceValidationService {
  private readonly logger = new Logger(PriceValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEvaluator: PriceValidationRuleEvaluator,
  ) {}

  /**
   * Validates extracted prices against a 3-tier hierarchy:
   *   Tier 1: ±20% of last known price (last 30 days) for that station × fuel_type
   *   Tier 2: regional voivodeship average — DEFERRED to Story 5.0; skipped here
   *   Tier 3: absolute fallback range (ABSOLUTE_BANDS)
   *
   * Then runs the configurable PriceValidationRule framework on top (see
   * planning-artifacts/price-validation-framework.md). Rules can further
   * demote per-fuel prices to invalid, or flag the whole submission via
   * rule_overall for shadow-rejection even when per-fuel validation passed.
   *
   * Deduplicates fuel types before validation — first occurrence wins.
   */
  async validatePrices(
    stationId: string,
    prices: ExtractedPrice[],
  ): Promise<PriceValidationOutput> {
    const deduplicated = this.deduplicate(prices);

    if (deduplicated.length === 0) {
      return { valid: [], invalid: [] };
    }

    const fuelTypes = deduplicated.map(p => p.fuel_type);
    const recentPrices = await this.fetchRecentPrices(stationId, fuelTypes);

    const valid: ValidatedPrice[] = [];
    const invalid: InvalidPrice[] = [];

    for (const price of deduplicated) {
      const recent = recentPrices.get(price.fuel_type);

      if (recent !== undefined) {
        // Tier 1: ±20% of the last known price
        const min = recent * 0.8;
        const max = recent * 1.2;
        if (price.price_per_litre >= min && price.price_per_litre <= max) {
          valid.push({ ...price, tier: 1 });
        } else {
          invalid.push({
            ...price,
            reason: `tier1_out_of_band: ${min.toFixed(2)}–${max.toFixed(2)}`,
          });
        }
      } else {
        // Tier 3: absolute fallback (Tier 2 skipped until Story 5.0)
        const band = ABSOLUTE_BANDS[price.fuel_type];
        if (band && price.price_per_litre >= band.min && price.price_per_litre <= band.max) {
          valid.push({ ...price, tier: 3 });
        } else {
          invalid.push({
            ...price,
            reason: band
              ? `tier3_out_of_range: ${band.min}–${band.max}`
              : 'tier3_unknown_fuel_type',
          });
        }
      }
    }

    // Run the configurable rule framework on prices that survived Tier 1/3.
    // Rules fail-open (no rules / no references → passed), so this step is
    // a strict tightening. Fail-soft on evaluator errors: a broken evaluator
    // must not block submissions.
    const evaluatorInput = valid.map(p => ({ fuel_type: p.fuel_type, price_per_litre: p.price_per_litre }));
    let ruleResult;
    try {
      ruleResult = await this.ruleEvaluator.evaluate(evaluatorInput);
    } catch (err) {
      this.logger.error(
        `Rule evaluator threw — treating as no rules fired: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { valid, invalid };
    }

    // Action handling:
    //   shadow_reject — escalate the WHOLE submission (don't silently drop
    //     fuels). Worker routes to shadow_rejected so admins can review the
    //     OCR output and verify against the photo. The intent of
    //     shadow_reject is "looks suspicious, needs human eyes" — silently
    //     dropping a fuel hides exactly the problem the rule was meant to
    //     surface (and used to make valid prices vanish from the map).
    //   reject — demote that fuel to invalid; the rest of the submission
    //     still ships if other prices pass.
    const firstShadowReject = ruleResult.perFuel
      .flatMap(o => o.rulesFired)
      .find(r => r.action === 'shadow_reject');

    if (firstShadowReject) {
      for (const v of valid) {
        invalid.push({
          fuel_type: v.fuel_type,
          price_per_litre: v.price_per_litre,
          reason: `rule_${firstShadowReject.reason_code}`,
        });
      }
      return {
        valid: [],
        invalid,
        rule_overall: 'shadow_reject',
        rule_reason_code: firstShadowReject.reason_code,
      };
    }

    // No shadow_reject rules fired — apply per-fuel reject demotion.
    const stillValid: ValidatedPrice[] = [];
    for (const v of valid) {
      const outcome = ruleResult.perFuel.find(o => o.fuel_type === v.fuel_type);
      const rejectRule = outcome?.rulesFired.find(r => r.action === 'reject');
      if (rejectRule) {
        invalid.push({
          fuel_type: v.fuel_type,
          price_per_litre: v.price_per_litre,
          reason: `rule_${rejectRule.reason_code}`,
        });
      } else {
        stillValid.push(v);
      }
    }

    const firstReject = ruleResult.perFuel
      .flatMap(o => o.rulesFired)
      .find(r => r.action === 'reject');

    return {
      valid: stillValid,
      invalid,
      rule_overall: ruleResult.overall,
      rule_reason_code: firstReject?.reason_code,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Fetches the most recent price per fuel type within the last 30 days
   * for the given station. Uses DISTINCT ON for efficiency.
   */
  private async fetchRecentPrices(
    stationId: string,
    fuelTypes: string[],
  ): Promise<Map<string, number>> {
    if (fuelTypes.length === 0) return new Map();

    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const rows = await this.prisma.$queryRaw<{ fuel_type: string; price: number }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (fuel_type) fuel_type, price
        FROM "PriceHistory"
        WHERE station_id = ${stationId}
          AND fuel_type IN (${Prisma.join(fuelTypes)})
          AND recorded_at >= ${since}
        ORDER BY fuel_type, recorded_at DESC
      `,
    );

    return new Map(rows.map(r => [r.fuel_type, r.price]));
  }

  /** Deduplicates by fuel_type — first occurrence wins. */
  private deduplicate(prices: ExtractedPrice[]): ExtractedPrice[] {
    const seen = new Set<string>();
    return prices.filter(p => {
      if (seen.has(p.fuel_type)) return false;
      seen.add(p.fuel_type);
      return true;
    });
  }
}
