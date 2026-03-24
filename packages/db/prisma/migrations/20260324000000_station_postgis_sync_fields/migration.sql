CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "google_places_id" TEXT UNIQUE;
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "location" geography(Point,4326);
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Station_location_idx" ON "Station" USING gist("location");
