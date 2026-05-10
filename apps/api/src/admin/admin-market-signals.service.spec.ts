import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminMarketSignalsService } from './admin-market-signals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockMarketSignalFindMany = jest.fn();
const mockQueryRaw = jest.fn();

const mockPrisma = {
  marketSignal: { findMany: mockMarketSignalFindMany },
  $queryRaw: mockQueryRaw,
};

const at = (offset: string) => new Date(`2026-05-09T${offset}`);

const baseRow = {
  signal_type: 'orlen_rack_pb95' as const,
  value: 6.20,
  pct_change: 0.012,
  recorded_at: at('06:00:00Z'),
  rate_source: null as string | null,
};

describe('AdminMarketSignalsService', () => {
  let service: AdminMarketSignalsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMarketSignalFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminMarketSignalsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AdminMarketSignalsService);
  });

  // ── getSummary ──────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('always returns all 4 signal types in canonical order, even when DB is empty', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.getSummary();

      expect(result).toHaveLength(4);
      expect(result.map((r) => r.signalType)).toEqual([
        'orlen_rack_pb95',
        'orlen_rack_on',
        'orlen_rack_lpg',
        'brent_crude_pln',
      ]);
      // Empty DB → null fields drive AC5's "Not configured" UI
      for (const row of result) {
        expect(row.value).toBeNull();
        expect(row.recordedAt).toBeNull();
        expect(row.rateSource).toBeNull();
      }
    });

    it('returns the latest sample per signal type when DB has data', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { ...baseRow, signal_type: 'orlen_rack_pb95', value: 6.20, recorded_at: at('06:00:00Z') },
        { ...baseRow, signal_type: 'orlen_rack_on', value: 6.05, recorded_at: at('06:00:01Z') },
        { ...baseRow, signal_type: 'orlen_rack_lpg', value: 2.85, recorded_at: at('06:00:02Z') },
        {
          signal_type: 'brent_crude_pln' as const,
          value: 1.7754,
          pct_change: 0.04,
          recorded_at: at('06:00:03Z'),
          rate_source: 'live',
        },
      ]);

      const result = await service.getSummary();

      expect(result[0]).toMatchObject({ signalType: 'orlen_rack_pb95', value: 6.20 });
      expect(result[3]).toMatchObject({
        signalType: 'brent_crude_pln',
        value: 1.7754,
        pctChange: 0.04,
        rateSource: 'live',
      });
    });

    it('rateSource is always null for ORLEN signals (rate translation only applies to Brent)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        // ORLEN row written with a stray rate_source value (corrupt/legacy)
        { ...baseRow, signal_type: 'orlen_rack_pb95', rate_source: 'live' },
      ]);

      const result = await service.getSummary();

      const orlenPb95 = result.find((r) => r.signalType === 'orlen_rack_pb95')!;
      expect(orlenPb95.rateSource).toBeNull();
    });

    it('Brent rateSource passes through "live" / "cached" verbatim', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { ...baseRow, signal_type: 'brent_crude_pln', rate_source: 'cached' },
      ]);

      const result = await service.getSummary();

      const brent = result.find((r) => r.signalType === 'brent_crude_pln')!;
      expect(brent.rateSource).toBe('cached');
    });

    it('Brent rateSource normalised to null when DB has an unknown value (defensive)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { ...baseRow, signal_type: 'brent_crude_pln', rate_source: 'fallback' },
      ]);

      const result = await service.getSummary();

      const brent = result.find((r) => r.signalType === 'brent_crude_pln')!;
      expect(brent.rateSource).toBeNull();
    });

    it('handles partial data — Brent missing while ORLEN present', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { ...baseRow, signal_type: 'orlen_rack_pb95' },
      ]);

      const result = await service.getSummary();

      const brent = result.find((r) => r.signalType === 'brent_crude_pln')!;
      // AC5 "Not configured — set ALPHA_VANTAGE_API_KEY" path
      expect(brent.value).toBeNull();
      expect(brent.recordedAt).toBeNull();
    });
  });

  // ── getHistory ─────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns the latest N rows for the requested signal type, newest first', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([
        { value: 6.21, pct_change: 0.001, recorded_at: at('14:00:00Z'), rate_source: null, significant_movement: false },
        { value: 6.20, pct_change: 0.012, recorded_at: at('06:00:00Z'), rate_source: null, significant_movement: false },
      ]);

      const result = await service.getHistory('orlen_rack_pb95', 30);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ value: 6.21, significantMovement: false });
      expect(mockMarketSignalFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { signal_type: 'orlen_rack_pb95' },
          orderBy: { recorded_at: 'desc' },
          take: 30,
        }),
      );
    });

    it('rejects unknown signalType with BadRequest', async () => {
      await expect(service.getHistory('mystery_signal', 30)).rejects.toThrow(BadRequestException);
      expect(mockMarketSignalFindMany).not.toHaveBeenCalled();
    });

    it('clamps limit to MAX_HISTORY_LIMIT (200) when caller asks for more', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([]);

      await service.getHistory('orlen_rack_pb95', 999_999);

      expect(mockMarketSignalFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('falls back to default limit when caller passes 0 (treated as "use default")', async () => {
      // `Number(0) || DEFAULT` evaluates to DEFAULT because 0 is falsy —
      // arguably a feature: limit=0 in a curl is more likely "I forgot
      // to pass one" than "give me zero rows". Document the behaviour
      // so a future tightening doesn't change it accidentally.
      mockMarketSignalFindMany.mockResolvedValueOnce([]);

      await service.getHistory('orlen_rack_pb95', 0);

      expect(mockMarketSignalFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 }),
      );
    });

    it('clamps a negative limit to 1', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([]);

      await service.getHistory('orlen_rack_pb95', -5);

      expect(mockMarketSignalFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('falls back to default limit (30) when caller passes a non-numeric value', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([]);

      // Cast forces NaN through the path the controller would produce on
      // a malformed `?limit=foo` query string.
      await service.getHistory('orlen_rack_pb95', NaN);

      expect(mockMarketSignalFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 }),
      );
    });

    it('passes through Brent rateSource when valid', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([
        { value: 1.78, pct_change: 0.001, recorded_at: at('14:00:00Z'), rate_source: 'cached', significant_movement: false },
      ]);

      const result = await service.getHistory('brent_crude_pln', 30);

      expect(result[0].rateSource).toBe('cached');
    });

    it('normalises unknown rateSource to null in history rows', async () => {
      mockMarketSignalFindMany.mockResolvedValueOnce([
        { value: 1.78, pct_change: null, recorded_at: at('14:00:00Z'), rate_source: 'mystery', significant_movement: false },
      ]);

      const result = await service.getHistory('brent_crude_pln', 30);

      expect(result[0].rateSource).toBeNull();
    });
  });
});
