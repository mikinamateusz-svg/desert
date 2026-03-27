CREATE TYPE "StationType" AS ENUM ('standard', 'mop');
CREATE TYPE "SettlementTier" AS ENUM ('metropolitan', 'city', 'town', 'rural');

ALTER TABLE "Station"
  ADD COLUMN "brand"                  TEXT,
  ADD COLUMN "station_type"           "StationType",
  ADD COLUMN "voivodeship"            TEXT,
  ADD COLUMN "settlement_tier"        "SettlementTier",
  ADD COLUMN "is_border_zone_de"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classification_version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Station_classification_version_idx" ON "Station" ("classification_version");
