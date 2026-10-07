import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Icon, Txt } from '@/components';
import { useStore } from '@/data/store';
import { useTheme } from '@/theme/ThemeProvider';
import { notificationsSupported, requestPermission, useNotificationPermission } from './setup';

const DISMISS_KEY = 'nudge.remindersCard.dismissedAt';
const SNOOZE_MS = 7 * 24 * 3_600_000;

/**
 * Home: a calm, contextual opt-in — never a cold-start prompt. Shows only when the OS hasn't been
 * asked yet, notifications aren't switched off for the workspace, and there is at least one open
 * promise of mine to be reminded about. "Not now" hides it for 7 days.
 */
export function EnableRemindersCard() {
  const { state } = useStore();
  const { c } = useTheme();
  const permission = useNotificationPermission();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!notificationsSupported) return;
    let alive = true;
    AsyncStorage.getItem(DISMISS_KEY)
      .then((raw) => {
        if (alive) setDismissed(!!raw && Date.now() - Number(raw) < SNOOZE_MS);
      })
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, []);

  const hasOpenPromise = state.commitments.some((p) => p.status === 'open' && p.ownerId === state.me);
  const show =
    notificationsSupported &&
    dismissed === false &&
    permission.state === 'undetermined' &&
    state.settings.notifications !== 'off' &&
    hasOpenPromise;
  if (!show) return null;

  const turnOn = async () => {
    setBusy(true);
    await requestPermission(); // reminders + push sync on the permission-change event
    await permission.refresh();
    setBusy(false);
  };
  const notNow = () => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {});
  };

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={18} color={c.t2} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="h3">Get a nudge before promises are due</Txt>
          <Txt variant="meta">One reminder an hour before each promise. Nothing between 9 pm and 8 am.</Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Turn on" flex loading={busy} onPress={() => void turnOn()} />
        <Button variant="ghost" label="Not now" onPress={notNow} />
      </View>
    </Card>
  );
}

export default EnableRemindersCard;
