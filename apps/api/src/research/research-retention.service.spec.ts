import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SubmissionStatus as PrismaSubmissionStatus } from '@prisma/client';
import { ResearchRetentionService } from './research-retention.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const mockResearchPhoto = {
  create: jest.fn(),
  findMany: jest.fn(),
  delete: jest.fn(),
};

const mockPrisma = { researchPhoto: mockResearchPhoto };

const mockStorage = {
  copyObject: jest.fn(),
  deleteObject: jest.fn(),
};

function makeConfig(retentionDays: string | undefined) {
  return {
    get: (key: string, fallback?: string) => {
      if (key === 'PHOTO_RESEARCH_RETENTION_DAYS') return retentionDays ?? fallback ?? '';
      return fallback ?? '';
    },
  };
}

const baseInput = {
  submissionId: 'sub-1',
  stationId: 'station-1',
  photoR2Key: 'submissions/user-1/sub-1.jpg',
  gpsLat: 51.7592 as number | null,
  gpsLng: 19.4560 as number | null,
  ocrPrices: [{ fuel_type: 'PB_95', price_per_litre: 6.29 }],
  finalPrices: [{ fuel_type: 'PB_95', price_per_litre: 6.29 }],
  finalStatus: PrismaSubmissionStatus.verified,
  flagReason: null as string | null,
  capturedAt: new Date('2026-04-23T10:00:00Z'),
};

async function buildService(retentionDays: string | undefined): Promise<ResearchRetentionService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ResearchRetentionService,
      { provide: ConfigService, useValue: makeConfig(retentionDays) },
      { provide: PrismaService, useValue: mockPrisma },
      { provide: StorageService, useValue: mockStorage },
    ],
  }).compile();
  return module.get<ResearchRetentionService>(ResearchRetentionService);
}

