import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
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
        <Text style={styles.title}>{t('account.deleteAccount.step1Title')}</Text>
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
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteButtonText}>{t('account.deleteAccount.confirmButton')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: '#111', marginBottom: 16 },
  body: { fontSize: 15, color: '#444', marginBottom: 12 },
  retained: { fontSize: 13, color: '#888', marginBottom: 32 },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#444', fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 20,
  },
  error: { color: '#c0392b', fontSize: 14, marginBottom: 16 },
  deleteButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#c0392b',
    alignItems: 'center',
  },
  deleteButtonDisabled: { backgroundColor: '#e0b0aa' },
  deleteButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
