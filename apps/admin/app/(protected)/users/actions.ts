'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch } from '../../../lib/admin-api';

export async function shadowBanUser(userId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/users/${userId}/shadow-ban`, { method: 'POST' });
    revalidatePath(`/users/${userId}`);
    revalidatePath('/users');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to shadow ban user.' };
  }
}

export async function unbanUser(userId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/users/${userId}/unban`, { method: 'POST' });
    revalidatePath(`/users/${userId}`);
    revalidatePath('/users');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to remove ban.' };
  }
}

export async function dismissAlert(
  userId: string,
  alertId: string,
): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/users/${userId}/alerts/${alertId}/dismiss`, { method: 'POST' });
    revalidatePath(`/users/${userId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to dismiss alert.' };
  }
}
