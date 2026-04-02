-- AlterTable: add temporary GPS columns to Submission for async pipeline use
-- These are nulled by the Story 3.4 worker after station matching completes.
ALTER TABLE "Submission" ADD COLUMN "gps_lat" DOUBLE PRECISION;
ALTER TABLE "Submission" ADD COLUMN "gps_lng" DOUBLE PRECISION;
