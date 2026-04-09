import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  StalenessDetectionService,
  SIGNAL_TO_FUEL_TYPE,
} from './staleness-detection.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
const mockQueryRaw = jest.fn();
const mockCreateMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockStaleFindMany = jest.fn();

const mockPrisma = {
  marketSignal: {
    findMany: mockFindMany,
  },
  $queryRaw: mockQueryRaw,
  stationFuelStaleness: {
    createMany: mockCreateMany,
    deleteMany: mockDeleteMany,
    findMany: mockStaleFindMany,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeSignal = (signal_type: string) => ({
  signal_type,
  significant_movement: true,
  recorded_at: new Date(),
});

const makeStationRows = (ids: string[]) => ids.map((id) => ({ id }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StalenessDetectionService', () => {
  let service: StalenessDetectionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StalenessDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<StalenessDetectionService>(StalenessDetectionService);
  });

  // ── SIGNAL_TO_FUEL_TYPE constant ─────────────────────────────────────────

  describe('SIGNAL_TO_FUEL_TYPE', () => {
    it('maps orlen_rack_pb95 → PB_95', () => {
      expect(SIGNAL_TO_FUEL_TYPE['orlen_rack_pb95']).toBe('PB_95');
    });

    it('maps orlen_rack_on → ON', () => {
      expect(SIGNAL_TO_FUEL_TYPE['orlen_rack_on']).toBe('ON');
    });

    it('maps orlen_rack_lpg → LPG', () => {
      expect(SIGNAL_TO_FUEL_TYPE['orlen_rack_lpg']).toBe('LPG');
    });
  });

  // ── detectStaleness ───────────────────────────────────────────────────────

  describe('detectStaleness — no significant movements', () => {
    it('does not write any stale flags when findMany returns empty', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.detectStaleness();

      expect(mockCreateMany).not.toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleness — single fuel type (PB_95)', () => {
    it('queries stations and creates stale flags for PB_95', async () => {
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['station-1', 'station-2']));
      mockCreateMany.mockResolvedValue({ count: 2 });

      await service.detectStaleness();

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          { station_id: 'station-1', fuel_type: 'PB_95', reason: 'orlen_movement' },
          { station_id: 'station-2', fuel_type: 'PB_95', reason: 'orlen_movement' },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('detectStaleness — multiple fuel types (PB_95 + ON)', () => {
    it('calls createMany once per fuel type', async () => {
      mockFindMany.mockResolvedValue([
        makeSignal('orlen_rack_pb95'),
        makeSignal('orlen_rack_on'),
      ]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['station-1']));
      mockCreateMany.mockResolvedValue({ count: 1 });

      await service.detectStaleness();

      expect(mockCreateMany).toHaveBeenCalledTimes(2);
      const fuelTypesCalled = mockCreateMany.mock.calls.map(
        (c) => c[0].data[0].fuel_type,
      );
      expect(fuelTypesCalled).toContain('PB_95');
      expect(fuelTypesCalled).toContain('ON');
    });
  });

  describe('detectStaleness — deduplicates identical fuel types', () => {
    it('calls createMany only once when multiple signals map to same fuel type', async () => {
      // Two pb95 signals (e.g. two ingestion runs both had significant movement)
      mockFindMany.mockResolvedValue([
        makeSignal('orlen_rack_pb95'),
        makeSignal('orlen_rack_pb95'),
      ]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['station-1']));
      mockCreateMany.mockResolvedValue({ count: 1 });

      await service.detectStaleness();

      expect(mockCreateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('detectStaleness — unknown signal_type has no mapping', () => {
    it('ignores unknown signal types and writes nothing', async () => {
      mockFindMany.mockResolvedValue([makeSignal('brent_crude_usd')]);

      await service.detectStaleness();

      expect(mockQueryRaw).not.toHaveBeenCalled();
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleness — no stations without recent submissions', () => {
    it('does not call createMany when queryRaw returns empty array', async () => {
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockQueryRaw.mockResolvedValue([]);

      await service.detectStaleness();

      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleness — DB error reading signals propagates (AC7)', () => {
    it('propagates DB error from findMany without calling createMany', async () => {
      mockFindMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.detectStaleness()).rejects.toThrow('DB connection lost');
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleness — DB error writing flags propagates (AC8)', () => {
    it('propagates DB error from createMany', async () => {
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['station-1']));
      mockCreateMany.mockRejectedValue(new Error('Write failed'));

      await expect(service.detectStaleness()).rejects.toThrow('Write failed');
    });
  });

  describe('detectStaleness — DB error in queryRaw propagates (AC7)', () => {
    it('propagates DB error from $queryRaw without calling createMany', async () => {
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockQueryRaw.mockRejectedValue(new Error('Raw query failed'));

      await expect(service.detectStaleness()).rejects.toThrow('Raw query failed');
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleness — uses skipDuplicates for idempotency (AC1)', () => {
    it('passes skipDuplicates: true to createMany', async () => {
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_lpg')]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['station-1']));
      mockCreateMany.mockResolvedValue({ count: 0 }); // already flagged

      await service.detectStaleness();

      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });
  });

  // ── clearStaleFlag ────────────────────────────────────────────────────────

  describe('clearStaleFlag', () => {
    it('calls deleteMany with correct station_id and fuel_type (AC2)', async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 });

      await service.clearStaleFlag('station-abc', 'PB_95');

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { station_id: 'station-abc', fuel_type: 'PB_95' },
      });
    });

    it('is a silent no-op when record does not exist (count: 0)', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });

      await expect(service.clearStaleFlag('station-abc', 'ON')).resolves.toBeUndefined();
    });

    it('does not affect other fuel types at the same station', async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 });

      await service.clearStaleFlag('station-abc', 'PB_95');

      // deleteMany was called with specific fuel_type — other types are unaffected
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { station_id: 'station-abc', fuel_type: 'PB_95' },
      });
      // NOT called a second time for other fuel types
      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── getStaleFuelTypes ─────────────────────────────────────────────────────

  describe('getStaleFuelTypes', () => {
    it('returns fuel types for stale (station, fuel_type) records', async () => {
      mockStaleFindMany.mockResolvedValue([
        { fuel_type: 'PB_95' },
        { fuel_type: 'ON' },
      ]);

      const result = await service.getStaleFuelTypes('station-xyz');

      expect(result).toEqual(['PB_95', 'ON']);
      expect(mockStaleFindMany).toHaveBeenCalledWith({
        where: { station_id: 'station-xyz', flagged_at: { gte: expect.any(Date) } },
        select: { fuel_type: true },
      });
    });

    it('returns empty array when no stale flags for station', async () => {
      mockStaleFindMany.mockResolvedValue([]);

      const result = await service.getStaleFuelTypes('station-xyz');

      expect(result).toEqual([]);
    });
  });

  // ── silent operation (AC5) ────────────────────────────────────────────────

  describe('detectStaleness — silent operation (AC5)', () => {
    it('does not log any notification-related messages', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mockFindMany.mockResolvedValue([makeSignal('orlen_rack_pb95')]);
      mockQueryRaw.mockResolvedValue(makeStationRows(['s-1']));
      mockCreateMany.mockResolvedValue({ count: 1 });

      await service.detectStaleness();

      for (const call of logSpy.mock.calls) {
        expect(String(call[0]).toLowerCase()).not.toContain('push');
        expect(String(call[0]).toLowerCase()).not.toContain('notification');
      }
      logSpy.mockRestore();
    });
  });
});
