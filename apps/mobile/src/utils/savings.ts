/**
 * Compute savings vs area average for a fill-up (Story 5.3).
 *
 *   savings = (areaAvgPerLitre − pricePerLitrePln) × litres
 *
 * Returns:
 *   - null  → no comparable area data (areaAvgPerLitre missing). Caller
 *             must hide the savings line entirely (AC2 — no zero, no
 *             placeholder, no error message).
 *   - >  0  → driver paid less than the regional median ("you saved X PLN")
 *   - <  0  → driver paid more ("X PLN above area average")
 *   - == 0  → exactly the average (rare; treated as zero savings)
 *
 * Rounded to 2 decimal places (PLN grosz precision). Server-side
 * `FillupService.createFillup` computes the same value and ships it back
 * in the create response — this client-side helper is for the history
 * screen (Story 5.5) where the row was saved with `areaAvgAtFillup` and
 * we recompute on render.
 */
export function calculateSavings(
  areaAvgPerLitre: number | null,
  pricePerLitrePln: number,
  litres: number,
): number | null {
  if (areaAvgPerLitre === null || !Number.isFinite(areaAvgPerLitre)) return null;
  if (!Number.isFinite(pricePerLitrePln) || !Number.isFinite(litres)) return null;
  // Grosz-integer arithmetic — round each side to grosz BEFORE subtracting
  // so the result is platform-stable. The previous `Math.round((a-p)*l*100)/100`
  // pattern was FP-vulnerable around .5 boundaries; tests had to use tolerance
  // windows because the result drifted between Node versions / platforms.
  // Mirrors the server-side computation in fillup.service.ts so the
  // history screen (Story 5.5) always matches the celebration figure.
  return (
    Math.round(areaAvgPerLitre * litres * 100) -
    Math.round(pricePerLitrePln * litres * 100)
  ) / 100;
}
