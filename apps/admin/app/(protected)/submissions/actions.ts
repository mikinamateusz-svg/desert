'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, adminFetch } from '../../../lib/admin-api';

export type ActionResult = { error: string } | null;

export async function approveSubmission(submissionId: string): Promise<ActionResult> {
  try {
    await adminFetch(`/v1/admin/submissions/${submissionId}/approve`, { method: 'POST' });
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409) {
      return { error: 'conflict' };
    }
    return { error: 'generic' };
  }
  redirect('/submissions');
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
