import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { flags } from '../../src/config/flags';
import { usePremiumAlertsStatus } from '../../src/hooks/usePremiumAlertsStatus';

const PREMIUM_ALERT_WINDOW_DAYS = 30;

// Story 6.10 — extended from 4s when alerts-loop copy is shown so users
// have time to read the additional reassurance + disclaimer lines.
const AUTO_DISMISS_MS = flags.alertsLoop ? 6_000 : 4_000;

export default function ConfirmScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { stationName } = useLocalSearchParams<{ stationName?: string }>();
  const { activeUntil } = usePremiumAlertsStatus();

  // P1 (6.10 review) — branch the alerts-loop copy: if the user already
  // has an active premium window, this verification will EXTEND it; if
  // not, this verification will ACTIVATE it. Compute the projected new-
  // until client-side via the same MAX(current, NOW + 30d) formula the
  // backend uses on verify.
  const projectedNewUntil = (() => {
    const candidate = Date.now() + PREMIUM_ALERT_WINDOW_DAYS * 86_400_000;
    if (activeUntil && activeUntil.getTime() > candidate) return activeUntil;
    return new Date(candidate);
  })();
  const isExtension = activeUntil != null && activeUntil.getTime() > Date.now();
  const formattedNewUntil = projectedNewUntil.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

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

      {/* Story 6.10 — alerts-loop reassurance + verified-only disclaimer.
          Activate-vs-extend branch driven by the user's current premium
          window state (per AC8). Hidden when flags.alertsLoop is off. */}
      {flags.alertsLoop && (
        <>
          <Text style={styles.alertsLoopMessage}>
            {isExtension
              ? t('confirmation.alertsLoopExtend', { date: formattedNewUntil })
              : t('confirmation.alertsLoopActivate')}
          </Text>
          <Text style={styles.alertsLoopDisclaimer}>
            {t('confirmation.alertsVerifiedOnlyDisclaimer')}
          </Text>
        </>
      )}

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
    marginBottom: 24,
  },
  alertsLoopMessage: {
    fontSize: 14,
    color: tokens.brand.ink,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  alertsLoopDisclaimer: {
    fontSize: 12,
    color: tokens.neutral.n500,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 16,
    marginBottom: 24,
    paddingHorizontal: 16,
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
