-- Story 6.9 — Expo push tokens for guest users (unauthenticated).
--
-- One row per device (`token` is the natural key). Guest signs up →
-- their token may move to NotificationPreference; this row becomes
-- orphaned. At MVP scale orphan volume is negligible; a future cleanup
-- job can sweep rows older than ~90 days.

CREATE TABLE "GuestPushToken" (
  "id"         TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestPushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestPushToken_token_key" ON "GuestPushToken" ("token");

CREATE INDEX "GuestPushToken_created_at_idx" ON "GuestPushToken" ("created_at");
