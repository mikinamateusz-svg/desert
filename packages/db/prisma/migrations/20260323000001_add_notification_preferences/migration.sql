CREATE TABLE "NotificationPreference" (
    "id"              TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "expo_push_token" TEXT,
    "price_drops"     BOOLEAN NOT NULL DEFAULT true,
    "sharp_rise"      BOOLEAN NOT NULL DEFAULT true,
    "monthly_summary" BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_user_id_key" ON "NotificationPreference"("user_id");

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
