import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, EmptyState, Screen, SparkPulse, Txt } from '@/components';
import { useSession } from '@/data/session';

/**
 * Where the emailed sign-in link lands (nudge://auth-callback?code=…). Exchanges the code for a
 * session on this device, then hands over to the normal routing (Home, or onboarding for new people).
 */
export default function AuthCallback() {
  const session = useSession();
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const linkingUrl = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(params.error_description ?? null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || error) return;
    const url = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : linkingUrl;
    if (!params.code && !url) return;
    started.current = true;
    session
      .completeFromLink({ code: params.code, url })
      .then(() => router.replace('/sign-in'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [params.code, linkingUrl, error, session]);

  return (
    <Screen>
      {error ? (
        <EmptyState title="Couldn’t sign you in" body={error}>
          <Button label="Back to sign in" size="lg" full onPress={() => router.replace('/sign-in')} />
        </EmptyState>
      ) : (
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 160 }}>
          <SparkPulse size={32} />
          <Txt variant="body">Signing you in…</Txt>
        </View>
      )}
    </Screen>
  );
}
