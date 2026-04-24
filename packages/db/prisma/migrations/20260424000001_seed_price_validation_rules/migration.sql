-- Seed initial price validation rules. Two per fuel: absolute-band safety net
-- (action=reject — catches decimal-point misreads) + rack-relative band
-- (action=shadow_reject — catches OCR fuel-label swaps). Rules are
-- data-driven: admin can toggle, retune, or replace via REST endpoints.
-- See _bmad-output/planning-artifacts/price-validation-framework.md.
--
-- Band widths start loose (margin 0.15-0.80 PLN/l). Phase 2 stats analysis
-- against the labeled research corpus will retune these empirically.

-- ─── Absolute bands (hard reject — catches wildly-wrong OCR reads) ────────
INSERT INTO "PriceValidationRule"
  (id, rule_type, applies_to, parameters, action, reason_code, enabled, notes, created_at, updated_at)
VALUES
  ('rule_abs_pb95', 'absolute_band', 'PB_95',
    '{"min": 3.50, "max": 10.00}'::jsonb,
    'reject', 'pb95_absolute_band', true,
    'Safety net — catches decimal-point misreads regardless of market conditions',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_abs_pb98', 'absolute_band', 'PB_98',
    '{"min": 3.50, "max": 11.00}'::jsonb,
    'reject', 'pb98_absolute_band', true,
    'Safety net — catches decimal-point misreads',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_abs_on', 'absolute_band', 'ON',
    '{"min": 3.50, "max": 10.00}'::jsonb,
    'reject', 'on_absolute_band', true,
    'Safety net — catches decimal-point misreads',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_abs_on_premium', 'absolute_band', 'ON_PREMIUM',
    '{"min": 3.50, "max": 11.00}'::jsonb,
    'reject', 'on_premium_absolute_band', true,
    'Safety net — catches decimal-point misreads',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_abs_lpg', 'absolute_band', 'LPG',
    '{"min": 1.00, "max": 5.00}'::jsonb,
    'reject', 'lpg_absolute_band', true,
    'Safety net — catches decimal-point misreads',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ─── Rack-relative bands (shadow_reject — catches OCR label-swaps) ───────
-- Formula: expected_retail = rack_net × vat_multiplier(1.23) + margin.
-- Margins default to [0.15, 0.80] PLN/l for major fuels based on typical
-- Polish retail spread; LPG tighter [0.00, 0.60]. vat_multiplier omitted
-- here so it reads from SystemConfig (admin-switchable to 1.08).
INSERT INTO "PriceValidationRule"
  (id, rule_type, applies_to, parameters, action, reason_code, enabled, notes, created_at, updated_at)
VALUES
  ('rule_rel_pb95', 'relative_to_reference', 'PB_95',
    '{"source": "orlen_rack", "value_type": "rack_net", "margin_min": 0.15, "margin_max": 0.80, "max_age_hours": 72}'::jsonb,
    'shadow_reject', 'pb95_outside_rack_band', true,
    'Sanity check: retail PB 95 should be rack × VAT + 0.15-0.80 PLN/l margin',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_rel_on', 'relative_to_reference', 'ON',
    '{"source": "orlen_rack", "value_type": "rack_net", "margin_min": 0.15, "margin_max": 0.80, "max_age_hours": 72}'::jsonb,
    'shadow_reject', 'on_outside_rack_band', true,
    'Sanity check: retail ON should be rack × VAT + 0.15-0.80 PLN/l margin',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_rel_lpg', 'relative_to_reference', 'LPG',
    '{"source": "orlen_rack", "value_type": "rack_net", "margin_min": 0.00, "margin_max": 0.60, "max_age_hours": 72}'::jsonb,
    'shadow_reject', 'lpg_outside_rack_band', true,
    'Sanity check: retail LPG should be rack × VAT + 0.00-0.60 PLN/l margin (LPG margins tighter)',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- PB_98 and ON_PREMIUM rack prices are not currently ingested (Orlen publishes
-- only PB 95, ON, LPG via the wholesale API). When those sources are added in
-- Phase 2, corresponding rules will be inserted.
