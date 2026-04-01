import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

global.fetch = jest.fn();

// ── JSON fixtures ──────────────────────────────────────────────────────────────

// Mirror the product name constants from the service (kept in sync manually — not re-exported)
const PRODUCT_PB95 = 'Pb95';
const PRODUCT_ON   = 'ONEkodiesel';

/** Wholesale fixture — values in PLN/1000L */
const makeWholesale = (pb95: number, on: number) => [
  { productName: PRODUCT_PB95, effectiveDate: '2026-04-01T00:00:00', value: pb95 },
  { productName: PRODUCT_ON,   effectiveDate: '2026-04-01T00:00:00', value: on },
  { productName: 'Pb98',       effectiveDate: '2026-04-01T00:00:00', value: 6032.0 },
];

/** Autogas fixture — values in PLN/litre (already per-litre, per voivodeship) */
const makeAutogas = (...values: number[]) => values.map(v => ({ value: v }));

/** Standard fixtures */
const VALID_WHOLESALE = makeWholesale(5234.56, 5123.45);
// Expected PLN/litre: 5.23456, 5.12345
const VALID_AUTOGAS = makeAutogas(2.98765, 3.01235);
// Expected mean: (2.98765 + 3.01235) / 2 = 3.0

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreate    = jest.fn().mockResolvedValue({});
const mockFindFirst = jest.fn();
const mockTransaction = jest.fn().mockImplementation(
  (ops: Promise<unknown>[]) => Promise.all(ops),
);

const mockPrisma = {
  marketSignal: {
    findFirst: mockFindFirst,
    create:    mockCreate,
  },
  $transaction: mockTransaction,
};

/** Make fetch return the standard valid JSON for both endpoints */
const makeFetchOk = (wholesale = VALID_WHOLESALE, autogas = VALID_AUTOGAS) =>
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    const data = (url as string).includes('autogas') ? autogas : wholesale;
    return Promise.resolve({
      ok:   true,
      json: jest.fn().mockResolvedValue(data),
    });
  });

