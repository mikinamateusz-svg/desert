-- Story 3.20 — capture-screen telemetry on Submission.
-- Four diagnostic columns set by the mobile client at submission time. Used
-- to tune the GPS-gate timeout post-launch and to diagnose why a submission
-- landed unmatched (no GPS at capture vs override-used vs no nearby station).
-- All nullable; pre-3.20 rows stay null. Additive, no backfill.
ALTER TABLE "Submission"
  ADD COLUMN "gps_acquired_at_capture" BOOLEAN,
  ADD COLUMN "gps_acquisition_ms" INTEGER,
  ADD COLUMN "override_used" BOOLEAN,
  ADD COLUMN "nearby_stations_count" INTEGER;
