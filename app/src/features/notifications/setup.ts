import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Notification plumbing shared by reminders, push and the opt-in UI.
 * Everything here is a no-op on web (expo-notifications supports iOS and Android only).
 */

export const CHANNEL_ID = 'reminders';
/** Brand indigo — same value as the expo-notifications plugin `color` in app.json. */
const ACCENT = '#4B47E0';

export const notificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let handlerSet = false;

/**
 * While Nudge is open, only a promise coming due earns a banner (and a sound); everything
 * else goes quietly into the notification list. Calm, not busy.
 */
export function installNotificationHandler() {
  if (!notificationsSupported || handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const urgent = data?.kind === 'reminder' || data?.kind === 'promise_due' || isPromiseUrl(data?.url);
      return {
        shouldShowBanner: urgent,
        shouldShowList: true,
        shouldPlaySound: urgent,
        shouldSetBadge: false,
      };
    },
  });
}

function isPromiseUrl(url: unknown) {
  return typeof url === 'string' && (url.startsWith('/promise/') || url === '/radar');
}

let channelReady: Promise<unknown> | null = null;

/** Android: the channel must exist before asking for permission (Android 13+) or a push token. */
export function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve(null);
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reminders',
    description: 'Promises coming due and customers who need you',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: ACCENT,
    vibrationPattern: [0, 200, 120, 200],
  }).catch((e: unknown) => {
    channelReady = null;
    console.info('[notifications] channel setup failed', e instanceof Error ? e.message : e);
  });
  return channelReady;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function toState(p: Notifications.NotificationPermissionsStatus): { state: PermissionState; canAskAgain: boolean } {
  const provisional = p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (p.granted || provisional) return { state: 'granted', canAskAgain: false };
  if (p.status === 'undetermined') return { state: 'undetermined', canAskAgain: true };
  return { state: 'denied', canAskAgain: p.canAskAgain };
}

export async function getPermission(): Promise<{ state: PermissionState; canAskAgain: boolean }> {
  if (!notificationsSupported) return { state: 'unavailable', canAskAgain: false };
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return { state: 'unavailable', canAskAgain: false };
  }
}

/** Asks once, in context (never on cold start). Creates the Android channel first. */
export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'unavailable';
  try {
    await ensureChannel();
    const result = toState(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
    );
    emitPermissionChange();
    return result.state;
  } catch {
    return 'unavailable';
  }
}

/* ── Tiny event so the bridge re-syncs reminders / push right after the person says yes ── */

const listeners = new Set<() => void>();
export function onPermissionChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function emitPermissionChange() {
  for (const fn of listeners) fn();
}

/** Live permission state; refreshes when the app returns to the foreground (e.g. from Settings). */
export function useNotificationPermission() {
  const [value, setValue] = useState<{ state: PermissionState | 'loading'; canAskAgain: boolean }>({
    state: notificationsSupported ? 'loading' : 'unavailable',
    canAskAgain: false,
  });
  const refresh = useCallback(async () => {
    const next = await getPermission();
    setValue(next);
    return next.state;
  }, []);
  useEffect(() => {
    if (!notificationsSupported) return;
    let alive = true;
    const load = () =>
      void getPermission().then((next) => {
        if (alive) setValue(next);
      });
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    const off = onPermissionChange(load);
    return () => {
      alive = false;
      sub.remove();
      off();
    };
  }, []);
  return { ...value, refresh };
}
