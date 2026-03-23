import { Redirect } from 'expo-router';
import { useAuth } from '../src/store/auth.store';

export default function RootIndex() {
  const { isLoading } = useAuth();

  if (isLoading) return null;

  // Always route to app — guest mode and auth state are handled inside (app)
  return <Redirect href="/(app)" />;
}
