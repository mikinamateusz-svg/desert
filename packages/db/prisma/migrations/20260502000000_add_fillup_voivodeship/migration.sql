-- Story 5.3: voivodeship snapshot on FillUp.
-- Two resolution paths at save time:
--   1. Station matched within 200m → copy station.voivodeship
--   2. No station match but GPS available → reverse-geocode via Nominatim
--
-- Used by RegionalBenchmarkService.getLatestForVoivodeship() to compute
-- area-average savings even when the pump didn't match a known station.
-- Snapshot semantics: never updated after creation.

ALTER TABLE "FillUp" ADD COLUMN "voivodeship" TEXT;
