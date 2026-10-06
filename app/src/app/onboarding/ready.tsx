import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Card, CheckCircle, Icon, Num, Screen, Sep, Txt } from '@/components';
import { useMe, useStore } from '@/data/store';
import { openCommitments } from '@/data/selectors';
import { getDraft, resetDraft, useDraft } from '@/features/onboarding/draft';
import { Glow } from '@/features/onboarding/Glow';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter } from '@/features/onboarding/Header';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';

/** 06 · You're ready — what Nudge already found, and what it is still reading. */
export default function Ready() {
  const { state, actions } = useStore();
  const { c, scheme } = useTheme();
  const me = useMe();
  const { width, height } = useWindowDimensions();
  useDraft(state.org); // make sure the answers are seeded even if a step was skipped

  const customers = state.customers.filter((x) => !x.archived).length;
  const promises = openCommitments(state).length;
  const wa = state.integrations.find((i) => i.kind === 'whatsapp');
  const conversations = Number(wa?.detail.match(/(\d[\d,]*)\s+chats/)?.[1]?.replace(/,/g, '')) || state.events.length;
  const pct = useLearning();
  const done = pct >= 100;

  const goHome = () => {
    const { sells, handles, channels } = getDraft();
    actions.onboard({ sells: sells.trim() || state.org.sells, handles, channels });
    resetDraft();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  };

  return (
    <Screen
      gap={36}
      fade
      header={
        <Glow
          cx="50%"
          cy="0%"
          rx="100%"
          ry="50%"
          stop={0.7}
          alpha={0.1}
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
        />
      }
      contentStyle={{ paddingTop: 52, paddingBottom: FOOTER_SPACE + 24 }}
      footer={
        <OnboardingFooter>
          <OnboardingCta label="Go to Home" onPress={goHome} />
          <Txt variant="meta" center style={{ marginTop: 4 }}>
            You can keep using Nudge while it learns.
          </Txt>
        </OnboardingFooter>
      }
    >
      <View style={{ gap: 14, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: c.acc,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: scheme === 'dark' ? '0 16px 32px -14px rgba(127,123,255,0.55)' : '0 16px 32px -14px rgba(75,71,224,0.7)',
          }}
        >
          <Icon name="spark" size={26} color={c.onAcc} />
        </View>
        <Txt variant="h1" accessibilityRole="header" style={{ fontSize: 36, lineHeight: 40, letterSpacing: -1.08 }}>
          You’re ready, {firstName(me?.name ?? 'there')}.
        </Txt>
        <Txt variant="body">We’ll start learning how your business works. Most of it is already here.</Txt>
      </View>

      <Card padding={0} style={{ paddingVertical: 6, paddingHorizontal: 18 }}>
        <Row label="Found customers" value={String(customers)} />
        <Sep />
        <Row label="Open promises" value={String(promises)} />
        <Sep />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58 }}
          accessibilityLiveRegion="polite"
          accessibilityLabel={done ? `Read ${conversations} conversations` : `Reading ${conversations} conversations, ${pct} percent`}
        >
          {done ? <CheckCircle /> : <ReadingDot />}
          <Txt style={{ flex: 1 }} color={done ? c.t1 : c.accText} numberOfLines={1}>
            {done ? `Read ${conversations} conversations` : `Reading ${conversations} conversations…`}
          </Txt>
          <Num variant="meta">{pct}%</Num>
        </View>
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58 }}>
      <CheckCircle />
      <Txt style={{ flex: 1 }}>{label}</Txt>
      <Num weight="medium">{value}</Num>
    </View>
  );
}

/** Pending step: indigo ring with a breathing dot (AI is working). */
function ReadingDot() {
  const { c } = useTheme();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 0.35, duration: motion.aiPulse / 2, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(o, { toValue: 1, duration: motion.aiPulse / 2, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return (
    <View
      style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: c.accWash2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.acc, opacity: o }} />
    </View>
  );
}

/** Simulated first sync: ticks from 8% to 100% over ~7s, quick at first and slowing near the end. */
function useLearning() {
  const [pct, setPct] = useState(8);
  useEffect(() => {
    if (pct >= 100) return;
    const step = pct < 60 ? 3 : pct < 90 ? 2 : 1;
    const t = setTimeout(() => setPct(Math.min(100, pct + step)), 160);
    return () => clearTimeout(t);
  }, [pct]);
  return pct;
}
