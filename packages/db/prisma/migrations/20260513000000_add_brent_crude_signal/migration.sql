-- Story 6.0: extend MarketSignal for Brent crude in PLN/litre.
--
-- The brent_crude_pln signal type carries the PLN/litre equivalent of
-- Brent crude (USD/bbl × USD/PLN ÷ 158.987). It is a directional rise
-- signal only — never displayed as a retail price. A ≥3% upward move
-- publishes a price-rise-signal event consumed by Story 6.3's predictive
-- alert worker.
--
-- The rate_source column tracks which NBP USD/PLN snapshot was used for
-- the conversion: 'live' = same-run fetch, 'cached' = up-to-24h stale
-- value from Redis fallback. Null for orlen_rack_* signals (no rate
-- translation). Existing rows get null which matches the orlen_rack
-- semantics — no backfill needed.

ALTER TYPE "SignalType" ADD VALUE IF NOT EXISTS 'brent_crude_pln';

ALTER TABLE "MarketSignal"
    ADD COLUMN "rate_source" TEXT;
