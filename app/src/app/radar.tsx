import { useRef, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CheckCircle,
  Dot,
  FloatingTabBar,
  Icon,
  IconButton,
  Num,
  Quote,
  Screen,
  Sep,
  TABS,
  Tap,
  TopBar,
  Txt,
  useIsTablet,
} from '@/components';
import { commitmentRisk, customerById, eventById, radar, riskBadge, type Risk } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { Commitment } from '@/data/types';
import { dueLabel, plural, shortDay } from '@/lib/format';
import { channelLabel, PromiseRow, RadarArt, RadarClearArt, SnoozeSheet, useCompletePromise } from '@/features/promises';
import { useTheme } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';

const rank: Record<Risk, number> = { overdue: 0, at_risk: 1, on_track: 2, done: 3 };
const native = Platform.OS !== 'web';
const ease = Easing.bezier(...motion.easing);

/**
 * 13 · Promise Radar — what you said you'd do, ranked by what is slipping.
 * Each promise keeps the customer's own words as proof.
 */
export default function PromiseRadar() {
  const { state } = useStore();
  const { c } = useTheme();
  const isTablet = useIsTablet();
  const complete = useCompletePromise();
  const [snoozing, setSnoozing] = useState<Commitment | null>(null);
  const [showLater, setShowLater] = useState(false);
  const now = Date.now();
  const { attention, later, doneThisWeek } = radar(state, now);
  const ranked = [...attention].sort((a, b) => rank[commitmentRisk(a, now)] - rank[commitmentRisk(b, now)] || a.dueAt - b.dueAt);
  const [featured, ...rest] = ranked;

  const header = (
    <TopBar
      right={<IconButton name="plus" label="Add a promise" onPress={() => router.push('/capture')} />}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))}
    />
  );
  const tabBar = isTablet ? null : (
    <FloatingTabBar
      active="inbox"
      onSelect={(key) => router.navigate((TABS.find((t) => t.key === key)?.route ?? '/') as Href)}
    />
  );
  const body = { maxWidth: 720, width: '100%', alignSelf: 'center' } as const;

  if (!featured) {
    const next = later[0];
    const kept = doneThisWeek.length;
    return (
      <Screen tabBar={!isTablet} header={header} footer={tabBar} contentStyle={body}>
        <Txt variant="h1" accessibilityRole="header">
          Promise Radar
        </Txt>
        <View style={{ alignItems: 'center', gap: 28, paddingTop: 40, paddingHorizontal: 12 }}>
          <RadarClearArt />
          <View style={{ gap: 10, alignItems: 'center' }}>
            <Txt variant="section" center style={{ fontSize: 24 }}>
              Nothing at risk
            </Txt>
            <Txt variant="body" center>
              {kept > 0 ? (
                <>
                  You kept every promise this week —{' '}
                  <Num tone="t1" style={{ fontSize: 15 }}>
                    {kept} of {kept}
                  </Num>
                  .
                </>
              ) : (
                'Nothing is due in the next two days.'
              )}
            </Txt>
          </View>
          {next && (
            <View style={{ alignSelf: 'stretch' }}>
            <Card
              padding={0}
              onPress={() => router.push(`/promise/${next.id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}
            >
              <Dot tone="ok" />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt>Next: {next.title.charAt(0).toLowerCase() + next.title.slice(1)}</Txt>
                <Txt variant="meta">{dueLabel(next.dueAt, now)}</Txt>
              </View>
              <Icon name="chevron" size={16} color={c.t3} />
            </Card>
            </View>
          )}
        </View>
        <SnoozeSheet commitment={snoozing} onClose={() => setSnoozing(null)} />
      </Screen>
    );
  }

  return (
    <Screen tabBar={!isTablet} gap={20} header={header} footer={tabBar} contentStyle={body}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Txt variant="h1" accessibilityRole="header">
            Promise Radar
          </Txt>
          <Txt variant="s">
            <Txt variant="s" tone="t1" weight="medium">
              {plural(attention.length, 'commitment')}
            </Txt>{' '}
            need{attention.length === 1 ? 's' : ''} attention
          </Txt>
        </View>
        <RadarArt attention={ranked} later={later} now={now} />
      </View>

      <FeaturedPromise
        key={featured.id}
        commitment={featured}
        now={now}
        onComplete={() => complete(featured.id)}
        onSnooze={() => setSnoozing(featured)}
      />

      {rest.length > 0 && (
        <Card padding={0} style={{ paddingVertical: 2, paddingHorizontal: 18 }}>
          {rest.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <Sep />}
              <PromiseRow commitment={p} customer={customerById(state, p.customerId)} now={now} onPress={() => router.push(`/promise/${p.id}`)} />
            </View>
          ))}
        </Card>
      )}

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tap
            onPress={() => later.length && setShowLater((v) => !v)}
            disabled={!later.length}
            accessibilityRole="button"
            accessibilityState={{ expanded: showLater }}
            accessibilityLabel={`Later this week, ${later.length}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
          >
            <Txt variant="cap">Later this week · {later.length}</Txt>
            {later.length > 0 && (
              <View style={{ transform: [{ rotate: showLater ? '90deg' : '0deg' }] }}>
                <Icon name="chevron" size={14} color={c.t3} />
              </View>
            )}
          </Tap>
          <Txt variant="meta">Done this week · {doneThisWeek.length}</Txt>
        </View>
        {showLater && later.length > 0 && (
          <Card padding={0} style={{ paddingVertical: 2, paddingHorizontal: 18 }}>
            {later.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <Sep />}
                <PromiseRow commitment={p} customer={customerById(state, p.customerId)} now={now} onPress={() => router.push(`/promise/${p.id}`)} />
              </View>
            ))}
          </Card>
        )}
      </View>

      <SnoozeSheet commitment={snoozing} onClose={() => setSnoozing(null)} />
    </Screen>
  );
}

/** The most urgent promise, with proof and two actions. Completing checks (180ms) then collapses (260ms). */
function FeaturedPromise({
  commitment: p,
  now,
  onComplete,
  onSnooze,
}: {
  commitment: Commitment;
  now: number;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const { state } = useStore();
  const customer = customerById(state, p.customerId);
  const source = eventById(state, p.sourceEventId);
  const risk = riskBadge[commitmentRisk(p, now)];
  const [done, setDone] = useState(false);
  const check = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(1)).current;
  const height = useRef(0);
  const [measured, setMeasured] = useState(false);

  const finish = () => {
    if (done) return;
    setDone(true);
    Animated.timing(check, { toValue: 1, duration: motion.promiseCheck, easing: ease, useNativeDriver: false }).start(() => {
      setMeasured(true);
      Animated.timing(collapse, { toValue: 0, duration: motion.promiseCollapse, easing: ease, useNativeDriver: false }).start(onComplete);
    });
  };

  const channel = channelLabel[source?.channel ?? customer?.preferredChannel ?? 'whatsapp'];
  const when = shortDay(source?.at ?? p.createdAt, now);

  return (
    <Animated.View
      onLayout={(e) => {
        if (!measured) height.current = e.nativeEvent.layout.height;
      }}
      style={[
        { opacity: collapse },
        measured && {
          height: collapse.interpolate({ inputRange: [0, 1], outputRange: [0, height.current] }),
          overflow: 'hidden',
          marginBottom: collapse.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }),
        },
      ]}
    >
      <Card elevated style={{ gap: 12 }} onPress={() => router.push(`/promise/${p.id}`)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <Avatar name={customer?.name ?? '?'} size={28} />
            <Txt variant="s" tone="t1" weight="medium" numberOfLines={1}>
              {customer?.name}
            </Txt>
          </View>
          {done ? (
            <Animated.View style={{ transform: [{ scale: check }], opacity: check }}>
              <CheckCircle />
            </Animated.View>
          ) : (
            <Badge tone={risk.tone} label={risk.label} />
          )}
        </View>
        <View style={{ gap: 3 }}>
          <Txt variant="h3" strike={done}>
            {p.title}
          </Txt>
          <Txt variant="meta">{dueLabel(p.dueAt, now)}</Txt>
        </View>
        {p.quote ? <Quote by={`· ${channel}, ${when}`}>{`“${p.quote}”`}</Quote> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Complete" flex onPress={finish} disabled={done} accessibilityLabel={`Complete: ${p.title}`} />
          <Button label="Snooze" variant="secondary" flex onPress={onSnooze} disabled={done} />
        </View>
      </Card>
    </Animated.View>
  );
}
