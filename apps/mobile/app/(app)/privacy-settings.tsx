import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { apiGetConsents, apiWithdrawConsent, ConsentRecord } from '../../src/api/user';

export default function PrivacySettingsScreen() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      Alert.alert('', t('privacy.signInRequired'));
      router.back();
      return;
    }
    void loadConsents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function loadConsents() {
    if (!accessToken) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await apiGetConsents(accessToken);
      setConsents(data);
    } catch {
      setLoadError(t('privacy.errorLoading'));
    } finally {
      setIsLoading(false);
    }
  }

  function handleWithdrawPress(type: string) {
    Alert.alert(
      t('privacy.withdrawConfirmTitle'),
      t('privacy.withdrawConfirmMessage'),
      [
        { text: t('privacy.withdrawConfirmCancel'), style: 'cancel' },
        { text: t('privacy.withdrawConfirmConfirm'), style: 'destructive', onPress: () => handleWithdraw(type) },
      ],
    );
  }

  async function handleWithdraw(type: string) {
    if (!accessToken) return;
    setWithdrawError(null);
    try {
      await apiWithdrawConsent(accessToken, type);
      Alert.alert('', t('privacy.withdrawSuccess'));
      await loadConsents();
    } catch {
      setWithdrawError(t('privacy.errorWithdrawing'));
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadConsents}>
          <Text style={styles.retryButtonText}>{t('privacy.retryButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t('privacy.title')}</Text>

      {consents.map((consent) => (
        <View key={consent.id} style={styles.consentCard}>
          <Text style={styles.consentType}>
            {consent.type === 'CORE_SERVICE' ? t('privacy.consentTypes.CORE_SERVICE') : consent.type}
          </Text>
          <Text style={styles.consentDate}>
            {t('privacy.consentedOn', { date: formatDate(consent.consented_at) })}
          </Text>
          {consent.withdrawn_at === null ? (
            <>
              <Text style={styles.statusActive}>{t('privacy.consentActive')}</Text>
              <TouchableOpacity style={styles.withdrawButton} onPress={() => handleWithdrawPress(consent.type)}>
                <Text style={styles.withdrawButtonText}>{t('privacy.withdrawButton')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.statusWithdrawn}>
              {t('privacy.consentWithdrawn', { date: formatDate(consent.withdrawn_at) })}
            </Text>
          )}
        </View>
      ))}

      {withdrawError !== null && (
        <Text style={styles.errorText}>{withdrawError}</Text>
      )}

      <Text style={styles.warningText}>{t('privacy.coreServiceWithdrawWarning')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  container: { padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '600', color: '#111', marginBottom: 24 },
  consentCard: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  consentType: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 4 },
  consentDate: { fontSize: 13, color: '#666', marginBottom: 8 },
  statusActive: { fontSize: 13, color: '#27ae60', marginBottom: 12 },
  statusWithdrawn: { fontSize: 13, color: '#888' },
  withdrawButton: { alignSelf: 'flex-start' },
  withdrawButtonText: { color: '#c0392b', fontSize: 14 },
  errorText: { color: '#c0392b', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    marginTop: 8,
  },
  retryButtonText: { color: '#444', fontSize: 14 },
  warningText: { fontSize: 13, color: '#888', marginTop: 8 },
});
