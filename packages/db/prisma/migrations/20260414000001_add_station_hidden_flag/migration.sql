-- Story 2.15: Add hidden flag to Station for admin data cleanup.
-- Hidden stations are excluded from public nearby queries but persist across syncs.
ALTER TABLE "Station" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
