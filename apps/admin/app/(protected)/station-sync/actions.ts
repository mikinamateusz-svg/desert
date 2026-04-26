'use server';

// Files marked 'use server' may only export async functions — see types.ts
// for SyncStatusResult and the metrics actions.ts hotfix for the cautionary tale.
import { revalidatePath } from 'next/cache';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';
import type { SyncStatusResult } from './types';

export async function fetchSyncStatus(): Promise<{ data?: SyncStatusResult; error?: string }> {
  try {
    const data = await adminFetch<SyncStatusResult>('/v1/admin/stations/sync/status');
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load status.' };
  }
}

export async function triggerSync(): Promise<{ error?: string }> {
  try {
    await adminFetch('/v1/admin/stations/sync', { method: 'POST' });
    revalidatePath('/station-sync');
    return {};
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'already_running' };
    return { error: e instanceof Error ? e.message : 'Failed to trigger sync.' };
  }
}
