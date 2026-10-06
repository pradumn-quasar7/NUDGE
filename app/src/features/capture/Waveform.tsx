import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

/** Bar heights + opacities from board 16 (Voice capture · listening). */
const BARS: [number, number][] = [
  [14, 0.35], [22, 0.45], [40, 0.6], [64, 0.8], [88, 1], [56, 1], [76, 1], [44, 0.85],
  [68, 1], [30, 0.7], [52, 0.8], [24, 0.55], [36, 0.5], [16, 0.4], [10, 0.3],
];

/**
 * Indigo voice waveform. While `active`, every bar breathes on its own rhythm; when idle the bars settle low.
 * Purely decorative — hidden from screen readers.
 */
export function Waveform({ active = true, height = 96, bars = BARS }: { active?: boolean; height?: number; bars?: [number, number][] }) {
  const { c } = useTheme();
  const values = useRef(bars.map(() => new Animated.Value(0.4))).current;

  useEffect(() => {
    const native = Platform.OS !== 'web';
    if (!active) {
      const settle = Animated.parallel(
        values.map((v) => Animated.timing(v, { toValue: 0.18, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: native })),
      );
      settle.start();
      return () => settle.stop();
    }
    const loops = values.map((v, i) => {
      const d = 260 + ((i * 97) % 220);
      const lo = 0.3 + ((i * 37) % 30) / 100;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: d, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
          Animated.timing(v, { toValue: lo, duration: d + 40, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        ]),
      );
    });
    const timers = loops.map((l, i) => setTimeout(() => l.start(), (i * 53) % 300));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [active, values]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height }}
    >
      {bars.map(([h, o], i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            height: Math.min(h, height),
            borderRadius: 2,
            backgroundColor: c.acc,
            opacity: o,
            transform: [{ scaleY: values[i] }],
          }}
        />
      ))}
    </View>
  );
}

/** Three indigo dots pulsing in turn — "Understanding…". */
export function ThinkingDots({ size = 8 }: { size?: number }) {
  const { c } = useTheme();
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.stagger(
        180,
        values.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: native }),
            Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: native }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [values]);
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} accessibilityLabel="Understanding">
      {values.map((v, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.acc, opacity: v }} />
      ))}
    </View>
  );
}
