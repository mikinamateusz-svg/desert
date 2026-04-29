-- Seed cross-fuel ordering rules.
-- PB_98 >= PB_95 and ON_PREMIUM >= ON are universal invariants in the Polish
-- fuel market. An inversion means Flash (or any OCR model) swapped fuel labels
-- on the price board. action=shadow_reject so ops can confirm the correct
-- prices from the photo before they enter production.
-- See _bmad-output/analysis/results/runs-20260429-200002.md for the benchmark
-- evidence that motivated these rules.

INSERT INTO "PriceValidationRule"
  (id, rule_type, applies_to, parameters, action, reason_code, enabled, notes, created_at, updated_at)
VALUES
  ('rule_ord_pb98_gt_pb95', 'cross_fuel_ordering', 'PB_98',
    '{"reference_fuel": "PB_95", "min_delta": 0.0}'::jsonb,
    'shadow_reject', 'pb98_below_pb95', true,
    'PB_98 >= PB_95 is a market invariant — inversion means OCR misread fuel labels',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_ord_on_premium_gt_on', 'cross_fuel_ordering', 'ON_PREMIUM',
    '{"reference_fuel": "ON", "min_delta": 0.0}'::jsonb,
    'shadow_reject', 'on_premium_below_on', true,
    'ON_PREMIUM >= ON is a market invariant — inversion means OCR misread fuel labels',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
