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

// ── Story 3.16: paired-review actions on a price_conflict pair ─────────────

export async function approveNewerInConflict(
  conflictGroupId: string,
  newerSubmissionId: string,
): Promise<ActionResult> {
  try {
    await adminFetch(`/v1/admin/submissions/conflict/${conflictGroupId}/approve-newer`, {
      method: 'POST',
      body: JSON.stringify({ submission_id: newerSubmissionId }),
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'conflict' };
    // P-10 (3.17 review) — 400 BadRequest from the paired-review endpoints
    // means the UI is stale (e.g., the submission_id no longer matches the
    // expected newer/older half). Surface a distinct error so the admin
    // gets a "stale view — refresh" hint instead of a generic toast.
    if (e instanceof AdminApiError && e.status === 400) return { error: 'badRequest' };
    return { error: 'generic' };
  }
  redirect('/submissions');
}

// Story 3.17 — symmetric Approve older action.
export async function approveOlderInConflict(
  conflictGroupId: string,
  olderSubmissionId: string,
): Promise<ActionResult> {
  try {
    await adminFetch(`/v1/admin/submissions/conflict/${conflictGroupId}/approve-older`, {
      method: 'POST',
      body: JSON.stringify({ submission_id: olderSubmissionId }),
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'conflict' };
    // P-10 (3.17 review) — 400 BadRequest from the paired-review endpoints
    // means the UI is stale (e.g., the submission_id no longer matches the
    // expected newer/older half). Surface a distinct error so the admin
    // gets a "stale view — refresh" hint instead of a generic toast.
    if (e instanceof AdminApiError && e.status === 400) return { error: 'badRequest' };
    return { error: 'generic' };
  }
  redirect('/submissions');
}

export async function markNewerUnusableInConflict(
  conflictGroupId: string,
  newerSubmissionId: string,
): Promise<ActionResult> {
  try {
    await adminFetch(`/v1/admin/submissions/conflict/${conflictGroupId}/newer-unusable`, {
      method: 'POST',
      body: JSON.stringify({ submission_id: newerSubmissionId }),
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'conflict' };
    // P-10 (3.17 review) — 400 BadRequest from the paired-review endpoints
    // means the UI is stale (e.g., the submission_id no longer matches the
    // expected newer/older half). Surface a distinct error so the admin
    // gets a "stale view — refresh" hint instead of a generic toast.
    if (e instanceof AdminApiError && e.status === 400) return { error: 'badRequest' };
    return { error: 'generic' };
  }
  redirect('/submissions');
}

export async function markBothUnusableInConflict(
  conflictGroupId: string,
): Promise<ActionResult> {
  try {
    await adminFetch(`/v1/admin/submissions/conflict/${conflictGroupId}/both-unusable`, {
      method: 'POST',
    });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) return { error: 'conflict' };
    // P-10 (3.17 review) — 400 BadRequest from the paired-review endpoints
    // means the UI is stale (e.g., the submission_id no longer matches the
    // expected newer/older half). Surface a distinct error so the admin
    // gets a "stale view — refresh" hint instead of a generic toast.
    if (e instanceof AdminApiError && e.status === 400) return { error: 'badRequest' };
    return { error: 'generic' };
  }
  redirect('/submissions');
}

export async function detectLocaleAction(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get('locale')?.value ?? 'pl';
}
