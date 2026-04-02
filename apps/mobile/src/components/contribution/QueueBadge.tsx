import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';

interface Props {
  pending: number;
  failed: number;
}

/**
 * Translucent pill shown above MapFABGroup when photos are queued or failed.
 * Shows pending count first; falls back to failed count if no pending items.
 * Renders nothing when both counts are 0.
 */
export function QueueBadge({ pending, failed }: Props) {
  const { t } = useTranslation();

  if (pending === 0 && failed === 0) return null;

  const label =
    pending > 0
      ? t('contribution.queuePending', { count: pending })
      : t('contribution.queueFailed', { count: failed });

  const isFailed = pending === 0 && failed > 0;

  return (
    <View style={[styles.badge, isFailed && styles.badgeFailed]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: tokens.radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignSelf: 'flex-end',
  },
  badgeFailed: {
    backgroundColor: 'rgba(239,68,68,0.80)', // red tint for failed state
  },
  label: {
    color: tokens.neutral.n0,
    fontSize: 12,
    fontWeight: '500',
  },
});
