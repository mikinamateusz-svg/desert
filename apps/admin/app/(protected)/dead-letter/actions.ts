'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch } from '../../../lib/admin-api';

export async function retryDlqJob(jobId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/dlq/${jobId}/retry`, { method: 'POST' });
    revalidatePath('/dead-letter');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to retry job.' };
  }
}

export async function discardDlqJob(jobId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/dlq/${jobId}/discard`, { method: 'POST' });
    revalidatePath('/dead-letter');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to discard job.' };
  }
}
