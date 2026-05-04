-- Widen rack-relative margin bands. The original bounds (0.15-0.80 PLN/l for
-- PB_95/ON, 0.00-0.60 for LPG) were too tight for current Polish retail
-- spreads — field-test submissions on 2026-05-04 had PB_95 and ON
-- systematically demoted to invalid because real-world margins fell outside
-- those bands. Loosen so the rules only fire on truly suspicious values
-- (gross OCR misreads), not normal market variation.
--
-- Negative margin_min allows for loss-leader pricing and rack-data lag where
-- retail hasn't followed a rack rise yet.

UPDATE "PriceValidationRule"
SET parameters = parameters || '{"margin_min": -0.30, "margin_max": 1.50}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('rule_rel_pb95', 'rule_rel_on');

UPDATE "PriceValidationRule"
SET parameters = parameters || '{"margin_min": -0.30, "margin_max": 1.00}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'rule_rel_lpg';
