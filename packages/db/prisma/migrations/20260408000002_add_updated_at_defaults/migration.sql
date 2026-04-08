-- Fix 3: Add DEFAULT NOW() to updated_at columns so rows updated via raw SQL
-- (e.g. $executeRaw in classification worker) always get a valid timestamp.
-- Affects all 6 models that carry an @updatedAt field.
--
-- Backfill: NULL updated_at rows (pre-existing data) are set to NOW() first
-- so that the subsequent DEFAULT does not leave orphaned nulls in application queries.

UPDATE "User"                   SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "Station"                SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "Submission"             SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "UserConsent"            SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "NotificationPreference" SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE "StationFuelStaleness"   SET updated_at = NOW() WHERE updated_at IS NULL;

ALTER TABLE "User"                  ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "Station"               ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "Submission"            ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "UserConsent"           ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "NotificationPreference" ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE "StationFuelStaleness"  ALTER COLUMN updated_at SET DEFAULT NOW();
