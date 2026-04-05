-- Change trust_score default from 0 to 100
ALTER TABLE "User" ALTER COLUMN "trust_score" SET DEFAULT 100;

-- CreateTable
CREATE TABLE "AnomalyAlert" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "AnomalyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnomalyAlert_user_id_dismissed_at_idx" ON "AnomalyAlert"("user_id", "dismissed_at");

-- CreateIndex
CREATE INDEX "AnomalyAlert_dismissed_at_created_at_idx" ON "AnomalyAlert"("dismissed_at", "created_at");

-- AddForeignKey
ALTER TABLE "AnomalyAlert" ADD CONSTRAINT "AnomalyAlert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
