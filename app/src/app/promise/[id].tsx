import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AiCard,
  AiLabel,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Quote,
  Screen,
  Sep,
  Tap,
  TopBar,
  Txt,
  useSheetClose,
} from '@/components';
import { commitmentRisk, customerById, eventById, eventsFor, riskBadge } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { Commitment, CustomerEvent } from '@/data/types';
import { firstName, shortDay, time12 } from '@/lib/format';
import {
  channelLabel,
  dueWhen,
  HandOffSheet,
  MoneyText,
  riskLine,
  SheetModal,
  SnoozeSheet,
  useCompletePromise,
} from '@/features/promises';
import { useTheme } from '@/theme/ThemeProvider';
import { useNow } from '@/lib/useNow';
import { DraftSheet, type DraftTarget } from '@/features/drafts';
import { intentFor } from '@/lib/draft';

/** 14 · Promise detail — what was promised, to whom, by when, and the exact words it came from. */
export default function PromiseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useStore();
  const insets = useSafeAreaInsets();
  const complete = useCompletePromise();
  const [snoozing, setSnoozing] = useState<Commitment | null>(null);
  const [handOff, setHandOff] = useState(false);
  const [options, setOptions] = useState(false);
  const [drafting, setDrafting] = useState<DraftTarget | null>(null);
  const now = useNow();
  const p = state.commitments.find((x) => x.id === id);

  if (!p) {
    return (
      <Screen header={<TopBar />}>
        <EmptyState title="This promise is gone" body="It may have been removed or handed off. Your Promise Radar has the latest.">
          <Button label="Open Promise Radar" onPress={() => router.replace('/radar')} />
        </EmptyState>
      </Screen>
    );
  }

  const customer = customerById(state, p.customerId);
  const owner = state.members.find((m) => m.id === p.ownerId);
  const isMine = p.ownerId === state.me;
  const risk = commitmentRisk(p, now);
  const badge = riskBadge[risk];
  const isDone = p.status === 'done';
  const draftLabel = /quot/i.test(p.title)
    ? 'Draft quotation'
    : /^send /i.test(p.title)
      ? `Draft ${p.title.replace(/^send /i, '').replace(/ to \S+$/i, '')}`
      : 'Draft message';

  const kv = (label: string, children: React.ReactNode, right?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 50, gap: 12 }}>
      <Txt variant="meta" style={{ width: 84 }}>
        {label}
      </Txt>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>{children}</View>
      {right}
    </View>
  );

  return (
    <Screen
      gap={20}
      fade
      header={<TopBar right={<IconButton name="more" label="More options" onPress={() => setOptions(true)} />} />}
      contentStyle={{ maxWidth: 720, width: '100%', alignSelf: 'center', paddingBottom: 120 + insets.bottom }}
      footer={
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 30 + Math.max(insets.bottom - 14, 0),
            flexDirection: 'row',
            gap: 8,
            maxWidth: 720,
            marginHorizontal: 'auto',
          }}
        >
          <Button
            variant="ai"
            label={draftLabel}
            flex
            style={{ height: 54, borderRadius: 18 }}
            disabled={!customer}
            onPress={() => customer && setDrafting({ customerId: customer.id, commitmentId: p.id, intent: intentFor(p) })}
          />
          <Button
            variant="secondary"
            icon="check"
            accessibilityLabel="Mark complete"
            disabled={isDone}
            style={{ width: 54, height: 54, borderRadius: 18, paddingHorizontal: 0 }}
            onPress={() => {
              complete(p.id);
              if (router.canGoBack()) router.back();
            }}
          />
          <Button
            variant="secondary"
            icon="clock"
            accessibilityLabel="Snooze"
            disabled={isDone}
            style={{ width: 54, height: 54, borderRadius: 18, paddingHorizontal: 0 }}
            onPress={() => setSnoozing(p)}
          />
        </View>
      }
    >
      <View style={{ gap: 10 }}>
        <Badge tone={badge.tone} label={riskLine(p, now)} />
        <Txt variant="h1" accessibilityRole="header" style={{ fontSize: 30, lineHeight: 36 }} strike={isDone}>
          {p.title}
        </Txt>
      </View>

      <View>
        {kv(
          'To',
          customer ? (
            <Tap
              onPress={() => router.push(`/customer/${customer.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${customer.name}`}
              scale={0.98}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
            >
              <Avatar name={customer.name} size={30} />
              <Txt>{customer.name}</Txt>
            </Tap>
          ) : (
            <Txt tone="t2">Unknown customer</Txt>
          ),
        )}
        <Sep />
        {kv('Due', <Txt>{dueWhen(p.dueAt, now)}</Txt>)}
        <Sep />
        {kv(
          'Owner',
          <>
            <Avatar name={isMine ? firstName(owner?.name ?? 'You') : owner?.name ?? '?'} size={30} />
            <Txt>{isMine ? 'You' : owner?.name}</Txt>
          </>,
          <Button variant="ghost" label="Hand off" onPress={() => setHandOff(true)} />,
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Txt variant="cap">Where this came from</Txt>
        <Evidence commitment={p} customerName={customer?.name} />
      </View>

      {p.draftHint ? (
        <AiCard>
          <AiLabel>Ready to draft</AiLabel>
          <MoneyText>{p.draftHint}</MoneyText>
        </AiCard>
      ) : null}

      <DraftSheet target={drafting} onClose={() => setDrafting(null)} />
      <SnoozeSheet commitment={snoozing} onClose={() => setSnoozing(null)} />
      <HandOffSheet commitment={p} visible={handOff} onClose={() => setHandOff(false)} />
      <SheetModal visible={options} onClose={() => setOptions(false)}>
        <OptionsBody
          customerId={customer?.id}
          customerName={customer?.name}
          onHandOff={() => setTimeout(() => setHandOff(true), 220)}
          onSnooze={() => setTimeout(() => setSnoozing(p), 220)}
        />
      </SheetModal>
    </Screen>
  );
}

/** The source conversation — the customer's words, then the reply where the promise was made. */
function Evidence({ commitment: p, customerName }: { commitment: Commitment; customerName?: string }) {
  const { state } = useStore();
  const { c } = useTheme();
  const source = eventById(state, p.sourceEventId);
  const who = firstName(customerName ?? 'Customer');

  if (!source) {
    return (
      <Card padding={14} style={{ gap: 8, boxShadow: 'none' }}>
        {p.quote ? <Quote by={p.quoteBy ? `— ${p.quoteBy}` : undefined}>{`“${p.quote}”`}</Quote> : null}
        <Txt variant="meta">Added {shortDay(p.createdAt)} · {time12(p.createdAt)} · no linked conversation</Txt>
      </Card>
    );
  }

  const context = eventsFor(state, p.customerId)
    .filter((e) => e.id !== source.id && e.direction === 'in' && e.at <= source.at && source.at - e.at < 3 * 3_600_000)
    .sort((a, b) => a.at - b.at)
    .slice(-2);

  const line = (e: CustomerEvent, highlight: boolean) => {
    const author = e.direction === 'in' ? who : 'You';
    const text = e.body ?? e.aiNote ?? e.title;
    return (
      <View
        key={e.id}
        style={highlight ? { backgroundColor: c.warnWash, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8 } : undefined}
      >
        <Txt variant="s" tone="t1">
          <Txt variant="meta">{author} · </Txt>
          {text}
        </Txt>
      </View>
    );
  };

  return (
    <Card padding={14} style={{ gap: 8, boxShadow: 'none' }}>
      {context.map((e) => line(e, false))}
      {line(source, true)}
      <Txt variant="meta">
        {channelLabel[source.channel]} · {shortDay(source.at)} {time12(source.at)}
        {p.promisor === 'us' ? ' · confirmed by you' : ''}
      </Txt>
    </Card>
  );
}

function OptionsBody({
  customerId,
  customerName,
  onHandOff,
  onSnooze,
}: {
  customerId?: string;
  customerName?: string;
  onHandOff: () => void;
  onSnooze: () => void;
}) {
  const close = useSheetClose();
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      {customerId && (
        <Button
          variant="secondary"
          label={`Open ${firstName(customerName ?? '')}’s profile`}
          full
          onPress={() => {
            close();
            setTimeout(() => router.push(`/customer/${customerId}`), 220);
          }}
        />
      )}
      <Button
        variant="secondary"
        label="Hand off"
        full
        onPress={() => {
          close();
          onHandOff();
        }}
      />
      <Button
        variant="secondary"
        label="Snooze"
        full
        onPress={() => {
          close();
          onSnooze();
        }}
      />
    </View>
  );
}
