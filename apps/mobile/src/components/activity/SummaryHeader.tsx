import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { ActivitySummary } from './deriveSummary';

interface Props {
  summary: ActivitySummary;
  /** True when pagination hasn't reached the oldest page — render "Aktywny od X+" so the driver knows the real start date may be earlier. */
  approxActiveSince: boolean;
}

function formatActiveSince(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function SummaryHeader({ summary, approxActiveSince }: Props) {
  const { t, i18n } = useTranslation();
  const { verifiedCount, stationsCovered, activeSince } = summary;

  const activeSinceLine = activeSince
    ? t(
        approxActiveSince
          ? 'activity.summary.activeSinceApprox'
          : 'activity.summary.activeSince',
        { date: formatActiveSince(activeSince, i18n.language) },
      )
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.value}>{verifiedCount}</Text>
          <Text style={styles.label}>
            {t('activity.summary.submissions', { count: verifiedCount })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.value}>{stationsCovered}</Text>
          <Text style={styles.label}>
            {t('activity.summary.stations', { count: stationsCovered })}
          </Text>
        </View>
      </View>
      {activeSinceLine && <Text style={styles.activeSince}>{activeSinceLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    padding: 14,
    backgroundColor: tokens.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
  },
  stats: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'baseline',
  },
  stat: { flexDirection: 'column' },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.brand.ink,
    lineHeight: 24,
  },
  label: {
    fontSize: 11,
    color: tokens.neutral.n500,
    marginTop: 2,
  },
  activeSince: {
    fontSize: 11,
    color: tokens.neutral.n500,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.neutral.n100,
  },
});
