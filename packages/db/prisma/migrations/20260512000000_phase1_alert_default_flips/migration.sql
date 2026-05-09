-- Story 6.12 — promote price-drop alerts to Phase 1.
--
-- Flip the column defaults so new NotificationPreference rows ship with
-- price drops enabled out of the box (the contribution loop's reward
-- promise needs a concrete alert that fires regularly; sparse 6.3-lite
-- predictive rises alone don't justify the bell badge).
--
-- Backfill existing rows that still have the old defaults. This is safe
-- because the price-drop UI was Phase 2-gated until now, so any row with
-- `price_drop_enabled = false` AND `price_drop_fuel_types = '{}'` is one
-- where the user has never explicitly configured these — flipping them
-- to the new defaults is the same outcome they'd get if they'd opened
-- the prefs panel today.
ALTER TABLE "NotificationPreference"
  ALTER COLUMN "price_drop_enabled" SET DEFAULT true;

ALTER TABLE "NotificationPreference"
  ALTER COLUMN "price_drop_fuel_types" SET DEFAULT ARRAY['PB_95']::TEXT[];

UPDATE "NotificationPreference"
SET "price_drop_enabled" = true
WHERE "price_drop_enabled" = false;

UPDATE "NotificationPreference"
SET "price_drop_fuel_types" = ARRAY['PB_95']::TEXT[]
WHERE "price_drop_fuel_types" = '{}'::TEXT[];
