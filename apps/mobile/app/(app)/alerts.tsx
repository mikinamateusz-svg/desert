import { View, Text, StyleSheet } from 'react-native';

export default function AlertsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Alerts (coming soon)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  text: { color: '#666', fontSize: 16 },
});
