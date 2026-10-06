import { useState } from 'react';
import { View } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Group,
  Icon,
  Input,
  LargeTitle,
  Screen,
  SectionLabel,
  Sep,
  SettingsRow,
  Toggle,
  TopBar,
  Txt,
  useSheetClose,
  useToast,
} from '@/components';
import { useStore } from '@/data/store';
import type { Member } from '@/data/types';
import { firstName, plural, shortDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { ModalSheet, PLAN_SEATS } from '@/features/settings/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 22 · Team — everyone shares one memory. */
export default function Team() {
  const { state, actions } = useStore();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);

  const active = state.members.filter((m) => m.status === 'active');
  const openFor = (id: string) => state.commitments.filter((p) => p.ownerId === id && p.status === 'open').length;
  const s = state.settings;

  return (
    <Screen
      gap={22}
      header={<TopBar right={<Button variant="ghost" label="Invite" onPress={() => setInviting(true)} />} />}
    >
      <LargeTitle sub={<Txt variant="s">{`${active.length} of ${PLAN_SEATS} seats · everyone shares one memory`}</Txt>}>Team</LargeTitle>

      <Group>
        {state.members.map((m, i) => (
          <View key={m.id}>
            {i > 0 && <Sep />}
            <MemberRow
              m={m}
              isMe={m.id === state.me}
              open={openFor(m.id)}
              onResend={() => toast({ text: `Invite resent to ${m.email}`, icon: 'check' })}
            />
          </View>
        ))}
      </Group>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>How the team shares</SectionLabel>
        <Group>
          <SettingsRow
            title="Everyone sees every customer"
            subtitle="Turn off to keep customers private to their owner"
            right={
              <Toggle label="Everyone sees every customer" value={s.shareAllCustomers} onChange={(v) => actions.updateSettings({ shareAllCustomers: v })} />
            }
          />
          <SettingsRow
            title="Hand off promises when away"
            subtitle="Nudge suggests a teammate on leave days"
            right={
              <Toggle label="Hand off promises when away" value={s.handOffWhenAway} onChange={(v) => actions.updateSettings({ handOffWhenAway: v })} />
            }
          />
          <SettingsRow
            title="Members can delete history"
            right={
              <Toggle label="Members can delete history" value={s.membersCanDelete} onChange={(v) => actions.updateSettings({ membersCanDelete: v })} />
            }
            last
          />
        </Group>
      </View>

      <ModalSheet open={inviting} onClose={() => setInviting(false)}>
        <InviteForm
          taken={state.members.map((m) => m.email.toLowerCase())}
          seatsLeft={PLAN_SEATS - state.members.length}
          onInvite={(email) => {
            actions.inviteMember(email);
            toast({ text: `Invite sent to ${email}`, icon: 'check' });
          }}
        />
      </ModalSheet>
    </Screen>
  );
}

function MemberRow({ m, isMe, open, onResend }: { m: Member; isMe: boolean; open: number; onResend: () => void }) {
  const { c } = useTheme();
  if (m.status === 'invited') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 68, paddingVertical: 10 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: c.bg2,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: c.line2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="mail" size={16} color={c.t3} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="t" tone="t2" numberOfLines={1}>
            {m.email}
          </Txt>
          <Txt variant="meta">Invited {m.invitedAt ? shortDay(m.invitedAt) : 'recently'} · not joined yet</Txt>
        </View>
        <Button variant="ghost" label="Resend" accessibilityLabel={`Resend invite to ${m.email}`} onPress={onResend} />
      </View>
    );
  }
  const role = m.title ?? (m.role === 'owner' ? 'Owner' : 'Member');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: isMe ? 60 : 68, paddingVertical: 10 }}>
      <Avatar name={isMe ? firstName(m.name) : m.name} />
      <View style={{ flex: 1 }}>
        <Txt variant="t" weight="medium" numberOfLines={1}>
          {m.name}
        </Txt>
        <Txt variant="meta">{isMe ? `You · ${role}` : `${role} · ${plural(open, 'open promise')}`}</Txt>
      </View>
      {m.role === 'member' && <Badge label="Member" />}
    </View>
  );
}

function InviteForm({ taken, seatsLeft, onInvite }: { taken: string[]; seatsLeft: number; onInvite: (email: string) => void }) {
  const close = useSheetClose();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();

  const submit = () => {
    const e = email.trim().toLowerCase();
    if (!e) return setError('Enter their email address');
    if (!EMAIL_RE.test(e)) return setError('That doesn’t look like an email address');
    if (taken.includes(e)) return setError('They’re already on your team');
    if (seatsLeft <= 0) return setError(`All ${PLAN_SEATS} seats are in use`);
    onInvite(e);
    close();
  };

  return (
    <View style={{ gap: 16, paddingTop: 6 }}>
      <View style={{ gap: 8 }}>
        <Txt variant="h2" accessibilityRole="header">
          Invite a teammate
        </Txt>
        <Txt variant="body">They’ll share the same memory — every customer, promise and note.</Txt>
      </View>
      <Input
        icon="mail"
        placeholder="name@business.com"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) setError(undefined);
        }}
        error={error}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
        accessibilityLabel="Teammate’s email"
      />
      <View style={{ gap: 8 }}>
        <Button label="Send invite" full size="lg" onPress={submit} />
        <Button variant="secondary" label="Cancel" full size="lg" onPress={close} />
      </View>
    </View>
  );
}
