import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';

interface Props {
  pending: number;
  failed: number;
}

/**
 * Neutral pill shown above MapFABGroup when photos are waiting to upload.
 * Failed uploads are included in the count silently — the retry mechanism
 * handles them in the background without alarming the user.
 */
export function QueueBadge({ pending, failed }: Props) {
  const { t } = useTranslation();

  const total = pending + failed;
  if (total === 0) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.label}>
        {t('contribution.queuePending', { count: total })}
      </Text>
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
  label: {
    color: tokens.neutral.n0,
    fontSize: 12,
    fontWeight: '500',
  },
});
