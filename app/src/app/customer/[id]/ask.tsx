import { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import {
  AiLabel,
  Button,
  Card,
  Chip,
  Dot,
  Icon,
  IconButton,
  Num,
  Sep,
  Sheet,
  SparkPulse,
  Tap,
  Txt,
  useSheetClose,
  useToast,
  webNoOutline,
} from '@/components';
import { useStore } from '@/data/store';
import type { Customer } from '@/data/types';
import { type CopilotAnswer } from '@/lib/ai';
import { useAsk } from '@/features/copilot/useAsk';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

type Turn = { id: number; q: string; a?: CopilotAnswer };

/** 11 · Customer AI assistant — ask anything about one person; every answer shows where it came from. */
export default function AskAboutCustomer() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { state } = useStore();
  const customer = state.customers.find((c) => c.id === id);
  return <Sheet full>{customer ? <Conversation customer={customer} initial={q} /> : <Missing />}</Sheet>;
}

function Missing() {
  const close = useSheetClose();
  return (
    <View style={{ gap: 12, paddingVertical: 24 }}>
      <Txt variant="h3">That customer isn’t in your memory any more.</Txt>
      <Button variant="secondary" label="Close" onPress={close} />
    </View>
  );
}

function Conversation({ customer, initial }: { customer: Customer; initial?: string }) {
  const { c } = useTheme();
  const close = useSheetClose();
  const first = firstName(customer.name);
  const [turns, setTurns] = useState<Turn[]>([{ id: 0, q: initial?.trim() || `What did I promise ${first}?` }]);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);

  const pending = turns.find((t) => !t.a);
  const askNudge = useAsk();
  useEffect(() => {
    if (!pending) return;
    let live = true;
    const minDelay = new Promise((res) => setTimeout(res, 550));
    void Promise.all([askNudge(pending.q, customer.id), minDelay]).then(([a]) => {
      if (live) setTurns((all) => all.map((x) => (x.id === pending.id ? { ...x, a } : x)));
    });
    return () => {
      live = false;
    };
  }, [pending, customer.id, askNudge]);

  const ask = (text: string) => {
    const qq = text.trim();
    if (!qq || pending) return;
    setDraft('');
    setTurns((all) => [...all, { id: all.length, q: qq }]);
  };

  const asked = new Set(turns.map((t) => t.q.toLowerCase()));
  const suggestions = [`What is ${first} interested in?`, 'When should I follow up?', `What did I promise ${first}?`]
    .filter((s) => !asked.has(s.toLowerCase()))
    .slice(0, 2);

  return (
    <View style={{ flex: 1, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AiLabel size={14}>Ask about {first}</AiLabel>
        <View style={{ marginRight: -10 }}>
          <IconButton name="close" label="Close" onPress={close} />
        </View>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ gap: 22, paddingBottom: 8 }}
      >
        {turns.map((t, i) => (
          <View key={t.id} style={{ gap: 16 }}>
            <View
              style={{
                alignSelf: 'flex-end',
                maxWidth: '85%',
                backgroundColor: c.inv,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 18,
                borderBottomRightRadius: 6,
              }}
            >
              <Txt color={c.onInv}>{t.q}</Txt>
            </View>
            {t.a ? (
              <AnswerView a={t.a} customer={customer} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLiveRegion="polite">
                <SparkPulse size={18} />
                <Txt variant="s" tone="acc">
                  Looking through {first}’s memory…
                </Txt>
              </View>
            )}
            {i === turns.length - 1 && t.a && suggestions.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {suggestions.map((s) => (
                  <Chip key={s} label={s} onPress={() => ask(s)} />
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 52,
          borderRadius: 26,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.line2,
          paddingLeft: 16,
          paddingRight: 6,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => ask(draft)}
          placeholder="Ask a follow-up…"
          placeholderTextColor={c.t3}
          returnKeyType="send"
          accessibilityLabel={`Ask a follow-up about ${first}`}
          style={[{ flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: 15, color: c.t1 }, webNoOutline]}
        />
        <Tap
          onPress={() => (draft.trim() ? ask(draft) : router.push('/voice'))}
          haptic
          accessibilityRole="button"
          accessibilityLabel={draft.trim() ? 'Send' : 'Ask by voice'}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center' }}
        >
          {draft.trim() ? (
            <View style={{ transform: [{ rotate: '-90deg' }] }}>
              <Icon name="chevron" size={20} color={c.onInv} strokeWidth={2.2} />
            </View>
          ) : (
            <Icon name="mic" size={20} color={c.onInv} />
          )}
        </Tap>
      </View>
    </View>
  );
}

function AnswerText({ parts }: { parts: CopilotAnswer['text'] }) {
  let segs = parts;
  // Lead with the answer: if nothing is emphasised, the first sentence is.
  if (!parts.some((p) => p.b) && parts.length === 1) {
    const m = parts[0].t.match(/^(.+?[.!?])(\s[\s\S]*)?$/);
    segs = m ? [{ t: m[1], b: true }, ...(m[2] ? [{ t: m[2] }] : [])] : [{ t: parts[0].t, b: true }];
  }
  const size = { fontSize: 16, lineHeight: 23 };
  return (
    <Txt style={size}>
      {segs.map((p, i) => (
        <Txt key={i} style={size} weight={p.b ? 'medium' : 'regular'} tone={p.b ? 't1' : 't2'}>
          {p.t}
        </Txt>
      ))}
    </Txt>
  );
}

function AnswerView({ a, customer }: { a: CopilotAnswer; customer: Customer }) {
  const toast = useToast();
  const run = (act: CopilotAnswer['actions'][number]) => {
    if (act.route) router.push(act.route as Href);
    else if (/remind/i.test(act.label)) toast({ text: 'I’ll remind you tomorrow morning', icon: 'check' });
    else toast({ text: `${act.label} — added to your follow-ups`, icon: 'spark' });
  };
  return (
    <View style={{ gap: 12 }}>
      <AnswerText parts={a.text} />
      {a.understoodAs ? <Txt variant="meta">Understood as: {a.understoodAs}</Txt> : null}

      {a.stats?.length ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {a.stats.map((s) => (
            <Card key={s.label} padding={12} style={{ flex: 1, gap: 2, boxShadow: 'none' }}>
              <Num weight="medium" style={{ fontSize: 20, lineHeight: 26 }}>
                {s.value}
              </Num>
              <Txt variant="meta">{s.label}</Txt>
            </Card>
          ))}
        </View>
      ) : null}

      {a.rows?.length ? (
        <Card padding={0} style={{ paddingHorizontal: 14, paddingVertical: 2, boxShadow: 'none' }}>
          {a.rows.map((r, i) => {
            const other = r.customerId !== customer.id;
            return (
              <View key={`${r.title}-${i}`}>
                {i > 0 && <Sep />}
                <Tap
                  disabled={!other}
                  scale={other ? 0.99 : 1}
                  onPress={other ? () => router.push(`/customer/${r.customerId}`) : undefined}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 }}
                >
                  <Dot tone={r.tone === 'warn' ? 'warn' : r.tone === 'ok' ? 'ok' : 'neutral'} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt>{r.title}</Txt>
                    <Txt variant="meta">{r.meta}</Txt>
                  </View>
                </Tap>
              </View>
            );
          })}
        </Card>
      ) : null}

      {a.actions.length ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {a.actions.slice(0, 2).map((act, i) => (
            <Button
              key={act.label}
              label={act.label}
              variant={act.kind === 'ai' ? 'ai' : act.kind === 'primary' ? 'primary' : 'secondary'}
              flex={i === 0}
              onPress={() => run(act)}
            />
          ))}
        </View>
      ) : null}

      <Txt variant="meta">{a.evidence}</Txt>
    </View>
  );
}
