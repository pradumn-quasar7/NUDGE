import { View } from 'react-native';
import { router } from 'expo-router';
import {
  AiCard,
  AiLabel,
  AskBar,
  Avatar,
  AvatarStack,
  Button,
  Card,
  IconButton,
  Num,
  Quote,
  Screen,
  SectionLabel,
  Sep,
  StatusLine,
  Tap,
  Txt,
  useToast,
} from '@/components';
import { useMe, useStore } from '@/data/store';
import { attention, customerById, followUps, openCommitments, pendingExtractions } from '@/data/selectors';
import { dayDiff, firstName, greeting, inr, longDate, plural, relDay, shortDay, time } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Home — "What do I need to know or do right now?"
 * An assistant, not a dashboard: one status line, then only the cards that need a decision.
 */
export default function Home() {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const me = useMe();
  const toast = useToast();
  const now = Date.now();
  const { urgent, waiting, count } = attention(state, now);
  const priority = urgent[0];
  const priorityCustomer = customerById(state, priority?.customerId);
  const unread = state.notifications.some((n) => !n.read);
  const nextUp = openCommitments(state).find((p) => p.id !== priority?.id);
  const nextUpCustomer = customerById(state, nextUp?.customerId);
  const overnight = state.events
    .filter((e) => e.direction === 'in' && now - e.at < 36 * 3_600_000)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3);
  const extractions = pendingExtractions(state);
  const calm = count === 0;

  return (
    <Screen
      tabBar
      askBar
      gap={calm ? 28 : 22}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
          <IconButton name="search" label="Search" onPress={() => router.push('/search')} />
          <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
            <IconButton name="bell" label={unread ? 'Notifications, new' : 'Notifications'} dot={unread} onPress={() => router.push('/notifications')} />
            <Tap onPress={() => router.push('/more')} accessibilityLabel="Your profile" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Avatar name={firstName(me.name)} size={30} />
            </Tap>
          </View>
        </View>
      }
      footer={<AskBar bottom={96} />}
    >
      <View style={{ gap: 10 }}>
        {calm && <Txt variant="meta">{longDate(now)}</Txt>}
        <Txt variant="display" accessibilityRole="header">
          {greeting()}, {firstName(me.name)}.
        </Txt>
        {calm ? (
          <StatusLine tone="ok">Everything under control</StatusLine>
        ) : (
          <StatusLine tone="warn">
            <Txt variant="s" tone="t1" weight="medium" style={{ fontSize: 14 }}>
              {plural(count, 'thing')} need{count === 1 ? 's' : ''} your attention
            </Txt>
          </StatusLine>
        )}
      </View>

      {priority && priorityCustomer && (
        <Card elevated style={{ gap: 14 }} onPress={() => router.push(`/promise/${priority.id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt variant="cap" tone="warn">
              Priority
            </Txt>
            <Txt variant="meta">Promised {relDay(priority.createdAt, now)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={priorityCustomer.name} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3">
                {priority.title.toLowerCase().includes('quot') ? `${firstName(priorityCustomer.name)} needs a quotation` : priority.title}
              </Txt>
              <Txt variant="meta">
                {state.facts.find((f) => f.customerId === priorityCustomer.id && f.kind === 'temporal')?.text.replace('Needs ', '').replace(/ before.*/, '') ?? priorityCustomer.headline}
                {priority.draftHint ? ' · revised pricing' : ''}
              </Txt>
            </View>
          </View>
          {priority.quote && <Quote>{`“${priority.quote}”\n— ${priority.quoteBy?.toLowerCase() === 'you' ? 'you' : priority.quoteBy}, ${shortDay(priority.createdAt, now)}`}</Quote>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={priority.title.toLowerCase().includes('quot') ? 'Send quotation' : 'Do it now'}
              flex
              onPress={() => router.push(`/promise/${priority.id}`)}
            />
            <Button
              variant="secondary"
              icon="more"
              accessibilityLabel="More actions"
              style={{ width: 44, paddingHorizontal: 0 }}
              onPress={() => {
                actions.snoozeCommitment(priority.id, now + 3 * 3_600_000);
                toast({ text: 'Snoozed for 3 hours', icon: 'check' });
              }}
            />
          </View>
        </Card>
      )}

      {waiting.length > 0 && (
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3">{plural(waiting.length, 'customer')} waiting for a reply</Txt>
              <Txt variant="meta">
                Oldest: {firstName(customerById(state, waiting[waiting.length - 1].customerId)?.name ?? '')}, {Math.max(1, -dayDiff(waiting[waiting.length - 1].at, now))} days
              </Txt>
            </View>
            <AvatarStack names={waiting.map((w) => customerById(state, w.customerId)?.name ?? '?')} size={30} />
          </View>
          <Txt variant="s" numberOfLines={1}>
            {waiting
              .slice(1, 3)
              .map((w) => `${firstName(customerById(state, w.customerId)?.name ?? '')} — ${w.what.toLowerCase().replace('asked when ', '').replace('wants a ', '')}`)
              .join(' · ')}
          </Txt>
          <Button variant="tonal" label="Review" full onPress={() => router.push('/inbox')} />
        </Card>
      )}

      {extractions.length > 0 && (
        <AiCard>
          <AiLabel>I noticed {plural(extractions.length, 'commitment')}</AiLabel>
          <Txt variant="t">{extractions[0].title}</Txt>
          <Txt variant="meta">{extractions[0].sourceLabel}</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button variant="ai" icon="check" label="Review" flex onPress={() => router.push(`/extraction/${extractions[0].id}`)} />
            <Button variant="ghost" label="Later" />
          </View>
        </AiCard>
      )}

      {calm && nextUp && nextUpCustomer && (
        <View style={{ gap: 12 }}>
          <SectionLabel>Next up</SectionLabel>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingLeft: 18, paddingRight: 16 }} onPress={() => router.push(`/promise/${nextUp.id}`)}>
            <Avatar name={nextUpCustomer.name} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3">{nextUp.title}</Txt>
              <Txt variant="meta">
                {dayDiff(nextUp.dueAt, now) === 0 ? time(nextUp.dueAt) : shortDay(nextUp.dueAt, now)} · you promised {relDay(nextUp.createdAt, now)}
              </Txt>
            </View>
            <IconButton name="phone" label={`Call ${firstName(nextUpCustomer.name)}`} bordered />
          </Card>
        </View>
      )}

      <AiCard>
        <AiLabel>Business insight</AiLabel>
        <Txt style={{ fontSize: 16, lineHeight: 23 }}>
          Customers who receive a follow-up within 24 hours are converting <Num weight="semibold" style={{ fontSize: 16 }}>2.1×</Num> more often.
        </Txt>
        <View style={{ flexDirection: 'row' }}>
          <Button variant="ghost" label="Explore" style={{ paddingHorizontal: 0 }} onPress={() => router.push('/insights')} />
        </View>
      </AiCard>

      {overnight.length > 0 && (
        <View style={{ gap: 4 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Remembered overnight</SectionLabel>
          {overnight.map((e, i) => {
            const cust = customerById(state, e.customerId)!;
            return (
              <View key={e.id}>
                {i > 0 && <Sep />}
                <Tap onPress={() => router.push(`/customer/${cust.id}`)} scale={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
                  <Avatar name={cust.name} size={30} />
                  <Txt variant="s" tone="t1" style={{ flex: 1 }} numberOfLines={1}>
                    {e.kind === 'payment' ? (
                      <>
                        {firstName(cust.name)} paid <Num style={{ fontSize: 13.5 }}>{inr(e.amount ?? 0)}</Num>
                      </>
                    ) : (
                      `${firstName(cust.name)} ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}`
                    )}
                  </Txt>
                  <Txt variant="meta">{time(e.at)}</Txt>
                </Tap>
              </View>
            );
          })}
        </View>
      )}
      <View style={{ height: 1, backgroundColor: c.bg }} />
    </Screen>
  );
}
