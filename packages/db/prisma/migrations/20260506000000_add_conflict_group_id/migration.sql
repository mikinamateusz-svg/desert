-- Story 3.16: consensus-based submission dedup.
--
-- When two submissions for the same station inside the 12h dedup window
-- disagree beyond the ±0.05 PLN/l noise threshold, both are paired via
-- this UUID and routed to admin's paired-review queue. Nullable column
-- means existing rows and all non-conflict submissions cost nothing.
--
-- Partial index keeps the index size scoped to actual conflict pairs —
-- a full index on a nullable column would balloon for the 99% of
-- submissions that never conflict.

ALTER TABLE "Submission" ADD COLUMN "conflict_group_id" UUID;

CREATE INDEX "Submission_conflict_group_id_idx"
  ON "Submission"("conflict_group_id")
  WHERE "conflict_group_id" IS NOT NULL;
