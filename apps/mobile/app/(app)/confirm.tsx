import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';

const AUTO_DISMISS_MS = 4_000;

export default function ConfirmScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { stationName } = useLocalSearchParams<{ stationName?: string }>();

  // Auto-navigate to map after 4 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/(app)/');
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      {/* Checkmark */}
      <View style={styles.checkCircle}>
        <Text style={styles.checkmark}>✓</Text>
      </View>

      <Text style={styles.title}>{t('confirmation.thankYou')}</Text>

      {stationName && (
        <Text style={styles.stationName}>{stationName}</Text>
      )}

      <Text style={styles.subtitle}>{t('confirmation.impactMessage')}</Text>

      <TouchableOpacity
        style={styles.doneButton}
        onPress={() => router.replace('/(app)/')}
        accessibilityRole="button"
      >
        <Text style={styles.doneText}>{t('confirmation.done')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.brand.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkmark: {
    fontSize: 36,
    color: tokens.brand.ink,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  stationName: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: tokens.neutral.n400,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },
  doneButton: {
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  doneText: {
    color: tokens.neutral.n0,
    fontSize: 16,
    fontWeight: '600',
  },
});
