import { Fragment } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { Num, Tap, TimelineGlyph, Txt, type IconName } from '@/components';
import type { AppState } from '@/data/store';
import { commitmentRisk, customerCommitments, eventsFor, groupTimeline } from '@/data/selectors';
import type { CustomerEvent, EventKind, ID } from '@/data/types';
import { inr, shortDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { useNow } from '@/lib/useNow';

/** Glyph per event kind (board 04 · 10 Memory timeline). */
export const GLYPH: Record<EventKind, { icon: IconName; tone?: 'ok' | 'warn' | 'acc' }> = {
  message: { icon: 'message' },
  call: { icon: 'phone' },
  email: { icon: 'mail' },
  quote: { icon: 'doc' },
  payment: { icon: 'card', tone: 'ok' },
  note: { icon: 'pencil' },
  task: { icon: 'check' },
  promise: { icon: 'radar', tone: 'warn' },
  followup: { icon: 'radar', tone: 'warn' },
};

export type TimelineEntry = CustomerEvent & { commitmentId?: ID };

/** "Send revised quotation" → "Revised quotation". */
export function shortTitle(title: string) {
  const t = title.replace(/^(send|share|call|suggest|confirm|prepare|draft)\s+(the\s+)?/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Raw events for a customer plus a synthetic "Follow-up due" entry for each promise that is at risk or overdue,
 * so the timeline shows what is coming due next to what happened.
 */
export function timelineEntries(s: AppState, customerId: ID, now = Date.now()): TimelineEntry[] {
  const due: TimelineEntry[] = customerCommitments(s, customerId)
    .filter((p) => commitmentRisk(p, now) !== 'on_track')
    .map((p) => ({
      id: `due_${p.id}`,
      customerId,
      kind: 'followup',
      channel: 'manual',
      direction: 'internal',
      at: p.dueAt,
      title: 'Follow-up due',
      body: `${shortTitle(p.title)} · ${commitmentRisk(p, now) === 'overdue' ? 'overdue' : 'at risk'}`,
      commitmentId: p.id,
    }));
  return [...due, ...eventsFor(s, customerId)].sort((a, b) => b.at - a.at);
}

/** Commitment that came from this event, if any — tapping the event opens it. */
function linkedCommitment(s: AppState, e: TimelineEntry) {
  if (e.commitmentId) return e.commitmentId;
  return s.commitments.find((c) => c.sourceEventId === e.id && c.status === 'open')?.id;
}

export function EventTitle({ e }: { e: CustomerEvent }) {
  const size = { fontSize: 15.5, lineHeight: 21 };
  if (e.amount != null) {
    return (
      <Txt weight="medium" style={[size, { flex: 1 }]}>
        {e.kind === 'payment' ? `${e.title} ` : `${e.title} · `}
        <Num weight="medium" style={size}>
          {inr(e.amount)}
        </Num>
      </Txt>
    );
  }
  return (
    <Txt weight="medium" style={[size, { flex: 1 }]}>
      {e.title}
    </Txt>
  );
}

function EventSub({ e }: { e: TimelineEntry }) {
  if (e.kind === 'call' && e.aiNote) {
    return (
      <Txt variant="s" tone="acc" style={{ marginTop: 2 }}>
        {e.aiNote}
      </Txt>
    );
  }
  if (e.ref) {
    return (
      <Txt variant="meta" style={{ marginTop: 2 }}>
        {e.ref}
      </Txt>
    );
  }
  if (!e.body || e.body === e.title) return null;
  if (e.kind === 'followup' || e.kind === 'promise') {
    return (
      <Txt variant="meta" style={{ marginTop: 2 }}>
        {e.body}
      </Txt>
    );
  }
  const quoted = e.kind === 'message' || e.kind === 'email';
  return (
    <Txt variant="s" style={{ marginTop: 2 }}>
      {quoted ? `“${e.body}”` : e.body}
    </Txt>
  );
}

/**
 * Vertical timeline with connector line. `groups` adds THIS WEEK / month caps; `compact` (tablet "Recent interactions")
 * keeps rows to one line except the latest thing the customer said.
 */
export function Timeline({
  state,
  entries,
  now: nowProp,
  groups = true,
  compact,
  highlightId,
  onItemLayout,
}: {
  state: AppState;
  entries: TimelineEntry[];
  now?: number;
  groups?: boolean;
  compact?: boolean;
  highlightId?: ID;
  onItemLayout?: (id: ID, y: number) => void;
}) {
  const tick = useNow();
  const now = nowProp ?? tick;
  const { c } = useTheme();
  const grouped = groups ? groupTimeline(entries, now) : [{ title: '', items: entries }];
  const latestInbound = entries.find((e) => e.direction === 'in' && e.body)?.id;

  return (
    <View style={{ position: 'relative' }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 15.5, top: 8, bottom: 8, width: 1, backgroundColor: c.line2 }}
      />
      {grouped.map((g, gi) => (
        <Fragment key={g.title || 'all'}>
          {g.title ? (
            <View style={{ paddingTop: gi === 0 ? 6 : 10, paddingBottom: 6, paddingLeft: 46 }}>
              <Txt variant="cap">{g.title}</Txt>
            </View>
          ) : null}
          {g.items.map((e) => {
            const glyph = GLYPH[e.kind];
            const promiseId = linkedCommitment(state, e);
            const on = highlightId === e.id;
            const showSub = !compact || e.id === latestInbound;
            return (
              <Tap
                key={e.id}
                disabled={!promiseId}
                scale={promiseId ? 0.99 : 1}
                onPress={promiseId ? () => router.push(`/promise/${promiseId}`) : undefined}
                accessibilityRole={promiseId ? 'button' : undefined}
                onLayout={onItemLayout ? (ev: LayoutChangeEvent) => onItemLayout(e.id, ev.nativeEvent.layout.y) : undefined}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 14,
                  paddingVertical: compact ? 10 : 9,
                  paddingHorizontal: 8,
                  marginHorizontal: -8,
                  borderRadius: 14,
                  backgroundColor: on ? c.accWash : 'transparent',
                }}
              >
                <View style={{ backgroundColor: c.bg, borderRadius: 16 }}>
                  <TimelineGlyph icon={glyph.icon} tone={glyph.tone} />
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingTop: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <EventTitle e={e} />
                    <Txt variant="meta" style={{ paddingTop: 2 }}>
                      {shortDay(e.at, now)}
                    </Txt>
                  </View>
                  {showSub ? <EventSub e={e} /> : null}
                </View>
              </Tap>
            );
          })}
        </Fragment>
      ))}
    </View>
  );
}
