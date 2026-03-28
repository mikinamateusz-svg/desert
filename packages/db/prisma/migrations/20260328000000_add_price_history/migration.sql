CREATE TABLE "PriceHistory" (
  "id"          TEXT             NOT NULL,
  "station_id"  TEXT             NOT NULL,
  "fuel_type"   TEXT             NOT NULL,
  "price"       DOUBLE PRECISION NOT NULL,
  "source"      "PriceSource"    NOT NULL,
  "recorded_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "Station"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PriceHistory_station_id_fuel_type_recorded_at_idx"
  ON "PriceHistory"("station_id", "fuel_type", "recorded_at" DESC);

-- Index to support regional aggregation query (JOIN on Station.voivodeship)
CREATE INDEX "Station_voivodeship_idx" ON "Station"("voivodeship");
