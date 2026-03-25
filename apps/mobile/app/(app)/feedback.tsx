import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { tokens } from '../../src/theme';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useAuth } from '../../src/store/auth.store';
import { apiSubmitFeedback } from '../../src/api/user';

export default function FeedbackScreen() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appVersion = (Constants.expoConfig?.version ?? 'unknown');
  const os = Platform.OS;

  async function handleSubmit() {
    if (!accessToken || !message.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiSubmitFeedback(accessToken, {
        message: message.trim(),
        app_version: appVersion,
        os,
      });
      setSubmitted(true);
    } catch {
      setError(t('feedback.errorSubmitting'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={styles.center}>
        <Text style={styles.thankYouText}>{t('feedback.thankYou')}</Text>
        <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
          <Text style={styles.doneButtonText}>{t('feedback.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{t('feedback.label')}</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder={t('feedback.placeholder')}
          placeholderTextColor={tokens.neutral.n400}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{message.length}/1000</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity
          style={[styles.submitButton, (isSubmitting || !message.trim() || !accessToken) && styles.submitButtonDisabled]}
          onPress={() => void handleSubmit()}
          disabled={isSubmitting || !message.trim() || !accessToken}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={tokens.neutral.n0} />
          ) : (
            <Text style={styles.submitButtonText}>{t('feedback.submit')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: tokens.surface.page },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: tokens.surface.page },
  container: { padding: 24, backgroundColor: tokens.surface.page },
  label: { fontSize: 15, color: tokens.neutral.n800, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
    padding: 12,
    fontSize: 15,
    color: tokens.brand.ink,
    backgroundColor: tokens.surface.card,
    minHeight: 140,
    marginBottom: 8,
  },
  charCount: { fontSize: 12, color: tokens.neutral.n400, textAlign: 'right', marginBottom: 16 },
  errorText: { fontSize: 14, color: tokens.price.expensive, marginBottom: 12 },
  submitButton: {
    backgroundColor: tokens.brand.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: tokens.neutral.n0, fontSize: 16, fontWeight: '600' },
  thankYouText: { fontSize: 18, fontWeight: '600', color: tokens.brand.ink, marginBottom: 24, textAlign: 'center' },
  doneButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  doneButtonText: { color: tokens.brand.accent, fontSize: 15, fontWeight: '500' },
});
