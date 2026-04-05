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
