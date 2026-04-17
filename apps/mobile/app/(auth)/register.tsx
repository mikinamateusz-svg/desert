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
  Linking,
  ScrollView,
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedWithdrawal, setAcceptedWithdrawal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const consentsValid = acceptedTerms && acceptedWithdrawal;

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
    if (!consentsValid) {
      setError(t('auth.register.consentRequired'));
      return;
    }
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
      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => router.replace('/(app)/')}
        accessibilityLabel="Close"
        accessibilityRole="button"
      >
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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

      {/* Consent checkboxes */}
      <TouchableOpacity
        style={styles.checkboxRow}
        onPress={() => setAcceptedTerms(v => !v)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
          {acceptedTerms && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkboxLabel}>
          {t('auth.register.acceptTermsPrefix')}
          <Text
            style={styles.checkboxLink}
            onPress={() => Linking.openURL('https://litro.pl/regulamin')}
          >
            {t('auth.register.termsLink')}
          </Text>
          {t('auth.register.andWord')}
          <Text
            style={styles.checkboxLink}
            onPress={() => Linking.openURL('https://litro.pl/polityka-prywatnosci')}
          >
            {t('auth.register.privacyLink')}
          </Text>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.checkboxRow}
        onPress={() => setAcceptedWithdrawal(v => !v)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, acceptedWithdrawal && styles.checkboxChecked]}>
          {acceptedWithdrawal && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkboxLabel}>
          {t('auth.register.acceptWithdrawal')}
        </Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (isSubmitting || !consentsValid) && styles.buttonDisabled]}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.neutral.n200,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: tokens.neutral.n500,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: tokens.brand.ink,
    borderColor: tokens.brand.ink,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
    lineHeight: 18,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: tokens.brand.ink,
    lineHeight: 18,
  },
  checkboxLink: {
    color: tokens.brand.accent,
    textDecorationLine: 'underline' as const,
  },
});
