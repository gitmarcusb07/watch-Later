import { Redirect } from 'expo-router';
import { AuthForm } from '@/features/auth/AuthForm';
import { AUTH_ENABLED } from '@/config/features';

export default function CreateAccountScreen() {
  if (!AUTH_ENABLED) return <Redirect href="/(tabs)" />;
  return <AuthForm mode="sign-up" />;
}
