-- Capture rounded GPS coords on research photos so we can diagnose
-- no_station_match cases (which station is closest? is our match radius too
-- tight?). Rounded to 4 decimal places (~10m precision) at write time per the
-- service. NULL for pre-GPS submissions or rows already retained without coords.

ALTER TABLE "ResearchPhoto"
  ADD COLUMN "gps_lat" DOUBLE PRECISION,
  ADD COLUMN "gps_lng" DOUBLE PRECISION;
