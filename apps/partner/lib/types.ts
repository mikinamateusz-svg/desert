// Wire shapes for partner-portal API responses. Mirrors the API DTOs
// in apps/api/src/station-claim/* — kept in sync manually until a
// shared types package emerges (cross-cutting refactor).

export type ClaimStatusValue = 'PENDING' | 'AWAITING_DOCS' | 'APPROVED' | 'REJECTED';
export type ClaimMethodValue = 'DOMAIN_MATCH' | 'PHONE_CALLBACK' | 'DOCUMENT' | 'HEAD_OFFICE_EMAIL';

export interface PartnerStation {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
  google_places_id?: string | null;
  lat?: number;
  lng?: number;
}

export interface ClaimStation {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
}

export interface MyClaim {
  id: string;
  station_id: string;
  status: ClaimStatusValue;
  verification_method_used: ClaimMethodValue | null;
  applicant_notes: string | null;
  reviewer_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  station: ClaimStation;
}
