import React, { useState } from 'react';
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

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function SoftSignUpSheet({ visible, onDismiss }: Props) {
  const { t } = useTranslation();
  const { skipOnboarding } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSkip() {
    try {
      await skipOnboarding();
    } catch {
      // AsyncStorage failure — dismiss anyway so the user isn't stuck
    }
    onDismiss();
  }

  function handleUseEmail() {
    onDismiss();
    router.push('/(auth)/register');
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
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={handleSkip}
    >
      <Pressable style={styles.overlay} onPress={handleSkip} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{t('auth.onboarding.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.onboarding.subtitle')}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoogleSignInButton onError={handleSocialError} />
        <AppleSignInButton onError={handleSocialError} />

        <TouchableOpacity style={styles.emailButton} onPress={handleUseEmail}>
          <Text style={styles.emailButtonText}>{t('auth.onboarding.useEmail')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipText}>{t('auth.onboarding.skip')}</Text>
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
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 24,
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
  skipButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  skipText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },
});
