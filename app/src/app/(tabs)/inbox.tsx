import { useState, type ReactNode } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  AiLabel,
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
  Quote,
  Screen,
  Sep,
  Tap,
  Txt,
  useSheetClose,
  useToast,
  webNoOutline,
  type ButtonVariant,
} from '@/components';
import { commitmentRisk, customerById, customerCommitments, lastInbound, openCommitments, riskBadge } from '@/data/selectors';
import { useStore, type AppState } from '@/data/store';
import type { Commitment, InboxBucket, InboxItem } from '@/data/types';
import { ago, dayDiff, firstName, inr, shortDay, time12 } from '@/lib/format';
import { SheetModal, useCompletePromise } from '@/features/promises';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

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

/** Confirmation copy for one-tap actions. */
function doneText(label: string, name: string) {
  const first = firstName(name);
  switch (label.toLowerCase()) {
    case 'send link':
      return `Payment link sent to ${first}`;
    case 'share':
      return `Shared with ${first}`;
    case 'nudge':
      return `Nudge sent to ${first}`;
    case 'check in':
      return `Checked in with ${first}`;
    case 'follow up':
      return `Followed up with ${first}`;
    default:
      return `Done · ${first}`;
  }
}

/** On-device stand-in for the AI reply draft: built from the open promise for this customer. */
function draftReply(s: AppState, item: InboxItem, now = Date.now()) {
  const cust = customerById(s, item.customerId);
  const first = firstName(cust?.name ?? '');
  const p = customerCommitments(s, item.customerId)[0];
  if (!p) return `Hi ${first}, thanks for your message — I’ll get back to you on this today.`;
  const action = p.title
    .replace(new RegExp(`\\b${first}\\b`, 'g'), 'you')
    .replace(/ to you$/, '')
    .replace(/^./, (ch) => ch.toLowerCase());
  const d = dayDiff(p.dueAt, now);
  const when = d === 0 ? `today at ${time12(p.dueAt)}` : d === 1 ? `tomorrow at ${time12(p.dueAt)}` : `on ${shortDay(p.dueAt, now)}`;
  return `Hi ${first}, thanks for checking. I’ll ${action} ${when}.`;
}

/** 12 · Inbox — every row reads Who → What → Why it matters → What to do. */
export default function Inbox() {
  const { state, actions } = useStore();
  const toast = useToast();
  const complete = useCompletePromise();
  const [bucket, setBucket] = useState<InboxBucket>('needs_reply');
  const [reviewing, setReviewing] = useState<InboxItem | null>(null);
  const now = Date.now();
  const promises = openCommitments(state);
  const items = state.inbox.filter((i) => i.bucket === bucket).sort((a, b) => b.at - a.at);
  const count = (b: InboxBucket) => (b === 'promises' ? promises.length : state.inbox.filter((i) => i.bucket === b).length);

  const act = (item: InboxItem) => {
    const name = customerById(state, item.customerId)?.name ?? '';
    const label = item.action.label.toLowerCase();
    if (label === 'send now') {
      const p = customerCommitments(state, item.customerId)[0];
      if (p) return router.push(`/promise/${p.id}`);
    }
    if (label === 'review') return setReviewing(item);
    actions.resolveInbox(item.id, { title: `${item.action.label.replace(/^Send /, 'Sent ')} · ${item.what.toLowerCase()}` });
    toast({ text: doneText(item.action.label, name), icon: 'check' });
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

      <SheetModal visible={!!reviewing} onClose={() => setReviewing(null)}>
        {reviewing && <ReviewDraft item={reviewing} />}
      </SheetModal>
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

/** The AI-drafted reply, shown with the message it answers. Nothing is sent until you tap Send. */
function ReviewDraft({ item }: { item: InboxItem }) {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const close = useSheetClose();
  const cust = customerById(state, item.customerId);
  const asked = lastInbound(state, item.customerId);
  const [text, setText] = useState(() => draftReply(state, item));
  const first = firstName(cust?.name ?? '');
  return (
    <View style={{ gap: 14, paddingTop: 4 }}>
      <AiLabel>{item.whyAi ? item.why : 'Reply drafted'}</AiLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={cust?.name ?? '?'} size={30} />
        <View style={{ flex: 1 }}>
          <Txt weight="semibold">{cust?.name}</Txt>
          <Txt variant="meta">{item.what}</Txt>
        </View>
      </View>
      {asked?.body ? <Quote by={`· ${ago(asked.at)}`}>{`“${asked.body}”`}</Quote> : null}
      <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line2, paddingHorizontal: 14, paddingVertical: 12 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          accessibilityLabel="Reply draft"
          style={[{ fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 22, color: c.t1, minHeight: 88, textAlignVertical: 'top' }, webNoOutline]}
        />
      </View>
      <Txt variant="meta">Edit anything before sending. Nothing goes out until you tap Send.</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Send reply"
          size="lg"
          flex
          disabled={!text.trim()}
          onPress={() => {
            actions.resolveInbox(item.id, { title: 'You replied', body: text.trim() });
            toast({ text: `Reply sent to ${first}`, icon: 'check' });
            close();
          }}
        />
        <Button label="Later" size="lg" variant="secondary" onPress={close} />
      </View>
    </View>
  );
}
