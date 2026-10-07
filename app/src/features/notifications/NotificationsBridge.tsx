import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSession } from '@/data/session';
import { useStore } from '@/data/store';
import { onPushTokenRotated, registerForPush, unregisterPush } from './push';
import { clearReminders, planReminders, syncReminders } from './reminders';
import { ensureChannel, installNotificationHandler, notificationsSupported, onPermissionChange } from './setup';

/**
 * Wires notifications into the app. Renders nothing; mount once inside <SessionProvider> and
 * <StoreProvider> (next to <SyncErrors /> in src/app/_layout.tsx). No-op on web.
 *
 *  - foreground handler + Android "reminders" channel (once)
 *  - tap → open the screen in `data.url` (cold start and while running)
 *  - local "promise due soon" reminders kept in step with the store (debounced)
 *  - cloud mode: register this device for remote push when signed in; forget it on sign-out
 *
 * Never asks for permission by itself — that is EnableRemindersCard / Settings → Notifications.
 */
export default function NotificationsBridge() {
  if (!notificationsSupported) return null;
  return <Bridge />;
}

/** Only screens we know; push data is server-made, but a tap must never open an arbitrary link. */
const ROUTE = /^\/(promise\/[\w-]{1,64}|customer\/[\w-]{1,64}|radar|notifications)$/;

function Bridge() {
  const { state, ready, actions } = useStore();
  const session = useSession();

  // ── once: handler + channel ──
  useEffect(() => {
    installNotificationHandler();
    void ensureChannel();
  }, []);

  // ── tap routing ──
  const pending = useRef<{ url: string; notificationId?: string } | null>(null);
  const handled = useRef<string | null>(null);
  const flush = useRef<() => void>(() => {});
  const canRoute = ready && (session.mode === 'demo' || !!session.userId);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    flush.current = () => {
      const next = pending.current;
      if (!next || !canRoute) return;
      try {
        router.push(next.url as Href);
        pending.current = null;
        tries = 0;
        if (next.notificationId && state.notifications.some((n) => n.id === next.notificationId && !n.read)) {
          actions.markNotificationRead(next.notificationId);
        }
      } catch {
        // The navigator mounts a moment after the store is ready (fonts): try again shortly.
        if (tries++ < 20) timer = setTimeout(() => flush.current(), 250);
      }
    };
    flush.current();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [canRoute, state.notifications, actions]);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' && ROUTE.test(data.url) ? data.url : '/notifications';
      const notificationId = typeof data?.notificationId === 'string' ? data.notificationId : undefined;
      pending.current = { url, notificationId };
      flush.current();
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);

  // ── local reminders ──
  const signedOut = session.mode === 'cloud' && session.ready && !session.userId;
  const active = ready && state.onboarded && !signedOut;
  const { commitments, customers, me } = state;
  const level = state.settings.notifications;
  const resync = useRef<() => void>(() => {});
  useEffect(() => {
    if (!ready) return;
    if (!active) {
      void clearReminders();
      resync.current = () => {};
      return;
    }
    const run = () => void syncReminders(planReminders({ commitments, customers, me, notifications: level }));
    resync.current = run;
    const t = setTimeout(run, 800);
    return () => clearTimeout(t);
  }, [ready, active, commitments, customers, me, level]);

  useEffect(() => {
    const off = onPermissionChange(() => resync.current());
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') resync.current();
    });
    return () => {
      off();
      sub.remove();
    };
  }, []);

  // ── remote push (cloud) ──
  const userId = session.userId;
  const orgId = session.mode === 'cloud' && state.onboarded ? state.org.id : '';
  const accessToken = useRef<string | null>(null);
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    if (session.session?.access_token) accessToken.current = session.session.access_token;
  }, [session.session]);

  useEffect(() => {
    if (session.mode !== 'cloud' || !session.ready) return;
    if (!userId) {
      // Signed out: stop pushes to this phone for the previous account.
      if (lastUser.current) void unregisterPush(accessToken.current);
      lastUser.current = null;
      return;
    }
    lastUser.current = userId;
    if (!orgId) return;
    const register = () => void registerForPush({ orgId, userId });
    register();
    const offPermission = onPermissionChange(register);
    const offRotate = onPushTokenRotated(register);
    return () => {
      offPermission();
      offRotate();
    };
  }, [session.mode, session.ready, userId, orgId]);

  return null;
}
