-- Story 6.4: Phase 2 alert preference columns on NotificationPreference.
-- Phase 1 columns (price_drops, sharp_rise, monthly_summary) stay
-- untouched — Phase 1 alert pipeline keeps reading them. Stories 6.1
-- (price drops), 6.2 (community rises), 6.3 (predictive rises) will
-- consume the new Phase 2 columns when they ship.
--
-- All defaults are conservative ("off") so adding the columns does NOT
-- change behaviour for any existing user. The driver opts in via the
-- new Phase 2 settings panel.

ALTER TABLE "NotificationPreference"
    ADD COLUMN "price_drop_enabled"      BOOLEAN          NOT NULL DEFAULT false,
    ADD COLUMN "price_drop_mode"         TEXT             NOT NULL DEFAULT 'cheaper_than_now',
    ADD COLUMN "price_drop_target_pln"   DECIMAL(5, 2),
    ADD COLUMN "price_drop_fuel_types"   TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "alert_radius_km"         INTEGER          NOT NULL DEFAULT 10,
    ADD COLUMN "rise_community_enabled"  BOOLEAN          NOT NULL DEFAULT false,
    ADD COLUMN "rise_predictive_enabled" BOOLEAN          NOT NULL DEFAULT false;
