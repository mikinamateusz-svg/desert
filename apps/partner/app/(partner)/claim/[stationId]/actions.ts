'use server';

import { revalidatePath } from 'next/cache';
import { partnerFetch, PartnerApiError } from '../../../../lib/partner-api';
import type { MyClaim } from '../../../../lib/types';

export type SubmitClaimResult =
  | { ok: true; claim: MyClaim }
  | { ok: false; error: 'alreadyClaimed' | 'alreadyPending' | 'alreadyApproved' | 'generic' };

/**
 * Server action for the partner-portal claim submission form. Returns
 * a typed result so the client form can localise the error message
 * without needing to interpret raw API status codes.
 *
 * 409 from the API can mean one of three distinct conflicts (already
 * pending, already approved by self, already approved by other) — we
 * map by the error message body the service throws since the API
 * surfaces all three with 409 ConflictException.
 */
export async function submitClaim(
  stationId: string,
  applicantNotes: string,
): Promise<SubmitClaimResult> {
  try {
    const claim = await partnerFetch<MyClaim>('/v1/me/station-claims', {
      method: 'POST',
      body: JSON.stringify({
        stationId,
        applicantNotes: applicantNotes.trim() || undefined,
      }),
    });
    // Revalidate the home page so the new claim shows up immediately
    // when the user navigates back. The dynamic claim-detail success
    // screen renders the response inline so it doesn't need this.
    revalidatePath('/home');
    return { ok: true, claim };
  } catch (e) {
    if (e instanceof PartnerApiError && e.status === 409) {
      const msg = e.message.toLowerCase();
      if (msg.includes('already managed by a verified owner')) return { ok: false, error: 'alreadyClaimed' };
      if (msg.includes('already been verified')) return { ok: false, error: 'alreadyApproved' };
      // pending or awaiting-docs collapse to one user-visible state.
      if (msg.includes('pending review') || msg.includes('awaiting documents')) {
        return { ok: false, error: 'alreadyPending' };
      }
    }
    return { ok: false, error: 'generic' };
  }
}
