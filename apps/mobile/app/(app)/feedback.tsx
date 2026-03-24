import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
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
          placeholderTextColor="#aaa"
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
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{t('feedback.submit')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  container: { padding: 24 },
  label: { fontSize: 15, color: '#333', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#1a1a1a',
    minHeight: 140,
    marginBottom: 8,
  },
  charCount: { fontSize: 12, color: '#999', textAlign: 'right', marginBottom: 16 },
  errorText: { fontSize: 14, color: '#ef4444', marginBottom: 12 },
  submitButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  thankYouText: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 24, textAlign: 'center' },
  doneButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  doneButtonText: { color: '#f59e0b', fontSize: 15, fontWeight: '500' },
});
