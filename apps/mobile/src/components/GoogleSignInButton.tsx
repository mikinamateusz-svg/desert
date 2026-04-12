import React, { useEffect, useState } from 'react';
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

const GOOGLE_CONFIGURED =
  !!process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] &&
  process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] !== 'xxxx.apps.googleusercontent.com';

// Lazy-loaded native modules — only imported when Google is actually configured.
// Importing expo-auth-session / expo-web-browser at module scope crashes on some
// Android devices (notably Xiaomi) even if the components are never rendered.
let Google: typeof import('expo-auth-session/providers/google') | null = null;
if (GOOGLE_CONFIGURED) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');
  WebBrowser.maybeCompleteAuthSession();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Google = require('expo-auth-session/providers/google') as typeof import('expo-auth-session/providers/google');
}

// Stub component when Google is not configured — avoids loading native modules entirely
function GoogleSignInButtonDisabled() {
  return null;
}

function GoogleSignInButtonEnabled({ onError }: Props) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);

  // expo-auth-session uses browser-based OAuth (Chrome Custom Tab).
  // In standalone builds, the default redirectUri is a custom scheme (desert://)
  // which Google's web client rejects. Force the Expo auth proxy HTTPS URI.
  const [request, response, promptAsync] = Google!.useIdTokenAuthRequest({
    clientId: process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'],
    redirectUri: 'https://auth.expo.io/@mmikina/desert',
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
