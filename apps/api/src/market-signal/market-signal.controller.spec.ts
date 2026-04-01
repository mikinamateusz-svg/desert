import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { MarketSignalController } from './market-signal.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

const now = new Date('2026-04-01T06:00:00.000Z');

const mockQueryRaw = jest.fn();

const mockPrisma = {
  $queryRaw: mockQueryRaw,
};

describe('MarketSignalController', () => {
  let controller: MarketSignalController;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketSignalController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<MarketSignalController>(MarketSignalController);
    reflector = module.get<Reflector>(Reflector);
  });

  // ── @Public() decorator ────────────────────────────────────────────────────

  describe('getSummary — @Public() decorator', () => {
    it('is marked @Public() — unauthenticated access allowed', () => {
      const isPublic = reflector.get<boolean>('isPublic', controller.getSummary);
      expect(isPublic).toBe(true);
    });
  });

  // ── empty table ────────────────────────────────────────────────────────────

  describe('getSummary — empty MarketSignal table', () => {
    it('returns { signals: [] } when $queryRaw returns empty array', async () => {
      mockQueryRaw.mockResolvedValue([]);

      const result = await controller.getSummary();

      expect(result).toEqual({ signals: [] });
    });
  });

  // ── data present ───────────────────────────────────────────────────────────

  describe('getSummary — data present', () => {
    const rows = [
      { signal_type: 'orlen_rack_pb95', value: 5.4660, pct_change: 0.015, recorded_at: now },
      { signal_type: 'orlen_rack_on',   value: 6.7820, pct_change: -0.008, recorded_at: now },
      { signal_type: 'orlen_rack_lpg',  value: 3.1000, pct_change: null,  recorded_at: now },
    ];

    beforeEach(() => {
      mockQueryRaw.mockResolvedValue(rows);
    });

    it('returns mapped signal items with camelCase keys', async () => {
      const { signals } = await controller.getSummary();
      expect(signals).toHaveLength(3);
    });

    it('maps signal_type → signalType', async () => {
      const { signals } = await controller.getSummary() as { signals: Record<string, unknown>[] };
      expect(signals[0]!.signalType).toBe('orlen_rack_pb95');
      expect(signals[1]!.signalType).toBe('orlen_rack_on');
      expect(signals[2]!.signalType).toBe('orlen_rack_lpg');
    });

    it('maps value correctly', async () => {
      const { signals } = await controller.getSummary() as { signals: Record<string, unknown>[] };
      expect(signals[0]!.value).toBe(5.4660);
    });

    it('maps pct_change → pctChange (fraction, not percentage)', async () => {
      const { signals } = await controller.getSummary() as { signals: Record<string, unknown>[] };
      expect(signals[0]!.pctChange).toBe(0.015);
      expect(signals[1]!.pctChange).toBe(-0.008);
    });

    it('maps pct_change: null → pctChange: null (not undefined)', async () => {
      const { signals } = await controller.getSummary() as { signals: Record<string, unknown>[] };
      expect(signals[2]!.pctChange).toBeNull();
    });

    it('maps recorded_at → recordedAt as ISO string', async () => {
      const { signals } = await controller.getSummary() as { signals: Record<string, unknown>[] };
      expect(signals[0]!.recordedAt).toBe(now.toISOString());
    });
  });
});
