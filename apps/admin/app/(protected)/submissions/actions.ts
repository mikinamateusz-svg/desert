'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, adminFetch } from '../../../lib/admin-api';
import type { StationRow, StationListResult } from '../../../lib/types';

export type ActionResult = { error: string } | null;

export async function approveSubmission(
  submissionId: string,
  overridePrices?: Array<{ fuel_type: string; price_per_litre: number }>,
  overrideStationId?: string,
): Promise<ActionResult> {
  const body: Record<string, unknown> = {};
  if (overridePrices && overridePrices.length > 0) body.prices = overridePrices;
  if (overrideStationId) body.stationId = overrideStationId;
  try {
    await adminFetch(`/v1/admin/submissions/${submissionId}/approve`, {
      method: 'POST',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) {
      return { error: 'conflict' };
    }
    return { error: 'generic' };
  }
  redirect('/submissions');
}

export async function searchStations(query: string): Promise<StationRow[]> {
  const result = await adminFetch<StationListResult>(
    `/v1/admin/stations?search=${encodeURIComponent(query)}&limit=10`,
  );
  return result?.data ?? [];
}

export async function rejectSubmission(
  submissionId: string,
  notes: string | null,
): Promise<ActionResult> {
  const body = JSON.stringify({ notes });
  try {
    await adminFetch(`/v1/admin/submissions/${submissionId}/reject`, {
      method: 'POST',
      body,
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) {
      return { error: 'conflict' };
    }
    return { error: 'generic' };
  }
  redirect('/submissions');
}

export async function detectLocaleAction(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get('locale')?.value ?? 'pl';
}
