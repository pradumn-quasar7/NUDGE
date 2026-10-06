import { useState } from 'react';
import { View } from 'react-native';
import { Button, Group, LargeTitle, Screen, SectionLabel, SettingsRow, TopBar, Txt, useToast } from '@/components';
import { useStore } from '@/data/store';
import { plural } from '@/lib/format';
import { ConfirmSheet } from '@/features/settings/ui';

/** Privacy & data export — plain statements, an export, and a guarded delete. */
export default function Privacy() {
  const { state } = useStore();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = state.members.filter((m) => m.status === 'active').length;

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">Your customers trust you. You can trust Nudge.</Txt>}>Privacy & data export</LargeTitle>

      <Group>
        <SettingsRow icon="shieldCheck" title="Encrypted, always" subtitle="In transit and at rest. Only your team can read it." />
        <SettingsRow icon="shield" title="Your workspace stands alone" subtitle="Each business is kept separate. Nothing is shared between workspaces." />
        <SettingsRow icon="message" title="Nothing is sent without a tap" subtitle="Nudge drafts. You decide what reaches a customer." />
        <SettingsRow icon="spark" title="AI never acts on its own" subtitle="New promises and facts wait for your confirmation." last />
      </Group>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Your data</SectionLabel>
        <Txt variant="s" style={{ paddingHorizontal: 4 }}>
          Download everything Nudge remembers — customers, conversations, promises and facts — in one file.
        </Txt>
        <Button
          variant="secondary"
          icon="doc"
          label="Export my data"
          full
          style={{ marginTop: 6 }}
          onPress={() => toast({ text: 'We’ll email your export within 24 hours', icon: 'check' })}
        />
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Delete</SectionLabel>
        <Txt variant="s" style={{ paddingHorizontal: 4 }}>
          Removes {state.org.name}, every customer and all history for {plural(members, 'member')}. This can’t be undone.
        </Txt>
        <Button variant="danger" label="Delete workspace" full style={{ marginTop: 6 }} onPress={() => setConfirmDelete(true)} />
      </View>

      <ConfirmSheet
        open={confirmDelete}
        title="Delete this workspace?"
        body={`${state.org.name} and everything Nudge remembers will be permanently removed for the whole team.`}
        confirmLabel="Delete workspace"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => toast({ text: 'Deletion requested. We’ll email you to confirm.' })}
      />
    </Screen>
  );
}
