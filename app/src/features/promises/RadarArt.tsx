import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Icon } from '@/components';
import { commitmentRisk } from '@/data/selectors';
import type { Commitment } from '@/data/types';
import { DAY_MS, nameHash } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { useNow } from '@/lib/useNow';

type Blip = { id: string; x: number; y: number; r: number; fill: string; opacity: number };

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Promise Radar illustration — concentric rings, an indigo sweep and one blip per open promise.
 * Distance from the centre = time until due; warn = at risk / overdue, ok = on track, grey = later.
 */
export function RadarArt({
  attention,
  later,
  size = 104,
  now: nowProp,
}: {
  attention: Commitment[];
  later: Commitment[];
  size?: number;
  now?: number;
}) {
  const tick = useNow();
  const now = nowProp ?? tick;
  const { c, scheme } = useTheme();
  const R = size / 2;
  const blips: Blip[] = [];
  const place = (p: Commitment, frac: number, fill: string, d: number, opacity = 1) => {
    const a = ((nameHash(p.id) % 360) * Math.PI) / 180;
    const dist = clamp(frac, 0.12, 0.82) * (R - d / 2 - 3);
    blips.push({ id: p.id, x: R + Math.cos(a) * dist, y: R + Math.sin(a) * dist, r: d / 2, fill, opacity });
  };
  attention.slice(0, 6).forEach((p, i) => {
    const risk = commitmentRisk(p, now);
    const warn = risk === 'at_risk' || risk === 'overdue';
    const frac = 0.18 + 0.3 * clamp((p.dueAt - now) / (2 * DAY_MS));
    place(p, frac, warn ? c.warnDot : c.okDot, warn ? (i === 0 ? 12 : 10) : 9);
  });
  later.slice(0, 6).forEach((p) => {
    place(p, 0.6 + 0.3 * clamp((p.dueAt - now) / (7 * DAY_MS)), c.t3, 7, 0.6);
  });

  // Sweep wedge: from 300° to ~380° (clockwise from 12 o'clock), fading out.
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${R + Math.cos(rad) * (R - 0.5)} ${R + Math.sin(rad) * (R - 0.5)}`;
  };
  const wedge = `M ${R} ${R} L ${pt(300)} A ${R - 0.5} ${R - 0.5} 0 0 1 ${pt(380)} Z`;
  const total = attention.length + later.length;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Radar: ${attention.length} need attention, ${later.length} later`}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0.3">
            <Stop offset="0" stopColor={c.acc} stopOpacity={scheme === 'dark' ? 0.28 : 0.16} />
            <Stop offset="1" stopColor={c.acc} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Circle cx={R} cy={R} r={R - 0.5} fill={scheme === 'dark' ? c.card : 'transparent'} />
        {total > 0 && <Path d={wedge} fill="url(#sweep)" />}
        {[0, size * 0.173, size * 0.346].map((inset) => (
          <Circle key={inset} cx={R} cy={R} r={R - 0.5 - inset} stroke={c.line2} strokeWidth={1} fill="none" />
        ))}
        {blips.map((b) => (
          <Circle key={`${b.id}-halo`} cx={b.x} cy={b.y} r={b.r + 3} fill={c.card} opacity={b.opacity === 1 ? 1 : 0.8} />
        ))}
        {blips.map((b) => (
          <Circle key={b.id} cx={b.x} cy={b.y} r={b.r} fill={b.fill} opacity={b.opacity} />
        ))}
      </Svg>
    </View>
  );
}

/** E2 art — calm rings with a green check in the centre. */
export function RadarClearArt({ size = 150 }: { size?: number }) {
  const { c } = useTheme();
  const R = size / 2;
  const core = size * 0.107; // 16 of 150
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {[0, size * 0.173, size * 0.346].map((inset) => (
          <Circle key={inset} cx={R} cy={R} r={R - 0.5 - inset} stroke={c.line2} strokeWidth={1} fill="none" />
        ))}
        <Circle cx={R} cy={R} r={core + 10} fill={c.okWash} />
        <Circle cx={R} cy={R} r={core} fill={c.okDot} />
      </Svg>
      <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={16} color="#FFFFFF" strokeWidth={2.6} />
      </View>
    </View>
  );
}
