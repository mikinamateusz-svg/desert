/**
 * Vehicle display formatting helpers.
 *
 * Wikidata-derived vehicle catalog stores model fields like
 *   "Saab_9-3_II_YS3F"
 * which renders as ugly text when shown raw. These helpers normalise the
 * model string into a clean "<make> <model>" form by:
 *   1. Stripping the leading "<make>_" if duplicated at the front of the model
 *   2. Splitting the remainder on underscore
 *   3. Taking parts until a "modifier" segment is hit — generation roman
 *      numeral, chassis code, "Mk7"-style marker
 *
 * Worked examples (see __tests__/formatVehicle.test.ts):
 *   Saab + Saab_9-3_II_YS3F            → "Saab 9-3"
 *   Mercedes-Benz + Mercedes-Benz_C-Class_W205 → "Mercedes-Benz C-Class"
 *   BMW + BMW_3_Series_E90             → "BMW 3 Series" (multi-word preserved)
 *   Volkswagen + Volkswagen_Golf_Mk7   → "Volkswagen Golf"
 *   Toyota + Toyota_Corolla_E170       → "Toyota Corolla"
 */

interface VehicleBasics {
  make: string;
  model: string;
  year?: number;
  nickname?: string | null;
  engine_variant?: string | null;
}

// Matches generation / chassis / trim-style suffixes that should be
// stripped from the model display. Tested patterns:
//   - Roman numerals: II, III, IV, V, VI, VII, VIII (generation marker)
//   - "Mk" + digits or roman: Mk7, MkVII
//   - Chassis code: leading capital(s) + digit(s) + optional trailing
//     letter (W205, E170, YS3F, B58, 8P — wait, 8P starts with digit; see
//     ALL-CAPS branch for that case)
//   - Short all-caps short-codes: YS3F, AWD, RWD (3-5 alphanumeric)
const MODIFIER_RE = /^([IVX]{1,8}|Mk[IVX0-9]+|[A-Z]{1,3}\d+[A-Z]?|[A-Z][A-Z0-9]{2,5})$/;

/**
 * Returns "<make> <model>" with the chassis/generation cruft stripped.
 * Pure function — does NOT consider nickname; use `formatVehicleDisplayName`
 * for the user-facing string.
 */
export function formatVehicleBrandModel(make: string, model: string): string {
  // Defensive: if make is empty or model doesn't contain make prefix, just
  // best-effort: replace underscores with spaces and call it done.
  if (!make) {
    return model.replace(/_/g, ' ');
  }

  // Step 1: strip leading "<make>_" if present
  let stripped = model;
  const prefix = `${make}_`;
  if (stripped.startsWith(prefix)) {
    stripped = stripped.slice(prefix.length);
  }

  // Step 2: walk segments, stop at first modifier
  const parts = stripped.split('_');
  const modelParts: string[] = [];
  for (const part of parts) {
    if (MODIFIER_RE.test(part)) break;
    modelParts.push(part);
  }

  // If we somehow stripped everything (model was entirely "<make>_<chassis>"
  // and nothing remained), fall back to the raw stripped string with
  // underscores replaced — better than rendering just the make alone.
  if (modelParts.length === 0) {
    return `${make} ${stripped.replace(/_/g, ' ')}`.trim();
  }

  return `${make} ${modelParts.join(' ')}`;
}

/**
 * Preferred user-facing display name. Returns the nickname if set,
 * otherwise the cleaned brand + model.
 */
export function formatVehicleDisplayName(vehicle: VehicleBasics): string {
  const nick = vehicle.nickname?.trim();
  if (nick) return nick;
  return formatVehicleBrandModel(vehicle.make, vehicle.model);
}

/**
 * Subtitle string for the vehicle (used under the display name in
 * lists / cards). Composes "<year> · <engine variant>" where each
 * piece is optional. Returns empty string when neither is available.
 */
export function formatVehicleSubtitle(vehicle: VehicleBasics): string {
  const parts: string[] = [];
  if (vehicle.year != null) parts.push(String(vehicle.year));
  const engine = vehicle.engine_variant?.trim();
  if (engine) parts.push(engine);
  return parts.join(' · ');
}
