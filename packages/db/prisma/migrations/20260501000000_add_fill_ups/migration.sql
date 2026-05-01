-- Story 5.2: per-driver fill-up records.
-- Created from pump-meter OCR or manual entry. fuel_type stored as TEXT
-- (consistent with Vehicle / Submission patterns) — DTO validator restricts
-- the accepted set at the API boundary.
--
-- station_id is nullable because GPS station matching may fail (no station
-- within 200 m); the fill-up record is still useful for the driver's history
-- in that case.
--
-- area_avg_at_fillup snapshots the median price for the station's voivodeship
-- × fuel_type from RegionalBenchmark (Story 5.0) at the time of the fill-up,
-- so per-driver savings calculations (Story 5.3) don't drift with later
-- benchmark updates.
--
-- odometer_km is populated by manual numeric entry in this story; Story 5.4
-- adds the OCR path that uses the same column.

CREATE TABLE "FillUp" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "station_id" TEXT,
    "fuel_type" TEXT NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "total_cost_pln" DOUBLE PRECISION NOT NULL,
    "price_per_litre_pln" DOUBLE PRECISION NOT NULL,
    "area_avg_at_fillup" DOUBLE PRECISION,
    "odometer_km" INTEGER,
    "filled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FillUp_pkey" PRIMARY KEY ("id")
);

-- Index on (user_id, filled_at DESC) supports the listFillups query
-- (paginated history, newest first) and per-user analytics joins.
CREATE INDEX "FillUp_user_id_filled_at_idx" ON "FillUp"("user_id", "filled_at" DESC);

-- Index on (vehicle_id, filled_at DESC) supports per-vehicle history filtering
-- (?vehicleId= on listFillups) and Story 5.6 per-vehicle consumption rollups.
CREATE INDEX "FillUp_vehicle_id_filled_at_idx" ON "FillUp"("vehicle_id", "filled_at" DESC);

-- RESTRICT on user_id mirrors the Vehicle pattern: account deletion (Story 1.8)
-- must drop fill-ups in the same transaction or it will hit a FK error.
ALTER TABLE "FillUp" ADD CONSTRAINT "FillUp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on vehicle_id ensures vehicle delete is blocked while fill-ups exist
-- — this is exactly what `Vehicle.is_locked` enforces at the application layer
-- (the lock is set when the first fill-up is recorded). Belt-and-suspenders.
ALTER TABLE "FillUp" ADD CONSTRAINT "FillUp_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on station_id: a station deletion (admin cleanup, Google Places
-- merge) shouldn't orphan history. Drop the link, keep the fill-up.
ALTER TABLE "FillUp" ADD CONSTRAINT "FillUp_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
