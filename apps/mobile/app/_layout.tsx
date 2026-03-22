import { Slot } from 'expo-router';
import { AuthProvider } from '../src/store/auth.store';
import '../src/i18n';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}
