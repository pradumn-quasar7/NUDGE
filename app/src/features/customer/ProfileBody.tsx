import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import {
  AiCard,
  AiLabel,
  Avatar,
  Badge,
  Button,
  Card,
  Dot,
  Icon,
  Num,
  Sep,
  Tap,
  Txt,
  useToast,
  type IconName,
} from '@/components';
import { useStore, type AppState } from '@/data/store';
import { commitmentRisk, customerCommitments, eventsFor, relationshipHealth, riskBadge } from '@/data/selectors';
import type { Customer, ID } from '@/data/types';
import { dueLabel, firstName, inr, monthYear, plural, shortDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { Timeline, timelineEntries } from './Timeline';

/* ───────────── Helpers ───────────── */

export function sinceLine(c: Customer, long = true) {
  return [c.company, `${long ? 'customer since' : 'since'} ${monthYear(c.customerSince)}`].filter(Boolean).join(' · ');
}

/** Message / Call / Quote / Note — shared by the phone quick actions and the tablet header. */
export function useContactActions(customer: Customer | undefined) {
  const { state } = useStore();
  const toast = useToast();
  const first = customer ? firstName(customer.name) : '';
  const digits = customer?.phone?.replace(/[^\d+]/g, '') ?? '';
  const open = (url: string) => Linking.openURL(url).catch(() => toast({ text: 'Couldn’t open that on this device' }));
  return {
    message: () => {
      if (!customer) return;
      if (digits) open(`https://wa.me/${digits.replace('+', '')}`);
      else if (customer.email) open(`mailto:${customer.email}`);
      else toast({ text: `No phone or email for ${first} yet` });
    },
    call: () => {
      if (!customer) return;
      if (digits) open(`tel:${digits}`);
      else toast({ text: `No phone number for ${first} yet` });
    },
    quote: () => {
      if (!customer) return;
      const p = customerCommitments(state, customer.id).find((x) => /quot/i.test(x.title));
      if (p) router.push(`/promise/${p.id}`);
      else router.push({ pathname: '/capture', params: { customerId: customer.id } });
    },
    note: () => {
      if (!customer) return;
      router.push({ pathname: '/capture', params: { customerId: customer.id } });
    },
  };
}

/* ───────────── Relationship (explainable) ───────────── */

export function RelationshipBar({ state, customerId }: { state: AppState; customerId: ID }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const h = relationshipHealth(state, customerId);
  const tone = h.tone === 'ok' ? 'ok' : 'warn';
  const fill = tone === 'ok' ? c.okDot : c.warnDot;
  return (
    <View style={{ gap: 12 }}>
      <Tap
        onPress={() => setOpen((v) => !v)}
        scale={0.99}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Relationship: ${h.label}, ${h.score} of 5. ${open ? 'Hide' : 'Show'} why`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
      >
        <Txt variant="s" tone="t1" weight="medium">
          Relationship
        </Txt>
        <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < h.score ? fill : c.line2 }} />
          ))}
        </View>
        <Txt variant="s" tone={tone} weight="medium">
          {h.label}
        </Txt>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={14} color={c.t3} />
        </View>
      </Tap>
      {open && (
        <View style={{ backgroundColor: c.bg2, borderRadius: 14, padding: 14, gap: 10 }}>
          <Txt variant="meta">Why “{h.label.toLowerCase()}” — what Nudge can see</Txt>
          {h.signals.length ? (
            h.signals.map((s) => (
              <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Dot tone={s.tone} />
                <Txt variant="s" tone="t1">
                  {s.label}
                </Txt>
              </View>
            ))
          ) : (
            <Txt variant="s">Not enough history yet. Health fills in as you talk.</Txt>
          )}
          <Txt variant="meta">A read of the relationship, not a lead score.</Txt>
        </View>
      )}
    </View>
  );
}

/* ───────────── What matters ───────────── */

export function WhatMatters({ customer }: { customer: Customer }) {
  const src = customer.summarySources;
  const updated = src ? shortDay(src.updatedAt) : '';
  const when = updated === 'Today' || updated === 'Yesterday' ? updated.toLowerCase() : updated;
  const from = src
    ? [src.messages ? plural(src.messages, 'message') : '', src.calls ? plural(src.calls, 'call') : ''].filter(Boolean).join(' and ')
    : '';
  return (
    <AiCard>
      <AiLabel>What matters</AiLabel>
      <Txt style={{ lineHeight: 22 }}>
        {customer.summary ??
          `Nudge is still getting to know ${firstName(customer.name)}. Add a note or connect WhatsApp and a summary will appear here.`}
      </Txt>
      {src && customer.summary ? (
        <Txt variant="meta">
          Updated {when}
          {from ? ` · from ${from}` : ''}
        </Txt>
      ) : null}
    </AiCard>
  );
}

/* ───────────── Open commitments ───────────── */

export function OpenCommitments({ state, customer, withQuote }: { state: AppState; customer: Customer; withQuote?: boolean }) {
  const now = Date.now();
  const open = customerCommitments(state, customer.id);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="h3" accessibilityRole="header">
          Open commitments
        </Txt>
        <Txt variant="meta">{open.length} active</Txt>
      </View>
      <Card padding={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
        {open.length === 0 ? (
          <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Txt variant="s" style={{ flex: 1 }}>
              Nothing promised to {firstName(customer.name)} right now.
            </Txt>
            <Button
              variant="ghost"
              label="Add"
              size="sm"
              onPress={() => router.push({ pathname: '/capture', params: { customerId: customer.id } })}
            />
          </View>
        ) : (
          open.map((p, i) => {
            const risk = riskBadge[commitmentRisk(p, now)];
            return (
              <View key={p.id}>
                {i > 0 && <Sep />}
                <Tap
                  onPress={() => router.push(`/promise/${p.id}`)}
                  scale={0.99}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}, ${dueLabel(p.dueAt, now)}, ${risk.label}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: withQuote ? 62 : 60, paddingVertical: 10 }}
                >
                  <Dot tone={risk.tone} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt>{p.title}</Txt>
                    <Txt variant="meta">
                      {dueLabel(p.dueAt, now)}
                      {withQuote && p.quote ? ` · “${p.quote}”` : ''}
                    </Txt>
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
  );
}

/* ───────────── Quick actions (phone) ───────────── */

function QuickAction({ icon, label, a11y, onPress }: { icon: IconName; label: string; a11y: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <Tap
        onPress={onPress}
        haptic
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={icon} size={20} color={c.t1} />
      </Tap>
      <Txt variant="meta">{label}</Txt>
    </View>
  );
}

/* ───────────── Body ───────────── */

/**
 * Customer profile body — "phone" is board 04 · 09; "tablet" is the detail pane of board 11
 * (header with actions, then summary + commitments beside the recent timeline).
 */
export function ProfileBody({ customerId, layout }: { customerId: ID; layout: 'phone' | 'tablet' }) {
  const { state } = useStore();
  const { c } = useTheme();
  const customer = state.customers.find((x) => x.id === customerId);
  const contact = useContactActions(customer);
  const [width, setWidth] = useState(0);
  if (!customer) return null;
  const first = firstName(customer.name);
  const events = eventsFor(state, customer.id);

  if (layout === 'phone') {
    return (
      <View style={{ gap: 22 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Avatar name={customer.name} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="h2" style={{ fontSize: 26, lineHeight: 32 }} accessibilityRole="header">
              {customer.name}
            </Txt>
            <Txt variant="meta">{sinceLine(customer)}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Num weight="medium">{inr(customer.lifetimeValue)}</Num>
              <Txt variant="meta">lifetime value</Txt>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <QuickAction icon="message" label="Message" a11y={`Message ${first}`} onPress={contact.message} />
          <QuickAction icon="phone" label="Call" a11y={`Call ${first}`} onPress={contact.call} />
          <QuickAction icon="doc" label="Quote" a11y="Create quotation" onPress={contact.quote} />
          <QuickAction icon="pencil" label="Note" a11y="Add note" onPress={contact.note} />
        </View>

        <RelationshipBar state={state} customerId={customer.id} />
        <WhatMatters customer={customer} />
        <OpenCommitments state={state} customer={customer} />

        <Card padding={0} onPress={() => router.push(`/customer/${customer.id}/memory`)} style={{ paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingVertical: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="clock" size={18} color={c.t2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={{ fontSize: 15.5 }}>Full memory</Txt>
              <Txt variant="meta">
                {events.length ? `${plural(events.length, 'event')} · timeline, facts and files` : 'Timeline, facts and files'}
              </Txt>
            </View>
            <Icon name="chevron" size={16} color={c.t3} />
          </View>
        </Card>
      </View>
    );
  }

  /* tablet */
  const h = relationshipHealth(state, customer.id);
  const twoCol = width === 0 || width >= 620;
  const recent = timelineEntries(state, customer.id).slice(0, 7);
  return (
    <View style={{ gap: 26 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <Avatar name={customer.name} size={64} />
        <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
          <Txt variant="h1" accessibilityRole="header" numberOfLines={1}>
            {customer.name}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Txt variant="meta">{sinceLine(customer, false)}</Txt>
            <Txt variant="meta">·</Txt>
            <Num variant="s" tone="t1">
              {inr(customer.lifetimeValue)}
            </Num>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Dot tone={h.tone} />
              <Txt variant="s" tone={h.tone === 'ok' ? 'ok' : 'warn'} weight="medium">
                {h.label}
              </Txt>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="secondary" icon="phone" accessibilityLabel={`Call ${first}`} style={{ width: 44, paddingHorizontal: 0 }} onPress={contact.call} />
          <Button variant="secondary" label="Message" onPress={contact.message} />
          <Button label="New quote" onPress={contact.quote} />
        </View>
      </View>

      <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 28, alignItems: 'flex-start' }}>
        <View style={{ flex: twoCol ? 1 : undefined, alignSelf: twoCol ? undefined : 'stretch', minWidth: 0, gap: 20 }}>
          <WhatMatters customer={customer} />
          <OpenCommitments state={state} customer={customer} withQuote />
          <RelationshipBar state={state} customerId={customer.id} />
        </View>
        <View style={{ flex: twoCol ? 1 : undefined, alignSelf: twoCol ? undefined : 'stretch', minWidth: 0, gap: 10 }}>
          <Txt variant="h3" accessibilityRole="header">
            Recent interactions
          </Txt>
          {recent.length ? (
            <Timeline state={state} entries={recent} groups={false} compact />
          ) : (
            <Txt variant="s">Nothing yet. Messages, calls and payments with {first} will show up here.</Txt>
          )}
          <View style={{ flexDirection: 'row' }}>
            <Button
              variant="ghost"
              label="See full timeline"
              style={{ paddingHorizontal: 0 }}
              onPress={() => router.push(`/customer/${customer.id}/memory`)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
