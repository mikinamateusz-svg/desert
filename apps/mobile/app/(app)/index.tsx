import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/store/auth.store';

export default function MapScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>desert</Text>
      <Text style={styles.subtitle}>Map (coming soon)</Text>
      {user && (
        <Text style={styles.user}>Signed in as {user.display_name ?? user.email}</Text>
      )}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  user: {
    fontSize: 14,
    color: '#444',
    marginTop: 16,
  },
  logoutButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  logoutText: {
    color: '#444',
    fontSize: 14,
  },
});
