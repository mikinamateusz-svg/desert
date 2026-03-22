import { Redirect } from 'expo-router';
import { useAuth } from '../src/store/auth.store';

export default function RootIndex() {
  const { accessToken, isLoading } = useAuth();

  if (isLoading) return null;

  return accessToken ? <Redirect href="/(app)" /> : <Redirect href="/(auth)/login" />;
}
