import { useRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  IconButton,
  Num,
  Screen,
  SectionLabel,
  Sep,
  Tap,
  Txt,
  useIsTablet,
  useToast,
  webNoOutline,
  type IconName,
} from '@/components';
import { useStore } from '@/data/store';
import { customerById, eventsFor, openCommitments } from '@/data/selectors';
import type { ID } from '@/data/types';
import { type CopilotAnswer, type CopilotRow } from '@/lib/ai';
import { useAnswer } from '@/features/copilot/useAsk';
import { dueLabel, firstName, inr, shortDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { AnswerActions, AnswerView, WithMoney } from '@/features/copilot/AnswerView';

/**
 * 18 Search — a command bar that also understands questions.
 * 19 Natural-language results — what it understood, the list, one AI action pinned at the bottom.
 * `?q=` runs a question immediately.
 */

/** Session-only recent searches (not persisted). */
const recentQueries: string[] = [];

const openCustomer = (id: ID) => router.push({ pathname: '/customer/[id]', params: { id } });

export default function Search() {
  const { c } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const isTablet = useIsTablet();
  const params = useLocalSearchParams<{ q?: string }>();
  const initial = typeof params.q === 'string' ? params.q.trim() : '';
  const [text, setText] = useState(initial);
  const [submitted, setSubmitted] = useState<string | null>(initial || null);
  const [focus, setFocus] = useState(false);
  const input = useRef<TextInput>(null);

  const submit = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    const i = recentQueries.indexOf(clean);
    if (i >= 0) recentQueries.splice(i, 1);
    recentQueries.unshift(clean);
    recentQueries.length = Math.min(recentQueries.length, 5);
    setText(clean);
    setSubmitted(clean);
    input.current?.blur();
  };

  const clear = () => {
    setText('');
    setSubmitted(null);
    setTimeout(() => input.current?.focus(), 0);
  };

  const result = useAnswer(submitted);
  const pinned = result?.actions.find((a) => a.kind === 'ai');
  const listMode = !!result && !!result.rows && (result.rows.length >= 2 || !!result.understoodAs);
  const cancel = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      {submitted ? (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 18, paddingLeft: 14, paddingRight: 2, backgroundColor: c.card, borderWidth: 1, borderColor: c.line2 }}>
          <Icon name="spark" size={20} color={c.accText} />
          <Tap
            scale={1}
            onPress={() => {
              setSubmitted(null);
              setTimeout(() => input.current?.focus(), 0);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Edit search: ${submitted}`}
            style={{ flex: 1, height: 54, justifyContent: 'center' }}
          >
            <Txt numberOfLines={1}>{submitted}</Txt>
          </Tap>
          <IconButton name="close" label="Clear search" color={c.t3} onPress={clear} />
        </View>
      ) : (
        <>
          <View
            style={[
              { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 18, paddingHorizontal: 14, backgroundColor: c.card, borderWidth: 1, borderColor: focus ? c.acc : c.line2 },
              focus && { boxShadow: `0 0 0 4px ${c.accWash2}` },
            ]}
          >
            <Icon name="search" size={20} color={c.t3} />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              autoFocus
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              placeholder="Search customers, conversations, promises…"
              placeholderTextColor={c.t3}
              returnKeyType="search"
              onSubmitEditing={() => submit(text)}
              accessibilityLabel="Search"
              style={[{ flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: 15, color: c.t1 }, webNoOutline]}
            />
            {text ? (
              <View style={{ marginRight: -10 }}>
                <IconButton name="close" label="Clear search" color={c.t3} onPress={clear} />
              </View>
            ) : Platform.OS === 'web' || isTablet ? (
              <View style={{ borderWidth: 1, borderColor: c.line2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Num tone="t3" style={{ fontSize: 11.5, lineHeight: 15 }}>
                  ⌘K
                </Num>
              </View>
            ) : null}
          </View>
          <Tap onPress={cancel} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
            <Txt style={{ fontFamily: fonts.medium }}>Cancel</Txt>
          </Tap>
        </>
      )}
    </View>
  );

  const footer =
    result && listMode && pinned ? (
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 24, alignItems: 'center' }}>
        <Button
          variant="ai"
          size="lg"
          label={pinned.label}
          style={{ width: '100%', maxWidth: 720, height: 54, borderRadius: 18 }}
          onPress={() => (pinned.route ? router.push(pinned.route as Href) : toast({ text: 'Coming soon' }))}
        />
      </View>
    ) : null;

  return (
    <Screen
      header={header}
      footer={footer}
      fade={!!footer}
      gap={submitted ? 18 : 26}
      contentStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: footer ? 120 + insets.bottom : 24 + insets.bottom }}
    >
      {result ? (
        listMode ? (
          <NaturalResults result={result} pinnedLabel={pinned?.label} />
        ) : (
          <View style={{ paddingTop: 8 }}>
            <AnswerView answer={result} />
          </View>
        )
      ) : text.trim() ? (
        <LiveResults query={text.trim()} onAsk={() => submit(text)} />
      ) : (
        <Idle onAsk={submit} onSearch={(q) => setText(q)} />
      )}
    </Screen>
  );
}

/* ───────────── 18 · idle ───────────── */

function Idle({ onAsk, onSearch }: { onAsk: (q: string) => void; onSearch: (q: string) => void }) {
  const { state } = useStore();
  const { c } = useTheme();
  // The customer you're most likely working on: owner of the most urgent open promise.
  const focusCustomer = customerById(state, openCommitments(state)[0]?.customerId) ?? state.customers[0];
  const tries = [
    'Customers waiting for quotation',
    'People I haven’t contacted this week',
    ...(focusCustomer ? [`Show ${firstName(focusCustomer.name)}’s last conversation`] : []),
  ];
  const quote = state.events
    .filter((e) => e.kind === 'quote' && e.ref?.startsWith('Q-'))
    .sort((a, b) => b.at - a.at)[0];
  const pastSearch =
    recentQueries[0] ??
    state.facts.find((f) => f.kind === 'preference' && /^prefers .* (after|before)/i.test(f.text))?.text.replace(/^prefers /i, '');

  return (
    <>
      <View>
        <SectionLabel style={{ marginBottom: 4 }}>Try asking</SectionLabel>
        {tries.map((q, i) => (
          <View key={q}>
            {i > 0 && <Sep inset={46} />}
            <ListRow lead={<LeadTile icon="spark" ai />} onPress={() => onAsk(q)}>
              <Txt style={{ flex: 1 }}>{q}</Txt>
            </ListRow>
          </View>
        ))}
      </View>

      <View>
        <SectionLabel style={{ marginBottom: 4 }}>Recent</SectionLabel>
        {focusCustomer && (
          <ListRow lead={<Avatar name={focusCustomer.name} size={30} />} right="Customer" onPress={() => openCustomer(focusCustomer.id)}>
            <Txt style={{ flex: 1 }} numberOfLines={1}>
              {focusCustomer.name}
            </Txt>
          </ListRow>
        )}
        {quote && (
          <>
            <Sep inset={44} />
            <ListRow lead={<LeadTile icon="doc" size={30} />} right="Quotation" onPress={() => openCustomer(quote.customerId)}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                {quote.ref?.split(' · ')[0]}
                {quote.amount ? (
                  <>
                    {' · '}
                    <Num>{inr(quote.amount)}</Num>
                  </>
                ) : null}
              </Txt>
            </ListRow>
          </>
        )}
        {pastSearch && (
          <>
            <Sep inset={44} />
            <ListRow lead={<LeadTile icon="search" size={30} />} right="Search" onPress={() => onSearch(pastSearch)}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                “{pastSearch}”
              </Txt>
            </ListRow>
          </>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Jump to</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="secondary" size="sm" icon="radar" label="Radar" flex style={{ height: 44 }} onPress={() => router.push('/radar')} />
          <Button variant="secondary" size="sm" icon="mic" label="Voice" flex style={{ height: 44 }} onPress={() => router.push('/voice')} />
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            label="Customer"
            accessibilityLabel="New customer"
            flex
            style={{ height: 44 }}
            onPress={() => router.push('/customer/new')}
          />
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: c.bg }} />
    </>
  );
}

/* ───────────── 18 · typing — live local results ───────────── */

function LiveResults({ query, onAsk }: { query: string; onAsk: () => void }) {
  const { state } = useStore();
  const q = query.toLowerCase();
  const has = (s?: string) => !!s && s.toLowerCase().includes(q);
  const customers = state.customers.filter((x) => !x.archived && (has(x.name) || has(x.company) || has(x.headline))).slice(0, 5);
  const promises = openCommitments(state)
    .filter((p) => has(p.title) || has(p.quote) || has(customerById(state, p.customerId)?.name))
    .slice(0, 5);
  const conversations = [...state.events]
    .filter((e) => has(e.title) || has(e.body) || has(e.aiNote))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const none = !customers.length && !promises.length && !conversations.length;

  return (
    <>
      <ListRow lead={<LeadTile icon="spark" ai />} onPress={onAsk}>
        <Txt style={{ flex: 1 }} numberOfLines={2}>
          Ask Nudge <Txt tone="t2">“{query}”</Txt>
        </Txt>
      </ListRow>

      {none && <Txt variant="s">No exact matches in customers, promises or conversations. Ask Nudge instead — it understands questions.</Txt>}

      {customers.length > 0 && (
        <Section title="Customers">
          {customers.map((x, i) => (
            <View key={x.id}>
              {i > 0 && <Sep inset={44} />}
              <ListRow lead={<Avatar name={x.name} size={30} />} onPress={() => openCustomer(x.id)}>
                <View style={{ flex: 1 }}>
                  <Txt numberOfLines={1}>{x.name}</Txt>
                  <Txt variant="meta" numberOfLines={1}>
                    {[x.company, x.headline].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
              </ListRow>
            </View>
          ))}
        </Section>
      )}

      {promises.length > 0 && (
        <Section title="Promises">
          {promises.map((p, i) => {
            const cust = customerById(state, p.customerId);
            return (
              <View key={p.id}>
                {i > 0 && <Sep inset={44} />}
                <ListRow lead={<LeadTile icon="radar" size={30} />} onPress={() => router.push({ pathname: '/promise/[id]', params: { id: p.id } })}>
                  <View style={{ flex: 1 }}>
                    <Txt numberOfLines={1}>{p.title}</Txt>
                    <Txt variant="meta" numberOfLines={1}>
                      {cust ? `${firstName(cust.name)} · ` : ''}
                      {dueLabel(p.dueAt)}
                    </Txt>
                  </View>
                </ListRow>
              </View>
            );
          })}
        </Section>
      )}

      {conversations.length > 0 && (
        <Section title="Conversations">
          {conversations.map((e, i) => {
            const cust = customerById(state, e.customerId);
            return (
              <View key={e.id}>
                {i > 0 && <Sep inset={44} />}
                <ListRow lead={<LeadTile icon={e.kind === 'call' ? 'phone' : e.kind === 'quote' ? 'doc' : 'message'} size={30} />} onPress={() => openCustomer(e.customerId)}>
                  <View style={{ flex: 1 }}>
                    <WithMoney variant="t" text={e.body ? `“${e.body}”` : e.title} numberOfLines={1} />
                    <Txt variant="meta" numberOfLines={1}>
                      {cust ? `${firstName(cust.name)} · ` : ''}
                      {shortDay(e.at)}
                    </Txt>
                  </View>
                </ListRow>
              </View>
            );
          })}
        </Section>
      )}
    </>
  );
}

/* ───────────── 19 · natural-language results ───────────── */

const AI_PATTERN = /\b(usually|likely|tends? to|typically)\b/i;

function NaturalResults({ result, pinnedLabel }: { result: CopilotAnswer; pinnedLabel?: string }) {
  const lead = result.text.map((s) => s.t).join('');
  const short = lead.length <= 24;
  const rest = result.actions.filter((a) => a.label !== pinnedLabel);
  return (
    <>
      {result.understoodAs && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt variant="s">Understood as</Txt>
          <Badge tone="acc" label={result.understoodAs} />
        </View>
      )}
      <View style={short ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 } : { gap: 4 }}>
        <Txt variant="h2" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {lead}
        </Txt>
        <Txt variant="meta">{result.evidence}</Txt>
      </View>
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {result.rows!.map((r, i) => (
          <View key={`${r.customerId}-${i}`}>
            {i > 0 && <Sep />}
            <ResultRow row={r} />
          </View>
        ))}
      </Card>
      {rest.length > 0 && <AnswerActions actions={rest} />}
    </>
  );
}

function ResultRow({ row }: { row: CopilotRow }) {
  const { state } = useStore();
  const cust = customerById(state, row.customerId);
  const ai = AI_PATTERN.test(row.meta);
  // AI patterns read on their own ("Usually reorders monthly — due now"), without the day count.
  const meta = ai ? capitalise(row.meta.replace(/^[^·]*·\s*/, '')) : row.meta;
  const last = cust ? eventsFor(state, cust.id)[0] : undefined;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 10 }}>
      <Tap
        onPress={() => openCustomer(row.customerId)}
        scale={0.99}
        accessibilityRole="button"
        accessibilityHint={last ? `Last activity ${shortDay(last.at)}` : undefined}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 }}
      >
        <Avatar name={cust?.name ?? row.title} size={40} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt numberOfLines={1} style={{ fontFamily: fonts.medium }}>
            {row.title}
          </Txt>
          <WithMoney text={meta} tone={ai ? 'acc' : undefined} numberOfLines={2} />
        </View>
      </Tap>
      <Button
        variant="secondary"
        size="sm"
        label="Message"
        accessibilityLabel={`Message ${cust?.name ?? row.title}`}
        style={{ height: 44 }}
        onPress={() => openCustomer(row.customerId)}
      />
    </View>
  );
}

/* ───────────── bits ───────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <SectionLabel style={{ marginBottom: 4 }}>{title}</SectionLabel>
      {children}
    </View>
  );
}

function ListRow({ lead, right, children, onPress }: { lead: ReactNode; right?: string; children: ReactNode; onPress?: () => void }) {
  return (
    <Tap onPress={onPress} scale={0.99} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 6 }}>
      {lead}
      {children}
      {right ? <Txt variant="meta">{right}</Txt> : null}
    </Tap>
  );
}

function LeadTile({ icon, ai, size = 32 }: { icon: IconName; ai?: boolean; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: ai ? c.accWash : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color={ai ? c.accText : c.t2} />
    </View>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
