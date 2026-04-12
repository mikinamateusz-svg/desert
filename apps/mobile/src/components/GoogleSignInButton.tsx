import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth.store';
import { ApiError } from '../api/auth';

interface Props {
  onError?: (code: string) => void;
}

const GOOGLE_WEB_CLIENT_ID = process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];

const GOOGLE_CONFIGURED =
  !!GOOGLE_WEB_CLIENT_ID &&
  GOOGLE_WEB_CLIENT_ID !== 'xxxx.apps.googleusercontent.com';

// Native Google Sign-In SDK — lazy-loaded to avoid crashes on devices
// where the module initialisation fails when Google is not configured.
let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null = null;
if (GOOGLE_CONFIGURED) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  GoogleSignin = mod.GoogleSignin;
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
}

function GoogleSignInButtonDisabled() {
  return null;
}

function GoogleSignInButtonEnabled({ onError }: Props) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);

  async function handlePress() {
    setLoading(true);
    try {
      await GoogleSignin!.hasPlayServices();
      const response = await GoogleSignin!.signIn();

      if (response.type === 'cancelled') {
        setLoading(false);
        return;
      }

      const idToken = response.data?.idToken;
      if (!idToken) {
        onError?.('GOOGLE_EMAIL_MISSING');
        setLoading(false);
        return;
      }

      await auth.googleSignIn(idToken);
    } catch (err: unknown) {
      const code = err instanceof ApiError ? err.error : 'UNKNOWN_ERROR';
      onError?.(code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableOpacity
      style={[styles.button, loading && styles.buttonDisabled]}
      disabled={loading}
      onPress={handlePress}
    >
      {loading ? (
        <ActivityIndicator color="#1a73e8" />
      ) : (
        <Text style={styles.buttonText}>
          {t('auth.common.continueWithGoogle')}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export const GoogleSignInButton = GOOGLE_CONFIGURED
  ? GoogleSignInButtonEnabled
  : GoogleSignInButtonDisabled;

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#3c4043',
    fontSize: 16,
    fontWeight: '500',
  },
});
