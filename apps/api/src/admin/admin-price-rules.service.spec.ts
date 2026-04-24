import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminPriceRulesService } from './admin-price-rules.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceValidationRuleEvaluator } from '../price/price-validation-rule.evaluator.js';

const mockRule = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockSystemConfig = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
};
const mockSubmission = { findMany: jest.fn() };

const mockPrisma = {
  priceValidationRule: mockRule,
  systemConfig: mockSystemConfig,
  submission: mockSubmission,
};

const mockEvaluator = { evaluate: jest.fn() };

const validInput = {
  rule_type: 'absolute_band',
  applies_to: 'PB_95',
  parameters: { min: 3.5, max: 10 },
  action: 'reject',
  reason_code: 'pb95_absolute_band',
};

describe('AdminPriceRulesService', () => {
  let service: AdminPriceRulesService;

  beforeEach(async () => {
    // resetAllMocks (not just clearAllMocks) — we queue mockResolvedValueOnce
    // returns in some tests that short-circuit before consuming them (e.g.
    // validation throws before DB is touched). clearAllMocks leaves those
    // queued mocks alive across tests, which bleeds state; resetAllMocks
    // wipes both call history AND queued implementations.
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPriceRulesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceValidationRuleEvaluator, useValue: mockEvaluator },
      ],
    }).compile();
    service = module.get(AdminPriceRulesService);
  });

  describe('create', () => {
    it('creates with valid input', async () => {
      mockRule.create.mockResolvedValueOnce({ id: 'r1', ...validInput, enabled: true, notes: null });
      await service.create(validInput);
      expect(mockRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ rule_type: 'absolute_band', enabled: true, notes: null }),
      });
    });

    it('rejects invalid rule_type', async () => {
      await expect(
        service.create({ ...validInput, rule_type: 'banana' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid action', async () => {
      await expect(
        service.create({ ...validInput, action: 'explode' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed reason_code', async () => {
      await expect(
        service.create({ ...validInput, reason_code: 'PB95-Absolute' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      mockRule.findUnique.mockResolvedValueOnce({ id: 'r1' });
      mockRule.update.mockResolvedValueOnce({});
      await service.update('r1', { enabled: false });
      expect(mockRule.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { enabled: false },
      });
    });

    it('throws NotFound when rule does not exist', async () => {
      mockRule.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('missing', { enabled: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates shape even for partial updates', async () => {
      mockRule.findUnique.mockResolvedValueOnce({ id: 'r1' });
      await expect(
        service.update('r1', { action: 'explode' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('deletes when rule exists', async () => {
      mockRule.findUnique.mockResolvedValueOnce({ id: 'r1' });
      mockRule.delete.mockResolvedValueOnce({});
      await service.delete('r1');
      expect(mockRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });

    it('throws NotFound when rule does not exist', async () => {
      mockRule.findUnique.mockResolvedValueOnce(null);
      await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setConfig', () => {
    it('upserts by key', async () => {
      mockSystemConfig.upsert.mockResolvedValueOnce({});
      await service.setConfig('vat_multiplier', '1.08', 'Reduced rate period');
      expect(mockSystemConfig.upsert).toHaveBeenCalledWith({
        where: { key: 'vat_multiplier' },
        update: { value: '1.08', description: 'Reduced rate period' },
        create: { key: 'vat_multiplier', value: '1.08', description: 'Reduced rate period' },
      });
    });
  });

  describe('backtest', () => {
    const rule = {
      id: 'rule-rel-pb95',
      rule_type: 'relative_to_reference',
      applies_to: 'PB_95',
      parameters: {},
      action: 'shadow_reject',
      reason_code: 'pb95_outside_rack_band',
    };

    it('throws NotFound when rule does not exist', async () => {
      mockRule.findUnique.mockResolvedValueOnce(null);
      await expect(service.backtest('missing')).rejects.toThrow(NotFoundException);
    });

    it('counts hits across verified submissions', async () => {
      mockRule.findUnique.mockResolvedValueOnce(rule);
      mockSubmission.findMany.mockResolvedValueOnce([
        { id: 's1', price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.29 }] },
        { id: 's2', price_data: [{ fuel_type: 'PB_95', price_per_litre: 5.99 }] },
        { id: 's3', price_data: [{ fuel_type: 'ON', price_per_litre: 7.50 }] }, // applies_to filter drops this
      ]);
      // First call (s1) — rule fires. Second call (s2) — rule passes.
      mockEvaluator.evaluate
        .mockResolvedValueOnce({
          perFuel: [{ fuel_type: 'PB_95', price: 6.29, passed: false, rulesFired: [
            { rule_id: 'rule-rel-pb95', reason_code: 'pb95_outside_rack_band', action: 'shadow_reject', detail: 'too low' }
          ] }],
          overall: 'shadow_reject',
          softFlags: [],
        })
        .mockResolvedValueOnce({
          perFuel: [{ fuel_type: 'PB_95', price: 5.99, passed: true, rulesFired: [] }],
          overall: 'passed',
          softFlags: [],
        });

      const result = await service.backtest('rule-rel-pb95', { windowDays: 30, limit: 500 });

      expect(result.sampleSize).toBe(3);
      expect(result.wouldHaveFired).toBe(1);
      expect(result.wouldHavePassed).toBe(2); // s2 + s3 (s3 passed via filter skip)
      expect(result.sampleHits).toHaveLength(1);
      expect(result.sampleHits[0]).toMatchObject({
        submission_id: 's1',
        fuel_type: 'PB_95',
        price: 6.29,
      });
    });

    it('clamps windowDays and limit to sane bounds', async () => {
      mockRule.findUnique.mockResolvedValueOnce(rule);
      mockSubmission.findMany.mockResolvedValueOnce([]);
      await service.backtest('rule-rel-pb95', { windowDays: 9999, limit: 99999 });
      const call = mockSubmission.findMany.mock.calls[0][0] as { take: number };
      expect(call.take).toBeLessThanOrEqual(2000);
    });
  });
});
