'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch } from '../../../../lib/admin-api';
import type { ClaimMethodValue } from '../../../../lib/types';

export interface ApproveInput {
  method: Exclude<ClaimMethodValue, 'DOMAIN_MATCH'>;
  reviewerNotes?: string;
  /** Free-form admin-only evidence bag — call summary, doc URL, etc. */
  verificationEvidence?: Record<string, unknown>;
}

export async function approveClaim(
  claimId: string,
  input: ApproveInput,
): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/station-claims/${claimId}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    // Revalidate both the detail page and the queue listing — the latter
    // because the row's status badge + position move out of PENDING.
    revalidatePath(`/station-claims/${claimId}`);
    revalidatePath('/station-claims');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to approve claim.' };
  }
}

export interface RejectInput {
  rejectionReason: string;
  reviewerNotes?: string;
}

export async function rejectClaim(
  claimId: string,
  input: RejectInput,
): Promise<{ error?: string }> {
  if (!input.rejectionReason.trim()) {
    return { error: 'Rejection reason is required.' };
  }
  try {
    await adminFetch(`/v1/admin/station-claims/${claimId}/reject`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/station-claims/${claimId}`);
    revalidatePath('/station-claims');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to reject claim.' };
  }
}

export interface RequestDocsInput {
  reviewerNotes?: string;
}

export async function requestDocs(
  claimId: string,
  input: RequestDocsInput,
): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/station-claims/${claimId}/request-docs`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/station-claims/${claimId}`);
    revalidatePath('/station-claims');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to request documents.' };
  }
}
