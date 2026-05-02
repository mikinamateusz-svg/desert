-- Story 5.4: per-vehicle odometer readings + consumption snapshot on FillUp.
--
-- Two related changes:
--   1. New OdometerReading table — driver's km snapshots over time.
--   2. New consumption_l_per_100km column on FillUp — populated when an
--      OdometerReading triggers calculation for the segment ending at this
--      fill-up. Stays null for fill-ups where no consumption was computable.
--
-- Auto-link semantics: an OdometerReading captured within 30 min of a
-- matching-vehicle FillUp gets linked via fillup_id, and that FillUp's
-- odometer_km column is updated to reflect the reading. At-most-one
-- reading per fill-up enforced by the unique index on fillup_id.

-- 1. Add the new column to FillUp.
ALTER TABLE "FillUp" ADD COLUMN "consumption_l_per_100km" DOUBLE PRECISION;

-- 2. Create the OdometerReading table.
CREATE TABLE "OdometerReading" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "fillup_id" TEXT,
    "km" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OdometerReading_pkey" PRIMARY KEY ("id")
);

-- One OdometerReading per FillUp at most (auto-link or explicit attach).
CREATE UNIQUE INDEX "OdometerReading_fillup_id_key" ON "OdometerReading"("fillup_id");

-- Supports the canonical "previous reading for this vehicle" query that
-- drives consumption calculation: findFirst(where vehicle_id, orderBy
-- recorded_at desc).
CREATE INDEX "OdometerReading_vehicle_id_recorded_at_idx" ON "OdometerReading"("vehicle_id", "recorded_at" DESC);

-- Per-user listing index (history screens, GDPR export).
CREATE INDEX "OdometerReading_user_id_idx" ON "OdometerReading"("user_id");

-- RESTRICT on user_id mirrors the FillUp / Vehicle pattern: account
-- deletion (Story 1.8) must drop odometer readings in the same
-- transaction or hit a FK error.
ALTER TABLE "OdometerReading" ADD CONSTRAINT "OdometerReading_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on vehicle_id ensures the vehicle stays deletable only when no
-- odometer history exists — same belt-and-suspenders semantics as
-- FillUp.vehicle_id.
ALTER TABLE "OdometerReading" ADD CONSTRAINT "OdometerReading_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on fillup_id: a fill-up deletion (admin cleanup, future user-
-- delete-fillup story) shouldn't orphan the odometer reading. Drop the
-- link, keep the km snapshot.
ALTER TABLE "OdometerReading" ADD CONSTRAINT "OdometerReading_fillup_id_fkey"
    FOREIGN KEY ("fillup_id") REFERENCES "FillUp"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
