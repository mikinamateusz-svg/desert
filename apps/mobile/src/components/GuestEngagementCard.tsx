import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import { GoogleSignInButton } from './GoogleSignInButton';
import { AppleSignInButton } from './AppleSignInButton';
import { apiLogGuestNudgeEvent } from '../api/guest-nudge';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Story 6.9 Nudge 1 — engagement-based card shown after a guest has
 * opened the app 3+ times within 7 days (gating handled by the parent
 * via `useGuestSessionCounter` + `@guest:nudge:engagement:shown`).
 *
 * Offers Google / Apple / email sign-in plus a dismiss option. Fires
 * `guest_nudge_shown` on display and `guest_nudge_dismissed` /
 * `guest_nudge_cta_tapped` on the corresponding actions.
 *
 * Pattern mirrors SoftSignUpSheet for visual consistency; uses the
 * same modal-with-overlay treatment but with engagement-specific copy.
 */
export function GuestEngagementCard({ visible, onDismiss }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Fire `nudge_shown` analytics when the card becomes visible.
  // Best-effort — analytics breakage must never block the UX.
  useEffect(() => {
    if (!visible) return;
    apiLogGuestNudgeEvent('engagement', 'guest_nudge_shown').catch(() => {});
  }, [visible]);

  function handleDismiss() {
    apiLogGuestNudgeEvent('engagement', 'guest_nudge_dismissed').catch(() => {});
    onDismiss();
  }

  function handleUseEmail() {
    apiLogGuestNudgeEvent('engagement', 'guest_nudge_cta_tapped').catch(() => {});
    onDismiss();
    router.replace('/(auth)/register');
  }

  function handleSocialError(code: string) {
    if (code === 'SOCIAL_EMAIL_CONFLICT') {
      setError(t('auth.common.socialEmailConflict'));
    } else if (code === 'INVALID_GOOGLE_TOKEN') {
      setError(t('auth.common.invalidGoogleToken'));
    } else if (code === 'GOOGLE_EMAIL_MISSING') {
      setError(t('auth.common.googleEmailMissing'));
    } else if (code === 'INVALID_APPLE_TOKEN') {
      setError(t('auth.common.invalidAppleToken'));
    } else if (code === 'APPLE_EMAIL_MISSING') {
      setError(t('auth.common.appleEmailMissing'));
    } else {
      setError(t('auth.common.genericSignInError'));
    }
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={handleDismiss}>
      <Pressable style={styles.overlay} onPress={handleDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{t('guestNudge.engagement.title')}</Text>
        <Text style={styles.subtitle}>{t('guestNudge.engagement.subtitle')}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoogleSignInButton onError={handleSocialError} />
        <AppleSignInButton onError={handleSocialError} />

        <TouchableOpacity style={styles.emailButton} onPress={handleUseEmail}>
          <Text style={styles.emailButtonText}>{t('guestNudge.engagement.useEmail')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dismissButton} onPress={handleDismiss}>
          <Text style={styles.dismissText}>{t('guestNudge.engagement.dismiss')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
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
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: tokens.brand.ink,
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  error: {
    fontSize: 13,
    color: tokens.price.expensive,
    textAlign: 'center',
    marginBottom: 12,
  },
  emailButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  emailButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.neutral.n0,
  },
  dismissButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  dismissText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },
});
