export interface PipelineHealthDto {
  successRate1h: number | null;
  processingTimeP50Seconds: number | null;
  processingTimeP95Seconds: number | null;
  queueDepth: number;
  activeJobs: number;
  dlqCount: number;
  errorBreakdown: { reason: string; count: number }[];
}

export interface FunnelMetricsDto {
  period: string;
  totalSubmissions: number;
  verified: number;
  verifiedPct: number;
  rejected: number;
  rejectedPct: number;
  shadowRejected: number;
  shadowRejectedPct: number;
  pending: number;
  dlqCount: number;
  rejectionBreakdown: { reason: string; count: number }[];
}

export interface FunnelDrilldownRow {
  id: string;
  stationId: string | null;
  stationName: string | null;
  createdAt: string;
  flagReason: string | null;
}

export interface FunnelDrilldownDto {
  data: FunnelDrilldownRow[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductMetricsDayDto {
  date: string;
  mapViews: number;
  authPct: number;
  newRegistrations: number;
}

export interface ProductMetricsDto {
  period: string;
  days: ProductMetricsDayDto[];
  totalMapViews: number;
  avgAuthPct: number;
  totalNewRegistrations: number;
}

export interface ApiCostPeriodDto {
  spendUsd: number;
  imageCount: number;
}

export interface ApiCostMonthDto {
  month: string;
  spendUsd: number;
  imageCount: number;
}

export interface ApiCostMetricsDto {
  today: ApiCostPeriodDto;
  currentWeek: ApiCostPeriodDto;
  currentMonth: ApiCostPeriodDto;
  last3Months: ApiCostMonthDto[];
}
