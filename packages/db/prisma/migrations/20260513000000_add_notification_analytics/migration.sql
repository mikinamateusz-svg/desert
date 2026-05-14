-- Story 6.8 — analytics events + per-send logs for the alerts loop.
--
-- `NotificationEvent.user_id` is nullable so Story 6.9 guest events
-- can land in the same table (user_id: null) when that story ships.
-- Free-form `event_type` so new event categories are cheap to add —
-- controller validator is the gate.
--
-- `NotificationSendLog` is one row per alert SEND batch (not per
-- recipient). The per-recipient cost would be high write volume; this
-- keeps the table small while still giving us per-type sent counts
-- for the admin engagement metrics.

CREATE TABLE "NotificationEvent" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT,
  "event_type" TEXT NOT NULL,
  "trigger"    TEXT,
  "alert_type" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationEvent_event_type_created_at_idx"
  ON "NotificationEvent" ("event_type", "created_at");

CREATE INDEX "NotificationEvent_user_id_created_at_idx"
  ON "NotificationEvent" ("user_id", "created_at");

CREATE TABLE "NotificationSendLog" (
  "id"              TEXT NOT NULL,
  "alert_type"      TEXT NOT NULL,
  "recipient_count" INTEGER NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationSendLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationSendLog_alert_type_created_at_idx"
  ON "NotificationSendLog" ("alert_type", "created_at");
