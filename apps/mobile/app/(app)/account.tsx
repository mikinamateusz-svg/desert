import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { tokens } from '../../src/theme';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiRequestDataExport } from '../../src/api/user';
import { changeLanguage, SUPPORTED_LOCALES } from '../../src/i18n';
import type { SupportedLocale } from '../../src/i18n';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function AccountScreen() {
  const { user, logout, accessToken } = useAuth();
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language as SupportedLocale;
  const [isExporting, setIsExporting] = useState(false);

  async function handleExportData() {
    setIsExporting(true);
    try {
      await apiRequestDataExport(accessToken!);
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        alwaysBounceVertical={false}
      >
        {/* ── Identity ── */}
        <View style={styles.identitySection}>
          {accessToken ? (
            <>
              <View style={styles.avatar}>
                <Text style={styles.avatarInitials}>
                  {getInitials(user?.display_name ?? user?.email ?? '?')}
                </Text>
              </View>
              <Text style={styles.displayName}>
                {user?.display_name ?? user?.email}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.avatarGuest}>
                <Text style={styles.avatarGuestIcon}>👤</Text>
              </View>
              <Text style={styles.notSignedIn}>{t('account.notSignedIn')}</Text>
            </>
          )}
        </View>

        {/* ── Language selector ── */}
        <Text style={styles.sectionLabel}>{t('account.languageLabel')}</Text>
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

        {/* ── Actions ── */}
        <View style={styles.actionsSection}>
          {/* Sign In / Sign Out */}
          {accessToken ? (
            <TouchableOpacity style={styles.button} onPress={logout}>
              <Text style={styles.buttonText}>{t('account.signOut')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.buttonText}>{t('account.signIn')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/feedback')}>
            <Text style={styles.buttonText}>{t('account.sendFeedback')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/privacy-settings')}>
            <Text style={styles.buttonText}>{t('account.privacySettings')}</Text>
          </TouchableOpacity>

          {accessToken && (
            <TouchableOpacity
              style={[styles.button, isExporting && styles.buttonDisabled]}
              onPress={handleExportData}
              disabled={isExporting}
            >
              {isExporting
                ? <ActivityIndicator size="small" color={tokens.neutral.n500} />
                : <Text style={styles.buttonText}>{t('account.exportDataButton')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {/* ── Destructive zone (logged-in only) ── */}
        {accessToken && (
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={() => router.push('/(app)/delete-account')}
          >
            <Text style={styles.deleteText}>{t('account.deleteAccountButton')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },

  // Identity
  identitySection: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarInitials: {
    fontSize: 26,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },
  avatarGuest: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.neutral.n200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarGuestIcon: {
    fontSize: 32,
  },
  displayName: {
    fontSize: 17,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  notSignedIn: {
    fontSize: 17,
    fontWeight: '500',
    color: tokens.neutral.n400,
  },

  // Language
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: tokens.neutral.n400,
    marginBottom: 10,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  langButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
  },
  langButtonActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  langButtonText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  langButtonTextActive: {
    color: tokens.brand.accent,
    fontWeight: '700',
  },

  // Action buttons
  actionsSection: {
    gap: 12,
    marginBottom: 32,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 15,
    color: tokens.brand.ink,
    fontWeight: '500',
  },

  // Destructive
  deleteRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  deleteText: {
    fontSize: 14,
    color: tokens.price.expensive,
    fontWeight: '500',
  },
});
