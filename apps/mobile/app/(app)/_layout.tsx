import { Stack } from 'expo-router';
import { useAuth } from '../../src/store/auth.store';

export default function AppLayout() {
  const { isLoading } = useAuth();

  if (isLoading) return null;

  // No forced redirect — both authenticated users and guests can view the map.
  // The SoftSignUpSheet in (app)/index.tsx handles the first-open prompt.
  return <Stack screenOptions={{ headerShown: false }} />;
}
