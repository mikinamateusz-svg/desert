import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';
import { FlagWrongThrottlerGuard } from './flag-wrong-throttler.guard.js';

const mockSubmissionsService = {
  getMySubmissions: jest.fn(),
  createSubmission: jest.fn(),
};

const mockResponse = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
};

/** Build a minimal mock FastifyRequest for the POST handler. */
function makeMockReq(opts: {
  isMultipart?: boolean;
  parts?: Array<
    | { type: 'file'; fieldname: string; toBuffer: () => Promise<Buffer> }
    | { type: 'field'; fieldname: string; value: string }
  >;
}) {
  return {
    isMultipart: () => opts.isMultipart ?? true,
    parts: () => {
      const items = opts.parts ?? [];
      return (async function* () {
        for (const item of items) yield item;
      })();
    },
  };
}

describe('SubmissionsController', () => {
  let controller: SubmissionsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [{ provide: SubmissionsService, useValue: mockSubmissionsService }],
    })
      // FlagWrongThrottlerGuard pulls THROTTLER:MODULE_OPTIONS from the
      // ThrottlerModule which isn't in this isolated test module. We don't
      // exercise rate limiting here — controller behaviour and guard
      // behaviour are tested separately — so override with a no-op.
      .overrideGuard(FlagWrongThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SubmissionsController>(SubmissionsController);
  });

  // ── getMySubmissions ────────────────────────────────────────────────────────

  describe('getMySubmissions', () => {
    it('should call service with userId, page, and limit', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce(mockResponse);

      const result = await controller.getMySubmissions('user-uuid', { page: 1, limit: 20 });

      expect(result).toEqual(mockResponse);
      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 1, 20);
    });

    it('should use default page=1 and limit=20 when params are defaults', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce(mockResponse);

      await controller.getMySubmissions('user-uuid', { page: 1, limit: 20 });

      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 1, 20);
    });

    it('should pass custom page and limit to service', async () => {
      mockSubmissionsService.getMySubmissions.mockResolvedValueOnce({
        ...mockResponse,
        page: 3,
        limit: 10,
      });

      await controller.getMySubmissions('user-uuid', { page: 3, limit: 10 });

      expect(mockSubmissionsService.getMySubmissions).toHaveBeenCalledWith('user-uuid', 3, 10);
    });
  });

  // ── create (POST /v1/submissions) ───────────────────────────────────────────

  describe('create', () => {
    const photoBuffer = Buffer.from('fake-jpeg');

    it('calls createSubmission with parsed fields and returns void', async () => {
      mockSubmissionsService.createSubmission.mockResolvedValueOnce(undefined);

      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
          { type: 'field', fieldname: 'fuel_type', value: 'PB_95' },
          { type: 'field', fieldname: 'gps_lat', value: '52.2297' },
          { type: 'field', fieldname: 'gps_lng', value: '21.0122' },
          { type: 'field', fieldname: 'manual_price', value: '6.54' },
          { type: 'field', fieldname: 'preselected_station_id', value: 'station-abc' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await controller.create(req as any, 'user-uuid');

      expect(result).toBeUndefined();
      expect(mockSubmissionsService.createSubmission).toHaveBeenCalledWith(
        'user-uuid',
        photoBuffer,
        {
          fuelType: 'PB_95',
          gpsLat: 52.2297,
          gpsLng: 21.0122,
          manualPrice: 6.54,
          preselectedStationId: 'station-abc',
          // Story 3.20 — telemetry fields default to null when omitted by the
          // mobile client (pre-3.20 callers don't send them).
          gpsAcquiredAtCapture: null,
          gpsAcquisitionMs: null,
          overrideUsed: null,
          nearbyStationsCount: null,
        },
      );
    });

    it('parses empty string fields as null', async () => {
      mockSubmissionsService.createSubmission.mockResolvedValueOnce(undefined);

      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
          { type: 'field', fieldname: 'fuel_type', value: 'ON' },
          { type: 'field', fieldname: 'gps_lat', value: '' },
          { type: 'field', fieldname: 'gps_lng', value: '' },
          { type: 'field', fieldname: 'manual_price', value: '' },
          { type: 'field', fieldname: 'preselected_station_id', value: '' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await controller.create(req as any, 'user-uuid');

      expect(mockSubmissionsService.createSubmission).toHaveBeenCalledWith(
        'user-uuid',
        photoBuffer,
        {
          fuelType: 'ON',
          gpsLat: null,
          gpsLng: null,
          manualPrice: null,
          preselectedStationId: null,
          gpsAcquiredAtCapture: null,
          gpsAcquisitionMs: null,
          overrideUsed: null,
          nearbyStationsCount: null,
        },
      );
    });

    // Story 3.20 — telemetry fields parsed and forwarded.
    it('parses capture-screen telemetry fields when provided', async () => {
      mockSubmissionsService.createSubmission.mockResolvedValueOnce(undefined);

      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
          { type: 'field', fieldname: 'fuel_type', value: 'PB_95' },
          { type: 'field', fieldname: 'gps_acquired_at_capture', value: 'true' },
          { type: 'field', fieldname: 'gps_acquisition_ms', value: '3200' },
          { type: 'field', fieldname: 'override_used', value: 'false' },
          { type: 'field', fieldname: 'nearby_stations_count', value: '2' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await controller.create(req as any, 'user-uuid');

      expect(mockSubmissionsService.createSubmission).toHaveBeenCalledWith(
        'user-uuid',
        photoBuffer,
        expect.objectContaining({
          gpsAcquiredAtCapture: true,
          gpsAcquisitionMs: 3200,
          overrideUsed: false,
          nearbyStationsCount: 2,
        }),
      );
    });

    it('rejects absurd telemetry values via the int parser clamp', async () => {
      mockSubmissionsService.createSubmission.mockResolvedValueOnce(undefined);

      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
          { type: 'field', fieldname: 'fuel_type', value: 'PB_95' },
          // Above GPS_ACQUISITION_MS_MAX (10 minutes) → null
          { type: 'field', fieldname: 'gps_acquisition_ms', value: '99999999' },
          // Negative → null
          { type: 'field', fieldname: 'nearby_stations_count', value: '-5' },
          // Garbage bool → null
          { type: 'field', fieldname: 'override_used', value: 'maybe' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await controller.create(req as any, 'user-uuid');

      expect(mockSubmissionsService.createSubmission).toHaveBeenCalledWith(
        'user-uuid',
        photoBuffer,
        expect.objectContaining({
          gpsAcquisitionMs: null,
          nearbyStationsCount: null,
          overrideUsed: null,
        }),
      );
    });

    // P5 (3.20 review) — field-specific clamps. Previously a shared max
    // would let nearby_stations_count: 500_000 through (above NEARBY_COUNT_MAX
    // = 99 but below GPS_ACQUISITION_MS_MAX = 600_000). Verify each field
    // is rejected against its own upper bound.
    it('rejects nearby_stations_count above 99 (its field-specific cap)', async () => {
      mockSubmissionsService.createSubmission.mockResolvedValueOnce(undefined);

      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
          { type: 'field', fieldname: 'fuel_type', value: 'PB_95' },
          // 100 is just over the cap — should be rejected
          { type: 'field', fieldname: 'nearby_stations_count', value: '100' },
          // 5_000 is well within GPS_ACQUISITION_MS_MAX — should pass
          { type: 'field', fieldname: 'gps_acquisition_ms', value: '5000' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await controller.create(req as any, 'user-uuid');

      expect(mockSubmissionsService.createSubmission).toHaveBeenCalledWith(
        'user-uuid',
        photoBuffer,
        expect.objectContaining({
          nearbyStationsCount: null,
          gpsAcquisitionMs: 5000,
        }),
      );
    });

    it('throws BadRequestException when request is not multipart', async () => {
      const req = makeMockReq({ isMultipart: false, parts: [] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(controller.create(req as any, 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSubmissionsService.createSubmission).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when photo field is missing', async () => {
      const req = makeMockReq({
        parts: [{ type: 'field', fieldname: 'fuel_type', value: 'PB_95' }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(controller.create(req as any, 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSubmissionsService.createSubmission).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when fuel_type field is missing', async () => {
      const req = makeMockReq({
        parts: [
          { type: 'file', fieldname: 'photo', toBuffer: async () => photoBuffer },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(controller.create(req as any, 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSubmissionsService.createSubmission).not.toHaveBeenCalled();
    });
  });
});
