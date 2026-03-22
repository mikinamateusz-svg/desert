import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../src/store/auth.store';

export default function AppLayout() {
  const { accessToken, isLoading } = useAuth();

  if (isLoading) return null;

  // Not authenticated — go to login
  if (!accessToken) return <Redirect href="/(auth)/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
