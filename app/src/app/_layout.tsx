import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { StoreProvider, useStore } from '@/data/store';
import { SessionProvider } from '@/data/session';
import { ToastProvider, useToast } from '@/components';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular, GeistMono_500Medium });
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <StoreProvider>
            <ToastProvider>
              <SyncErrors />
              <Navigator fontsLoaded={fontsLoaded} />
            </ToastProvider>
          </StoreProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const sheet = { presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } } as const;

function Navigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { c, scheme } = useTheme();
  const { ready } = useStore();
  const show = fontsLoaded && ready;
  useEffect(() => {
    if (show) SplashScreen.hideAsync().catch(() => {});
  }, [show]);
  if (!show) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade_from_bottom', animationDuration: 220 }}>
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="sign-in" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="onboarding/about" options={{ animation: 'slide_from_right' }} />
        {['sell', 'channels', 'connect', 'ready'].map((step) => (
          <Stack.Screen key={step} name={`onboarding/${step}`} options={{ animation: 'slide_from_right' }} />
        ))}
        <Stack.Screen name="capture" options={sheet} />
        <Stack.Screen name="voice" options={sheet} />
        <Stack.Screen name="extraction/[id]" options={sheet} />
        <Stack.Screen name="customer/[id]/ask" options={sheet} />
        <Stack.Screen name="copilot" options={{ presentation: 'modal', animation: 'fade' }} />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

/** Cloud mode: a save that failed is never silent — say so, reassure, offer a retry. */
function SyncErrors() {
  const { sync, reload } = useStore();
  const toast = useToast();
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sync.status !== 'error' || !sync.error || shown.current === sync.error) return;
    shown.current = sync.error;
    toast({ text: `${sync.error.split('.')[0]}. Your data is safe.`, icon: 'error', action: { label: 'Retry', onPress: () => void reload() } });
  }, [sync, reload, toast]);
  return null;
}
