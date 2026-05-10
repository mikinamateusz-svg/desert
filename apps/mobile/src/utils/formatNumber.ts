/**
 * Locale-aware integer formatter (Story 5.9). Used by both the
 * ShareableCard pill row and the savings-summary screen segment so
 * the captured PNG and the in-app preview can't drift.
 *
 * Hermes Android has limited ICU data — `toLocaleString` may throw
 * `RangeError` on uncommon locale tags. Fall back to plain
 * `String(Math.round(value))` so the publicly-shared card never ships
 * a "—" placeholder or unrendered text.
 *
 * Note: this intentionally does NOT do the PL/UK comma-decimal
 * fallback that `formatAmountForLocale` (in ShareableCard) performs
 * for fractional values — the values passed here are already rounded
 * to integer PLN at the api boundary, so there's no decimal separator
 * to swap.
 */
export function formatIntegerForLocale(value: number, locale: string): string {
  try {
    return value.toLocaleString(locale, { maximumFractionDigits: 0 });
  } catch {
    return String(Math.round(value));
  }
}
