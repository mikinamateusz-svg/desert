import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import {
  apiGetNotificationPreferences,
  apiUpdateNotificationPreferences,
  type NotificationPreferences,
} from '../../src/api/notifications';
import { apiGetSubmissions } from '../../src/api/submissions';
import { useNotificationPermission } from '../../src/hooks/useNotificationPermission';

const REPROMPT_KEY = 'desert:notifRepromptShown';

export default function AlertsScreen() {
  const { t } = useTranslation();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { status: permissionStatus, isChecking, requestPermission, getExpoPushToken } =
    useNotificationPermission();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showReprompt, setShowReprompt] = useState(false);

  // Load preferences when permission is granted and user is authenticated
  const loadPrefs = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingPrefs(true);
    setLoadError(null);
    try {
      const result = await apiGetNotificationPreferences(accessToken);
      setPrefs(result);
    } catch {
      setLoadError(t('notifications.errorLoading'));
    } finally {
      setIsLoadingPrefs(false);
    }
  }, [accessToken, t]);

  useEffect(() => {
    if (permissionStatus === 'granted' && accessToken) {
      void loadPrefs();
    }
  }, [permissionStatus, accessToken, loadPrefs]);

  // Check re-prompt condition when denied
  useEffect(() => {
    if (permissionStatus !== 'denied' || !accessToken) return;

    void (async () => {
      const alreadyShown = await AsyncStorage.getItem(REPROMPT_KEY);
      if (alreadyShown === 'true') return;

      try {
        const res = await apiGetSubmissions(accessToken, 1, 1);
        if (res.total > 0) {
          setShowReprompt(true);
        }
      } catch {
        // silently skip — re-prompt is non-critical
      }
    })();
  }, [permissionStatus, accessToken]);

  const handleEnableNotifications = useCallback(async () => {
    const result = await requestPermission();
    if (result === 'granted') {
      const token = await getExpoPushToken();
      // P4: only register token when one was actually obtained
      if (accessToken && token !== null) {
        try {
          await apiUpdateNotificationPreferences(accessToken, { expo_push_token: token });
        } catch {
          // best-effort token registration
        }
      }
    }
  }, [requestPermission, getExpoPushToken, accessToken]);

  const handleToggle = useCallback(
    // P5: narrow key type to the three boolean toggle fields only
    async (key: 'price_drops' | 'sharp_rise' | 'monthly_summary', value: boolean) => {
      if (!accessToken || !prefs) return;

      // P3: capture snapshot before optimistic update for accurate revert
      const snapshot = prefs;
      setPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));
      setSaveError(null);

      try {
        await apiUpdateNotificationPreferences(accessToken, { [key]: value });
      } catch {
        // Revert to pre-change snapshot
        setPrefs(snapshot);
        setSaveError(t('notifications.errorSaving'));
      }
    },
    [accessToken, prefs, t],
  );

  const handleRepromptEnable = useCallback(async () => {
    await AsyncStorage.setItem(REPROMPT_KEY, 'true');
    setShowReprompt(false);
    await Linking.openSettings();
  }, []);

  const handleRepromptDismiss = useCallback(async () => {
    await AsyncStorage.setItem(REPROMPT_KEY, 'true');
    setShowReprompt(false);
  }, []);

  // P3 pattern: wait for auth restore before deciding what to show
  if (authLoading || isChecking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t('notifications.signInPrompt')}</Text>
      </View>
    );
  }

  // Undetermined: show value-prop screen
  if (permissionStatus === 'undetermined') {
    return (
      <View style={styles.center}>
        <Text style={styles.valuePropTitle}>{t('notifications.valuePropTitle')}</Text>
        <View style={styles.featureList}>
          <Text style={styles.featureItem}>• {t('notifications.feature1')}</Text>
          <Text style={styles.featureItem}>• {t('notifications.feature2')}</Text>
          <Text style={styles.featureItem}>• {t('notifications.feature3')}</Text>
        </View>
        <TouchableOpacity style={styles.enableButton} onPress={() => void handleEnableNotifications()}>
          <Text style={styles.enableButtonText}>{t('notifications.enableButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Denied: show instructions + optional re-prompt
  if (permissionStatus === 'denied') {
    return (
      <View style={styles.container}>
        {showReprompt && (
          <View style={styles.repromptBanner}>
            <Text style={styles.repromptTitle}>{t('notifications.repromptTitle')}</Text>
            <Text style={styles.repromptSubtitle}>{t('notifications.repromptSubtitle')}</Text>
            <View style={styles.repromptActions}>
              <TouchableOpacity
                style={styles.repromptEnableButton}
                onPress={() => void handleRepromptEnable()}
              >
                <Text style={styles.repromptEnableText}>{t('notifications.repromptEnable')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void handleRepromptDismiss()}>
                <Text style={styles.repromptDismissText}>{t('notifications.repromptDismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.center}>
          <Text style={styles.deniedTitle}>{t('notifications.permissionDeniedTitle')}</Text>
          <Text style={styles.deniedBody}>{t('notifications.permissionDeniedBody')}</Text>
          <TouchableOpacity
            style={styles.openSettingsButton}
            onPress={() => void Linking.openSettings()}
          >
            <Text style={styles.openSettingsText}>{t('notifications.openSettings')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Granted: show toggles
  if (isLoadingPrefs) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadPrefs()}>
          <Text style={styles.retryText}>{t('notifications.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {saveError && (
        <View style={styles.saveErrorBanner}>
          <Text style={styles.saveErrorText}>{saveError}</Text>
        </View>
      )}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{t('notifications.priceDrop')}</Text>
        <Switch
          value={prefs?.price_drops ?? true}
          onValueChange={(v) => void handleToggle('price_drops', v)}
          trackColor={{ true: '#f59e0b' }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{t('notifications.sharpRise')}</Text>
        <Switch
          value={prefs?.sharp_rise ?? true}
          onValueChange={(v) => void handleToggle('sharp_rise', v)}
          trackColor={{ true: '#f59e0b' }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{t('notifications.monthlySummary')}</Text>
        <Switch
          value={prefs?.monthly_summary ?? true}
          onValueChange={(v) => void handleToggle('monthly_summary', v)}
          trackColor={{ true: '#f59e0b' }}
          thumbColor="#fff"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  valuePropTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
    textAlign: 'center',
  },
  featureList: { marginBottom: 32, alignSelf: 'flex-start' },
  featureItem: { fontSize: 15, color: '#444', marginBottom: 10, lineHeight: 22 },
  enableButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  enableButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deniedTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  deniedBody: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  openSettingsButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  openSettingsText: { color: '#f59e0b', fontSize: 14, fontWeight: '500' },
  repromptBanner: {
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    padding: 16,
  },
  repromptTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  repromptSubtitle: { fontSize: 13, color: '#555', marginBottom: 12 },
  repromptActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  repromptEnableButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  repromptEnableText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  repromptDismissText: { color: '#888', fontSize: 13 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  toggleLabel: { fontSize: 15, color: '#1a1a1a', flex: 1, marginRight: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e5e5', marginHorizontal: 20 },
  saveErrorBanner: {
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    padding: 12,
    alignItems: 'center',
  },
  saveErrorText: { color: '#dc2626', fontSize: 13 },
  errorText: { fontSize: 14, color: '#ef4444', marginBottom: 16, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  retryText: { color: '#f59e0b', fontSize: 14, fontWeight: '500' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#333', textAlign: 'center' },
});
