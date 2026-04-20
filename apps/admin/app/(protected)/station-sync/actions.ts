'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';

export interface SyncStatusResult {
  status: 'idle' | 'running' | 'failed';
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  stationCount: number;
}

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
