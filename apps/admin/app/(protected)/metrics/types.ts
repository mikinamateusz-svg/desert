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

export type FreshnessSortBy = 'lastPriceAt' | 'voivodeship' | 'priceSource';
export type FreshnessSortOrder = 'asc' | 'desc';
export type PriceSource = 'community' | 'admin_override' | 'seeded';

export interface FreshnessRowDto {
  stationId: string;
  stationName: string;
  address: string | null;
  voivodeship: string | null;
  priceSource: PriceSource | null;
  lastPriceAt: string | null;
  isStale: boolean;
}

export interface FreshnessDashboardDto {
  data: FreshnessRowDto[];
  total: number;
  page: number;
  limit: number;
  staleCount: number;
}

// ── Story 6.8 — Notifications & Alert Engagement Analytics ─────────────────

export type NotifPeriod = '7d' | '30d' | '90d' | 'all';

export interface RepromptStats {
  trigger: 'photo' | 'monthly';
  shown: number;
  dismissed: number;
  granted: number;
  conversionRate: number;
}

export interface AlertEngagementStats {
  alertType: string;
  sent: number;
  opened: number;
  engagementRate: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface NotificationAnalyticsDto {
  period: NotifPeriod;
  totalUsers: number;
  pushGrantedUsers: number;
  pushGrantRate: number;
  optInRates: {
    priceDrop: number;
    communityRise: number;
    predictiveRise: number;
    monthlySummary: number;
  };
  configBreakdown: {
    radius: { km5: number; km10: number; km25: number };
    dropMode: { cheaperThanNow: number; targetPrice: number };
  };
  repromptStats: RepromptStats[];
  alertEngagement: AlertEngagementStats[];
  pushGrantTrend: TrendPoint[];
}
