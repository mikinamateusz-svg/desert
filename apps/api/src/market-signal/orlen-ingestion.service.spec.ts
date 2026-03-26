import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

global.fetch = jest.fn();

// ── HTML fixtures ─────────────────────────────────────────────────────────────

/**
 * Realistic ORLEN-style HTML: fuel name in one <td>, price in the next <td>.
 * The parser must advance past the matched label text (via exec + match[0].length)
 * and then find the first digit in the remaining HTML (which starts with </td><td>).
 * Prices are in PLN/1000L.
 */
const makeOrlenHtml = (pb95: string, on: string, lpg: string) =>
  `<table class="price-table">
    <thead><tr><th>Produkt</th><th>Cena netto (zł/1000 l)</th></tr></thead>
    <tbody>
      <tr><td>Eurosuper 95</td><td class="price">${pb95}</td></tr>
      <tr><td>Ekodiesel</td><td class="price">${on}</td></tr>
      <tr><td>Autogas</td><td class="price">${lpg}</td></tr>
    </tbody>
  </table>`;

/** Standard fixture — prices in PLN/1000L */
const VALID_HTML = makeOrlenHtml('5 234,56', '5 123,45', '2 987,65');
// Expected PLN/litre: 5.23456, 5.12345, 2.98765

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn().mockResolvedValue({});
const mockFindFirst = jest.fn();
// P3: $transaction mock — executes all operations (array form)
const mockTransaction = jest.fn().mockImplementation(
  (ops: Promise<unknown>[]) => Promise.all(ops),
);

const mockPrisma = {
  marketSignal: {
    findFirst: mockFindFirst,
    create: mockCreate,
  },
  $transaction: mockTransaction,
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('https://orlen.pl/rack'),
};

const makeFetchOk = (html: string) =>
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: jest.fn().mockResolvedValue(html),
  });

const makeFetchFail = (status: number) =>
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
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
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<OrlenIngestionService>(OrlenIngestionService);
  });

  // ── parsePrices ─────────────────────────────────────────────────────────────

  describe('parsePrices', () => {
    it('extracts PB95 price from HTML and converts PLN/1000L → PLN/l', () => {
      const { pb95 } = service.parsePrices(VALID_HTML);
      expect(pb95).toBeCloseTo(5.23456, 4);
    });

    it('extracts ON price from HTML', () => {
      const { on } = service.parsePrices(VALID_HTML);
      expect(on).toBeCloseTo(5.12345, 4);
    });

    it('extracts LPG price from HTML', () => {
      const { lpg } = service.parsePrices(VALID_HTML);
      expect(lpg).toBeCloseTo(2.98765, 4);
    });

    it('handles comma decimal separator without spaces', () => {
      const html = makeOrlenHtml('5234,56', '5123,45', '2987,65');
      const { pb95 } = service.parsePrices(html);
      expect(pb95).toBeCloseTo(5.23456, 4);
    });

    it('handles dot decimal separator', () => {
      const html = makeOrlenHtml('5234.56', '5123.45', '2987.65');
      const { pb95 } = service.parsePrices(html);
      expect(pb95).toBeCloseTo(5.23456, 4);
    });

    it('correctly advances past label when \\s* matches multiple spaces (P1 fix)', () => {
      // "Eurosuper  95" — two spaces matched by \s*. Using source.length would advance
      // by 14 chars (wrong); exec + match[0].length advances by 13 chars (correct).
      const html = makeOrlenHtml('5 234,56', '5 123,45', '2 987,65')
        .replace('Eurosuper 95', 'Eurosuper  95');
      const { pb95 } = service.parsePrices(html);
      expect(pb95).toBeCloseTo(5.23456, 4);
    });

    it('throws when parsed value is implausibly high (P2 plausibility check)', () => {
      // 52345 PLN/1000L → 52.345 PLN/l — way outside [0.3, 15]
      const html = makeOrlenHtml('52345,00', '5123,45', '2987,65');
      expect(() => service.parsePrices(html)).toThrow(/plausible range/i);
    });

    it('throws when parsed value is implausibly low (P2 plausibility check)', () => {
      // 100 PLN/1000L → 0.1 PLN/l — below minimum
      const html = makeOrlenHtml('100,00', '5123,45', '2987,65');
      expect(() => service.parsePrices(html)).toThrow(/plausible range/i);
    });

    it('throws when Eurosuper 95 label is missing', () => {
      const html = `<table><tr><td>Ekodiesel</td><td>5123,45</td></tr></table>`;
      expect(() => service.parsePrices(html)).toThrow(/Eurosuper/i);
    });

    it('throws when Ekodiesel label is missing', () => {
      const html = `<table><tr><td>Eurosuper 95</td><td>5234,56</td></tr></table>`;
      expect(() => service.parsePrices(html)).toThrow(/Ekodiesel/i);
    });

    it('throws when Autogas label is missing', () => {
      const htmlNoLpg = `<table>
        <tr><td>Eurosuper 95</td><td>5234,56</td></tr>
        <tr><td>Ekodiesel</td><td>5123,45</td></tr>
      </table>`;
      expect(() => service.parsePrices(htmlNoLpg)).toThrow(/Autogas/i);
    });

    it('is case-insensitive for fuel labels', () => {
      const html = makeOrlenHtml('5 234,56', '5 123,45', '2 987,65')
        .replace('Eurosuper 95', 'eurosuper 95')
        .replace('Ekodiesel', 'ekodiesel')
        .replace('Autogas', 'autogas');
      expect(() => service.parsePrices(html)).not.toThrow();
    });
  });

  // ── fetchPage ───────────────────────────────────────────────────────────────

  describe('fetchPage', () => {
    it('returns HTML on 200 OK', async () => {
      makeFetchOk('<html>ok</html>');
      const html = await service.fetchPage();
      expect(html).toBe('<html>ok</html>');
    });

    it('throws on non-OK HTTP status', async () => {
      makeFetchFail(503);
      await expect(service.fetchPage()).rejects.toThrow('503');
    });

    it('sends a User-Agent header', async () => {
      makeFetchOk('<html/>');
      await service.fetchPage();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://orlen.pl/rack',
        expect.objectContaining({
          headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('Desert') }),
        }),
      );
    });
  });

  // ── storeSignals / pct_change / significant_movement ────────────────────────

  describe('ingest — first ever ingestion', () => {
    it('stores pct_change: null and significant_movement: false when no previous signal', async () => {
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
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
      makeFetchOk(VALID_HTML);
      mockFindFirst.mockResolvedValue(null);

      await service.ingest();

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // $transaction received an array of 3 promises (one per fuel type)
      const ops = mockTransaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(3);
    });

    it('reads all previous values before writing (parallel reads)', async () => {
      makeFetchOk(VALID_HTML);
      mockFindFirst.mockResolvedValue(null);

      await service.ingest();

      // All three findFirst calls happen before any create calls
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
      makeFetchOk('<html>no prices here</html>');

      await expect(service.ingest()).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('ingest — significant movement logging', () => {
    it('logs a warning on significant movement', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      makeFetchOk(VALID_HTML);
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

      makeFetchOk(VALID_HTML);
      mockFindFirst.mockImplementation((args: { where: { signal_type: string } }) => {
        const currentByType: Record<string, number> = {
          orlen_rack_pb95: 5.23456,
          orlen_rack_on:   5.12345,
          orlen_rack_lpg:  2.98765,
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
      makeFetchOk(VALID_HTML);
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
