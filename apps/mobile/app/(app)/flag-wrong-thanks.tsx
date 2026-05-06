import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';

/**
 * Story 3.14 AC4 — thanks screen shown after a successful flag-wrong action.
 *
 * Acknowledges the misread as our fault, explains admin will review the
 * photo, and invites the driver to retake at a better angle. Two CTAs:
 * primary "Take another photo" goes straight to capture; secondary "Back
 * to activity" goes back. No auto-dismiss — the driver decides.
 */
export default function FlagWrongThanksScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <Text style={styles.title}>{t('contribution.flagWrong.thanksTitle')}</Text>
      <Text style={styles.body}>{t('contribution.flagWrong.thanksBody')}</Text>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => router.replace('/(app)/capture')}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{t('contribution.flagWrong.thanksRetake')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.replace('/(app)/activity')}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>{t('contribution.flagWrong.thanksBack')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: tokens.neutral.n500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 12,
  },
  primaryText: {
    color: tokens.brand.ink,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  secondaryText: {
    color: tokens.neutral.n500,
    fontSize: 14,
  },
});
