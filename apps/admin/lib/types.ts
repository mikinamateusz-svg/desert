export interface FlaggedSubmissionRow {
  id: string;
  station_id: string | null;
  station_name: string | null;
  // JSONB column — runtime shape can have null price_per_litre on malformed
  // OCR rows. Type widened to match observed prod data; UI must guard.
  price_data: Array<{ fuel_type: string; price_per_litre: number | null }>;
  ocr_confidence_score: number | null;
  created_at: string;
  user_id: string;
  flag_reason: string;
}

export interface FlaggedSubmissionDetail extends FlaggedSubmissionRow {
  station_brand: string | null;
  photo_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

export interface SubmissionListResult {
  data: FlaggedSubmissionRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  trust_score: number;
  shadow_banned: boolean;
  submission_count: number;
  active_alert_count: number;
  created_at: string;
}

export interface UserListResult {
  data: UserRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UserSubmissionRow {
  id: string;
  station_id: string | null;
  price_data: unknown;
  status: string;
  flag_reason: string | null;
  created_at: string;
}

export interface AnomalyAlertRow {
  id: string;
  alert_type: string;
  detail: unknown;
  created_at: string;
  dismissed_at: string | null;
}

export interface DlqJobRow {
  jobId: string;
  submissionId: string;
  stationId: string | null;
  stationName: string | null;
  failureReason: string;
  attemptsMade: number;
  lastAttemptAt: string | null;
}

export interface StationRow {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
  hidden?: boolean;
}

export interface StationListResult {
  data: StationRow[];
  total: number;
  page: number;
  limit: number;
}

export interface StationPriceRow {
  fuel_type: string;
  price: number;
  source: string; // 'community' | 'admin_override' | 'seeded'
  recorded_at: string;
}

export interface StationDetail extends StationRow {
  prices: StationPriceRow[];
}

export interface UserDetail {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  trust_score: number;
  shadow_banned: boolean;
  submission_count: number;
  created_at: string;
  submissions: {
    data: UserSubmissionRow[];
    total: number;
  };
  alerts: AnomalyAlertRow[];
}

// ── Story 7.1 — station claims (admin queue) ─────────────────────────────

export type ClaimStatusValue = 'PENDING' | 'AWAITING_DOCS' | 'APPROVED' | 'REJECTED';
export type ClaimMethodValue = 'DOMAIN_MATCH' | 'PHONE_CALLBACK' | 'DOCUMENT' | 'HEAD_OFFICE_EMAIL';

export interface ClaimStation {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
  voivodeship?: string | null;
}

export interface ClaimUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
}

export interface StationClaimRow {
  id: string;
  station_id: string;
  user_id: string;
  status: ClaimStatusValue;
  verification_method_used: ClaimMethodValue | null;
  applicant_notes: string | null;
  reviewer_notes: string | null;
  rejection_reason: string | null;
  // verification_evidence is a flexible Json bag (phone-call summary,
  // doc URLs, head-office email subject) — typed `unknown` because the
  // shape varies per method.
  verification_evidence: unknown;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  station: ClaimStation;
  user: ClaimUser;
}

export interface StationClaimListResult {
  data: StationClaimRow[];
  total: number;
  page: number;
  limit: number;
}
