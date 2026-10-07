import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  AiCard,
  AiLabel,
  Badge,
  Button,
  Card,
  Dot,
  Icon,
  IconButton,
  Sep,
  Sheet,
  Skeleton,
  SparkPulse,
  Tap,
  Txt,
  useSheetClose,
  useToast,
} from '@/components';
import { useStore, type AppState } from '@/data/store';
import { backendMode } from '@/data/session';
import { getHandoffBrief } from '@/data/remote-memory';
import { RemoteError } from '@/data/remote';
import { commitmentRisk, riskBadge } from '@/data/selectors';
import type { Commitment, Customer, ID } from '@/data/types';
import { briefText, buildLocalBrief, type BriefPromise, type HandoffBrief } from '@/lib/brief';
import { dueLabel, firstName, plural, shortDay } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Customer Handoff Brief (product feature 7) — what a teammate needs before taking over a customer:
 * history, where things stand, open promises, what to handle with care, the next best action, and the
 * events it all comes from. Cloud: the handoff-brief Edge Function; demo (or AI unavailable): built on
 * the device from the same memory (src/lib/brief.ts).
 */
export default function HandoffBriefSheet() {
  const { id, commitmentId, forMemberId } = useLocalSearchParams<{ id: string; commitmentId?: string; forMemberId?: string }>();
  const { state } = useStore();
  const customer = state.customers.find((c) => c.id === id);
  return (
    <>
      <Stack.Screen options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
      <Sheet full>
        {customer ? (
          <BriefView key={`${customer.id}:${commitmentId ?? ''}:${forMemberId ?? ''}`} customer={customer} commitmentId={commitmentId} forMemberId={forMemberId} />
        ) : (
          <Missing />
        )}
      </Sheet>
    </>
  );
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

type Remote =
  | { status: 'loading' }
  | { status: 'ready'; brief: HandoffBrief }
  | { status: 'local'; reason?: string };

function fallbackReason(err: unknown, first: string): string {
  const code = err instanceof RemoteError ? err.code : undefined;
  if (code === 'rate_limited') return `You’ve made a lot of briefs this hour, so this one was put together on your phone from ${first}’s memory.`;
  if (code === 'not_enough_history') return `There isn’t much history with ${first} yet — here’s what Nudge knows so far.`;
  return `Nudge couldn’t reach its AI just now, so this brief was put together on your phone from ${first}’s memory.`;
}

const canCopy = () =>
  Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

function BriefView({ customer, commitmentId, forMemberId }: { customer: Customer; commitmentId?: ID; forMemberId?: ID }) {
  const { state } = useStore();
  const toast = useToast();
  const close = useSheetClose();
  const now = useNow();
  const first = firstName(customer.name);
  const orgId = state.org.id;
  const cloud = backendMode === 'cloud' && !!orgId;
  const [remote, setRemote] = useState<Remote>(cloud ? { status: 'loading' } : { status: 'local' });
  const [refreshes, setRefreshes] = useState(0);

  const local = useMemo(
    () => buildLocalBrief(state, customer.id, { commitmentId, forMemberId, now }),
    [state, customer.id, commitmentId, forMemberId, now],
  );

  useEffect(() => {
    if (!cloud) return;
    let live = true;
    getHandoffBrief(orgId, customer.id, commitmentId, forMemberId, { refresh: refreshes > 0 })
      .then((r) => live && setRemote({ status: 'ready', brief: r.brief }))
      .catch((e: unknown) => live && setRemote({ status: 'local', reason: fallbackReason(e, first) }));
    return () => {
      live = false;
    };
  }, [cloud, orgId, customer.id, commitmentId, forMemberId, refreshes, first]);

  const brief = remote.status === 'ready' ? remote.brief : remote.status === 'local' ? local : null;
  const reader = state.members.find((m) => m.id === forMemberId);
  const meta = [reader ? `For ${firstName(reader.name)}` : 'For a teammate', customer.company, brief ? `prepared ${shortDay(brief.generatedAt, now).toLowerCase()}` : '']
    .filter(Boolean)
    .join(' · ');

  const share = async () => {
    if (!brief) return;
    const text = briefText(brief, state, now);
    try {
      await Share.share({ title: `Handoff brief · ${customer.name}`, message: text });
    } catch {
      if (canCopy()) {
        await navigator.clipboard.writeText(text).catch(() => {});
        toast({ text: 'Copied — paste it wherever you like', icon: 'check' });
      } else {
        toast({ text: 'Sharing isn’t available here', icon: 'error' });
      }
    }
  };
  const copy = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(briefText(brief, state, now));
      toast({ text: 'Brief copied', icon: 'check' });
    } catch {
      toast({ text: 'Couldn’t copy on this device', icon: 'error' });
    }
  };

  return (
    <View style={{ flex: 1, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AiLabel size={14}>Handoff brief</AiLabel>
        <View style={{ marginRight: -10 }}>
          <IconButton name="close" label="Close" onPress={close} />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 8 }}>
        <View style={{ gap: 4 }}>
          <Txt variant="h2" accessibilityRole="header">
            {customer.name}
          </Txt>
          <Txt variant="meta">{meta}</Txt>
        </View>

        {!brief ? (
          <Loading first={first} />
        ) : (
          <BriefBody brief={brief} state={state} customer={customer} now={now} />
        )}

        {remote.status === 'local' && remote.reason ? <Txt variant="meta">{remote.reason}</Txt> : null}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Button
          flex
          icon="send"
          label={reader ? `Send to ${firstName(reader.name)}` : 'Share'}
          accessibilityLabel={reader ? `Share the brief with ${reader.name}` : 'Share the brief'}
          disabled={!brief}
          onPress={() => void share()}
        />
        {canCopy() ? <Button variant="secondary" label="Copy" disabled={!brief} onPress={() => void copy()} /> : null}
        {cloud && remote.status !== 'loading' ? (
          <Button
            variant="ghost"
            label="Refresh"
            accessibilityLabel="Write the brief again"
            onPress={() => {
              setRemote({ status: 'loading' });
              setRefreshes((n) => n + 1);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function Loading({ first }: { first: string }) {
  return (
    <View style={{ gap: 16 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SparkPulse size={18} />
        <Txt variant="s" tone="acc">
          Nudge is writing {first}’s brief…
        </Txt>
      </View>
      <AiCard>
        <Skeleton w="40%" h={12} />
        <Skeleton h={12} />
        <Skeleton w="85%" h={12} />
        <Skeleton w="60%" h={12} />
      </AiCard>
      <Card>
        <View style={{ gap: 12 }}>
          <Skeleton w="70%" h={12} />
          <Skeleton w="50%" h={12} />
        </View>
      </Card>
    </View>
  );
}

/** A brief promise as a Commitment for the shared risk rules (the store's row wins when present). */
function asCommitment(p: BriefPromise, customerId: ID, state: AppState): Commitment {
  const known = state.commitments.find((c) => c.id === p.id);
  return (
    known ?? {
      id: p.id,
      customerId,
      title: p.title,
      ownerId: p.ownerId ?? '',
      dueAt: p.dueAt,
      status: p.status,
      promisor: p.promisor,
      confidence: 1,
      createdAt: p.dueAt,
    }
  );
}

function BriefBody({ brief, state, customer, now }: { brief: HandoffBrief; state: AppState; customer: Customer; now: number }) {
  const { c } = useTheme();
  const first = firstName(customer.name);
  const memberName = (id?: ID) => (id === state.me ? 'You' : state.members.find((m) => m.id === id)?.name);
  const openTimeline = () => router.push({ pathname: '/customer/[id]/memory', params: { id: customer.id, tab: 'timeline' } });
  const evidence = brief.evidenceEventIds.map((id) => state.events.find((e) => e.id === id)).filter((e) => !!e);

  return (
    <>
      <AiCard>
        <AiLabel>History</AiLabel>
        <Txt style={{ lineHeight: 22 }}>{brief.history}</Txt>
        <View style={{ height: 4 }} />
        <AiLabel>Right now</AiLabel>
        <Txt style={{ lineHeight: 22 }}>{brief.currentState}</Txt>
      </AiCard>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt variant="h3" accessibilityRole="header">
            Open promises
          </Txt>
          <Txt variant="meta">{brief.openCommitments.length} active</Txt>
        </View>
        <Card padding={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
          {brief.openCommitments.length === 0 ? (
            <View style={{ minHeight: 56, justifyContent: 'center' }}>
              <Txt variant="s">Nothing promised to or by {first} right now.</Txt>
            </View>
          ) : (
            brief.openCommitments.map((p, i) => {
              const risk = riskBadge[commitmentRisk(asCommitment(p, customer.id, state), now)];
              const who = p.promisor === 'customer' ? `${first} promised` : memberName(p.ownerId);
              const target = p.id === brief.commitmentId;
              return (
                <View key={p.id}>
                  {i > 0 && <Sep />}
                  <Tap
                    onPress={() => router.push(`/promise/${p.id}`)}
                    scale={0.99}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.title}, ${dueLabel(p.dueAt, now)}, ${risk.label}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 }}
                  >
                    <Dot tone={risk.tone} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt weight={target ? 'medium' : undefined}>{p.title}</Txt>
                      <Txt variant="meta">{[dueLabel(p.dueAt, now), who].filter(Boolean).join(' · ')}</Txt>
                      {p.note ? (
                        <Txt variant="s" tone={brief.source === 'ai' ? 'acc' : 't2'} numberOfLines={2}>
                          {p.note}
                        </Txt>
                      ) : null}
                    </View>
                    <View style={{ alignSelf: 'center' }}>
                      <Badge tone={risk.tone} label={risk.label} dot={false} />
                    </View>
                  </Tap>
                </View>
              );
            })
          )}
        </Card>
      </View>

      {brief.sensitiveNotes.length ? (
        <View style={{ gap: 10 }}>
          <Txt variant="h3" accessibilityRole="header">
            Handle with care
          </Txt>
          <Card padding={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
            {brief.sensitiveNotes.map((n, i) => (
              <View key={`${i}:${n.text}`}>
                {i > 0 && <Sep />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10 }}>
                  <Dot tone="warn" />
                  <Txt style={{ flex: 1 }}>{n.text}</Txt>
                  {n.eventIds.length ? (
                    <Tap
                      onPress={openTimeline}
                      accessibilityRole="link"
                      accessibilityLabel={`See where “${n.text}” comes from`}
                      style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 8 }}
                    >
                      <Txt variant="s" tone="acc">
                        Source
                      </Txt>
                    </Tap>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <AiCard>
        <AiLabel>Next best action</AiLabel>
        <Txt style={{ lineHeight: 22 }}>{brief.nextAction}</Txt>
      </AiCard>

      {evidence.length ? (
        <View style={{ gap: 8 }}>
          <Txt variant="meta">Based on {plural(evidence.length, 'event')} in {first}’s memory</Txt>
          <View style={{ gap: 6 }}>
            {evidence.map((e) => (
              <Tap
                key={e.id}
                onPress={openTimeline}
                scale={0.99}
                accessibilityRole="link"
                accessibilityLabel={`Open ${e.title} on the timeline`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2 }}
              >
                <Icon name="clock" size={14} color={c.t3} />
                <Txt variant="s" tone="t1" style={{ flex: 1 }} numberOfLines={1}>
                  {e.title}
                </Txt>
                <Txt variant="meta">{shortDay(e.at, now)}</Txt>
                <Icon name="chevron" size={14} color={c.t3} />
              </Tap>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}
