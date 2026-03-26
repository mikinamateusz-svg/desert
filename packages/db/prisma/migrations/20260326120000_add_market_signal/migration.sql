-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg');

-- CreateTable
CREATE TABLE "MarketSignal" (
  "id"                   TEXT NOT NULL,
  "signal_type"          "SignalType" NOT NULL,
  "value"                DOUBLE PRECISION NOT NULL,
  "pct_change"           DOUBLE PRECISION,
  "significant_movement" BOOLEAN NOT NULL DEFAULT false,
  "recorded_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSignal_signal_type_recorded_at_idx" ON "MarketSignal"("signal_type", "recorded_at");
