import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { StationDto } from '../../api/stations';

interface Props {
  visible: boolean;
  stations: StationDto[];
  onSelect: (stationId: string) => void;
  onDismiss: () => void;
}

export function StationDisambiguationSheet({ visible, stations, onSelect, onDismiss }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('contribution.disambiguate.title')}</Text>
        {stations.slice(0, 3).map(station => (
          <TouchableOpacity
            key={station.id}
            style={styles.stationButton}
            onPress={() => onSelect(station.id)}
            accessibilityRole="button"
          >
            <Text style={styles.stationName}>{station.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 16,
    textAlign: 'center',
  },
  stationButton: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    marginBottom: 10,
    alignItems: 'center',
  },
  stationName: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '500',
  },
});
