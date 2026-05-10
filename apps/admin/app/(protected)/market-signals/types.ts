// Story 4.12 — types extracted from actions.ts so the 'use server' file
// only exports async functions (Turbopack-safe per the Story 4.7 lesson).

export type SignalType =
  | 'orlen_rack_pb95'
  | 'orlen_rack_on'
  | 'orlen_rack_lpg'
  | 'brent_crude_pln';

export type RateSource = 'live' | 'cached' | null;

export interface SignalSummary {
  signalType: SignalType;
  value: number | null;
  pctChange: number | null;
  recordedAt: string | null;
  rateSource: RateSource;
}

export interface SummaryResponse {
  signals: SignalSummary[];
}

export interface HistoryRow {
  recordedAt: string;
  value: number;
  pctChange: number | null;
  rateSource: RateSource;
  significantMovement: boolean;
}

export interface HistoryResponse {
  signalType: SignalType;
  rows: HistoryRow[];
}
