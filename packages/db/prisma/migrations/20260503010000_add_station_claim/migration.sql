-- Story 7.1: station ownership claims (partner portal first story).
--
-- Workflow:
--   - Owner submits claim via the partner portal.
--   - If their account email's domain matches a known chain whitelist
--     AND the station's brand matches the chain → status APPROVED at
--     submission time, STATION_MANAGER role granted.
--   - Otherwise → status PENDING, surfaces in the admin claim queue.
--   - Ops verifies via phone callback to the station's published number
--     OR document upload (Story 7.2) → APPROVED / REJECTED / AWAITING_DOCS.

CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'AWAITING_DOCS', 'APPROVED', 'REJECTED');
CREATE TYPE "ClaimMethod" AS ENUM ('DOMAIN_MATCH', 'PHONE_CALLBACK', 'DOCUMENT', 'HEAD_OFFICE_EMAIL');

CREATE TABLE "StationClaim" (
    "id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "verification_method_used" "ClaimMethod",
    "applicant_notes" TEXT,
    "verification_evidence" JSONB,
    "reviewer_notes" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,

    CONSTRAINT "StationClaim_pkey" PRIMARY KEY ("id")
);

-- One claim row per (station, user). Re-submissions after REJECTED reuse
-- the row (admin updates status back to PENDING + clears rejection_reason).
CREATE UNIQUE INDEX "StationClaim_station_id_user_id_key"
    ON "StationClaim"("station_id", "user_id");

-- Per-station listing: "show me everyone who has tried to claim this station"
-- (used by admin queue to detect dupes / contested claims).
CREATE INDEX "StationClaim_station_id_idx" ON "StationClaim"("station_id");

-- Per-user listing: "show me my claims" (partner portal home).
CREATE INDEX "StationClaim_user_id_idx" ON "StationClaim"("user_id");

-- Status-filtered queue: admin landing page filters by PENDING / AWAITING_DOCS.
CREATE INDEX "StationClaim_status_idx" ON "StationClaim"("status");

-- RESTRICT on station_id mirrors the FillUp / OdometerReading pattern:
-- a station with active claims must have those claims handled before the
-- station row can be deleted.
ALTER TABLE "StationClaim" ADD CONSTRAINT "StationClaim_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "Station"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on user_id — account deletion (Story 1.8) must clean up
-- claims first or hit a FK error.
ALTER TABLE "StationClaim" ADD CONSTRAINT "StationClaim_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
