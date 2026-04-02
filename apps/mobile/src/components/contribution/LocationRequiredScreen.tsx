import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';

interface Props {
  onBack: () => void;
}

export function LocationRequiredScreen({ onBack }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button">
        <Text style={styles.backText}>{t('contribution.cancel')}</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>{t('contribution.locationRequired.title')}</Text>
        <Text style={styles.message}>{t('contribution.locationRequired.message')}</Text>
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{t('contribution.locationRequired.cta')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.card,
    paddingHorizontal: 24,
  },
  backButton: {
    paddingVertical: 12,
  },
  backText: {
    color: tokens.brand.ink,
    fontSize: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 15,
    color: tokens.neutral.n500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  ctaButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  ctaText: {
    color: tokens.brand.ink,
    fontSize: 16,
    fontWeight: '600',
  },
});
