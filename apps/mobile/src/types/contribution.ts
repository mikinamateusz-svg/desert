import type { FuelType } from '@desert/types';

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
}
