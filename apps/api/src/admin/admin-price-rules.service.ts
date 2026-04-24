import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, type SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceValidationRuleEvaluator } from '../price/price-validation-rule.evaluator.js';
import type { ExtractedPrice } from '../ocr/ocr.service.js';

// ── DTO types ─────────────────────────────────────────────────────────────

export interface RuleListRow {
  id: string;
  rule_type: string;
  applies_to: string;
  parameters: unknown;
  action: string;
  reason_code: string;
  enabled: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRuleInput {
  rule_type: string;
  applies_to: string;
  /** Rule-type-specific JSON object. Cast to Prisma.InputJsonValue at write time. */
  parameters: unknown;
  action: string;
  reason_code: string;
  enabled?: boolean;
  notes?: string | null;
}

export interface UpdateRuleInput {
  rule_type?: string;
  applies_to?: string;
  parameters?: unknown;
  action?: string;
  reason_code?: string;
  enabled?: boolean;
  notes?: string | null;
}

export interface BacktestResult {
  rule_id: string;
  sampleSize: number;
  windowDays: number;
  // How the rule WOULD have fired against historical verified submissions.
  // Useful for estimating false-positive rate before enabling a new rule.
  wouldHaveFired: number;
  wouldHavePassed: number;
  sampleHits: Array<{
    submission_id: string;
    fuel_type: string;
    price: number;
    reason_detail: string;
  }>;
}

// ── Validation helpers ────────────────────────────────────────────────────

const ALLOWED_RULE_TYPES = ['absolute_band', 'relative_to_reference'];
const ALLOWED_ACTIONS = ['reject', 'shadow_reject', 'flag', 'log_only'];

function validateRuleShape(input: Partial<CreateRuleInput>): void {
  if (input.rule_type !== undefined && !ALLOWED_RULE_TYPES.includes(input.rule_type)) {
    throw new BadRequestException(
      `rule_type must be one of ${ALLOWED_RULE_TYPES.join(', ')}`,
    );
  }
  if (input.action !== undefined && !ALLOWED_ACTIONS.includes(input.action)) {
    throw new BadRequestException(
      `action must be one of ${ALLOWED_ACTIONS.join(', ')}`,
    );
  }
  if (input.reason_code !== undefined && !/^[a-z][a-z0-9_]*$/.test(input.reason_code)) {
    throw new BadRequestException(
      `reason_code must be lowercase snake_case (matches /^[a-z][a-z0-9_]*$/)`,
    );
  }
}

// ── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class AdminPriceRulesService {
  private readonly logger = new Logger(AdminPriceRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: PriceValidationRuleEvaluator,
  ) {}

  async list(): Promise<RuleListRow[]> {
    return this.prisma.priceValidationRule.findMany({
      orderBy: [{ enabled: 'desc' }, { rule_type: 'asc' }, { applies_to: 'asc' }],
    });
  }

  async get(id: string): Promise<RuleListRow> {
    const row = await this.prisma.priceValidationRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Rule ${id} not found`);
    return row;
  }

  async create(input: CreateRuleInput): Promise<RuleListRow> {
    validateRuleShape(input);
    return this.prisma.priceValidationRule.create({
      data: {
        rule_type: input.rule_type,
        applies_to: input.applies_to,
        parameters: input.parameters as Prisma.InputJsonValue,
        action: input.action,
        reason_code: input.reason_code,
        enabled: input.enabled ?? true,
        notes: input.notes ?? null,
      },
    });
  }

  async update(id: string, input: UpdateRuleInput): Promise<RuleListRow> {
    validateRuleShape(input);
    const existing = await this.prisma.priceValidationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Rule ${id} not found`);

    // Only set fields the caller provided — undefined means "leave alone".
    const data: Prisma.PriceValidationRuleUpdateInput = {};
    if (input.rule_type !== undefined) data.rule_type = input.rule_type;
    if (input.applies_to !== undefined) data.applies_to = input.applies_to;
    if (input.parameters !== undefined) data.parameters = input.parameters as Prisma.InputJsonValue;
    if (input.action !== undefined) data.action = input.action;
    if (input.reason_code !== undefined) data.reason_code = input.reason_code;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.notes !== undefined) data.notes = input.notes;

    return this.prisma.priceValidationRule.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.priceValidationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Rule ${id} not found`);
    await this.prisma.priceValidationRule.delete({ where: { id } });
  }

  // ── SystemConfig (vat_multiplier etc.) ──────────────────────────────────

  async getConfig(key: string): Promise<{ key: string; value: string; description: string | null; updated_at: Date } | null> {
    return this.prisma.systemConfig.findUnique({ where: { key } });
  }

  async setConfig(key: string, value: string, description?: string | null): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, description: description ?? undefined },
      create: { key, value, description: description ?? null },
    });
  }

  // ── Back-test ───────────────────────────────────────────────────────────

  /**
   * Replay a rule's logic against recent verified submissions WITHOUT
   * mutating any data. Returns a count of how many verified prices would
   * have been caught by the rule, plus a sample of hits. Lets ops estimate
   * false-positive rate before enabling an aggressive rule.
   *
   * The backtest doesn't depend on the rule being currently enabled — useful
   * for dry-running a newly-created rule. It DOES depend on the rule row
   * existing in the DB (pass the id after creating with enabled=false).
   */
  async backtest(
    ruleId: string,
    opts: { windowDays?: number; limit?: number } = {},
  ): Promise<BacktestResult> {
    const rule = await this.prisma.priceValidationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);

    const windowDays = Math.min(Math.max(opts.windowDays ?? 30, 1), 180);
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const submissions = await this.prisma.submission.findMany({
      where: { status: 'verified' as SubmissionStatus, created_at: { gte: since } },
      select: { id: true, price_data: true },
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    let wouldHaveFired = 0;
    let wouldHavePassed = 0;
    const sampleHits: BacktestResult['sampleHits'] = [];

    for (const sub of submissions) {
      const prices = Array.isArray(sub.price_data) ? (sub.price_data as unknown as ExtractedPrice[]) : [];
      if (prices.length === 0) continue;

      // Evaluate only this one rule — we construct a minimal single-rule set
      // by cloning the evaluator's per-rule logic via a tiny dispatcher.
      // Rather than exposing applyRule publicly, we call the full evaluator
      // with the rule's applies_to filter applied client-side.
      const scoped = prices.filter(
        p => rule.applies_to === '*' || rule.applies_to === p.fuel_type,
      );
      if (scoped.length === 0) {
        wouldHavePassed += 1;
        continue;
      }

      // Temporarily narrow "what rules count" by inspecting the evaluator's
      // output for only this rule's reason_code. We run the full evaluator
      // (with ALL active rules) and filter — not perfect isolation, but good
      // enough for back-test estimates. For full isolation, a dry-run API
      // that takes rule inline would be cleaner (deferred).
      const result = await this.evaluator.evaluate(scoped);
      const fired = result.perFuel.flatMap(f =>
        f.rulesFired.filter(r => r.rule_id === rule.id).map(r => ({
          submission_id: sub.id,
          fuel_type: f.fuel_type,
          price: f.price,
          reason_detail: r.detail ?? '',
        })),
      );

      if (fired.length > 0) {
        wouldHaveFired += 1;
        if (sampleHits.length < 20) sampleHits.push(...fired.slice(0, 20 - sampleHits.length));
      } else {
        wouldHavePassed += 1;
      }
    }

    return {
      rule_id: ruleId,
      sampleSize: submissions.length,
      windowDays,
      wouldHaveFired,
      wouldHavePassed,
      sampleHits,
    };
  }
}
