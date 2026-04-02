import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';

interface Props {
  onAddPrice: () => void;
  onLogFillup: () => void;
  isPanning: boolean;
}

export function MapFABGroup({ onAddPrice, onLogFillup, isPanning }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isPanning ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isPanning, opacity]);

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: insets.bottom + 80 },
        { opacity },
      ]}
      pointerEvents={isPanning ? 'none' : 'box-none'}
    >
      <TouchableOpacity
        style={styles.primaryPill}
        onPress={onAddPrice}
        accessibilityLabel={t('contribution.addPrice')}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{t('contribution.addPrice')}</Text>
      </TouchableOpacity>

      <View style={styles.gap} />

      <TouchableOpacity
        style={styles.secondaryPill}
        onPress={onLogFillup}
        accessibilityLabel={t('contribution.logFillup')}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>{t('contribution.logFillup')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 14,
    alignItems: 'flex-end',
  },
  gap: {
    height: 8,
  },
  primaryPill: {
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: tokens.neutral.n0,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryPill: {
    backgroundColor: tokens.neutral.n0,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryText: {
    color: tokens.neutral.n500,
    fontSize: 14,
    fontWeight: '600',
  },
});
