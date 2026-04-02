import type { CaptureResult } from '../types/contribution';

/**
 * Stub for the Story 3.2 offline queue interface.
 * Story 3.2 will replace this implementation without changing callers.
 */
export async function enqueueSubmission(result: CaptureResult): Promise<void> {
  // TODO Story 3.2: persist to SQLite offline queue
  console.log('[captureQueue] enqueueSubmission (stub):', result.capturedAt, result.fuelType);
}
