import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

/**
 * Supabase client for the app.
 *
 * Configure with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see app/.env.example).
 * When they are not set the app stays in demo mode: `supabase` is null and `isSupabaseConfigured`
 * is false, so nothing here throws at import time.
 *
 * Sessions are stored in the Keychain / Keystore (expo-secure-store) on iOS and Android and in
 * localStorage on web. The anon key is public by design; every query is protected by RLS.
 */

// Must be referenced literally so Expo inlines them at build time.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = /^https?:\/\//.test(url) && anonKey.length > 0;

type AuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/**
 * SecureStore values should stay small (large values can fail on some devices), and a Supabase
 * session (JWT + refresh token + user) is often bigger than that. Values are split into chunks
 * stored under `${key}.0`, `${key}.1`, … with the chunk count stored under `${key}`.
 */
const CHUNK = 1800;

const secureStorage: AuthStorage = {
  async getItem(key) {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    const count = Number(head);
    if (!Number.isInteger(count) || count < 0) return head; // stored unchunked
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.some((p) => p === null) ? null : parts.join('');
  },
  async setItem(key, value) {
    await secureStorage.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(key, String(count));
  },
  async removeItem(key) {
    const head = await SecureStore.getItemAsync(key);
    const count = Number(head);
    if (head !== null && Number.isInteger(count) && count > 0) {
      await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)));
    }
    await SecureStore.deleteItemAsync(key);
  },
};

const webStorage: AuthStorage = {
  async getItem(key) {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: Platform.OS === 'web' ? webStorage : secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        // Email links come back as nudge://auth-callback?code=… and are exchanged on this device.
        flowType: 'pkce',
      },
    })
  : null;

/** Returns the client or throws a clear error in demo mode. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

// On native, only refresh tokens while the app is in the foreground (recommended by Supabase).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
