-- Story 5.0: voivodeship × fuel_type median snapshots, written daily by RegionalBenchmarkWorker.
-- No unique constraint — each run appends a new snapshot row so history is preserved.

CREATE TABLE "RegionalBenchmark" (
    "id" TEXT NOT NULL,
    "voivodeship" TEXT NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "median_price" DOUBLE PRECISION NOT NULL,
    "station_count" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionalBenchmark_pkey" PRIMARY KEY ("id")
);

-- Supports getLatestForStation lookup: find the most recent snapshot for a (voivodeship, fuel_type) pair.
CREATE INDEX "RegionalBenchmark_voivodeship_fuel_type_calculated_at_idx" ON "RegionalBenchmark"("voivodeship", "fuel_type", "calculated_at" DESC);
