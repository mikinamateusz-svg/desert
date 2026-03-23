import React, { useEffect, useState } from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth.store';
import { ApiError } from '../api/auth';

// Must be called at module level — completes the OAuth session on redirect back to app
WebBrowser.maybeCompleteAuthSession();

interface Props {
  onError?: (code: string) => void;
}

export function GoogleSignInButton({ onError }: Props) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'],
    androidClientId: process.env['EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'],
    iosClientId: process.env['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'],
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params['id_token'];
    if (!idToken) return;

    setLoading(true);
    auth
      .googleSignIn(idToken)
      .catch((err: unknown) => {
        const code =
          err instanceof ApiError ? err.error : 'UNKNOWN_ERROR';
        onError?.(code);
      })
      .finally(() => setLoading(false));
  }, [response, auth]);

  return (
    <TouchableOpacity
      style={[styles.button, (!request || loading) && styles.buttonDisabled]}
      disabled={!request || loading}
      onPress={() => promptAsync()}
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