const makeFetchFail = (status: number) =>
  (global.fetch as jest.Mock).mockResolvedValue({
    ok:         false,
    status,
    statusText: 'Error',
  });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrlenIngestionService', () => {
  let service: OrlenIngestionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrlenIngestionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<OrlenIngestionService>(OrlenIngestionService);
  });

  // ── parsePrices ─────────────────────────────────────────────────────────────

  describe('parsePrices', () => {
    it('extracts PB95 price from wholesale JSON and converts PLN/1000L → PLN/l', () => {
      const { pb95 } = service.parsePrices(VALID_WHOLESALE, VALID_AUTOGAS);
      expect(pb95).toBeCloseTo(5.23456, 4);
    });

    it('extracts ON price from wholesale JSON', () => {
      const { on } = service.parsePrices(VALID_WHOLESALE, VALID_AUTOGAS);
      expect(on).toBeCloseTo(5.12345, 4);
    });

    it('computes LPG as mean of all voivodeship values', () => {
      const autogas = makeAutogas(3.08, 3.10, 3.12);
      const { lpg } = service.parsePrices(VALID_WHOLESALE, autogas);
      expect(lpg).toBeCloseTo((3.08 + 3.10 + 3.12) / 3, 5);
    });

    it('works with a single autogas value', () => {
      const { lpg } = service.parsePrices(VALID_WHOLESALE, makeAutogas(3.10));
      expect(lpg).toBeCloseTo(3.10, 4);
    });

    it('throws when Pb95 is missing from wholesale data', () => {
      const noPb95 = VALID_WHOLESALE.filter(i => i.productName !== PRODUCT_PB95);
      expect(() => service.parsePrices(noPb95, VALID_AUTOGAS)).toThrow(/"Pb95"/i);
    });

    it('throws when ONEkodiesel is missing from wholesale data', () => {
      const noOn = VALID_WHOLESALE.filter(i => i.productName !== PRODUCT_ON);
      expect(() => service.parsePrices(noOn, VALID_AUTOGAS)).toThrow(/"ONEkodiesel"/i);
    });

    it('throws when autogas list is empty', () => {
      expect(() => service.parsePrices(VALID_WHOLESALE, [])).toThrow(/empty/i);
    });

    it('throws when wholesale response is not an array (e.g. error envelope)', () => {
      expect(() =>
        service.parsePrices({ error: 'maintenance' } as any, VALID_AUTOGAS),
      ).toThrow(/unexpected shape/i);
    });

    it('throws when autogas response is not an array', () => {
      expect(() =>
        service.parsePrices(VALID_WHOLESALE, { error: 'maintenance' } as any),
      ).toThrow(/unexpected shape/i);
    });

    it('throws when wholesale PB95 value is implausibly high (plausibility check)', () => {
      const bad = makeWholesale(52_000, 5123.45); // 52 PLN/l — impossible
      expect(() => service.parsePrices(bad, VALID_AUTOGAS)).toThrow(/plausible range/i);
    });

    it('throws when wholesale PB95 value is implausibly low (plausibility check)', () => {
      const bad = makeWholesale(100, 5123.45); // 0.1 PLN/l — impossible
      expect(() => service.parsePrices(bad, VALID_AUTOGAS)).toThrow(/plausible range/i);
    });
  });

  // ── fetchJson ────────────────────────────────────────────────────────────────

  describe('fetchJson', () => {
    it('returns parsed JSON on 200 OK', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok:   true,
        json: jest.fn().mockResolvedValue([{ productName: 'Pb95', value: 5466 }]),
      });
      const result = await service.fetchJson('https://tool.orlen.pl/api/wholesalefuelprices');
      expect(result).toEqual([{ productName: 'Pb95', value: 5466 }]);
    });

    it('throws on non-OK HTTP status', async () => {
      makeFetchFail(503);
      await expect(
        service.fetchJson('https://tool.orlen.pl/api/wholesalefuelprices'),
      ).rejects.toThrow('503');
    });

    it('sends a User-Agent header', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok:   true,
        json: jest.fn().mockResolvedValue([]),
      });
      await service.fetchJson('https://tool.orlen.pl/api/wholesalefuelprices');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://tool.orlen.pl/api/wholesalefuelprices',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Desert'),
          }),
        }),
      );
    });
  });

  // ── storeSignals / pct_change / significant_movement ────────────────────────

  describe('ingest — first ever ingestion', () => {
    it('stores pct_change: null and significant_movement: false when no previous signal', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue(null);

      await service.ingest();

      expect(mockCreate).toHaveBeenCalledTimes(3);
      for (const call of mockCreate.mock.calls) {
        expect(call[0].data.pct_change).toBeNull();
        expect(call[0].data.significant_movement).toBe(false);
      }
    });
  });

  describe('ingest — movement < 3% (2%)', () => {
    it('sets significant_movement: false', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue({ value: 5.23456 * 1.02 });

      await service.ingest();

      const pb95Call = mockCreate.mock.calls.find(
        (c) => c[0].data.signal_type === 'orlen_rack_pb95',
      );
      expect(pb95Call![0].data.significant_movement).toBe(false);
    });
  });

  describe('ingest — movement exactly 3%', () => {
    it('sets significant_movement: true', async () => {
      makeFetchOk();
      const prevValue = 5.23456 / 1.03;
      mockFindFirst.mockResolvedValue({ value: prevValue });

      await service.ingest();

      const pb95Call = mockCreate.mock.calls.find(
        (c) => c[0].data.signal_type === 'orlen_rack_pb95',
      );
      expect(pb95Call![0].data.significant_movement).toBe(true);
    });
  });

  describe('ingest — negative movement ≥ 3%', () => {
    it('sets significant_movement: true for a price drop ≥ 3%', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue({ value: 5.23456 * 1.05 });

      await service.ingest();

      const pb95Call = mockCreate.mock.calls.find(
        (c) => c[0].data.signal_type === 'orlen_rack_pb95',
      );
      expect(pb95Call![0].data.significant_movement).toBe(true);
    });
  });

  describe('ingest — movement > 0 but < 3%', () => {
    it('sets significant_movement: false for 1% rise', async () => {
      makeFetchOk();
      const prevValue = 5.23456 / 1.01;
      mockFindFirst.mockResolvedValue({ value: prevValue });

      await service.ingest();

      const pb95Call = mockCreate.mock.calls.find(
        (c) => c[0].data.signal_type === 'orlen_rack_pb95',
      );
      expect(pb95Call![0].data.significant_movement).toBe(false);
    });
  });

  // P4: division-by-zero guard
  describe('ingest — corrupt previous.value === 0 (P4 fix)', () => {
    it('stores pct_change: null instead of Infinity when previous.value is 0', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue({ value: 0 });

      await service.ingest();

      for (const call of mockCreate.mock.calls) {
        expect(call[0].data.pct_change).toBeNull();
        expect(call[0].data.significant_movement).toBe(false);
      }
    });
  });

  // P3: transaction wrapping
  describe('ingest — atomic transaction (P3 fix)', () => {
    it('wraps all three creates in a single $transaction call', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue(null);

      await service.ingest();

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      const ops = mockTransaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(3);
    });

    it('reads all previous values before writing (parallel reads)', async () => {
      makeFetchOk();
      mockFindFirst.mockResolvedValue(null);

      await service.ingest();

      expect(mockFindFirst).toHaveBeenCalledTimes(3);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('ingest — fetch failure', () => {
    it('propagates HTTP error without creating any records', async () => {
      makeFetchFail(502);

      await expect(service.ingest()).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('ingest — parse failure', () => {
    it('propagates parse error without creating any records', async () => {
      makeFetchOk([], []); // empty arrays → no Pb95 / no autogas values

      await expect(service.ingest()).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('ingest — significant movement logging', () => {
    it('logs a warning on significant movement', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      makeFetchOk();
      const prevValue = 5.23456 / 1.04;
      mockFindFirst.mockResolvedValue({ value: prevValue });

      await service.ingest();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Significant movement'),
      );
      warnSpy.mockRestore();
    });

    it('does not log a warning when all movements are < 3%', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      makeFetchOk();
      mockFindFirst.mockImplementation((args: { where: { signal_type: string } }) => {
        const currentByType: Record<string, number> = {
          orlen_rack_pb95: 5.23456,
          orlen_rack_on:   5.12345,
          orlen_rack_lpg:  3.0,
        };
        const current = currentByType[args.where.signal_type];
        return Promise.resolve({ value: current * 1.01 });
      });

      await service.ingest();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('pct_change value', () => {
    it('stores pct_change as a fraction (not percentage)', async () => {
      makeFetchOk();
      const prevValue = 5.23456 / 1.05;
      mockFindFirst.mockResolvedValue({ value: prevValue });

      await service.ingest();

      const pb95Call = mockCreate.mock.calls.find(
        (c) => c[0].data.signal_type === 'orlen_rack_pb95',
      );
      expect(pb95Call![0].data.pct_change).toBeCloseTo(0.05, 3);
    });
  });
});
