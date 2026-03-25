import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';

export default function LogScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('log.comingSoonTitle')}</Text>
      <Text style={styles.subtitle}>{t('log.comingSoonSubtitle')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.page,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n400,
    textAlign: 'center',
  },
});
