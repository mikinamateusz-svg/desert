import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { getToken } from '../lib/secure-storage';
import { refreshSessionFromModule } from '../store/auth.store';
import { getDueEntries, markFailed, markRetry, markSuccess, unfailAllQueueEntries } from './queueDb';
import { PermanentUploadError, TokenExpiredError, uploadSubmission } from '../api/submissions';

/** One-shot recovery flag for the Story 3.11 401-as-permanent bug.
 *  v2 bump: first round revived entries, but then the API's submissions endpoint
 *  was returning 403 to ADMIN users, so entries got markFailed'd a second time.
 *  Revive them once more now that the API allows ADMIN to submit. */
const UNFAIL_MIGRATION_KEY = 'desert:migration:3.11-unfail-done-v2';

let _running = false;
let _unsubscribeNetInfo: (() => void) | null = null;
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let _processingLock = false;

export function startQueueProcessor(): void {
  if (_running) return;
  _running = true;

  // One-shot recovery for the Story 3.11 401-as-permanent bug. Run at most once
  // per install so future genuine `failed` entries (e.g. markFailed after a
  // permanent 4xx, or retry_count exhaustion) stay failed across restarts.
  void runUnfailMigrationOnce();

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

async function runUnfailMigrationOnce(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(UNFAIL_MIGRATION_KEY);
    if (done === 'true') return;
    const revived = unfailAllQueueEntries();
    await AsyncStorage.setItem(UNFAIL_MIGRATION_KEY, 'true');
    if (revived > 0) {
      console.log(`[queueProcessor] 3.11 migration revived ${revived} previously-failed queue entries`);
    }
  } catch {
    // If AsyncStorage fails, skip rather than run the migration on every boot.
  }
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
    let accessToken = await getToken();
    if (!accessToken) return; // not signed in — skip silently

    const entries = getDueEntries();
    for (const entry of entries) {
      try {
        await uploadSubmission(accessToken, entry);
        markSuccess(entry.id);
      } catch (err) {
        if (err instanceof TokenExpiredError) {
          // Access token expired mid-loop. Refresh once; if it works, retry this
          // same entry with the new token. If refresh fails, schedule this entry
          // for a later retry (NOT permanent — the user may re-login later and
          // we want their photos to still upload then).
          const refreshed = await refreshSessionFromModule();
          if (refreshed) {
            accessToken = refreshed;
            try {
              await uploadSubmission(accessToken, entry);
              markSuccess(entry.id);
              continue;
            } catch (retryErr) {
              if (retryErr instanceof PermanentUploadError) {
                markFailed(entry.id);
              } else {
                markRetry(entry.id, entry.retry_count);
              }
              continue;
            }
          }
          // No refresh token available or refresh failed. Leave the entry as
          // pending with a backoff so a later login can pick it up.
          markRetry(entry.id, entry.retry_count);
          // Bail out of the loop — no point trying the remaining entries with
          // a dead session; they'd all hit the same error.
          break;
        }

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
