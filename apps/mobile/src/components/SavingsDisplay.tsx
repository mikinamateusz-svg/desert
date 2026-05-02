import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';

interface Props {
  /**
   * Pre-computed savings in PLN. Positive = driver saved vs area average,
   * negative = paid above. null → component renders nothing (AC2: no
   * placeholder text, no zero, no error, no visible gap).
   */
  savingsPln: number | null;
}

/**
 * Renders the savings-vs-area-average line on the fill-up celebration
 * screen (Story 5.3). Reused later by Story 5.5 (history) and Story 6.5
 * (monthly summary).
 *
 * Colour rules (AC1):
 *   - Positive (saved)        → green; "You saved X PLN vs. area average"
 *   - Negative (above average) → amber; "X PLN above area average"
 *   - Never red — red would imply an error / shaming. Amber communicates
 *     "could be better" without negative framing.
 *   - Math.abs() before formatting so the user never sees a raw "-12.34".
 */
export function SavingsDisplay({ savingsPln }: Props) {
  const { t } = useTranslation();
  // P-12: defensive Number.isFinite guard — covers null, undefined, NaN,
  // Infinity. The API contract types this as `number | null` but a server
  // bug or schema drift could leak a non-finite value; rendering "NaN PLN"
  // to the user is worse than silently hiding the line.
  if (savingsPln === null || !Number.isFinite(savingsPln)) return null;
  // P-5: don't celebrate a literal zero. `(area - price) * litres == 0`
  // means the driver paid exactly the regional average — there's nothing
  // tangible to communicate. Showing "You saved 0.00 PLN" reads as
  // misleading celebration / sarcastic UX. Hide the line instead.
  if (savingsPln === 0) return null;

  const saved = savingsPln > 0;
  const amount = Math.abs(savingsPln).toFixed(2);

  return (
    <View style={styles.row}>
      <Text style={[styles.amount, saved ? styles.green : styles.amber]}>
        {saved
          ? t('fillup.savedPln', { amount })
          : t('fillup.aboveAvgPln', { amount })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    marginTop: 8,
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  // tokens.fresh.recent already used elsewhere as the green-for-good signal
  // (freshness indicator) — re-using it here keeps the green palette
  // consistent across the app.
  green: { color: tokens.fresh.recent },
  // No 'amber' token currently — use the brand accent (amber/gold). It's the
  // same hue used for the active fuel-pill state, but in this context the
  // text-only treatment doesn't conflict with selected-pill semantics.
  amber: { color: tokens.brand.accent },
});
