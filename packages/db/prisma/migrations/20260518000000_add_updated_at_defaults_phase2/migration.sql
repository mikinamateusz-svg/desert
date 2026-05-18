-- Story 0.1 Fix 3 extension — Phase 2 model coverage.
--
-- The original April migration (20260408000002_add_updated_at_defaults) added
-- DEFAULT NOW() on `updated_at` for 6 models that existed at the time:
--   User / Station / Submission / UserConsent / NotificationPreference / StationFuelStaleness
--
-- Phase 2 added 7 more models with `@updatedAt` columns that never got the
-- DB-level default. The Prisma ORM layer still manages them on every UPDATE,
-- but a raw `$executeRaw` INSERT that omits `updated_at` would write NULL
-- and trip downstream NOT NULL-style assumptions.
--
-- Same idempotent pattern as the April migration: backfill any NULLs, then
-- ALTER TABLE … SET DEFAULT NOW(). Safe to re-run.

UPDATE "ResearchPhoto"        SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "PriceValidationRule"  SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "SystemConfig"         SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "Vehicle"              SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "FillUp"               SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "StationClaim"         SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "DailyApiCost"         SET updated_at = NOW() WHERE updated_at IS NULL;

ALTER TABLE "ResearchPhoto"        ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "PriceValidationRule"  ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "SystemConfig"         ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "Vehicle"              ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "FillUp"               ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "StationClaim"         ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "DailyApiCost"         ALTER COLUMN updated_at SET DEFAULT NOW();
