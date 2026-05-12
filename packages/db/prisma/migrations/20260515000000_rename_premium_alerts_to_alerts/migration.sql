-- Story 6.13 — retire the "premium" framing for alerts.
-- The mechanic (Story 6.10) is correct: contribution-gated 30-day
-- window. Only the naming changes — alerts are core + free, not a
-- paid tier. Pure column rename; values are preserved verbatim.
--
-- Safe to deploy ahead of the application code rename: Postgres
-- column renames are instant (catalogue-only, no rewrite), so the
-- staging migration finishes before the new app binary boots, and
-- the old binary on prod (if any) would crash on its next read —
-- which is why the application code rename ships in the same
-- release. See `6-13-premium-to-price-alerts-rename.md` §Order of
-- operations for safest deployment.
ALTER TABLE "User"
  RENAME COLUMN "premium_alerts_active_until" TO "alerts_active_until";

-- Postgres' RENAME COLUMN does NOT rename dependent indexes — bring the
-- partial index from migration `20260510000000_add_user_premium_alerts_active_until`
-- into line so future Prisma `migrate dev` runs don't see catalogue drift.
ALTER INDEX "User_premium_alerts_active_until_idx"
  RENAME TO "User_alerts_active_until_idx";

-- Backfill the DriverAlert.alert_type literal and the AdminAuditLog.action
-- literal that the renamed worker now writes. Pre-launch envs (staging)
-- may have rows from prior 6.10 runs under the old strings — without this
-- backfill the mobile KnownAlertType union no longer recognises them and
-- the inbox renders them with the default fallback.
UPDATE "DriverAlert"
  SET "alert_type" = 'alerts_expiring_warning'
  WHERE "alert_type" = 'premium_expiring_warning';

UPDATE "AdminAuditLog"
  SET "action" = 'ALERTS_EXPIRING_WARNING_SENT'
  WHERE "action" = 'PREMIUM_EXPIRING_WARNING_SENT';
