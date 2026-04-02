import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { getToken } from '../lib/secure-storage';
import { getDueEntries, markFailed, markRetry, markSuccess } from './queueDb';
import { PermanentUploadError, uploadSubmission } from '../api/submissions';

let _running = false;
let _unsubscribeNetInfo: (() => void) | null = null;
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let _processingLock = false;

export function startQueueProcessor(): void {
  if (_running) return;
  _running = true;

  // Attempt immediately in case there are queued items from a prior session
  void processQueue();

  // Retry when connectivity is restored
  _unsubscribeNetInfo = NetInfo.addEventListener(state => {
    // null = unknown connectivity — attempt rather than skip
    if (state.isConnected !== false) void processQueue();
  });

  // Retry when app comes to the foreground
  _appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (nextState === 'active') void processQueue();
  });
}

export function stopQueueProcessor(): void {
  _running = false;
  _unsubscribeNetInfo?.();
  _appStateSubscription?.remove();
  _unsubscribeNetInfo = null;
  _appStateSubscription = null;
}

/**
 * Process all due queue entries sequentially.
 * Re-entrant calls are dropped via _processingLock — prevents duplicate uploads
 * when NetInfo and AppState both fire at the same time.
 */
export async function processQueue(): Promise<void> {
  if (_processingLock) return;
  _processingLock = true;

  try {
    const accessToken = await getToken();
    if (!accessToken) return; // not signed in — skip silently

    const entries = getDueEntries();
    for (const entry of entries) {
      try {
        await uploadSubmission(accessToken, entry);
        markSuccess(entry.id);
      } catch (err) {
        if (err instanceof PermanentUploadError || entry.retry_count >= 3) {
          markFailed(entry.id);
        } else {
          markRetry(entry.id, entry.retry_count);
        }
      }
    }
  } finally {
    _processingLock = false;
  }
}
