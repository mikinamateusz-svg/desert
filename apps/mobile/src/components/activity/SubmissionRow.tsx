import { memo, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { Submission } from '../../api/submissions';
import { FlagWrongConfirmSheet } from './FlagWrongConfirmSheet';
import { FlagReasonExplainSheet } from './FlagReasonExplainSheet';
import { flagReasonCopy } from './flagReasonCopy';
import { staleness } from './staleness';

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

function SubmissionRowBase({ item, onPress, onFlaggedWrong }: Props) {
  const { t, i18n } = useTranslation();
  const [confirmVisible, setConfirmVisible] = useState(false);
  // Story 3.17 — tap-to-explain modal state for non-verified rows.
  const [explainVisible, setExplainVisible] = useState(false);
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

  // Story 3.17 — per-reason inline copy for non-verified rows. Story 4.3
  // shadow_banned secrecy invariant: the backend launders shadow_rejected
  // with flag_reason='shadow_banned' to status='pending' on the wire, so
  // this code path never sees that case. Defensive guard kept anyway.
  const isShadowBanned = effectiveFlagReason === 'shadow_banned';
  // Story 3.17 — verified rows tap through to station detail (existing).
  // shadow_rejected and rejected rows open the explain sheet ONLY when
  // they have a flag_reason (P-5 — null flag_reason is a no-op per spec
  // T10) AND aren't shadow_banned (P-4 — preserves Story 4.3 secrecy if
  // the laundering ever fails). Pending rows are not tappable.
  const explainable =
    (isShadowRejected || isRejected) &&
    !isShadowBanned &&
    effectiveFlagReason !== null;
  const tappable = (isVerified && station != null) || explainable;

  const handlePress = useCallback(() => {
    if (isVerified) {
      onPress(item);
    } else if (explainable) {
      setExplainVisible(true);
    }
  }, [isVerified, explainable, onPress, item]);

  const handleExplainDismiss = useCallback(() => setExplainVisible(false), []);
  const handleFlagPress = useCallback(() => setConfirmVisible(true), []);
  const handleConfirmDismiss = useCallback(() => setConfirmVisible(false), []);
  const handleFlagged = useCallback(() => {
    setConfirmVisible(false);
    // P-16: flip local status optimistically so the row updates instantly,
    // before the parent's refetch round-trip completes.
    setOptimisticallyFlagged(true);
    onFlaggedWrong?.();
  }, [onFlaggedWrong]);

  const showStaleness = isShadowRejected && !isShadowBanned;
  const stalenessSuffix = showStaleness
    ? staleness(new Date(item.created_at), new Date(), t)
    : null;
  const reasonCopy = explainable
    ? flagReasonCopy(effectiveFlagReason, isShadowRejected ? 'shadow_rejected' : 'rejected', t)
    : null;
  const inlineLabel = reasonCopy
    ? stalenessSuffix
      ? `${reasonCopy.label} · ${stalenessSuffix}`
      : reasonCopy.label
    : null;

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
      {isShadowRejected && inlineLabel && (
        <Text style={styles.shadowRejected}>{inlineLabel}</Text>
      )}
      {isRejected && inlineLabel && (
        <Text style={styles.rejected}>{inlineLabel}</Text>
      )}
    </View>
  );

  // P-8 (3.17 review) — explainable rows are now tappable for the
  // tap-to-explain modal; verified-with-station rows are tappable for
  // the station detail navigation. Both need explicit screen-reader
  // semantics so the row is announced as a button rather than static
  // text. The accessibilityHint differentiates the two affordances.
  const accessibilityHint = isVerified
    ? t('activity.tapHintStation', { defaultValue: '' })
    : t('activity.tapHintExplain', { defaultValue: '' });

  return (
    <>
      {tappable ? (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityHint={accessibilityHint || undefined}
        >
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
      <FlagReasonExplainSheet
        visible={explainVisible}
        flagReason={effectiveFlagReason}
        status={isShadowRejected ? 'shadow_rejected' : 'rejected'}
        onDismiss={handleExplainDismiss}
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
  rejected: { fontSize: 12, color: tokens.neutral.n400, fontStyle: 'italic' },
});
