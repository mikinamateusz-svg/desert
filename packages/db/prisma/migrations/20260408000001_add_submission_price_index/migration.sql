-- Fix 2: Add partial index on Submission(station_id, created_at DESC) WHERE status='verified'.
-- This index covers the findPricesInArea query which uses DISTINCT ON (station_id) ORDER BY
-- station_id, created_at DESC WHERE status = 'verified'. A partial index keeps it selective.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Prisma wraps all migrations in a transaction by default, which will cause this to fail.
-- Apply this migration manually:
--
--   1. Run in psql / Railway console (outside a transaction):
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_submission_station_verified"
--          ON "Submission" (station_id, created_at DESC)
--          WHERE status = 'verified';
--
--   2. Then mark as applied so Prisma does not try to run it again:
--        npx prisma migrate resolve --applied 20260408000001_add_submission_price_index
--
-- Alternatively, remove CONCURRENTLY for a blocking (table-lock) build — safe on empty/low-traffic DB:
--        CREATE INDEX IF NOT EXISTS "idx_submission_station_verified"
--          ON "Submission" (station_id, created_at DESC)
--          WHERE status = 'verified';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_submission_station_verified"
  ON "Submission" (station_id, created_at DESC)
  WHERE status = 'verified';
