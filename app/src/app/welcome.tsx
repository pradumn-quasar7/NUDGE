import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AiCard, AiLabel, Avatar, Dot, Icon, Tap, Txt, useIsTablet } from '@/components';
import { useStore } from '@/data/store';
import { Glow } from '@/features/onboarding/Glow';
import { OnboardingCta } from '@/features/onboarding/Header';
import { resetDraft } from '@/features/onboarding/draft';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius } from '@/theme/tokens';

const native = Platform.OS !== 'web';
/** The splash plays once per app launch — coming back to Welcome from step 1 skips it. */
let splashPlayed = false;

/**
 * 01 Splash → 02 Welcome. The splash holds ~1.2s, then crossfades into the welcome collage:
 * three floating memory cards that show what Nudge keeps (a preference, a promise, an AI catch).
 * The collage is illustrative brand art (shown before any account exists), so its copy is fixed.
 */
export default function Welcome() {
  const { state, actions } = useStore();
  // Decide once on mount; after "I already have an account" we navigate explicitly.
  const [alreadyOnboarded] = useState(state.onboarded);
  const reduceMotion = useReduceMotion();
  const [splash, setSplash] = useState(!splashPlayed);
  const splashO = useRef(new Animated.Value(splashPlayed ? 0 : 1)).current;
  const content = useRef(new Animated.Value(splashPlayed ? 1 : 0)).current;

  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => {
      splashPlayed = true;
      Animated.parallel([
        Animated.timing(splashO, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(content, { toValue: 1, duration: 520, delay: 80, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: native }),
      ]).start(() => setSplash(false));
    }, 1200);
    return () => clearTimeout(t);
  }, [content, splash, splashO]);

  if (alreadyOnboarded) return <Redirect href="/" />;

  const start = () => {
    resetDraft();
    router.push('/onboarding/sell');
  };
  const signIn = () => {
    actions.onboard({});
    router.replace('/');
  };

  return (
    <View style={{ flex: 1 }}>
      <WelcomeBody opacity={content} onStart={start} onSignIn={signIn} reduceMotion={reduceMotion} />
      {splash && <Splash opacity={splashO} />}
    </View>
  );
}

/* ───────────── 01 Splash ───────────── */

function Splash({ opacity }: { opacity: Animated.Value }) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      accessibilityLabel="Nudge. Your business, remembered."
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity }]}
    >
      <Glow cx="50%" cy="42%" rx="120%" ry="60%" stop={0.6} alpha={0.09} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            backgroundColor: c.inv,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: scheme === 'dark' ? '0 24px 48px -18px rgba(0,0,0,0.9)' : '0 24px 48px -18px rgba(20,20,28,0.5)',
          }}
        >
          <Icon name="logo" size={40} color={c.onInv} />
        </View>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -1.05 }}>Nudge</Txt>
      </View>
      <Txt variant="meta" center style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 22 }}>
        Your business, remembered.
      </Txt>
    </Animated.View>
  );
}

/* ───────────── 02 Welcome ───────────── */

const COLLAGE_W = 390;
const COLLAGE_H = 420;

function WelcomeBody({
  opacity,
  onStart,
  onSignIn,
  reduceMotion,
}: {
  opacity: Animated.Value;
  onStart: () => void;
  onSignIn: () => void;
  reduceMotion: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const isTablet = useIsTablet();
  const { height } = useWindowDimensions();
  const [blockTop, setBlockTop] = useState(height);
  const collageTop = insets.top + 16;
  // Shrink the collage on short phones so it never runs into the headline.
  const scale = Math.max(0.6, Math.min(isTablet ? 1.15 : 1, (blockTop - collageTop - 8) / COLLAGE_H));
  const translateY = opacity.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={{ flex: 1, backgroundColor: c.bg, opacity, transform: [{ translateY }] }}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: collageTop, left: 0, right: 0, alignItems: 'center' }}
      >
        <View style={{ width: COLLAGE_W, height: COLLAGE_H, transform: [{ scale }], transformOrigin: 'top center' }}>
          <Collage reduceMotion={reduceMotion} />
        </View>
      </View>

      <View
        onLayout={(e: LayoutChangeEvent) => setBlockTop(e.nativeEvent.layout.y)}
        style={{
          position: 'absolute',
          left: 24,
          right: 24,
          bottom: Math.max(insets.bottom + 6, 24),
          alignItems: 'center',
        }}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? 520 : undefined, gap: 28 }}>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="logo" size={14} color={c.onInv} />
              </View>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.54 }}>Nudge</Txt>
            </View>
            <Txt variant="h1" accessibilityRole="header" style={{ fontSize: 36, lineHeight: 40, letterSpacing: -1.08 }}>
              Your business, remembered.
            </Txt>
            <Txt variant="body">Every conversation, commitment and follow-up — kept for you, so nothing slips.</Txt>
          </View>
          <View style={{ gap: 8 }}>
            <OnboardingCta label="Get started" onPress={onStart} />
            <Tap
              onPress={onSignIn}
              accessibilityRole="button"
              accessibilityLabel="I already have an account"
              style={{ height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.btn }}
            >
              <Txt style={{ fontFamily: fonts.medium, fontSize: 15 }} tone="t2">
                I already have an account
              </Txt>
            </Tap>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function Collage({ reduceMotion }: { reduceMotion: boolean }) {
  const { c, shadow } = useTheme();
  const card = {
    backgroundColor: c.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: c.line,
    padding: 16,
    gap: 10,
    boxShadow: shadow.e2,
  };
  return (
    <>
      <Float delay={0} still={reduceMotion} style={{ left: 34, top: 30, width: 260, rotate: '-3deg' }}>
        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name="Priya Mehta" size={30} />
            <Txt variant="s" tone="t1" weight="medium">
              Priya Mehta
            </Txt>
          </View>
          <Txt variant="meta" style={{ lineHeight: 18 }}>
            Prefers calls after 5 pm. Second order is usually 2× the first.
          </Txt>
        </View>
      </Float>

      <Float delay={900} still={reduceMotion} style={{ right: 26, top: 150, width: 250, rotate: '2.5deg' }}>
        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Txt variant="s" tone="t1" weight="medium">
              Send revised quote
            </Txt>
            <Dot tone="warn" />
          </View>
          <Txt variant="meta">Promised to Rahul · due today</Txt>
        </View>
      </Float>

      <Float delay={1800} still={reduceMotion} style={{ left: 44, top: 268, width: 280 }}>
        <AiCard>
          <AiLabel size={12.5}>Remembered</AiLabel>
          <Txt variant="s" tone="t1" style={{ marginTop: -2 }}>
            Aman asked for 50 units by the 28th.
          </Txt>
        </AiCard>
      </Float>
    </>
  );
}

/** Gentle 4pt drift so the memory cards feel alive; still when Reduce Motion is on. */
function Float({
  children,
  delay,
  still,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  still: boolean;
  style: { left?: number; right?: number; top: number; width: number; rotate?: string };
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [delay, still, v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const { rotate = '0deg', ...pos } = style;
  return (
    <Animated.View style={{ position: 'absolute', ...pos, transform: [{ translateY }, { rotate }] }}>{children}</Animated.View>
  );
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduce)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}
