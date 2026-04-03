import { Test, TestingModule } from '@nestjs/testing';
import { PriceValidationService, ABSOLUTE_BANDS } from './price-validation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ExtractedPrice } from '../ocr/ocr.service.js';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const price = (fuelType: string, pricePerLitre: number): ExtractedPrice => ({
  fuel_type: fuelType,
  price_per_litre: pricePerLitre,
});

const recentRow = (fuelType: string, recentPrice: number) => ({
  fuel_type: fuelType,
  price: recentPrice,
});

const STATION_ID = 'station-abc';

// ── Test suite ───────────────────────────────────────────────────────────────

describe('PriceValidationService', () => {
  let service: PriceValidationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceValidationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PriceValidationService>(PriceValidationService);
  });

  // ── Tier 1 ───────────────────────────────────────────────────────────────

  describe('Tier 1 — recent price within 30 days', () => {
    it('accepts price within +20% of last known price', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [price('PB_95', 6.50)]);

      expect(valid).toHaveLength(1);
      expect(valid[0]).toMatchObject({ fuel_type: 'PB_95', price_per_litre: 6.50, tier: 1 });
      expect(invalid).toHaveLength(0);
    });

    it('accepts price within -20% of last known price', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid } = await service.validatePrices(STATION_ID, [price('PB_95', 5.00)]);

      expect(valid).toHaveLength(1);
      expect(valid[0].tier).toBe(1);
    });

    it('accepts price just inside the +20% boundary', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      // 7.19 < 6.00 * 1.2 (≈7.20) — clearly inside upper bound
      const { valid } = await service.validatePrices(STATION_ID, [price('PB_95', 7.19)]);

      expect(valid).toHaveLength(1);
      expect(valid[0].tier).toBe(1);
    });

    it('accepts price just inside the -20% boundary', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      // 4.81 > 6.00 * 0.8 (≈4.80) — clearly inside lower bound
      const { valid } = await service.validatePrices(STATION_ID, [price('PB_95', 4.81)]);

      expect(valid).toHaveLength(1);
      expect(valid[0].tier).toBe(1);
    });

    it('rejects price above +20% of last known price', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [price('PB_95', 7.21)]);

      expect(valid).toHaveLength(0);
      expect(invalid).toHaveLength(1);
      expect(invalid[0].reason).toContain('tier1_out_of_band');
    });

    it('rejects price below -20% of last known price', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [price('PB_95', 4.79)]);

      expect(valid).toHaveLength(0);
      expect(invalid[0].reason).toContain('tier1_out_of_band');
    });
  });

  // ── Tier 3 ───────────────────────────────────────────────────────────────

  describe('Tier 3 — absolute fallback (no recent history)', () => {
    beforeEach(() => {
      // No recent prices in DB
      mockQueryRaw.mockResolvedValueOnce([]);
    });

    it('accepts PB_95 price within absolute range', async () => {
      const { valid } = await service.validatePrices(STATION_ID, [price('PB_95', 6.00)]);

      expect(valid).toHaveLength(1);
      expect(valid[0].tier).toBe(3);
    });

    it('rejects PB_95 price below absolute minimum', async () => {
      const { valid, invalid } = await service.validatePrices(STATION_ID, [price('PB_95', 3.99)]);

      expect(valid).toHaveLength(0);
      expect(invalid[0].reason).toContain('tier3_out_of_range');
    });

    it('rejects PB_95 price above absolute maximum', async () => {
      const { valid, invalid } = await service.validatePrices(STATION_ID, [price('PB_95', 12.01)]);

      expect(valid).toHaveLength(0);
      expect(invalid[0].reason).toContain('tier3_out_of_range');
    });

    it('accepts LPG price at minimum boundary (1.50)', async () => {
      const { valid } = await service.validatePrices(STATION_ID, [price('LPG', 1.50)]);

      expect(valid).toHaveLength(1);
      expect(valid[0].tier).toBe(3);
    });

    it('rejects LPG price below minimum (1.49)', async () => {
      const { valid } = await service.validatePrices(STATION_ID, [price('LPG', 1.49)]);

      expect(valid).toHaveLength(0);
    });

    it('accepts PB_98 price at minimum boundary (4.50)', async () => {
      const { valid } = await service.validatePrices(STATION_ID, [price('PB_98', 4.50)]);

      expect(valid).toHaveLength(1);
    });

    it('rejects unknown fuel type (not in ABSOLUTE_BANDS)', async () => {
      const { valid, invalid } = await service.validatePrices(STATION_ID, [
        price('UNKNOWN_FUEL', 5.00),
      ]);

      expect(valid).toHaveLength(0);
      expect(invalid[0].reason).toContain('tier3_unknown_fuel_type');
    });
  });

  // ── Mixed tiers ──────────────────────────────────────────────────────────

  describe('mixed Tier 1 + Tier 3 prices', () => {
    it('validates PB_95 on Tier 1 and ON on Tier 3 in one call', async () => {
      // PB_95 has recent history, ON does not
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [
        price('PB_95', 6.10), // Tier 1, within ±20%
        price('ON', 5.80),    // Tier 3, within absolute range
      ]);

      expect(valid).toHaveLength(2);
      expect(valid.find(p => p.fuel_type === 'PB_95')?.tier).toBe(1);
      expect(valid.find(p => p.fuel_type === 'ON')?.tier).toBe(3);
      expect(invalid).toHaveLength(0);
    });

    it('returns partial valid when one price fails and another passes', async () => {
      mockQueryRaw.mockResolvedValueOnce([recentRow('PB_95', 6.00)]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [
        price('PB_95', 7.50), // Tier 1, outside ±20% (7.50 > 7.20)
        price('ON', 5.00),    // Tier 3, valid
      ]);

      expect(valid).toHaveLength(1);
      expect(valid[0].fuel_type).toBe('ON');
      expect(invalid).toHaveLength(1);
      expect(invalid[0].fuel_type).toBe('PB_95');
    });
  });

  // ── Deduplication ────────────────────────────────────────────────────────

  describe('deduplication (AC8 — D2 from Story 3.5)', () => {
    it('keeps first occurrence and drops duplicate fuel type', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const { valid } = await service.validatePrices(STATION_ID, [
        price('PB_95', 6.00),
        price('PB_95', 7.00), // duplicate — dropped
      ]);

      // Only one PB_95 entry validated
      expect(valid.filter(p => p.fuel_type === 'PB_95')).toHaveLength(1);
      expect(valid[0].price_per_litre).toBe(6.00);
    });

    it('queries DB with deduplicated fuel types only', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.validatePrices(STATION_ID, [
        price('PB_95', 6.00),
        price('PB_95', 7.00),
        price('ON', 5.00),
      ]);

      // Raw query should only be called once with 2 fuel types, not 3
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty valid/invalid for empty prices array', async () => {
      const { valid, invalid } = await service.validatePrices(STATION_ID, []);

      expect(valid).toHaveLength(0);
      expect(invalid).toHaveLength(0);
      // No DB query needed for empty input
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('all prices fail → valid is empty', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const { valid, invalid } = await service.validatePrices(STATION_ID, [
        price('PB_95', 0.50), // well below minimum
        price('ON', 99.00),   // well above maximum
      ]);

      expect(valid).toHaveLength(0);
      expect(invalid).toHaveLength(2);
    });
  });

  // ── ABSOLUTE_BANDS export ─────────────────────────────────────────────────

  describe('ABSOLUTE_BANDS constant', () => {
    it('includes all expected fuel types with correct ranges', () => {
      expect(ABSOLUTE_BANDS['PB_95']).toEqual({ min: 4.0, max: 12.0 });
      expect(ABSOLUTE_BANDS['PB_98']).toEqual({ min: 4.5, max: 13.0 });
      expect(ABSOLUTE_BANDS['ON']).toEqual({ min: 4.0, max: 12.0 });
      expect(ABSOLUTE_BANDS['ON_PREMIUM']).toEqual({ min: 4.5, max: 13.0 });
      expect(ABSOLUTE_BANDS['LPG']).toEqual({ min: 1.5, max: 5.0 });
      expect(ABSOLUTE_BANDS['AdBlue']).toEqual({ min: 3.0, max: 15.0 });
    });
  });
});
