import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { ApiError } from '../../src/api/auth';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';
import { AppleSignInButton } from '../../src/components/AppleSignInButton';
import { LitroLogo } from '../../src/components/LitroLogo';
import { tokens } from '../../src/theme/tokens';

const ALLOWED_RETURN_ROUTES: readonly string[] = [
  '/(app)/alerts',
  '/(app)/log',
  '/(app)/leaderboard',
];

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleGoogleError(code: string) {
    if (code === 'SOCIAL_EMAIL_CONFLICT') {
      setError(t('auth.common.socialEmailConflict'));
    } else if (code === 'GOOGLE_EMAIL_MISSING') {
      setError(t('auth.common.googleEmailMissing'));
    } else if (code === 'INVALID_APPLE_TOKEN') {
      setError(t('auth.common.invalidAppleToken'));
    } else if (code === 'APPLE_EMAIL_MISSING') {
      setError(t('auth.common.appleEmailMissing'));
    } else {
      setError(t('auth.common.invalidGoogleToken'));
    }
  }

  async function handleRegister() {
    setError(null);
    setIsSubmitting(true);
    try {
      await register(email, password, displayName);
      if (returnTo && ALLOWED_RETURN_ROUTES.includes(returnTo)) {
        router.replace(returnTo as Parameters<typeof router.replace>[0]);
      }
    } catch (err) {
      if (err instanceof ApiError && err.error === 'EMAIL_ALREADY_EXISTS') {
        setError(t('auth.register.emailAlreadyExists'));
      } else {
        setError(t('auth.register.genericError'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.logoRow}>
        <LitroLogo size={36} />
      </View>
      <Text style={styles.title}>{t('auth.register.title')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('auth.register.displayNameLabel')}
        value={displayName}
        onChangeText={setDisplayName}
      />

      <TextInput
        style={styles.input}
        placeholder={t('auth.register.emailLabel')}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder={t('auth.register.passwordLabel')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{t('auth.register.submitButton')}</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.divider}>{t('auth.common.orDivider')}</Text>

      <GoogleSignInButton onError={handleGoogleError} />
      <AppleSignInButton onError={handleGoogleError} />

      <Link href="/(auth)/login" style={styles.link}>
        {t('auth.register.loginLink')}
      </Link>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: tokens.surface.page,
  },
  logoRow: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
    color: tokens.brand.ink,
    backgroundColor: tokens.surface.card,
  },
  error: {
    color: tokens.price.expensive,
    marginBottom: 12,
    fontSize: 14,
  },
  button: {
    backgroundColor: tokens.brand.ink,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 16,
  },
  link: {
    textAlign: 'center',
    color: tokens.brand.accent,
    fontSize: 14,
  },
});
