import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiRequestDataExport } from '../../src/api/user';
import { changeLanguage, SUPPORTED_LOCALES } from '../../src/i18n';
import type { SupportedLocale } from '../../src/i18n';

export default function AccountScreen() {
  const { user, logout, accessToken } = useAuth();
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language as SupportedLocale;
  const [isExporting, setIsExporting] = useState(false);

  async function handleExportData() {
    if (!accessToken) {
      Alert.alert('', t('account.exportDataSignInRequired'));
      return;
    }
    setIsExporting(true);
    try {
      await apiRequestDataExport(accessToken);
      Alert.alert('', t('account.exportDataSuccess'));
    } catch {
      Alert.alert('', t('account.exportDataError'));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleLanguageChange(lang: SupportedLocale) {
    await changeLanguage(lang);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{user?.display_name ?? user?.email ?? 'Guest'}</Text>
      <View style={styles.langRow}>
        {SUPPORTED_LOCALES.map((lang) => (
          <TouchableOpacity
            key={lang}
            style={[styles.langButton, currentLang === lang && styles.langButtonActive]}
            onPress={() => void handleLanguageChange(lang)}
          >
            <Text style={[styles.langButtonText, currentLang === lang && styles.langButtonTextActive]}>
              {t(`account.language.${lang}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.button} onPress={logout}>
        <Text style={styles.buttonText}>{t('account.signOut')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, isExporting && styles.buttonDisabled]}
        onPress={handleExportData}
        disabled={isExporting}
      >
        {isExporting ? (
          <ActivityIndicator size="small" color="#444" />
        ) : (
          <Text style={styles.buttonText}>{t('account.exportDataButton')}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/privacy-settings')}>
        <Text style={styles.buttonText}>{t('account.privacySettings')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/feedback')}>
        <Text style={styles.buttonText}>{t('account.sendFeedback')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteRow}
        onPress={() => router.push('/(app)/delete-account')}
      >
        <Text style={styles.deleteText}>{t('account.deleteAccountButton')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  name: { fontSize: 16, color: '#333', marginBottom: 24 },
  langRow: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 8,
  },
  langButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  langButtonActive: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  langButtonText: {
    color: '#444',
    fontSize: 14,
  },
  langButtonTextActive: {
    color: '#f59e0b',
    fontWeight: '600',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    marginBottom: 16,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: { color: '#444', fontSize: 14 },
  deleteRow: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  deleteText: { color: '#c0392b', fontSize: 14 },
});
