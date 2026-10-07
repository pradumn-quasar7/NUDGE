import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { ensureChannel, getPermission, notificationsSupported } from './setup';

/**
 * Remote push (cloud mode, physical device, permission already granted — this never prompts).
 * Gets the Expo push token and registers it with `register_push_token`. When anything is
 * missing (simulator, Expo Go on Android, Firebase/FCM not configured yet, no network) it logs
 * one console.info line and returns — local reminders keep working regardless.
 */

const STORAGE_KEY = 'nudge.push.v1';
type Registered = { token: string; userId: string; orgId: string };

// Read literally so Expo inlines them (only used to unregister after the session is gone).
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function readRegistered(): Promise<Registered | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Registered) : null;
  } catch {
    return null;
  }
}

function skip(reason: string) {
  console.info(`[push] not registered: ${reason}`);
  return null;
}

/** Registers this device for pushes in `orgId`. Returns the Expo push token, or null when skipped. */
export async function registerForPush({ orgId, userId }: { orgId: string; userId: string }): Promise<string | null> {
  if (!notificationsSupported || !supabase) return null;
  if (!Device.isDevice) return skip('not a physical device');
  if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return skip('Expo Go on Android has no remote push (use a development build)');
  }
  const { state } = await getPermission();
  if (state !== 'granted') return null;

  const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return skip('no EAS projectId in app config');

  await ensureChannel();
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    // Typically Android without google-services.json / FCM credentials.
    return skip(e instanceof Error ? e.message : String(e));
  }

  const { error } = await supabase.rpc('register_push_token', {
    org_id: orgId,
    token,
    platform: Platform.OS,
    device_name: Device.deviceName ?? Device.modelName ?? null,
    // This app schedules its own "due soon" reminders (reminders.ts); the server skips those pushes.
    local_reminders: true,
  });
  if (error) return skip(`register_push_token ${error.code ?? ''}`.trim());

  // A different account on this device before? The RPC moved the token; nothing else to clean.
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token, userId, orgId } satisfies Registered)).catch(() => {});
  return token;
}

/**
 * Forgets this device on the server. Call it BEFORE `supabase.auth.signOut()` when possible.
 * After sign-out, pass the access token the session had (still valid until it expires) so the
 * request runs as that user.
 */
export async function unregisterPush(accessToken?: string | null): Promise<void> {
  const reg = await readRegistered();
  if (!reg) return;
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (data.session && data.session.user.id === reg.userId && supabase) {
      await supabase.rpc('unregister_push_token', { token: reg.token });
    } else if (accessToken && SUPABASE_URL && SUPABASE_ANON_KEY) {
      await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/unregister_push_token`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reg.token }),
      });
    }
  } catch {
    // Offline: the next sign-in on this device moves the token to the new account anyway.
  } finally {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
}

/** Re-register when the OS rotates the device token. Returns an unsubscribe function. */
export function onPushTokenRotated(fn: () => void): () => void {
  if (!notificationsSupported) return () => {};
  const sub = Notifications.addPushTokenListener(() => fn());
  return () => sub.remove();
}
