import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '../theme';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth.store';
import { GoogleSignInButton } from './GoogleSignInButton';
import { AppleSignInButton } from './AppleSignInButton';

export type FeatureGateKey = 'alerts' | 'savings' | 'log' | 'leaderboard';

interface Props {
  visible: boolean;
  /** Called when the user dismisses (no penalty) or after a successful social sign-in. */
  onDismiss: () => void;
  /** Determines the feature-specific title and value proposition. */
  featureKey: FeatureGateKey;
  /**
   * App route to push after a successful email registration.
   * E.g. '/(app)/alerts'. Omit to use the register screen's default behaviour.
   */
  returnTo?: string;
}

/**
 * Generic feature-gate bottom sheet.
 *
 * Shown when a guest navigates to a gated feature. Presents feature-specific
 * copy and sign-up options. On social sign-in the auth store updates and the
 * sheet auto-dismisses, letting the underlying screen reactively show its
 * authenticated state. On email, navigates to register with an optional returnTo
 * param — onDismiss is NOT called so the gate stays mounted while register slides
 * in and auto-dismisses on return if the user completed sign-up. On "Maybe later"
 * the sheet dismisses with no penalty and will reappear on next visit.
 *
 * The photo-submission gate (Epic 3) continues to use SignUpGateSheet which has
 * its own discard semantics — this component does not replace it.
 */
export function FeatureGateSheet({ visible, onDismiss, featureKey, returnTo }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Stable refs so effects don't re-run just because the callback/value identity changes.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  const accessTokenRef = useRef<string | null>(null);
  useEffect(() => { accessTokenRef.current = accessToken ?? null; }, [accessToken]);

  const tokenAtOpenRef = useRef<string | null>(null);

  // Fires only when visibility changes. Reads accessToken via ref to avoid
  // re-running on every token change.
  useEffect(() => {
    if (!visible) return;
    // Gate opened while user is already authenticated — dismiss immediately.
    if (accessTokenRef.current) {
      onDismissRef.current();
      return;
    }
    // Snapshot null so the auto-dismiss effect triggers on the null → value transition.
    tokenAtOpenRef.current = null;
    setError(null); // Clear any stale error from a previous open.
  }, [visible]);

  // Auto-dismiss when social sign-in succeeds while gate is visible.
  useEffect(() => {
    if (visible && accessToken && tokenAtOpenRef.current === null) {
      onDismissRef.current();
    }
  }, [accessToken, visible]);

  function handleUseEmail() {
    // Navigate directly without calling onDismiss. The gate stays mounted while
    // the register screen slides in. On return:
    //   - User completed sign-up → accessToken set → visibility effect auto-dismisses.
    //   - User cancelled → gate is still open (correct — they're still a guest).
    const href = returnTo
      ? `/(auth)/register?returnTo=${encodeURIComponent(returnTo)}`
      : '/(auth)/register';
    router.push(href as Parameters<typeof router.push>[0]);
  }

  function handleSocialError(code: string) {
    const errorMap: Record<string, string> = {
      SOCIAL_EMAIL_CONFLICT: t('auth.common.socialEmailConflict'),
      INVALID_GOOGLE_TOKEN:  t('auth.common.invalidGoogleToken'),
      GOOGLE_EMAIL_MISSING:  t('auth.common.googleEmailMissing'),
      INVALID_APPLE_TOKEN:   t('auth.common.invalidAppleToken'),
      APPLE_EMAIL_MISSING:   t('auth.common.appleEmailMissing'),
    };
    setError(errorMap[code] ?? t('auth.common.genericSignInError'));
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={() => onDismissRef.current()}
    >
      <Pressable style={styles.overlay} onPress={() => onDismissRef.current()} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{t(`featureGate.${featureKey}.title`)}</Text>
        <Text style={styles.subtitle}>{t(`featureGate.${featureKey}.subtitle`)}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoogleSignInButton onError={handleSocialError} />
        <AppleSignInButton  onError={handleSocialError} />

        <TouchableOpacity style={styles.emailButton} onPress={handleUseEmail}>
          <Text style={styles.emailButtonText}>{t('featureGate.useEmail')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.laterButton} onPress={() => onDismissRef.current()}>
          <Text style={styles.laterText}>{t('featureGate.maybeLater')}</Text>
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
    marginBottom: 24,
    lineHeight: 20,
  },
  error: {
    color: tokens.price.expensive,
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  emailButton: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  emailButtonText: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '500',
  },
  laterButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  laterText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },
});
