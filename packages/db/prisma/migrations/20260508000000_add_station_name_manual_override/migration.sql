-- Story 3.19 — Admin manual rename of stations.
-- Adds a nullable timestamp that the station-sync upsert respects: when
-- non-null, the sync's ON CONFLICT branch preserves Station.name instead
-- of overwriting it from the Google Places result. Per-field flag (rather
-- than a global manual_override boolean) keeps protection narrow — admin
-- shouldn't have to refresh every Google-managed field on a renamed
-- station; address / location continue to follow Google.
-- Additive, no backfill needed.
ALTER TABLE "Station" ADD COLUMN "name_manually_set_at" TIMESTAMP(3);
