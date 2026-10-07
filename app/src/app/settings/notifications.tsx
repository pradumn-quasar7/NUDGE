import { Linking, View } from 'react-native';
import { Button, Group, LargeTitle, Screen, SectionLabel, SettingsRow, TopBar, Txt } from '@/components';
import { useSession } from '@/data/session';
import { useMe, useStore } from '@/data/store';
import type { Settings } from '@/data/types';
import { requestPermission, useNotificationPermission } from '@/features/notifications/setup';
import { RadioRow } from '@/features/settings/ui';

const OPTIONS: { value: Settings['notifications']; title: string; subtitle: string }[] = [
  { value: 'needs_you', title: 'Only what needs you', subtitle: 'Promises coming due, customers waiting, AI suggestions to review' },
  { value: 'all', title: 'Everything', subtitle: 'Every message, payment and suggestion as it happens' },
  { value: 'off', title: 'Off', subtitle: 'Nothing pings — it’s all here when you open Nudge' },
];

/** Calm notifications: Nudge only interrupts when there's something to decide. */
export default function NotificationSettings() {
  const { state, actions } = useStore();
  const { mode } = useSession();
  const me = useMe();
  const value = state.settings.notifications;
  // The choice is a workspace setting; in cloud mode only owners can change it (update_workspace_settings).
  const canChange = mode === 'demo' || me.role === 'owner';

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">Nudge should feel calm, not busy.</Txt>}>Notifications</LargeTitle>

      <PhonePermission off={value === 'off'} />

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>What pings {mode === 'cloud' ? 'the team' : 'you'}</SectionLabel>
        <View accessibilityRole="radiogroup">
          <Group>
            {OPTIONS.map((o, i) => (
              <RadioRow
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                selected={value === o.value}
                onPress={() => {
                  if (canChange && value !== o.value) actions.updateSettings({ notifications: o.value });
                }}
                last={i === OPTIONS.length - 1}
              />
            ))}
          </Group>
        </View>
        {!canChange && (
          <Txt variant="meta" style={{ paddingHorizontal: 4 }}>
            Your workspace owner chooses this for everyone.
          </Txt>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>How Nudge stays quiet</SectionLabel>
        <Group>
          <SettingsRow
            icon="clock"
            title="An hour before a promise is due"
            subtitle="One reminder per promise you own — 10 minutes before if it’s due sooner."
          />
          <SettingsRow
            icon="bell"
            title="Quiet hours · 9 pm – 8 am"
            subtitle="Nothing overnight. A reminder that would land then waits until 8:30 am, unless the promise is due before that."
          />
          <SettingsRow
            icon="alert"
            title="Never alarming"
            subtitle="Normal risk is a gentle heads-up — no red badges for things that can wait."
            last
          />
        </Group>
      </View>
    </Screen>
  );
}

/** This phone's OS permission: the real state, and the one action that changes it. */
function PhonePermission({ off }: { off: boolean }) {
  const permission = useNotificationPermission();
  const { state, canAskAgain } = permission;
  if (state === 'loading') return null;

  let row: { value: string; tone: 'ok' | 'warn' | 'neutral'; subtitle: string; action?: { label: string; onPress: () => void } };
  if (state === 'unavailable') {
    row = { value: 'Not here', tone: 'neutral', subtitle: 'Reminders work in the Nudge app for iPhone and Android.' };
  } else if (state === 'granted') {
    row = {
      value: 'On',
      tone: 'ok',
      subtitle: off ? 'Allowed, but notifications are off above — nothing will ping.' : 'Nudge can remind you on this phone.',
    };
  } else if (state === 'undetermined' || canAskAgain) {
    row = {
      value: 'Off',
      tone: 'neutral',
      subtitle: 'Turn on to get a nudge before promises are due.',
      action: { label: 'Turn on', onPress: () => void requestPermission().then(() => permission.refresh()) },
    };
  } else {
    row = {
      value: 'Off',
      tone: 'warn',
      subtitle: 'Notifications are blocked for Nudge in your phone’s settings.',
      action: { label: 'Open settings', onPress: () => void Linking.openSettings().catch(() => {}) },
    };
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel style={{ paddingLeft: 4 }}>On this phone</SectionLabel>
      <Group>
        <SettingsRow icon="bell" title="Reminders and alerts" subtitle={row.subtitle} value={row.value} valueTone={row.tone} last={!row.action} />
        {row.action && (
          <View style={{ paddingVertical: 12 }}>
            <Button label={row.action.label} variant={row.tone === 'warn' ? 'secondary' : 'primary'} full onPress={row.action.onPress} />
          </View>
        )}
      </Group>
    </View>
  );
}
