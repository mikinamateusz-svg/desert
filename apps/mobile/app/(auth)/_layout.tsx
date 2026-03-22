import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../src/store/auth.store';

export default function AuthLayout() {
  const { accessToken, isLoading } = useAuth();

  if (isLoading) return null;

  // Already authenticated — go to app
  if (accessToken) return <Redirect href="/(app)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
