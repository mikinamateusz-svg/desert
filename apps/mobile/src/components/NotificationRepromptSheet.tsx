import { useEffect } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import { useAuth } from '../store/auth.store';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import {
  apiUpdateNotificationPreferences,
  apiRecordNotificationEvent,
} from '../api/notifications';

interface Props {
  visible: boolean;
  variant: 'photo' | 'monthly';
  /** Only used by the monthly variant. When null/undefined, the sheet
   *  falls back to a generic "Your monthly fuel summary is ready" title
   *  rather than risk an awkward "You saved 0 PLN" line. */
  savedPln?: number | null;
  onDismiss: () => void;
}

/**
 * Story 6.6 — bottom-sheet modal that re-prompts the user to enable OS
 * push notifications. Two trigger variants:
 *   - `photo`   — fired from confirm.tsx after a successful submission
 *   - `monthly` — fired from the (app) layout when Story 6.5 has computed
 *                 a monthly summary but the user has no push token yet
 *
 * On "Enable", we kick off the OS permission prompt; on `granted` we
 * immediately persist the Expo push token via PATCH /v1/me/notifications
 * and navigate to the prefs panel so the user can configure their alerts.
 * On any terminal outcome (granted, denied, or "No thanks") we call
 * `onDismiss` so the parent can record the AsyncStorage two-strike flag.
 */
export function NotificationRepromptSheet({ visible, variant, savedPln, onDismiss }: Props) {
  const { t } = useTranslation();
  const { requestPermission, getExpoPushToken } = useNotificationPermission();
  const { accessToken } = useAuth();
  const router = useRouter();

  // Story 6.8 — fire `reprompt_shown` whenever the sheet becomes visible.
  // Best-effort; analytics breakage must never block the UX.
  useEffect(() => {
    if (!visible || !accessToken) return;
    apiRecordNotificationEvent(accessToken, 'reprompt_shown', variant).catch(() => {});
  }, [visible, accessToken, variant]);

  async function handleEnable() {
    const status = await requestPermission();
    if (status === 'granted') {
      // Story 6.8 — fire grant event whether or not the token save lands;
      // the OS permission is the meaningful conversion signal.
      if (accessToken) {
        apiRecordNotificationEvent(accessToken, 'reprompt_granted', variant).catch(() => {});
      }
      const token = await getExpoPushToken();
      let saveFailed = false;
      if (token && accessToken) {
        try {
          await apiUpdateNotificationPreferences(accessToken, { expo_push_token: token });
        } catch {
          // Surface the failure so the user knows their token wasn't
          // saved — half-enabled state would otherwise be invisible.
          // /notifications screen is the place to retry.
          saveFailed = true;
        }
      } else if (!token) {
        // Token retrieval failed (Expo Go / simulator / project-id
        // misconfig) — same outcome, surface it.
        saveFailed = true;
      }
      if (saveFailed) {
        Alert.alert(
          t('notifications.errorSaving'),
          t('notifications.repromptSaveFailedHint'),
        );
      }
      onDismiss();
      // Land on the prefs panel rather than the alerts inbox — the user
      // just opted in for the first time, the most useful next step is
      // configuring their preferences (radius, fuel types, target price).
      router.push('/(app)/notifications');
    } else {
      // Denied or undetermined — record as shown so we don't pester again.
      // Story 6.8 — treat as a dismiss (the user actively rejected the OS prompt).
      if (accessToken) {
        apiRecordNotificationEvent(accessToken, 'reprompt_dismissed', variant).catch(() => {});
      }
      onDismiss();
    }
  }

  function handleDismiss() {
    // Story 6.8 — fire dismiss event before propagating to the parent.
    if (accessToken) {
      apiRecordNotificationEvent(accessToken, 'reprompt_dismissed', variant).catch(() => {});
    }
    onDismiss();
  }

  const title =
    variant === 'photo'
      ? t('notifications.repromptTitle')
      : savedPln != null
        ? t('notifications.repromptMonthlyTitle', { amount: savedPln })
        : t('notifications.repromptMonthlyTitleNoAmount');

  const subtitle =
    variant === 'photo'
      ? t('notifications.repromptSubtitle')
      : t('notifications.repromptMonthlySubtitle');

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={handleDismiss}>
      <Pressable style={styles.overlay} onPress={handleDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <TouchableOpacity
          style={styles.enableButton}
          onPress={() => void handleEnable()}
          accessibilityRole="button"
        >
          <Text style={styles.enableText}>{t('notifications.repromptEnable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          accessibilityRole="button"
        >
          <Text style={styles.dismissText}>{t('notifications.repromptDismiss')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    color: tokens.brand.ink,
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  enableButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  enableText: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.neutral.n0,
  },
  dismissButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },
});
