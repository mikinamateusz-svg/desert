import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ExtractedPrice } from '../ocr/ocr.service.js';

// ── Rule types and outcomes ────────────────────────────────────────────────

export type RuleAction = 'reject' | 'shadow_reject' | 'flag' | 'log_only';

export interface FiredRule {
  rule_id: string;
  reason_code: string;
  action: RuleAction;
  detail?: string;
}

export interface PerFuelOutcome {
  fuel_type: string;
  price: number;
  passed: boolean; // false if any rule with action in ('reject','shadow_reject') fired
  rulesFired: FiredRule[];
}

/** Worst action across all fuels, ordered: reject > shadow_reject > flag > log_only > passed. */
export type OverallOutcome = 'reject' | 'shadow_reject' | 'flag' | 'log_only' | 'passed';

export interface EvaluationResult {
  perFuel: PerFuelOutcome[];
  overall: OverallOutcome;
  /** Convenience: all `flag` / `log_only` fires, for telemetry. */
  softFlags: FiredRule[];
}

// ── Rule parameter shapes (type-specific) ──────────────────────────────────

interface AbsoluteBandParams {
  min: number;
  max: number;
}

interface CrossFuelOrderingParams {
  reference_fuel: string; // the fuel that must be cheaper (e.g. PB_95, ON)
  min_delta: number;      // this fuel must be >= reference + min_delta (use 0.0 for strict ≥)
}

interface RelativeToReferenceParams {
  source: string;
  value_type: string;
  vat_multiplier?: number; // if omitted, read from SystemConfig
  margin_min: number;
  margin_max: number;
  max_age_hours: number;
}

// ── Internal types ─────────────────────────────────────────────────────────

interface RuleRow {
  id: string;
  rule_type: string;
  applies_to: string;
  parameters: unknown;
  action: RuleAction;
  reason_code: string;
}

interface ReferenceRow {
  source: string;
  fuel_type: string;
  value_type: string;
  value: number;
  as_of: Date;
}

const ACTION_PRIORITY: Record<RuleAction | 'passed', number> = {
  reject: 4,
  shadow_reject: 3,
  flag: 2,
  log_only: 1,
  passed: 0,
};

const HARD_FAIL_ACTIONS: readonly RuleAction[] = ['reject', 'shadow_reject'];

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * PriceValidationRuleEvaluator — configurable, data-driven validation layer.
 * Evaluates the rules stored in PriceValidationRule against a submission's
 * prices, using reference data from PriceReferencePoint and runtime config
 * from SystemConfig. See planning-artifacts/price-validation-framework.md.
 *
 * Non-goals for v1:
 *  - Cross-fuel rules (promo-pricing noise — deferred).
 *  - Realignment of OCR output (experimental — Phase 2).
 *
 * Fail-open on any rule-evaluation error: evaluator must never block the
 * pipeline. Any internal exception logs and the rule is treated as if it
 * didn't fire.
 */
