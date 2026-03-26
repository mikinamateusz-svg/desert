import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import type { FreshnessBand } from '../utils/freshnessBand';

interface Props {
  band: FreshnessBand;
  source: 'community' | 'seeded';
  updatedAt: string; // ISO timestamp — appended to accessibilityLabel for exact time
}

export function FreshnessIndicator({ band, source, updatedAt }: Props) {
  const { t } = useTranslation();

  if (source === 'seeded') {
    return (
      <View
        style={styles.hollow}
        accessibilityRole="image"
        accessibilityLabel={`${t('freshness.estimated')}. ${updatedAt}`}
      />
    );
  }

  const dotStyle =
    band === 'fresh'   ? styles.dotFresh   :
    band === 'recent'  ? styles.dotRecent  :
    band === 'stale'   ? styles.dotStale   :
    styles.dotUnknown;

  const bandLabel =
    band === 'fresh'  ? t('freshness.fresh')         :
    band === 'recent' ? t('freshness.recent')         :
    band === 'stale'  ? t('freshness.mayBeOutdated')  :
    updatedAt; // unknown band — fall back to raw ISO string

  return (
    <View
      style={dotStyle}
      accessibilityRole="image"
      accessibilityLabel={`${bandLabel}. ${updatedAt}`}
    />
  );
}

const DOT_SIZE = 8;

const styles = StyleSheet.create({
  dotFresh: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: tokens.fresh.recent,
  },
  dotRecent: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: tokens.fresh.stale,
  },
  dotStale: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: tokens.fresh.old,
  },
  dotUnknown: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: tokens.neutral.n400,
  },
  hollow: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n400,
    backgroundColor: 'transparent',
  },
});
