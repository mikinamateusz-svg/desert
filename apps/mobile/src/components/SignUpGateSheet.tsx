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
import { useTranslation } from 'react-i18next';
import { GoogleSignInButton } from './GoogleSignInButton';
import { AppleSignInButton } from './AppleSignInButton';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Shown when a guest user tries to submit a price photo.
 * The photo discard logic lives in the caller (Epic 3).
 * This component handles sign-up only.
 */
export function SignUpGateSheet({ visible, onDismiss }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function handleUseEmail() {
    onDismiss();
    router.push('/(auth)/register');
  }

  function handleSocialError(code: string) {
    if (code === 'SOCIAL_EMAIL_CONFLICT') {
      setError(t('auth.common.socialEmailConflict'));
    } else if (code === 'INVALID_GOOGLE_TOKEN') {
      setError(t('auth.common.invalidGoogleToken'));
    } else if (code === 'INVALID_APPLE_TOKEN') {
      setError(t('auth.common.invalidAppleToken'));
    } else {
      setError(t('auth.common.genericSignInError'));
    }
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{t('auth.gate.title')}</Text>
        <Text style={styles.subtitle}>{t('auth.gate.subtitle')}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoogleSignInButton onError={handleSocialError} />
        <AppleSignInButton onError={handleSocialError} />

        <TouchableOpacity style={styles.emailButton} onPress={handleUseEmail}>
          <Text style={styles.emailButtonText}>{t('auth.gate.useEmail')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.discardButton} onPress={onDismiss}>
          <Text style={styles.discardText}>{t('auth.gate.discard')}</Text>
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
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
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  error: {
    color: '#e53e3e',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  emailButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  emailButtonText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
  discardButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  discardText: {
    fontSize: 14,
    color: '#9ca3af',
  },
});
