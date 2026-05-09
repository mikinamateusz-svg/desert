/**
 * Story 6.0 — shared market-signal types used across OrlenIngestionService,
 * BrentIngestionService, PriceRiseSignalPublisher, and the Phase 2 alert
 * pipeline (Stories 6.1/6.2/6.3 consume these via the
 * `price-rise-signals` BullMQ queue).
 */

/**
 * One per-signal-type movement record produced during a single ingestion
 * run. The publisher filters this list by upward movement ≥ 3% to decide
 * whether to enqueue a price-rise-signal job.
 */
export interface MovementRecord {
  /** signal_type column value (e.g. 'orlen_rack_pb95', 'brent_crude_pln') */
  signalType: string;
  /** Fraction; positive = upward. Null when no previous value to compare. */
  pctChange: number | null;
  /** True when |pctChange| ≥ 3% — mirrors the schema column */
  significantMovement: boolean;
  recordedAt: Date;
}

// ── price-rise-signals queue contract ──────────────────────────────────────

export const PRICE_RISE_SIGNALS_QUEUE = 'price-rise-signals';
export const PRICE_RISE_SIGNAL_JOB = 'price-rise-signal';

/**
 * Job payload published by PriceRiseSignalPublisher and consumed by
 * Story 6.3's PredictiveRiseAlertWorker. Story 6.2 also reads the dedup
 * key Story 6.3 sets per fuel type.
 */
export interface PriceRiseSignalJobData {
  signalSource: 'orlen_rack' | 'brent_crude_pln';
  fuelTypes: string[]; // e.g. ['PB_95', 'PB_98'] for orlen_rack_pb95
  pctMovement: number; // positive fraction (0.035 = 3.5% upward)
  signalType: string;  // raw signal_type column value
  recordedAt: string;  // ISO datetime
}

/**
 * Map signal types to the user-facing fuel types that should be alerted
 * when that signal moves. Brent crude is a crude-derived signal that
 * affects gasoline + diesel but NOT LPG (different feedstock chain).
 */
export const SIGNAL_FUEL_TYPES: Record<string, string[]> = {
  orlen_rack_pb95: ['PB_95', 'PB_98'],
  orlen_rack_on: ['ON', 'ON_PREMIUM'],
  orlen_rack_lpg: ['LPG'],
  brent_crude_pln: ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM'],
};
