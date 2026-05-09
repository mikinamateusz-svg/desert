-- Story 6.11 — per-user inbox record for every push the alerts loop sends.
-- `alert_type` deliberately a free-form text column (not an enum) so 6.1 /
-- 6.2 / 6.5 can add new types with zero migrations. Both indexes serve the
-- inbox endpoint: the (user_id, sent_at DESC) one for `findMany` order +
-- pagination, and the (user_id, read_at) one for the unread-count query.
-- ON DELETE CASCADE matches the rest of the per-user data — deleting a User
-- removes their inbox.
CREATE TABLE "DriverAlert" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "alert_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMP(3),
  "payload" JSONB,
  CONSTRAINT "DriverAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverAlert_user_id_sent_at_idx"
  ON "DriverAlert" ("user_id", "sent_at" DESC);

-- P6 (6.11 review) — partial index on unread rows only. The unread-count
-- query is `WHERE user_id = $1 AND read_at IS NULL` and the steady-state
-- majority of rows will have a non-null read_at; a partial index keeps
-- the working set small and avoids growing in proportion to read history.
-- The full-index alternative (user_id, read_at) was the original choice
-- but adds rows for every read row — unnecessary for the only query that
-- reads this column.
CREATE INDEX "DriverAlert_user_id_unread_idx"
  ON "DriverAlert" ("user_id")
  WHERE "read_at" IS NULL;

ALTER TABLE "DriverAlert"
  ADD CONSTRAINT "DriverAlert_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
