import { memo, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { Submission } from '../../api/submissions';
import { FlagWrongConfirmSheet } from './FlagWrongConfirmSheet';

interface Props {
  item: Submission;
  onPress: (item: Submission) => void;
  /** Called when the user successfully flags a row as wrong. Parent refetches. */
  onFlaggedWrong?: () => void;
}

const FLAG_WRONG_WINDOW_MS = 24 * 3600 * 1000;

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

/**
 * Story 3.14 AC5 — pick the inline copy shown on a shadow_rejected row based
 * on flag_reason. Falls back to the generic "under review" string for unknown
 * or rule-based reasons (Story 3.17 will refine those once we have data on
 * which codes appear most).
 */
function shadowRejectedLabel(flagReason: string | null, t: (k: string) => string): string {
  if (flagReason === 'user_flagged_wrong') {
    return t('contribution.flagWrong.withdrawnLabel');
  }
  if (flagReason === 'price_conflict') {
    return t('contribution.flagWrong.priceConflictLabel');
  }
  return t('contribution.flagWrong.underReviewLabel');
}

function SubmissionRowBase({ item, onPress, onFlaggedWrong }: Props) {
  const { t, i18n } = useTranslation();
  const [confirmVisible, setConfirmVisible] = useState(false);
  // P-16: optimistic flag state. Once the user confirms in the sheet, we
  // assume the API call will succeed (errors are handled in the sheet itself
  // via setErrorMsg) and flip the row to shadow_rejected immediately. The
  // parent's refetch will then replace `item` with the authoritative state.
  const [optimisticallyFlagged, setOptimisticallyFlagged] = useState(false);

  const station = item.station;
  const effectiveStatus = optimisticallyFlagged ? 'shadow_rejected' : item.status;
  const effectiveFlagReason = optimisticallyFlagged ? 'user_flagged_wrong' : item.flag_reason;
  const isVerified = effectiveStatus === 'verified';
  const isPending = effectiveStatus === 'pending';
  const isRejected = effectiveStatus === 'rejected';
  const isShadowRejected = effectiveStatus === 'shadow_rejected';

  // Only verified rows with a matched station are actionable (tap → station detail).
  const tappable = isVerified && station != null;

  // Story 3.14 AC1 — show flag-wrong button on driver's own verified rows
  // submitted within the last 24h. (Backend enforces ownership and window;
  // mobile gates UI for clarity. Admin row eligibility is a corner case the
  // backend handles via role bypass.)
  // P-17: also reject negative ageMs so a forward-skewed client clock can't
  // show the flag button on rows the server will refuse anyway.
  const ageMs = Date.now() - new Date(item.created_at).getTime();
  const flagEligible = isVerified && ageMs >= 0 && ageMs <= FLAG_WRONG_WINDOW_MS;

  const stationName = station != null
    ? station.name
    : t('activity.stationUnrecognised');

  // Filter out null prices (OCR read a fuel-type label but not a value) before
  // formatting — otherwise .toFixed() throws and crashes the screen. `?? []`
  // also defends against a backend drift that omits price_data entirely.
  const prices = (item.price_data ?? [])
    .filter((p): p is { fuel_type: string; price_per_litre: number } => p.price_per_litre != null)
    .map((p) => `${t(`fuelTypes.${p.fuel_type}`, { defaultValue: p.fuel_type })}: ${p.price_per_litre.toFixed(2)}`)
    .join('  ');

  const handlePress = useCallback(() => onPress(item), [onPress, item]);
  const handleFlagPress = useCallback(() => setConfirmVisible(true), []);
  const handleConfirmDismiss = useCallback(() => setConfirmVisible(false), []);
  const handleFlagged = useCallback(() => {
    setConfirmVisible(false);
    // P-16: flip local status optimistically so the row updates instantly,
    // before the parent's refetch round-trip completes.
    setOptimisticallyFlagged(true);
    onFlaggedWrong?.();
  }, [onFlaggedWrong]);

  const body = (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text
          style={[styles.stationName, station == null && styles.stationUnmatched]}
          numberOfLines={1}
        >
          {stationName}
        </Text>
        <Text style={styles.date}>{formatDateTime(item.created_at, i18n.language)}</Text>
      </View>

      {isVerified && prices.length > 0 && (
        <View style={styles.verifiedFooter}>
          <Text style={styles.prices} numberOfLines={1}>{prices}</Text>
          {flagEligible && (
            <TouchableOpacity
              onPress={handleFlagPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('contribution.flagWrong.button')}
            >
              <Text style={styles.flagButton}>{t('contribution.flagWrong.button')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {isPending && (
        <Text style={styles.pending}>{t('activity.pendingShort')}</Text>
      )}
      {isShadowRejected && (
        <Text style={styles.shadowRejected}>{shadowRejectedLabel(effectiveFlagReason, t)}</Text>
      )}
      {isRejected && (
        <Text style={styles.rejectedDash}>—</Text>
      )}
    </View>
  );

  return (
    <>
      {tappable ? (
        <TouchableOpacity activeOpacity={0.6} onPress={handlePress}>
          {body}
        </TouchableOpacity>
      ) : (
        body
      )}
      <FlagWrongConfirmSheet
        visible={confirmVisible}
        submissionId={item.id}
        onDismiss={handleConfirmDismiss}
        onFlagged={handleFlagged}
      />
    </>
  );
}

export const SubmissionRow = memo(SubmissionRowBase);

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: tokens.surface.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stationName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginRight: 8,
  },
  stationUnmatched: { color: tokens.neutral.n500, fontWeight: '500' },
  date: { fontSize: 12, color: tokens.neutral.n400 },
  prices: { flex: 1, fontSize: 13, color: tokens.brand.ink },
  verifiedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flagButton: {
    fontSize: 12,
    color: tokens.brand.accent,
    fontWeight: '600',
    marginLeft: 8,
  },
  pending: { fontSize: 11, color: tokens.neutral.n500, fontStyle: 'italic' },
  shadowRejected: { fontSize: 12, color: tokens.neutral.n500, fontStyle: 'italic' },
  rejectedDash: { fontSize: 13, color: tokens.neutral.n400 },
});
