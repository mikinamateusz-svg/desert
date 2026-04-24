import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PriceValidationRuleEvaluator } from './price-validation-rule.evaluator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrisma = {
  priceValidationRule: { findMany: jest.fn() },
  systemConfig: { findUnique: jest.fn() },
  $queryRawUnsafe: jest.fn(),
};

async function buildEvaluator(): Promise<PriceValidationRuleEvaluator> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PriceValidationRuleEvaluator,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  return module.get<PriceValidationRuleEvaluator>(PriceValidationRuleEvaluator);
}

describe('PriceValidationRuleEvaluator', () => {
  let svc: PriceValidationRuleEvaluator;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Default mocks — no rules, no references, default VAT.
    mockPrisma.priceValidationRule.findMany.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: '1.23' });

    svc = await buildEvaluator();
  });

  describe('no rules configured', () => {
    it('returns passed for any input when no rules exist', async () => {
      const result = await svc.evaluate([
        { fuel_type: 'PB_95', price_per_litre: 6.29 },
        { fuel_type: 'ON', price_per_litre: 7.59 },
      ]);
      expect(result.overall).toBe('passed');
      expect(result.perFuel.every(f => f.passed)).toBe(true);
      expect(result.perFuel.every(f => f.rulesFired.length === 0)).toBe(true);
    });

    it('returns an empty result for an empty price list', async () => {
      const result = await svc.evaluate([]);
      expect(result.overall).toBe('passed');
      expect(result.perFuel).toEqual([]);
    });
  });

  describe('absolute_band rules', () => {
    beforeEach(() => {
      mockPrisma.priceValidationRule.findMany.mockResolvedValue([
        {
          id: 'rule-abs-pb95',
          rule_type: 'absolute_band',
          applies_to: 'PB_95',
          parameters: { min: 3.5, max: 10 },
          action: 'reject',
          reason_code: 'pb95_absolute_band',
        },
      ]);
    });

    it('passes a value inside the band', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.29 }]);
      expect(result.overall).toBe('passed');
      expect(result.perFuel[0].passed).toBe(true);
    });

    it('fires reject when value exceeds max', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 62.9 }]);
      expect(result.overall).toBe('reject');
      expect(result.perFuel[0].passed).toBe(false);
      expect(result.perFuel[0].rulesFired[0]).toMatchObject({
        reason_code: 'pb95_absolute_band',
        action: 'reject',
      });
    });

    it('fires reject when value is below min', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 1.29 }]);
      expect(result.overall).toBe('reject');
      expect(result.perFuel[0].passed).toBe(false);
    });

    it('ignores rule when applies_to is a different fuel', async () => {
      const result = await svc.evaluate([{ fuel_type: 'ON', price_per_litre: 62.9 }]);
      expect(result.overall).toBe('passed');
    });

    it('skips a rule with malformed parameters (fail-open)', async () => {
      mockPrisma.priceValidationRule.findMany.mockResolvedValueOnce([
        {
          id: 'bad-rule',
          rule_type: 'absolute_band',
          applies_to: 'PB_95',
          parameters: { max: 10 }, // missing min
          action: 'reject',
          reason_code: 'broken',
        },
      ]);
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.29 }]);
      expect(result.overall).toBe('passed');
    });
  });

  describe('relative_to_reference rules', () => {
    const rule = {
      id: 'rule-rel-pb95',
      rule_type: 'relative_to_reference',
      applies_to: 'PB_95',
      parameters: {
        source: 'orlen_rack',
        value_type: 'rack_net',
        margin_min: 0.15,
        margin_max: 0.8,
        max_age_hours: 72,
      },
      action: 'shadow_reject',
      reason_code: 'pb95_outside_rack_band',
    };

    beforeEach(() => {
      mockPrisma.priceValidationRule.findMany.mockResolvedValue([rule]);
      // rack_net 5.28 × VAT 1.23 = 6.49 center; band 6.64–7.29
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { source: 'orlen_rack', fuel_type: 'PB_95', value_type: 'rack_net', value: 5.28, as_of: new Date() },
      ]);
    });

    it('passes a value inside the band (rack × VAT + margin)', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.79 }]);
      expect(result.overall).toBe('passed');
    });

    it('fires shadow_reject when value is below band (too cheap for market)', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 5.89 }]);
      expect(result.overall).toBe('shadow_reject');
      expect(result.perFuel[0].rulesFired[0].reason_code).toBe('pb95_outside_rack_band');
    });

    it('fires shadow_reject when value is above band', async () => {
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 8.29 }]);
      expect(result.overall).toBe('shadow_reject');
    });

    it('skips silently when no reference exists for this source/fuel/value_type', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);
      // Would normally fail the band check but no reference → rule skipped → pass
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 8.29 }]);
      expect(result.overall).toBe('passed');
    });

    it('skips when reference is older than max_age_hours', async () => {
      const stale = new Date(Date.now() - 96 * 3_600_000); // 96h old, max 72h
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { source: 'orlen_rack', fuel_type: 'PB_95', value_type: 'rack_net', value: 5.28, as_of: stale },
      ]);
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 8.29 }]);
      expect(result.overall).toBe('passed');
    });

    it('honours an explicit vat_multiplier on the rule (overrides SystemConfig)', async () => {
      const ruleWithExplicitVat = {
        ...rule,
        parameters: { ...rule.parameters, vat_multiplier: 1.08 },
      };
      mockPrisma.priceValidationRule.findMany.mockResolvedValueOnce([ruleWithExplicitVat]);
      // rack 5.28 × 1.08 = 5.70 center; band 5.85–6.50
      // 6.79 now falls OUTSIDE (it was inside with VAT 1.23)
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.79 }]);
      expect(result.overall).toBe('shadow_reject');
    });

    it('uses SystemConfig.vat_multiplier when rule omits it', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ value: '1.08' });
      // With config VAT 1.08: band is 5.85–6.50, so 6.79 should be rejected.
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.79 }]);
      expect(result.overall).toBe('shadow_reject');
    });

    it('falls back to VAT 1.23 when SystemConfig is missing or malformed', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      // With default VAT 1.23: band 6.64–7.29, 6.79 passes.
      const result = await svc.evaluate([{ fuel_type: 'PB_95', price_per_litre: 6.79 }]);
      expect(result.overall).toBe('passed');
    });
  });

  describe('overall action precedence', () => {
    beforeEach(() => {
      mockPrisma.priceValidationRule.findMany.mockResolvedValue([
        {
          id: 'r-abs',
          rule_type: 'absolute_band',
          applies_to: 'PB_95',
          parameters: { min: 3.5, max: 10 },
          action: 'reject',
          reason_code: 'pb95_abs',
        },
        {
          id: 'r-flag',
          rule_type: 'absolute_band',
          applies_to: 'ON',
          parameters: { min: 3.5, max: 10 },
          action: 'flag',
          reason_code: 'on_abs',
        },
      ]);
    });

    it('reject on one fuel dominates flag on another', async () => {
      const result = await svc.evaluate([
        { fuel_type: 'PB_95', price_per_litre: 62.9 }, // reject
        { fuel_type: 'ON', price_per_litre: 50.0 }, // flag (not reject, different action)
      ]);
      expect(result.overall).toBe('reject');
    });

    it('flag alone does not mark a fuel as failed', async () => {
      const result = await svc.evaluate([{ fuel_type: 'ON', price_per_litre: 50.0 }]);
      expect(result.perFuel[0].passed).toBe(true);
      expect(result.perFuel[0].rulesFired[0].action).toBe('flag');
      expect(result.overall).toBe('flag');
      expect(result.softFlags).toHaveLength(1);
    });
  });
});
