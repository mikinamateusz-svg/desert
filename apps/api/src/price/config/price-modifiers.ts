// All modifier values are in gr/l (grosz per litre). Divide by 100 to convert to PLN/l.
// To tune without a code deploy, update values here and redeploy (no DB migration needed).

/** Regional average retail markup above ORLEN rack price (gr/l). */
export const VOIVODESHIP_MARGINS_GR: Record<string, number> = {
  'dolnoslaskie':         27,
  'kujawsko-pomorskie':   31,
  'lubelskie':            33,
  'lubuskie':             29, // western border region — lower margins due to German competition
  'lodzkie':              30,
  'malopolskie':          28,
  'mazowieckie':          26, // Warsaw — highest competition → lowest margin
  'opolskie':             29,
  'podkarpackie':         34,
  'podlaskie':            35, // eastern region — lowest competition
  'pomorskie':            29,
  'slaskie':              27, // highly urbanised
  'swietokrzyskie':       33,
  'warminsko-mazurskie':  33,
  'wielkopolskie':        29,
  'zachodniopomorskie':   28,
};

/** Fallback margin when voivodeship is unknown or null (gr/l). */
export const DEFAULT_MARGIN_GR = 30;

/** Modifier per station type (gr/l). MOP stations have captive-audience pricing. */
export const STATION_TYPE_MODIFIERS_GR: Record<string, number> = {
  mop:      45,
  standard:  0,
};

/**
 * Modifier per brand slug (gr/l).
 * Hypermarkets price below market; premium brands price above.
 */
export const BRAND_MODIFIERS_GR: Record<string, number> = {
  auchan:     -30,
  carrefour:  -30,
  circle_k:    -5,
  huzar:       -5,
  moya:        -5,
  amic:        -5,
  orlen:        0,
  lotos:        0,
  bp:          +7,
  shell:       +7,
  independent:  0,
  // unknown/null brand → 0 (handled by caller using DEFAULT_BRAND_MODIFIER_GR)
};

/** Fallback modifier when brand is null or not in the map. */
export const DEFAULT_BRAND_MODIFIER_GR = 0;

/** Modifier for stations within 30km of a German border crossing (gr/l). */
export const BORDER_ZONE_MODIFIER_GR = -15;

/** Modifier per settlement tier (gr/l). Rural stations face less competition. */
export const SETTLEMENT_TIER_MODIFIERS_GR: Record<string, number> = {
  metropolitan:  0,
  city:          0,
  town:          0,
  rural:        10,
};

/** Symmetric band radius for market_estimate ranges (gr/l → ±0.15 PLN). */
export const BAND_RADIUS_GR = 15;

/** Band for fallback estimates — ±2.5% of midpoint (applied as a fraction, not gr/l). */
export const FALLBACK_BAND_PCT = 0.025;

/**
 * National average pump prices (PLN/l) — used as fallback midpoint when ORLEN
 * rack price is unavailable. Update periodically from e-petrol.pl data.
 * Only PB_95, ON, LPG have ORLEN rack signals; PB_98 and ON_PREMIUM are omitted.
 */
export const NATIONAL_FALLBACK_PRICES_PLN: Record<string, number> = {
  PB_95: 6.40,
  ON:    6.45,
  LPG:   2.90,
};

/** Fuel types for which estimated ranges are computed (tied to ORLEN rack signals). */
export const ESTIMABLE_FUEL_TYPES = ['PB_95', 'ON', 'LPG'] as const;
