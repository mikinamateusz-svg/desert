import type { CaptureResult } from '../types/contribution';
import { insertQueueEntry } from './queueDb';
import { processQueue } from './queueProcessor';

/**
 * Persist a captured photo to the local SQLite queue and immediately
 * trigger a background upload attempt.
 *
 * The insertion is synchronous — callers can navigate to the confirmation
 * screen right after this returns. The upload happens fire-and-forget.
 */
export async function enqueueSubmission(result: CaptureResult): Promise<void> {
  insertQueueEntry({
    photoUri: result.photoUri,
    fuelType: result.fuelType,
    manualPrice: result.manualPrice,
    preselectedStationId: result.preselectedStationId,
    gpsLat: result.gpsLat,
    gpsLng: result.gpsLng,
    capturedAt: result.capturedAt,
  });
  // Fire-and-forget — caller does not await the network upload
  void processQueue();
}
