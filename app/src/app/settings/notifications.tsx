import { View } from 'react-native';
import { Group, LargeTitle, Screen, SectionLabel, SettingsRow, TopBar, Txt } from '@/components';
import { useStore } from '@/data/store';
import type { Settings } from '@/data/types';
import { RadioRow } from '@/features/settings/ui';

const OPTIONS: { value: Settings['notifications']; title: string; subtitle: string }[] = [
  { value: 'needs_you', title: 'Only what needs you', subtitle: 'Promises coming due, customers waiting, money in' },
  { value: 'all', title: 'Everything', subtitle: 'Every message, payment and suggestion as it happens' },
  { value: 'off', title: 'Off', subtitle: 'Nothing pings — it’s all here when you open Nudge' },
];

/** Calm notifications: Nudge only interrupts when there's something to decide. */
export default function NotificationSettings() {
  const { state, actions } = useStore();
  const value = state.settings.notifications;
  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">Nudge should feel calm, not busy.</Txt>}>Notifications</LargeTitle>

      <View accessibilityRole="radiogroup">
        <Group>
          {OPTIONS.map((o, i) => (
            <RadioRow
              key={o.value}
              title={o.title}
              subtitle={o.subtitle}
              selected={value === o.value}
              onPress={() => actions.updateSettings({ notifications: o.value })}
              last={i === OPTIONS.length - 1}
            />
          ))}
        </Group>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>How Nudge stays quiet</SectionLabel>
        <Group>
          <SettingsRow
            icon="bell"
            title="One ping per decision"
            subtitle="Related updates are bundled, so a busy chat is one notification, not ten."
          />
          <SettingsRow
            icon="clock"
            title="Quiet hours · 10 pm – 8 am"
            subtitle="Nothing overnight. What came in waits for you in the morning on Home."
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
