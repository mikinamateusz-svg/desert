'use server';

// Files marked 'use server' may only export async functions — see types.ts
// for the SignalSummary / HistoryRow shapes (Story 4.7 hotfix lesson).
import { adminFetch } from '../../../lib/admin-api';
import type { HistoryResponse, SignalType, SummaryResponse } from './types';

export async function fetchSummary(): Promise<{ data?: SummaryResponse; error?: string }> {
  try {
    const data = await adminFetch<SummaryResponse>('/v1/admin/market-signals/summary');
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load market signals.' };
  }
}

export async function fetchHistory(
  signalType: SignalType,
  limit = 30,
): Promise<{ data?: HistoryResponse; error?: string }> {
  try {
    const data = await adminFetch<HistoryResponse>(
      `/v1/admin/market-signals/${signalType}/history?limit=${limit}`,
    );
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load history.' };
  }
}
