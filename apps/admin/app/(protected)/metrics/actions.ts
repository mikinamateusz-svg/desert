'use server';

// Files marked 'use server' may only export async functions — re-exporting types
// here causes Turbopack to register them as runtime server references, which
// crashes at module evaluation with "ReferenceError: <Type> is not defined".
// Consumers import these types directly from './types'.
import { adminFetch } from '../../../lib/admin-api';
import type {
  PipelineHealthDto,
  FunnelMetricsDto,
  FunnelDrilldownDto,
  ProductMetricsDto,
  ApiCostMetricsDto,
} from './types';

export async function fetchPipelineHealth(): Promise<{ data?: PipelineHealthDto; error?: string }> {
  try {
    const data = await adminFetch<PipelineHealthDto>('/v1/admin/metrics/pipeline');
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load pipeline health.' };
  }
}

export async function fetchFunnelMetrics(
  period: string,
): Promise<{ data?: FunnelMetricsDto; error?: string }> {
  try {
    const data = await adminFetch<FunnelMetricsDto>(`/v1/admin/metrics/funnel?period=${period}`);
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load funnel metrics.' };
  }
}

export async function fetchFunnelDrilldown(
  reason: string,
  period: string,
  page: number,
): Promise<{ data?: FunnelDrilldownDto; error?: string }> {
  try {
    const data = await adminFetch<FunnelDrilldownDto>(
      `/v1/admin/metrics/funnel/drilldown?reason=${encodeURIComponent(reason)}&period=${period}&page=${page}`,
    );
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load drilldown.' };
  }
}

export async function fetchProductMetrics(
  period: string,
): Promise<{ data?: ProductMetricsDto; error?: string }> {
  try {
    const data = await adminFetch<ProductMetricsDto>(`/v1/admin/metrics/product?period=${period}`);
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load product metrics.' };
  }
}

export async function fetchApiCostMetrics(): Promise<{ data?: ApiCostMetricsDto; error?: string }> {
  try {
    const data = await adminFetch<ApiCostMetricsDto>('/v1/admin/metrics/cost');
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load API cost metrics.' };
  }
}