describe('ResearchRetentionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('isEnabled', () => {
    it('returns false when env var is unset', async () => {
      const svc = await buildService(undefined);
      expect(svc.isEnabled()).toBe(false);
    });

    it('returns false when env var is 0', async () => {
      const svc = await buildService('0');
      expect(svc.isEnabled()).toBe(false);
    });

    it('returns true when env var is a positive integer', async () => {
      const svc = await buildService('30');
      expect(svc.isEnabled()).toBe(true);
    });
  });

  describe('captureIfEnabled', () => {
    it('is a no-op when retention is disabled', async () => {
      const svc = await buildService('0');
      await svc.captureIfEnabled(baseInput);
      expect(mockStorage.copyObject).not.toHaveBeenCalled();
      expect(mockResearchPhoto.create).not.toHaveBeenCalled();
    });

    it('is a no-op when photoR2Key is empty', async () => {
      const svc = await buildService('30');
      await svc.captureIfEnabled({ ...baseInput, photoR2Key: '' });
      expect(mockStorage.copyObject).not.toHaveBeenCalled();
      expect(mockResearchPhoto.create).not.toHaveBeenCalled();
    });

    it('happy path: copies object, creates DB row with retained_until in the future', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockResolvedValueOnce(undefined);
      mockResearchPhoto.create.mockResolvedValueOnce({});

      await svc.captureIfEnabled(baseInput);

      expect(mockStorage.copyObject).toHaveBeenCalledWith(
        'submissions/user-1/sub-1.jpg',
        'research/sub-1.jpg',
      );
      expect(mockResearchPhoto.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            submission_id: 'sub-1',
            r2_key: 'research/sub-1.jpg',
            station_id: 'station-1',
            final_status: PrismaSubmissionStatus.verified,
          }),
        }),
      );
      const callArg = (mockResearchPhoto.create.mock.calls[0][0] as { data: { retained_until: Date } }).data;
      // retained_until roughly 30 days out
      const thirtyDaysMs = 30 * 86_400_000;
      const diff = callArg.retained_until.getTime() - Date.now();
      expect(diff).toBeGreaterThan(thirtyDaysMs - 5_000);
      expect(diff).toBeLessThan(thirtyDaysMs + 5_000);
    });

    it('skips DB insert when R2 copy fails (fail-soft)', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockRejectedValueOnce(new Error('R2 unreachable'));

      await svc.captureIfEnabled(baseInput);

      expect(mockResearchPhoto.create).not.toHaveBeenCalled();
    });

    it('rolls back R2 copy when DB insert fails', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockResolvedValueOnce(undefined);
      mockResearchPhoto.create.mockRejectedValueOnce(new Error('DB write failed'));
      mockStorage.deleteObject.mockResolvedValueOnce(undefined);

      await svc.captureIfEnabled(baseInput);

      expect(mockStorage.deleteObject).toHaveBeenCalledWith('research/sub-1.jpg');
    });

    it('rounds GPS coords to 4 decimal places (~10m) before writing', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockResolvedValueOnce(undefined);
      mockResearchPhoto.create.mockResolvedValueOnce({});

      await svc.captureIfEnabled({
        ...baseInput,
        gpsLat: 51.75923847,  // many decimals — should be truncated to ~10m
        gpsLng: 19.45601923,
      });

      const callArg = (mockResearchPhoto.create.mock.calls[0][0] as { data: { gps_lat: number; gps_lng: number } }).data;
      expect(callArg.gps_lat).toBe(51.7592);
      expect(callArg.gps_lng).toBe(19.4560);
    });

    it('preserves null GPS coords when caller has none', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockResolvedValueOnce(undefined);
      mockResearchPhoto.create.mockResolvedValueOnce({});

      await svc.captureIfEnabled({ ...baseInput, gpsLat: null, gpsLng: null });

      const callArg = (mockResearchPhoto.create.mock.calls[0][0] as { data: { gps_lat: number | null; gps_lng: number | null } }).data;
      expect(callArg.gps_lat).toBeNull();
      expect(callArg.gps_lng).toBeNull();
    });

    it('writes null final_prices when the submission was rejected', async () => {
      const svc = await buildService('30');
      mockStorage.copyObject.mockResolvedValueOnce(undefined);
      mockResearchPhoto.create.mockResolvedValueOnce({});

      await svc.captureIfEnabled({
        ...baseInput,
        finalPrices: null,
        finalStatus: PrismaSubmissionStatus.rejected,
        flagReason: 'no_station_match',
      });

      const callArg = (mockResearchPhoto.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(callArg.final_status).toBe(PrismaSubmissionStatus.rejected);
      expect(callArg.flag_reason).toBe('no_station_match');
    });
  });

  describe('cleanupExpired', () => {
    it('returns 0 when no rows are past retained_until', async () => {
      const svc = await buildService('30');
      mockResearchPhoto.findMany.mockResolvedValueOnce([]);

      const result = await svc.cleanupExpired();

      expect(result).toEqual({ deleted: 0, failed: 0 });
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('deletes R2 object + DB row for each expired record', async () => {
      const svc = await buildService('30');
      mockResearchPhoto.findMany.mockResolvedValueOnce([
        { id: 'r1', r2_key: 'research/sub-1.jpg' },
        { id: 'r2', r2_key: 'research/sub-2.jpg' },
      ]);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      mockResearchPhoto.delete.mockResolvedValue({});

      const result = await svc.cleanupExpired();

      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockStorage.deleteObject).toHaveBeenCalledTimes(2);
      expect(mockResearchPhoto.delete).toHaveBeenCalledTimes(2);
    });

    it('counts per-row failures separately and does not throw', async () => {
      const svc = await buildService('30');
      mockResearchPhoto.findMany.mockResolvedValueOnce([
        { id: 'r1', r2_key: 'research/sub-1.jpg' },
        { id: 'r2', r2_key: 'research/sub-2.jpg' },
      ]);
      mockStorage.deleteObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('R2 error'));
      mockResearchPhoto.delete.mockResolvedValue({});

      const result = await svc.cleanupExpired();

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
