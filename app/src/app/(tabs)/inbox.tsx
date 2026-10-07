import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import {
  Avatar,
  Button,
  CheckCircle,
  Chip,
  Dot,
  EmptyState,
  Icon,
  IconButton,
  LargeTitle,
  Num,
  Screen,
  Sep,
  Tap,
  Txt,
  type ButtonVariant,
} from '@/components';
import { commitmentRisk, customerById, customerCommitments, openCommitments, riskBadge } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { Commitment, InboxBucket, InboxItem } from '@/data/types';
import { ago, dayDiff, inr, shortDay, time12 } from '@/lib/format';
import { useCompletePromise } from '@/features/promises';
import { DraftSheet, type DraftTarget } from '@/features/drafts';
import { intentFor } from '@/lib/draft';
import { useTheme } from '@/theme/ThemeProvider';
import { useNow } from '@/lib/useNow';

const BUCKETS: { key: InboxBucket; label: string }[] = [
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'promises', label: 'Promises' },
  { key: 'done', label: 'Done' },
];

const EMPTY: Record<InboxBucket, { title: string; body: string }> = {
  needs_reply: { title: 'All caught up', body: 'Nobody is waiting on a reply from you right now.' },
  waiting: { title: 'Nothing to chase', body: 'When a customer goes quiet after a quote or a question, they’ll show up here.' },
  promises: { title: 'No open promises', body: 'Promises you make in chats and calls land here, with the exact words they came from.' },
  done: { title: 'Nothing done yet', body: 'Replies you send and links you share from the inbox collect here.' },
};

/** 12 · Inbox — every row reads Who → What → Why it matters → What to do. */
export default function Inbox() {
  const { state } = useStore();
  const complete = useCompletePromise();
  const [bucket, setBucket] = useState<InboxBucket>('needs_reply');
  const [drafting, setDrafting] = useState<DraftTarget | null>(null);
  const now = useNow();
  const promises = openCommitments(state);
  const items = state.inbox.filter((i) => i.bucket === bucket).sort((a, b) => b.at - a.at);
  const count = (b: InboxBucket) => (b === 'promises' ? promises.length : state.inbox.filter((i) => i.bucket === b).length);

  // Every inbox action reaches out to a customer, so it starts from an editable draft — nothing is
  // sent or marked done until the person sends it from their own app and confirms (principle 6).
  const act = (item: InboxItem) => {
    const p = customerCommitments(state, item.customerId)[0];
    const relevant = p && intentFor(p) === intentFor(null, item) ? p : item.bucket === 'needs_reply' ? p : undefined;
    setDrafting({
      customerId: item.customerId,
      suggestionId: item.id,
      commitmentId: relevant?.id,
      intent: intentFor(relevant, item),
      amount: item.amount,
    });
  };

  const empty = bucket === 'promises' ? promises.length === 0 : items.length === 0;

  return (
    <Screen tabBar gap={16} contentStyle={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <LargeTitle right={<IconButton name="search" label="Search inbox" onPress={() => router.push('/search')} />}>Inbox</LargeTitle>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
        accessibilityRole="tablist"
        accessibilityLabel="Inbox sections"
      >
        {BUCKETS.map((b) => (
          <Chip key={b.key} label={b.label} count={b.key === 'done' ? undefined : count(b.key)} on={bucket === b.key} onPress={() => setBucket(b.key)} />
        ))}
      </ScrollView>

      {empty ? (
        <EmptyState
          art={bucket === 'needs_reply' ? <CheckCircle size={44} /> : undefined}
          title={EMPTY[bucket].title}
          body={EMPTY[bucket].body}
        >
          {bucket === 'needs_reply' && <Button variant="secondary" label="Open Promise Radar" onPress={() => router.push('/radar')} />}
        </EmptyState>
      ) : bucket === 'promises' ? (
        <View>
          {promises.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <Sep inset={54} />}
              <PromiseItem commitment={p} now={now} onComplete={() => complete(p.id)} />
            </View>
          ))}
          <Button variant="ghost" label="Open Promise Radar" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => router.push('/radar')} />
        </View>
      ) : (
        <View>
          {items.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <Sep inset={54} />}
              <InboxRow item={item} now={now} done={bucket === 'done'} onAct={() => act(item)} />
            </View>
          ))}
        </View>
      )}

      <DraftSheet target={drafting} onClose={() => setDrafting(null)} />
    </Screen>
  );
}

