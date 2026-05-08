import type { FuelType } from '@desert/types';

/**
 * Story 3.20 — capture-screen telemetry. Passed through from the capture
 * screen via captureQueue → multipart payload → backend Submission row.
 * All four optional; pre-3.20 callers omit them and the row stays null.
 */
export interface CaptureTelemetry {
  /** Was `location` non-null at the moment the user pressed the shutter? */
  gpsAcquiredAtCapture: boolean;
  /** Elapsed ms from screen mount/focus to first GPS fix; null if never acquired. */
  gpsAcquisitionMs: number | null;
  /** Did the shutter fire while the override timeout state was active? */
  overrideUsed: boolean;
  /** Count of nearby stations within radius at capture time, capped at 99. */
  nearbyStationsCount: number;
}

export interface CaptureResult {
  photoUri: string;
  fuelType: FuelType;
  manualPrice?: number;
  preselectedStationId?: string;
  /** undefined when GPS was not resolved at capture time */
  gpsLat?: number;
  /** undefined when GPS was not resolved at capture time */
  gpsLng?: number;
  capturedAt: string;
  /** Story 3.20 — capture diagnostics. Optional for pre-3.20 callers. */
  telemetry?: CaptureTelemetry;
}
