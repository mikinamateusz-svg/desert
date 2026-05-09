-- Story 6.10 — premium-alerts contribution loop.
-- Set to NOW + 30 days on every submission transition to `verified`,
-- using GREATEST() so a flurry of verifications never shortens an
-- already-active window. PriceRiseAlertService gates recipients on
-- this column being non-null and in the future. The 3-day pre-expiry
-- warning worker (PremiumExpiryWarningWorker) finds users whose value
-- is between NOW + 2d and NOW + 4d and pushes a renewal nudge.
-- Additive nullable column; pre-6.10 users have NULL (no premium yet).
ALTER TABLE "User" ADD COLUMN "premium_alerts_active_until" TIMESTAMP(3);

-- P8 (6.10 review) — partial index for the recipient-gating query
-- (`premium_alerts_active_until > NOW()`) and the warning-window query
-- (`premium_alerts_active_until BETWEEN NOW + 2d AND NOW + 4d`). Both
-- run on every alert event / daily worker tick; without an index this
-- is a sequential scan on User. Partial-on-non-null skips the bulk of
-- pre-6.10 users (NULL) so the index stays cheap.
CREATE INDEX IF NOT EXISTS "User_premium_alerts_active_until_idx"
  ON "User" ("premium_alerts_active_until")
  WHERE "premium_alerts_active_until" IS NOT NULL;
