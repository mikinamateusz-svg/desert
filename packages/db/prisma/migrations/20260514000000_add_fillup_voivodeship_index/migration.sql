-- Story 5.8: SavingsRankingService cohort scan
-- Both single-user and bulk queries filter
--   WHERE filled_at >= $1 AND filled_at < $2 AND voivodeship IS NOT NULL
-- Without this index the bulk monthly cron in MonthlySummaryNotificationService
-- does a sequential scan over FillUp once the table grows past a few
-- hundred thousand rows. (voivodeship, filled_at) — voivodeship first
-- because the equality predicate is more selective than the date range.
-- Plain (non-CONCURRENT) CREATE because Prisma migrate wraps each
-- migration in a transaction and the FillUp table is small at MVP
-- scale; the brief AccessExclusive lock is acceptable.
CREATE INDEX IF NOT EXISTS "FillUp_voivodeship_filled_at_idx"
  ON "FillUp" ("voivodeship", "filled_at");
