import { View } from 'react-native';
import {
  AiCard,
  AiLabel,
  Button,
  Card,
  Group,
  LargeTitle,
  Num,
  Screen,
  SectionLabel,
  Sep,
  SettingsRow,
  Toggle,
  TopBar,
  Txt,
  useToast,
} from '@/components';
import { useStore } from '@/data/store';
import { customerById, eventById } from '@/data/selectors';
import type { Integration } from '@/data/types';
import { firstName, shortDay } from '@/lib/format';
import { CHANNEL_SOURCE, syncedLabel } from '@/features/settings/ui';
import { useNow } from '@/lib/useNow';

const MODEL = [
  { title: 'People', body: 'Who each customer is, how they like to talk, what they’ve bought.' },
  { title: 'Promises', body: 'Anything you or they said would happen — with the exact words.' },
  { title: 'Preferences', body: 'Delivery times, channels, budgets. Some last; some expire on a date.' },
  { title: 'Sources', body: 'Every fact links back to the message, call or note it came from.' },
];

const SOURCE_KINDS: { kind: Integration['kind']; label: string }[] = [
  { kind: 'whatsapp', label: 'WhatsApp' },
  { kind: 'gmail', label: 'Gmail' },
  { kind: 'calls', label: 'Calls' },
];

/** What Nudge remembers — the memory model, counts, sources and recent facts with "Forget". */
export default function MemorySettings() {
  const { state, actions } = useStore();
  const toast = useToast();
  const now = useNow();

  const facts = state.facts;
  const counts = [
    { n: state.customers.filter((x) => !x.archived).length, label: 'Customers' },
    { n: facts.length, label: 'Facts' },
    { n: state.commitments.length, label: 'Promises' },
    { n: state.events.length, label: 'Conversations & notes' },
  ];
  const recent = [...facts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);

  const forget = (id: string) => {
    const fact = state.facts.find((f) => f.id === id);
    actions.forgetFact(id);
    toast({
      text: 'Forgotten',
      icon: 'check',
      action: fact ? { label: 'Undo', onPress: () => actions.unforgetFact(fact) } : undefined,
    });
  };

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">One shared memory for your whole team.</Txt>}>What Nudge remembers</LargeTitle>

      <AiCard>
        <AiLabel>How memory works</AiLabel>
        <View style={{ gap: 12 }}>
          {MODEL.map((m) => (
            <View key={m.title} style={{ gap: 2 }}>
              <Txt variant="t" weight="medium">
                {m.title}
              </Txt>
              <Txt variant="s">{m.body}</Txt>
            </View>
          ))}
        </View>
      </AiCard>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {counts.map((x) => (
          <Card key={x.label} padding={16} style={{ flexGrow: 1, flexBasis: '45%', gap: 4 }}>
            <Num weight="medium" style={{ fontSize: 24, lineHeight: 30 }}>
              {x.n}
            </Num>
            <Txt variant="meta">{x.label}</Txt>
          </Card>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Learn from</SectionLabel>
        <Group>
          {SOURCE_KINDS.map((s, i) => {
            const integ = state.integrations.find((x) => x.kind === s.kind);
            const on = integ?.status === 'connected';
            return (
              <SettingsRow
                key={s.kind}
                title={s.label}
                subtitle={on ? syncedLabel(integ?.lastSyncAt, now) : 'Paused — new messages aren’t remembered'}
                right={
                  <Toggle
                    label={`Remember ${s.label}`}
                    value={on}
                    onChange={(v) => {
                      if (!integ) return;
                      actions.setIntegration(integ.id, v ? { status: 'connected', lastSyncAt: Date.now() } : { status: 'paused' });
                      toast({ text: v ? `Remembering ${s.label} again` : `Paused ${s.label} · history is kept`, icon: 'check' });
                    }}
                  />
                }
                last={i === SOURCE_KINDS.length - 1}
              />
            );
          })}
        </Group>
      </View>

      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel style={{ paddingLeft: 4 }}>Recently remembered</SectionLabel>
          <Group>
            {recent.map((f, i) => {
              const cust = customerById(state, f.customerId);
              const ev = eventById(state, f.sourceEventId);
              const source = ev ? `from ${CHANNEL_SOURCE[ev.channel]}, ${shortDay(ev.at, now)}` : `added ${shortDay(f.createdAt, now)}`;
              return (
                <View key={f.id}>
                  {i > 0 && <Sep />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="t">{f.text}</Txt>
                      <Txt variant="meta">
                        {cust ? firstName(cust.name) : 'Customer'} · {source}
                      </Txt>
                    </View>
                    <Button variant="ghost" label="Forget" accessibilityLabel={`Forget “${f.text}”`} onPress={() => forget(f.id)} />
                  </View>
                </View>
              );
            })}
          </Group>
        </View>
      )}
    </Screen>
  );
}
