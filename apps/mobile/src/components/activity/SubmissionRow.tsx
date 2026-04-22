import { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { Submission } from '../../api/submissions';

interface Props {
  item: Submission;
  onPress: (item: Submission) => void;
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function SubmissionRowBase({ item, onPress }: Props) {
  const { t, i18n } = useTranslation();

  // Local-narrow station so subsequent reads don't need the non-null assertion.
  const station = item.station;
  const isVerified = item.status === 'verified';
  const isPending = item.status === 'pending';
  const isRejected = item.status === 'rejected';

  // Only verified rows with a matched station are actionable (AC6 v1 — pending/rejected taps are no-ops).
  const tappable = isVerified && station != null;

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
        <Text style={styles.prices} numberOfLines={1}>{prices}</Text>
      )}
      {isPending && (
        <Text style={styles.pending}>{t('activity.pendingShort')}</Text>
      )}
      {isRejected && (
        <Text style={styles.rejectedDash}>—</Text>
      )}
    </View>
  );

  if (tappable) {
    return (
      <TouchableOpacity activeOpacity={0.6} onPress={handlePress}>
        {body}
      </TouchableOpacity>
    );
  }
  return body;
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
  prices: { fontSize: 13, color: tokens.brand.ink },
  pending: { fontSize: 11, color: tokens.neutral.n500, fontStyle: 'italic' },
  rejectedDash: { fontSize: 13, color: tokens.neutral.n400 },
});