@Injectable()
export class PriceValidationRuleEvaluator {
  private readonly logger = new Logger(PriceValidationRuleEvaluator.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(prices: ExtractedPrice[]): Promise<EvaluationResult> {
    if (prices.length === 0) {
      return { perFuel: [], overall: 'passed', softFlags: [] };
    }

    const [rules, vatMultiplier] = await Promise.all([
      this.loadActiveRules(),
      this.loadVatMultiplier(),
    ]);

    if (rules.length === 0) {
      return {
        perFuel: prices.map(p => ({
          fuel_type: p.fuel_type,
          price: p.price_per_litre,
          passed: true,
          rulesFired: [],
        })),
        overall: 'passed',
        softFlags: [],
      };
    }

    const references = await this.loadRecentReferences();

    const perFuel: PerFuelOutcome[] = prices.map(p => {
      const fired: FiredRule[] = [];
      for (const rule of rules) {
        if (rule.applies_to !== '*' && rule.applies_to !== p.fuel_type) continue;
        const outcome = this.applyRule(rule, p, references, vatMultiplier, prices);
        if (outcome) fired.push(outcome);
      }
      const passed = !fired.some(f => HARD_FAIL_ACTIONS.includes(f.action));
      return { fuel_type: p.fuel_type, price: p.price_per_litre, passed, rulesFired: fired };
    });

    const softFlags = perFuel.flatMap(f =>
      f.rulesFired.filter(r => r.action === 'flag' || r.action === 'log_only'),
    );

    const overall = this.worstAction(perFuel);

    return { perFuel, overall, softFlags };
  }

  // ── Rule-type dispatch ────────────────────────────────────────────────────

  private applyRule(
    rule: RuleRow,
    price: ExtractedPrice,
    references: Map<string, ReferenceRow>,
    vatMultiplier: number,
    allPrices: ExtractedPrice[],
  ): FiredRule | null {
    try {
      switch (rule.rule_type) {
        case 'absolute_band':
          return this.applyAbsoluteBand(rule, price);
        case 'relative_to_reference':
          return this.applyRelativeToReference(rule, price, references, vatMultiplier);
        case 'cross_fuel_ordering':
          return this.applyCrossFuelOrdering(rule, price, allPrices);
        default:
          // Unknown rule_type — log once and skip. Could be a future type
          // loaded from a newer schema than this code version.
          this.logger.warn(`Unknown rule_type '${rule.rule_type}' on rule ${rule.id} — skipping`);
          return null;
      }
    } catch (err) {
      // Fail-open: a broken rule must never block valid submissions.
      this.logger.error(
        `Rule ${rule.id} (${rule.rule_type}) threw during evaluation — treating as didn't fire: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private applyAbsoluteBand(rule: RuleRow, price: ExtractedPrice): FiredRule | null {
    const params = rule.parameters as AbsoluteBandParams | null;
    if (!params || typeof params.min !== 'number' || typeof params.max !== 'number') {
      this.logger.warn(`Rule ${rule.id}: malformed absolute_band parameters — skipping`);
      return null;
    }
    const value = price.price_per_litre;
    if (value >= params.min && value <= params.max) return null;
    return {
      rule_id: rule.id,
      reason_code: rule.reason_code,
      action: rule.action,
      detail: `${value.toFixed(2)} outside [${params.min}, ${params.max}]`,
    };
  }

  private applyRelativeToReference(
    rule: RuleRow,
    price: ExtractedPrice,
    references: Map<string, ReferenceRow>,
    vatMultiplier: number,
  ): FiredRule | null {
    const params = rule.parameters as RelativeToReferenceParams | null;
    if (
      !params ||
      typeof params.source !== 'string' ||
      typeof params.value_type !== 'string' ||
      typeof params.margin_min !== 'number' ||
      typeof params.margin_max !== 'number' ||
      typeof params.max_age_hours !== 'number'
    ) {
      this.logger.warn(`Rule ${rule.id}: malformed relative_to_reference parameters — skipping`);
      return null;
    }

    const key = referenceKey(params.source, price.fuel_type, params.value_type);
    const ref = references.get(key);
    if (!ref) return null; // No reference available — skip silently.

    const ageHours = (Date.now() - ref.as_of.getTime()) / 3_600_000;
    if (ageHours > params.max_age_hours) {
      this.logger.log(
        `Rule ${rule.id}: reference ${key} is ${ageHours.toFixed(1)}h old (> ${params.max_age_hours}h) — skipping`,
      );
      return null;
    }

    const vat = params.vat_multiplier ?? vatMultiplier;
    const center = ref.value * vat;
    const min = center + params.margin_min;
    const max = center + params.margin_max;

    const value = price.price_per_litre;
    if (value >= min && value <= max) return null;

    return {
      rule_id: rule.id,
      reason_code: rule.reason_code,
      action: rule.action,
      detail:
        `${value.toFixed(2)} outside [${min.toFixed(2)}, ${max.toFixed(2)}] ` +
        `(ref ${params.source}.${params.value_type}=${ref.value.toFixed(2)} × VAT ${vat})`,
    };
  }

  private applyCrossFuelOrdering(
    rule: RuleRow,
    price: ExtractedPrice,
    allPrices: ExtractedPrice[],
  ): FiredRule | null {
    const params = rule.parameters as CrossFuelOrderingParams | null;
    if (!params || typeof params.reference_fuel !== 'string' || typeof params.min_delta !== 'number') {
      this.logger.warn(`Rule ${rule.id}: malformed cross_fuel_ordering parameters — skipping`);
      return null;
    }
    const ref = allPrices.find(p => p.fuel_type === params.reference_fuel);
    if (!ref) return null; // reference fuel not in this submission — skip silently
    const threshold = ref.price_per_litre + params.min_delta;
    if (price.price_per_litre >= threshold) return null;
    return {
      rule_id: rule.id,
      reason_code: rule.reason_code,
      action: rule.action,
      detail:
        `${price.fuel_type}=${price.price_per_litre.toFixed(2)} < ` +
        `${params.reference_fuel}=${ref.price_per_litre.toFixed(2)} + delta=${params.min_delta}`,
    };
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  private async loadActiveRules(): Promise<RuleRow[]> {
    const rows = await this.prisma.priceValidationRule.findMany({
      where: { enabled: true },
      select: {
        id: true,
        rule_type: true,
        applies_to: true,
        parameters: true,
        action: true,
        reason_code: true,
      },
    });
    return rows.map(r => ({
      id: r.id,
      rule_type: r.rule_type,
      applies_to: r.applies_to,
      parameters: r.parameters,
      action: r.action as RuleAction,
      reason_code: r.reason_code,
    }));
  }

  /**
   * Load the single most recent reference row per (source, fuel_type,
   * value_type). Narrow but cheap — one query, one DISTINCT ON.
   */
  private async loadRecentReferences(): Promise<Map<string, ReferenceRow>> {
    const rows = await this.prisma.$queryRawUnsafe<ReferenceRow[]>(`
      SELECT DISTINCT ON (source, fuel_type, value_type)
        source, fuel_type, value_type, value, as_of
      FROM "PriceReferencePoint"
      ORDER BY source, fuel_type, value_type, as_of DESC
    `);
    const map = new Map<string, ReferenceRow>();
    for (const r of rows) {
      map.set(referenceKey(r.source, r.fuel_type, r.value_type), r);
    }
    return map;
  }

  private async loadVatMultiplier(): Promise<number> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: 'vat_multiplier' },
      select: { value: true },
    });
    if (!row) return 1.23; // Fallback: Polish standard VAT.
    const parsed = Number.parseFloat(row.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(`SystemConfig.vat_multiplier is malformed ('${row.value}') — using default 1.23`);
      return 1.23;
    }
    return parsed;
  }

  private worstAction(perFuel: PerFuelOutcome[]): OverallOutcome {
    let worst: OverallOutcome = 'passed';
    for (const f of perFuel) {
      for (const r of f.rulesFired) {
        if (ACTION_PRIORITY[r.action] > ACTION_PRIORITY[worst]) {
          worst = r.action;
        }
      }
    }
    return worst;
  }
}

function referenceKey(source: string, fuelType: string, valueType: string): string {
  return `${source}::${fuelType}::${valueType}`;
}
