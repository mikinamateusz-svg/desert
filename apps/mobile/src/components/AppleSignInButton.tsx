import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '../store/auth.store';
import { ApiError } from '../api/auth';

interface Props {
  onError?: (code: string) => void;
}

export function AppleSignInButton({ onError }: Props) {
  const auth = useAuth();
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setIsAvailable);
    }
  }, []);

  if (!isAvailable) return null;

  async function handlePress() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) return;

      await auth.appleSignIn(credential.identityToken, credential.fullName);
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ERR_REQUEST_CANCELED') return; // user cancelled — no-op
      const code = err instanceof ApiError ? err.error : 'UNKNOWN_ERROR';
      onError?.(code);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={8}
      style={{ height: 48, marginBottom: 16 }}
      onPress={handlePress}
    />
  );
}
