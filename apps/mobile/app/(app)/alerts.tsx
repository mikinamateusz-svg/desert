import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { usePremiumAlertsStatus, bellState } from '../../src/hooks/usePremiumAlertsStatus';

/**
 * Story 6.10 — premium-alerts status surface. Tapped from the bell icon
 * on the map header chrome. Renders one of three banner states:
 *
 *   - inactive: prompt + "Take a photo" CTA → /capture
 *   - active:   informational "active until DATE"
 *   - expiring: warning + "Take a photo to extend" CTA → /capture
 *
 * Notification preferences moved to /(app)/notifications (Story 6.10
 * relocation per AC7); this screen no longer carries permission flow or
 * type toggles. Story 6.11 will add the inbox section below the banner.
 */
export default function AlertsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();
  const { activeUntil, loading } = usePremiumAlertsStatus();

  const state = bellState(activeUntil);

  const formattedDate = activeUntil
    ? activeUntil.toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  // Compute days remaining for the expiring-state copy.
  const daysRemaining = activeUntil
    ? Math.max(0, Math.ceil((activeUntil.getTime() - Date.now()) / 86_400_000))
    : 0;

  const handleTakePhoto = () => router.push('/(app)/capture');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {!accessToken ? (
        // Unauthenticated users — gentle prompt to sign in. Bell icon
        // shouldn't reach here in practice (it routes from the map, where
        // users may not be authed), so guard defensively.
        <View style={styles.banner}>
          <Text style={styles.title}>{t('alerts.statusBanner.signInTitle')}</Text>
          <Text style={styles.body}>{t('alerts.statusBanner.signInBody')}</Text>
        </View>
      ) : loading ? (
        <View style={styles.banner}>
          <Text style={styles.body}>{t('alerts.statusBanner.loading')}</Text>
        </View>
      ) : state === 'inactive' ? (
        <View style={[styles.banner, styles.bannerInactive]}>
          <Text style={styles.title}>{t('alerts.statusBanner.inactiveTitle')}</Text>
          <Text style={styles.body}>{t('alerts.statusBanner.inactiveBody')}</Text>
          <TouchableOpacity style={styles.cta} onPress={handleTakePhoto}>
            <Text style={styles.ctaText}>{t('alerts.statusBanner.takePhoto')}</Text>
          </TouchableOpacity>
        </View>
      ) : state === 'active' ? (
        <View style={[styles.banner, styles.bannerActive]}>
          <Text style={styles.title}>{t('alerts.statusBanner.activeTitle')}</Text>
          <Text style={styles.body}>
            {t('alerts.statusBanner.activeBody', { date: formattedDate })}
          </Text>
        </View>
      ) : (
        // expiring
        <View style={[styles.banner, styles.bannerExpiring]}>
          <Text style={styles.title}>
            {t('alerts.statusBanner.expiringTitle', { count: daysRemaining })}
          </Text>
          <Text style={styles.body}>{t('alerts.statusBanner.expiringBody')}</Text>
          <TouchableOpacity style={styles.cta} onPress={handleTakePhoto}>
            <Text style={styles.ctaText}>{t('alerts.statusBanner.takePhoto')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.page,
    paddingHorizontal: 16,
  },
  banner: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
  },
  bannerInactive: {
    borderColor: tokens.neutral.n200,
  },
  bannerActive: {
    borderColor: tokens.brand.accent,
  },
  bannerExpiring: {
    borderColor: tokens.price.expensive,
    backgroundColor: tokens.surface.warmPage,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: tokens.neutral.n500,
    lineHeight: 22,
    marginBottom: 16,
  },
  cta: {
    backgroundColor: tokens.brand.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: tokens.radius.full,
    alignItems: 'center',
  },
  ctaText: {
    color: tokens.neutral.n0,
    fontSize: 16,
    fontWeight: '600',
  },
});
