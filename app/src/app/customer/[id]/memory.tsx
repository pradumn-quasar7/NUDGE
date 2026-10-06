import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  AskBar,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  Num,
  Screen,
  SectionLabel,
  Segmented,
  Sep,
  Tap,
  TopBar,
  Txt,
  useIsTablet,
} from '@/components';
import { useStore } from '@/data/store';
import type { CustomerFact, EventKind, ID } from '@/data/types';
import { firstName, inr, shortDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { gutter } from '@/theme/tokens';
import { GLYPH, Timeline, timelineEntries } from '@/features/customer/Timeline';
import { WhatMatters } from '@/features/customer/ProfileBody';

type Tab = 'summary' | 'timeline' | 'files';
type KindFilter = 'all' | 'conversations' | 'money' | 'notes';

const KIND_FILTERS: { value: KindFilter; label: string; kinds?: EventKind[] }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'conversations', label: 'Messages & calls', kinds: ['message', 'call', 'email'] },
  { value: 'money', label: 'Quotes & payments', kinds: ['quote', 'payment'] },
  { value: 'notes', label: 'Notes & promises', kinds: ['note', 'task', 'promise', 'followup'] },
];

/** 10 · Customer memory — Summary (facts with sources) / Timeline / Files. */
export default function CustomerMemory() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const { state } = useStore();
  const { c } = useTheme();
  const isTablet = useIsTablet();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'timeline');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [highlight, setHighlight] = useState<ID | undefined>();
  const scroll = useRef<ScrollView>(null);
  const timelineTop = useRef(0);
  const rowY = useRef<Record<string, number>>({});
  const customer = state.customers.find((x) => x.id === id);

  if (!customer) {
    return (
      <Screen header={<TopBar />}>
        <EmptyState title="Customer not found" body="They may have been removed." />
      </Screen>
    );
  }

  const first = firstName(customer.name);
  const now = Date.now();
  const allEntries = timelineEntries(state, customer.id, now);
  const kinds = KIND_FILTERS.find((k) => k.value === kind)?.kinds;
  const entries = kinds ? allEntries.filter((e) => kinds.includes(e.kind)) : allEntries;
  const facts = state.facts.filter((f) => f.customerId === customer.id);
  const prefs = facts.filter((f) => f.kind === 'preference');
  const current = facts.filter((f) => f.kind !== 'preference' && (!f.validUntil || f.validUntil >= now));
  const files = allEntries.filter((e) => e.ref && (e.kind === 'quote' || e.kind === 'payment' || e.kind === 'email'));

  const jumpTo = (eventId: ID) => {
    setKind('all');
    setTab('timeline');
    setHighlight(eventId);
    // Wait for the timeline to lay out, then bring the source event into view.
    setTimeout(() => {
      const y = rowY.current[eventId];
      if (y != null) scroll.current?.scrollTo({ y: Math.max(0, timelineTop.current + y - 120), animated: true });
    }, 80);
    setTimeout(() => setHighlight(undefined), 2600);
  };

  return (
    <Screen
      askBar
      scroll={false}
      contentStyle={{ flex: 1, paddingHorizontal: 0, paddingBottom: 0 }}
      header={
        <TopBar
          title={customer.name}
          right={
            tab === 'timeline' ? (
              <IconButton
                name="sliders"
                label={filtersOpen ? 'Hide filters' : 'Filter events'}
                color={kind !== 'all' ? c.accText : undefined}
                onPress={() => setFiltersOpen((v) => !v)}
              />
            ) : null
          }
        />
      }
      footer={<AskBar placeholder={`Ask about ${first}…`} customerId={customer.id} bottom={24} />}
    >
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 140, gap: 18 }}
      >
        <View style={{ gap: 18, maxWidth: isTablet ? 720 : undefined, width: '100%', alignSelf: 'center' }}>
          <Segmented<Tab>
            options={[
              { value: 'summary', label: 'Summary' },
              { value: 'timeline', label: 'Timeline' },
              { value: 'files', label: 'Files' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'timeline' && (
            <>
              {filtersOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ gap: 8, paddingHorizontal: gutter }}>
                  {KIND_FILTERS.map((k) => (
                    <Chip key={k.value} small label={k.label} on={kind === k.value} onPress={() => setKind(k.value)} />
                  ))}
                </ScrollView>
              )}
              <View onLayout={(e) => (timelineTop.current = e.nativeEvent.layout.y)}>
                {entries.length ? (
                  <Timeline
                    state={state}
                    entries={entries}
                    now={now}
                    highlightId={highlight}
                    onItemLayout={(eid, y) => (rowY.current[eid] = y)}
                  />
                ) : (
                  <EmptyState
                    title={kind === 'all' ? 'Nothing remembered yet' : 'Nothing of this kind'}
                    body={
                      kind === 'all'
                        ? `Messages, calls, quotes and payments with ${first} will collect here automatically.`
                        : 'Try another filter.'
                    }
                  >
                    {kind === 'all' ? (
                      <Button
                        variant="secondary"
                        icon="pencil"
                        label="Add a note"
                        onPress={() => router.push({ pathname: '/capture', params: { customerId: customer.id } })}
                      />
                    ) : null}
                  </EmptyState>
                )}
              </View>
            </>
          )}

          {tab === 'summary' && (
            <>
              <WhatMatters customer={customer} />
              <FactGroup title="Preferences" facts={prefs} onSource={jumpTo} empty={`Nudge will learn how ${first} likes to work.`} />
              <FactGroup title="Right now" facts={current} onSource={jumpTo} empty="Nothing time-sensitive at the moment." />
              <Txt variant="meta">Every fact links to the message or call it came from.</Txt>
            </>
          )}

          {tab === 'files' &&
            (files.length ? (
              <Card padding={0} style={{ paddingHorizontal: 16 }}>
                {files.map((f, i) => (
                  <View key={f.id}>
                    {i > 0 && <Sep inset={48} />}
                    <Tap
                      onPress={() => jumpTo(f.id)}
                      scale={0.99}
                      accessibilityRole="button"
                      accessibilityLabel={`${f.ref}, ${f.title}, show in timeline`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingVertical: 10 }}
                    >
                      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={GLYPH[f.kind].icon} size={18} color={c.t2} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt weight="medium" style={{ fontSize: 15.5 }}>
                          {f.ref?.split(' · ').find((p) => /\d/.test(p)) ?? f.ref}
                        </Txt>
                        <Txt variant="meta">
                          {f.title} · {shortDay(f.at, now)}
                        </Txt>
                      </View>
                      {f.amount != null ? <Num variant="s" tone="t1">{inr(f.amount)}</Num> : null}
                    </Tap>
                  </View>
                ))}
              </Card>
            ) : (
              <EmptyState
                title="No files yet"
                body={`Quotes, invoices and documents shared with ${first} will appear here.`}
              />
            ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function FactGroup({
  title,
  facts,
  onSource,
  empty,
}: {
  title: string;
  facts: CustomerFact[];
  onSource: (eventId: ID) => void;
  empty: string;
}) {
  const { state } = useStore();
  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{title}</SectionLabel>
      <Card padding={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        {facts.length === 0 ? (
          <View style={{ minHeight: 56, justifyContent: 'center' }}>
            <Txt variant="s">{empty}</Txt>
          </View>
        ) : (
          facts.map((f, i) => {
            const src = state.events.find((e) => e.id === f.sourceEventId);
            return (
              <View key={f.id}>
                {i > 0 && <Sep />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt>{f.text}</Txt>
                    <Txt variant="meta">
                      {src ? `${src.kind === 'call' ? 'Call' : src.kind === 'note' ? 'Note' : src.title} · ${shortDay(src.at)}` : 'Learned over time'}
                      {f.validUntil ? ` · until ${shortDay(f.validUntil)}` : ''}
                    </Txt>
                  </View>
                  {src ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      label="Source"
                      accessibilityLabel={`Show source of “${f.text}” in the timeline`}
                      onPress={() => onSource(src.id)}
                    />
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}
