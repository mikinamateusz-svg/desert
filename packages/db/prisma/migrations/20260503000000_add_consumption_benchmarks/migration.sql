-- Story 5.6: real-world fuel consumption benchmarks per
-- (make × model × engine variant × fuel_type). Computed daily from the
-- last 90 days of FillUp consumption snapshots, gated on per-driver
-- minimum (≥3 segments) AND per-group minimum (≥10 distinct drivers).
-- Append-only — every daily run writes a fresh snapshot row, history
-- preserved for trend analysis. fuel_type is part of the cohort key so
-- EV / PHEV / diesel variants of the same nameplate never pool.

CREATE TABLE "ConsumptionBenchmark" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "engine_variant" TEXT NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "median_l_per_100km" DOUBLE PRECISION NOT NULL,
    "driver_count" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionBenchmark_pkey" PRIMARY KEY ("id")
);

-- Supports the most-recent-snapshot lookup driven by the mobile log
-- screen: findFirst({ where: make + model + engine_variant + fuel_type,
-- orderBy: calculated_at desc }). Composite + DESC on calculated_at
-- makes the lookup cheap; not index-only because findFirst projects all
-- columns, but the heap fetch is a single page hit.
CREATE INDEX "ConsumptionBenchmark_make_model_engine_variant_fuel_type_calc_idx"
    ON "ConsumptionBenchmark"("make", "model", "engine_variant", "fuel_type", "calculated_at" DESC);
