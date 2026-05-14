import { useEffect } from 'react';
import { Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import { apiLogGuestNudgeEvent } from '../api/guest-nudge';

interface Props {
  /** Set by GET /v1/nudge/market-event. Used for AsyncStorage one-per-event key. */
  eventId: string;
  onDismiss: () => void;
  onSignIn: () => void;
}

/**
 * Story 6.9 Nudge 2 — non-modal inline banner shown to guests within
 * 48h of a community-confirmed rise event (when they didn't receive
 * the push — no token registered or permission denied). The banner
 * sits below the map's top chrome and does not block map interaction.
 *
 * Spec AC7: copy is intentionally generic (no specific price movement
 * figures, fuel types, or station details) — the value prop is "sign
 * in and we'll tell you next time," not the current movement details.
 */
export function MarketEventBanner({ eventId: _eventId, onDismiss, onSignIn }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  // Fire shown analytics when the banner mounts. Best-effort.
  useEffect(() => {
    apiLogGuestNudgeEvent('market_event', 'guest_nudge_shown').catch(() => {});
  }, []);

  function handleSignIn() {
    apiLogGuestNudgeEvent('market_event', 'guest_nudge_cta_tapped').catch(() => {});
    onSignIn();
    router.push('/(auth)/login');
  }

  function handleDismiss() {
    apiLogGuestNudgeEvent('market_event', 'guest_nudge_dismissed').catch(() => {});
    onDismiss();
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.body} numberOfLines={2}>
          {t('guestNudge.marketEvent.banner')}
        </Text>
      </View>
      <Pressable style={styles.cta} onPress={handleSignIn} accessibilityRole="button">
        <Text style={styles.ctaText}>{t('guestNudge.marketEvent.signIn')}</Text>
      </Pressable>
      <TouchableOpacity
        onPress={handleDismiss}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={t('guestNudge.marketEvent.dismissA11y')}
      >
        <Ionicons name="close" size={18} color={tokens.brand.ink} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.brand.accent,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
    borderRadius: tokens.radius.md,
    // Inline shadow so the banner reads as a layer above the map without
    // a hard divider line.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  content: {
    flex: 1,
  },
  body: {
    fontSize: 13,
    color: tokens.brand.ink,
    fontWeight: '500',
    lineHeight: 18,
  },
  cta: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.brand.ink,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },
});
