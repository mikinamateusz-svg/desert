// Story 6.1 + 6.2 — alert queue names + job shapes.
// Centralised here so PhotoPipelineWorker can import the types without
// pulling in the worker classes (which would force AlertModule import
// cycles at type-only positions).

// ── Story 6.1: price-drop alerts ──────────────────────────────────────────

export const PRICE_DROP_CHECKS_QUEUE = 'price-drop-checks';
export const PRICE_DROP_CHECK_JOB = 'price-drop-check';

export interface PriceDropCheckJobData {
  stationId: string;
  fuelType: string;        // e.g. 'PB_95', 'ON', 'LPG'
  newPricePln: number;     // verified price PLN/litre
  stationVoivodeship: string | null;
  verifiedAt: string;      // ISO datetime — for audit + 30-min batching window
}

// ── Story 6.2: community-confirmed rise alerts ────────────────────────────

export const COMMUNITY_RISE_CHECKS_QUEUE = 'community-rise-checks';
export const COMMUNITY_RISE_CHECK_JOB = 'community-rise-check';

export interface CommunityRiseCheckJobData {
  voivodeship: string;
  fuelType: string;
  triggeredByStationId: string; // station whose verified submission triggered this check
  verifiedAt: string;
}
