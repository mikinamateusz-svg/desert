// Story 6.1 — price-drop alert queue + job shape.
// Lives in its own file so PhotoPipelineWorker can import the type
// without pulling in the worker (which would create a module cycle
// at instantiation time via AlertModule ↔ PhotoModule).

export const PRICE_DROP_CHECKS_QUEUE = 'price-drop-checks';
export const PRICE_DROP_CHECK_JOB = 'price-drop-check';

export interface PriceDropCheckJobData {
  stationId: string;
  fuelType: string;        // e.g. 'PB_95', 'ON', 'LPG'
  newPricePln: number;     // verified price PLN/litre
  stationVoivodeship: string | null;
  verifiedAt: string;      // ISO datetime — for audit + 30-min batching window
}
