CREATE TABLE "StationFuelStaleness" (
  "id"         TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "fuel_type"  TEXT NOT NULL,
  "reason"     TEXT NOT NULL,
  "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationFuelStaleness_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StationFuelStaleness"
  ADD CONSTRAINT "StationFuelStaleness_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "Station"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "StationFuelStaleness_station_id_fuel_type_key"
  ON "StationFuelStaleness"("station_id", "fuel_type");

CREATE INDEX "StationFuelStaleness_station_id_idx"
  ON "StationFuelStaleness"("station_id");
