import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { flags } from '../../src/config/flags';
import { useAlertsStatus } from '../../src/hooks/useAlertsStatus';
import { useNotificationPermission } from '../../src/hooks/useNotificationPermission';
import { NotificationRepromptSheet } from '../../src/components/NotificationRepromptSheet';
import {
  REPROMPT_PHOTO_KEY,
  shouldSkipAllReprompts,
  hasShownReprompt,
  recordRepromptShown,
} from '../../src/components/repromptStorage';

// Story 6.6 — short delay before the sheet appears so the "thank you"
// animation can settle. Kept well below the screen's 4s/6s auto-dismiss
// so the sheet has time to be readable before the user is bounced home.
const REPROMPT_DELAY_MS = 1_000;

const ALERT_WINDOW_DAYS = 30;

// Story 6.10 — extended from 4s when alerts-loop copy is shown so users
// have time to read the additional reassurance + disclaimer lines.
const AUTO_DISMISS_MS = flags.alertsLoop ? 6_000 : 4_000;

export default function ConfirmScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { stationName } = useLocalSearchParams<{ stationName?: string }>();
  const { activeUntil } = useAlertsStatus();
  const { status: permissionStatus, isChecking: permissionChecking } = useNotificationPermission();
  const [showReprompt, setShowReprompt] = useState(false);

  // P1 (6.10 review) — branch the alerts-loop copy: if the user already
  // has an active alerts window, this verification will EXTEND it; if
  // not, this verification will ACTIVATE it. Compute the projected new-
  // until client-side via the same MAX(current, NOW + 30d) formula the
  // backend uses on verify.
  const projectedNewUntil = (() => {
    const candidate = Date.now() + ALERT_WINDOW_DAYS * 86_400_000;
    if (activeUntil && activeUntil.getTime() > candidate) return activeUntil;
    return new Date(candidate);
  })();
  const isExtension = activeUntil != null && activeUntil.getTime() > Date.now();
  const formattedNewUntil = projectedNewUntil.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Auto-navigate to map after 4 / 6 seconds — UNLESS the re-prompt
  // sheet is visible, in which case we'd kick the user away mid-read.
  // Re-arm the timer when the sheet is dismissed.
  useEffect(() => {
    if (showReprompt) return;
    const timer = setTimeout(() => {
      router.replace('/(app)/');
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [showReprompt]);

  // Story 6.6 — photo-trigger smart re-prompt. Only fires when:
  //   - permission has actually been resolved (avoid flicker on cold mount)
  //   - permission is UNDETERMINED specifically — not 'denied'. On iOS,
  //     requestPermissionsAsync() after a prior denial returns 'denied'
  //     without showing the OS dialog, so the Enable button would dead-
  //     end. Users in 'denied' state are handled by the re-prompt UI in
  //     alerts.tsx (with deep-link to OS settings) instead.
  //   - the photo flag hasn't already been set
  //   - the two-strike rule isn't already triggered
  // Sheet appears on a 1s delay so the "thank you" UI has time to settle.
  useEffect(() => {
    if (permissionChecking || permissionStatus !== 'undetermined') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        // Re-check live permission — user may have granted via a deep-link
        // / Settings round-trip during the 1s delay window, in which case
        // re-prompting would be wasted.
        if (permissionStatus !== 'undetermined') return;
        if (await shouldSkipAllReprompts()) return;
        if (await hasShownReprompt(REPROMPT_PHOTO_KEY)) return;
        if (cancelled) return;
        // Record-on-show, not on-dismiss: protects against the screen
        // auto-navigating away mid-sheet, which would never fire onDismiss
        // and would re-show the sheet on every subsequent submission.
        await recordRepromptShown(REPROMPT_PHOTO_KEY);
        if (cancelled) return;
        setShowReprompt(true);
      })();
    }, REPROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [permissionStatus, permissionChecking]);

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
          Activate-vs-extend branch driven by the user's current alerts
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

      <NotificationRepromptSheet
        visible={showReprompt}
        variant="photo"
        onDismiss={() => setShowReprompt(false)}
      />
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
