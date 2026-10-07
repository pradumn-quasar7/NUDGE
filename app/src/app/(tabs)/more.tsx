import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Button, Card, Group, Icon, LargeTitle, Screen, SectionLabel, SettingsRow, Txt } from '@/components';
import { useSession } from '@/data/session';
import { useMe, useStore } from '@/data/store';
import { firstName, plural } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { ConfirmSheet } from '@/features/settings/ui';

const NOTIFY_LABEL = { needs_you: 'Only what needs you', all: 'Everything', off: 'Off' } as const;
const PREF_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

/** 24 · More — plain grouped lists for the quiet corners. */
export default function More() {
  const session = useSession();
  const cloud = session.mode === 'cloud';
  const { state, actions } = useStore();
  const { c, pref } = useTheme();
  const me = useMe();
  const [confirmReset, setConfirmReset] = useState(false);

  const people = state.members.filter((m) => m.status === 'active').length;
  const paused = state.integrations.filter((i) => i.status === 'paused').length;
  const role = me.title ?? (me.role === 'owner' ? 'Owner' : 'Member');

  return (
    <Screen tabBar gap={22}>
      <LargeTitle>More</LargeTitle>

      <Card padding={16} onPress={() => router.push('/team')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={firstName(me.name)} size={52} />
        <View style={{ flex: 1 }}>
          <Txt variant="h3">{me.name}</Txt>
          <Txt variant="meta" style={{ marginTop: 2 }}>
            {role} · {state.org.name}
          </Txt>
        </View>
        <Icon name="chevron" size={16} color={c.t3} />
      </Card>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Business</SectionLabel>
        <Group>
          <SettingsRow icon="customers" title="Team" value={plural(people, 'person', 'people')} onPress={() => router.push('/team')} />
          <SettingsRow
            icon="plug"
            title="Integrations"
            value={paused ? `${paused} need${paused === 1 ? 's' : ''} you` : 'All connected'}
            valueTone={paused ? 'warn' : undefined}
            onPress={() => router.push('/integrations')}
          />
          <SettingsRow icon="card" title="Billing" value={state.org.plan === 'pro' ? 'Pro' : 'Free'} onPress={() => router.push('/billing')} last />
        </Group>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>You</SectionLabel>
        <Group>
          <SettingsRow
            icon="bell"
            title="Notifications"
            value={NOTIFY_LABEL[state.settings.notifications]}
            onPress={() => router.push('/settings/notifications')}
          />
          <SettingsRow icon="contrast" title="Appearance" value={PREF_LABEL[pref]} onPress={() => router.push('/settings/appearance')} />
          <SettingsRow icon="spark" title="What Nudge remembers" onPress={() => router.push('/settings/memory')} />
          <SettingsRow icon="shield" title="Privacy & data export" onPress={() => router.push('/settings/privacy')} last />
        </Group>
      </View>

      <View style={{ alignItems: 'center', gap: 2, marginTop: 8 }}>
        {cloud ? (
          <>
            <Button variant="ghost" size="sm" label="Sign out" onPress={() => setConfirmReset(true)} />
            <Txt variant="meta">Signed in as {session.email}</Txt>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" label="Reset demo data" onPress={() => setConfirmReset(true)} />
            <Txt variant="meta">Nudge · demo workspace</Txt>
          </>
        )}
      </View>

      <ConfirmSheet
        open={confirmReset}
        title={cloud ? 'Sign out?' : 'Reset demo data?'}
        body={
          cloud
            ? 'Your workspace stays safe on the server. Sign back in any time with a code sent to your email.'
            : 'Every customer, promise and setting goes back to the original demo, and you’ll start again from the welcome screen.'
        }
        confirmLabel={cloud ? 'Sign out' : 'Reset demo data'}
        danger={!cloud}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          if (cloud) void session.signOut().then(() => router.replace('/welcome'));
          else {
            actions.reset();
            router.replace('/welcome');
          }
        }}
      />
    </Screen>
  );
}
