import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { tokens } from '../../src/theme';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiDeleteAccount } from '../../src/api/user';

type Step = 1 | 2;

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!accessToken) {
      setError(t('account.deleteAccount.errorDeleting'));
      return;
    }
    if (confirmText !== 'DELETE') return;
    setIsDeleting(true);
    setError(null);
    try {
      await apiDeleteAccount(accessToken);
      Alert.alert('', t('account.deleteAccount.successMessage'));
      await logout();
      router.replace('/(auth)/login');
    } catch {
      setError(t('account.deleteAccount.errorDeleting'));
      setIsDeleting(false);
    }
  };

  if (step === 1) {
    return (
      <View style={styles.container}>
        <Text style={styles.body}>{t('account.deleteAccount.step1Body')}</Text>
        <Text style={styles.retained}>{t('account.deleteAccount.step1Retained')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => setStep(2)}>
          <Text style={styles.primaryButtonText}>{t('account.deleteAccount.step1Continue')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>{t('account.deleteAccount.step1Cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('account.deleteAccount.step2Title')}</Text>
        <Text style={styles.body}>{t('account.deleteAccount.typeToConfirm')}</Text>
        <TextInput
          style={styles.input}
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder={t('account.deleteAccount.confirmPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
        />
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[
            styles.deleteButton,
            (!accessToken || confirmText !== 'DELETE' || isDeleting) && styles.deleteButtonDisabled,
          ]}
          onPress={handleDelete}
          disabled={!accessToken || confirmText !== 'DELETE' || isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color={tokens.neutral.n0} />
          ) : (
            <Text style={styles.deleteButtonText}>{t('account.deleteAccount.confirmButton')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: tokens.surface.page },
  title: { fontSize: 20, fontWeight: '600', color: tokens.brand.ink, marginBottom: 16 },
  body: { fontSize: 15, color: tokens.neutral.n500, marginBottom: 12 },
  retained: { fontSize: 13, color: tokens.neutral.n400, marginBottom: 32 },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: tokens.brand.ink,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { color: tokens.neutral.n0, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
  },
  secondaryButtonText: { color: tokens.brand.ink, fontSize: 15, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: tokens.surface.card,
    marginBottom: 20,
  },
  error: { color: tokens.price.expensive, fontSize: 14, marginBottom: 16 },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: tokens.price.expensive,
    alignItems: 'center',
  },
  deleteButtonDisabled: { backgroundColor: '#fca5a5' },
  deleteButtonText: { color: tokens.neutral.n0, fontSize: 15, fontWeight: '600' },
});
