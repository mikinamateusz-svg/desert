export interface FlaggedSubmissionRow {
  id: string;
  station_id: string | null;
  station_name: string | null;
  price_data: Array<{ fuel_type: string; price_per_litre: number }>;
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
