import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Avatar, Button, EmptyState, Icon, Num, Screen, Sep, Tap, TopBar, Txt, useToast, type IconName } from '@/components';
import { customerById, pendingExtractions } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { AppNotification } from '@/data/types';
import { dayDiff, firstName, shortDay, time } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { useNow } from '@/lib/useNow';

/** 21 · Notifications — only what needs you, each with a way to act on it. */
export default function Notifications() {
  const { state, actions } = useStore();
  const now = useNow();
  const sorted = [...state.notifications].sort((a, b) => b.at - a.at);
  const today = sorted.filter((n) => dayDiff(n.at, now) === 0);
  const earlier = sorted.filter((n) => dayDiff(n.at, now) !== 0);
  const anyUnread = sorted.some((n) => !n.read);

  return (
    <Screen
      gap={20}
      header={
        <TopBar
          right={
            <Button
              variant="ghost"
              label="Mark all read"
              disabled={!anyUnread}
              onPress={actions.markNotificationsRead}
            />
          }
        />
      }
      contentStyle={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}
    >
      <Txt variant="h1" accessibilityRole="header">
        Notifications
      </Txt>
      {sorted.length === 0 ? (
        <EmptyState
          art={<Icon name="bell" size={32} />}
          title="You’re all caught up"
          body="Nudge only pings you when a customer, a promise or a payment needs you."
        />
      ) : (
        <>
          {today.length > 0 && <Section title="Today" items={today} now={now} />}
          {earlier.length > 0 && <Section title="Earlier" items={earlier} now={now} quiet />}
        </>
      )}
    </Screen>
  );
}

function Section({ title, items, now, quiet }: { title: string; items: AppNotification[]; now: number; quiet?: boolean }) {
  return (
    <View>
      <Txt variant="cap" style={{ marginBottom: 4 }}>
        {title}
      </Txt>
      {items.map((n, i) => (
        <View key={n.id}>
          {i > 0 && <Sep />}
          <NotificationRow n={n} now={now} quiet={quiet} />
        </View>
      ))}
    </View>
  );
}

function NotificationRow({ n, now, quiet }: { n: AppNotification; now: number; quiet?: boolean }) {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const customer = customerById(state, n.customerId);
  const member = !customer
    ? state.members.find((m) => m.status === 'active' && n.title[0]?.t.startsWith(firstName(m.name)))
    : undefined;

  const open = () => {
    if (!n.read) actions.markNotificationRead(n.id);
    if (n.kind === 'ai_commitments') {
      const x = pendingExtractions(state)[0];
      if (x) router.push(`/extraction/${x.id}`);
      else toast({ text: 'All commitments reviewed', icon: 'spark' });
    } else if (n.kind === 'promise_due') {
      router.push('/radar');
    } else if (customer) {
      router.push(`/customer/${customer.id}`);
    }
  };

  const runAction = (a: NonNullable<AppNotification['actions']>[number]) => {
    if (!n.read) actions.markNotificationRead(n.id);
    const who = customer ? firstName(customer.name) : '';
    if (a.route) return router.push(a.route as Href);
    if (/reply/i.test(a.label) && customer) return router.push(`/customer/${customer.id}`);
    if (/invoice/i.test(a.label)) return toast({ text: who ? `Invoice drafted for ${who}` : 'Invoice drafted', icon: 'check' });
    toast({ text: `${a.label} · done`, icon: 'check' });
  };

  const tinted = (icon: IconName, bg: string, fg: string) => (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={20} color={fg} />
    </View>
  );
  const glyph =
    n.kind === 'promise_due'
      ? tinted('clock', c.warnWash, c.warn)
      : n.kind === 'ai_commitments'
        ? tinted('spark', c.accWash, c.accText)
        : customer
          ? <Avatar name={customer.name} />
          : member
            ? <Avatar name={member.name} />
            : tinted('bell', c.bg2, c.t2);

  const meta = dayDiff(n.at, now) === 0 ? `${n.meta} · ${time(n.at)}` : n.meta === shortDay(n.at, now) ? n.meta : `${n.meta} · ${shortDay(n.at, now)}`;
  const label = n.title.map((s) => s.t).join('');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14 }}>
      <View style={{ flex: 1 }}>
      <Tap
        onPress={open}
        scale={0.99}
        accessibilityRole="button"
        accessibilityLabel={`${n.read ? '' : 'Unread. '}${label}. ${meta}`}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}
      >
        {glyph}
        <View style={{ flex: 1, gap: 4 }}>
          <Txt tone={quiet ? 't2' : 't1'}>
            {n.title.map((s, i) =>
              /^₹[\d,]+$/.test(s.t) ? (
                <Num key={i} style={{ fontSize: 15 }} tone={quiet ? 't2' : 't1'}>
                  {s.t}
                </Num>
              ) : s.b ? (
                <Txt key={i} weight="semibold" tone={quiet ? 't2' : 't1'}>
                  {s.t}
                </Txt>
              ) : (
                s.t
              ),
            )}
          </Txt>
          <Txt variant="meta">{meta}</Txt>
        </View>
      </Tap>
      {/* Actions sit outside the row's pressable: nested buttons are invalid on web and confuse screen readers. */}
      {n.actions?.length ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, marginLeft: 54, flexWrap: 'wrap' }}>
          {n.actions.map((a) => (
            <Button
              key={a.label}
              label={a.label}
              variant={a.primary ? 'primary' : 'secondary'}
              style={{ paddingHorizontal: 16 }}
              onPress={() => runAction(a)}
            />
          ))}
        </View>
      ) : null}
      </View>
      {!n.read && (
        <View
          accessibilityElementsHidden
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.acc, marginTop: 6 }}
        />
      )}
    </View>
  );
}