function Row({
  name,
  when,
  what,
  why,
  action,
  onPress,
  dim,
}: {
  name: string;
  when: string;
  what: string;
  why: ReactNode;
  action?: ReactNode;
  onPress?: () => void;
  dim?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16, opacity: dim ? 0.72 : 1 }}>
      <View style={{ flex: 1 }}>
      <Tap onPress={onPress} scale={0.99} accessibilityRole="button" accessibilityLabel={`${name}. ${what}`} style={{ flexDirection: 'row', gap: 14 }}>
        <Avatar name={name} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Txt>
            <Txt variant="meta">{when}</Txt>
          </View>
          <Txt style={{ fontSize: 15.5, marginTop: 2 }}>{what}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>{why}</View>
        </View>
      </Tap>
      </View>
      {action ? <View style={{ alignSelf: 'center' }}>{action}</View> : null}
    </View>
  );
}

function InboxRow({ item, now, done, onAct }: { item: InboxItem; now: number; done?: boolean; onAct: () => void }) {
  const { state } = useStore();
  const { c } = useTheme();
  const cust = customerById(state, item.customerId);
  const name = cust?.name ?? 'Unknown';
  const whyColor = item.whyTone === 'warn' ? c.warn : item.whyAi || item.whyTone === 'acc' ? c.accText : c.t3;
  const why = done ? (
    <>
      <Dot tone="ok" />
      <Txt variant="meta" color={c.ok}>
        Done
      </Txt>
    </>
  ) : (
    <>
      {item.whyAi ? <Icon name="spark" size={12} color={c.accText} /> : <Dot tone={item.whyTone === 'warn' ? 'warn' : item.whyTone === 'acc' ? 'acc' : 'neutral'} />}
      <Txt variant="meta" color={whyColor} style={{ flexShrink: 1 }}>
        {item.amount != null ? (
          <>
            <Num style={{ fontSize: 12.5 }} color={whyColor}>
              {inr(item.amount)}
            </Num>{' '}
          </>
        ) : null}
        {item.why}
      </Txt>
    </>
  );
  return (
    <Row
      name={name}
      when={ago(item.at, now)}
      what={item.what}
      why={why}
      dim={done}
      onPress={() => cust && router.push(`/customer/${cust.id}`)}
      action={
        done ? undefined : (
          <Button
            size="sm"
            label={item.action.label}
            variant={item.action.variant as ButtonVariant}
            onPress={onAct}
            accessibilityLabel={`${item.action.label} — ${name}`}
            style={{ paddingHorizontal: 14, borderRadius: 12 }}
          />
        )
      }
    />
  );
}

function PromiseItem({ commitment: p, now, onComplete }: { commitment: Commitment; now: number; onComplete: () => void }) {
  const { state } = useStore();
  const { c } = useTheme();
  const name = customerById(state, p.customerId)?.name ?? 'Unknown';
  const risk = riskBadge[commitmentRisk(p, now)];
  const color = risk.tone === 'warn' ? c.warn : risk.tone === 'bad' ? c.bad : risk.tone === 'ok' ? c.ok : c.t3;
  const d = dayDiff(p.dueAt, now);
  return (
    <Row
      name={name}
      when={d === 0 ? time12(p.dueAt) : shortDay(p.dueAt, now)}
      what={p.title}
      why={
        <>
          <Dot tone={risk.tone} />
          <Txt variant="meta" color={color}>
            {risk.label}
            {p.quote ? <Txt variant="meta">{`  “${p.quote}”`}</Txt> : null}
          </Txt>
        </>
      }
      onPress={() => router.push(`/promise/${p.id}`)}
      action={<Button size="sm" variant="secondary" label="Complete" onPress={onComplete} style={{ paddingHorizontal: 14, borderRadius: 12 }} />}
    />
  );
}
