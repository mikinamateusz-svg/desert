import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/store/auth.store';
import { SoftSignUpSheet } from '../../src/components/SoftSignUpSheet';

export default function MapScreen() {
  const { user, accessToken, hasSeenOnboarding, logout } = useAuth();
  const [sheetDismissed, setSheetDismissed] = useState(false);

  // Show the soft sign-up sheet on first open (no token, never seen onboarding)
  const showSheet = !accessToken && !hasSeenOnboarding && !sheetDismissed;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>desert</Text>
      <Text style={styles.subtitle}>Map (coming soon)</Text>
      {user && (
        <Text style={styles.user}>Signed in as {user.display_name ?? user.email}</Text>
      )}
      {accessToken && (
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      )}

      <SoftSignUpSheet
        visible={showSheet}
        onDismiss={() => setSheetDismissed(true)}
      />
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
