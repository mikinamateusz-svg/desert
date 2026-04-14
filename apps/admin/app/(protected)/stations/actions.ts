'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch } from '../../../lib/admin-api';

export async function overridePrice(
  stationId: string,
  fuelType: string,
  price: number,
  reason: string,
): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/stations/${stationId}/override-price`, {
      method: 'POST',
      body: JSON.stringify({ fuelType, price, reason }),
    });
    revalidatePath(`/stations/${stationId}`);
    revalidatePath('/stations');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to override price.' };
  }
}

export async function refreshCache(stationId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/stations/${stationId}/refresh-cache`, {
      method: 'POST',
    });
    revalidatePath(`/stations/${stationId}`);
    revalidatePath('/stations');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to refresh cache.' };
  }
}

export async function hideStation(stationId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/stations/${stationId}/hide`, { method: 'POST' });
    revalidatePath('/stations');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to hide station.' };
  }
}

export async function unhideStation(stationId: string): Promise<{ error?: string }> {
  try {
    await adminFetch(`/v1/admin/stations/${stationId}/unhide`, { method: 'POST' });
    revalidatePath('/stations');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to unhide station.' };
  }
}
