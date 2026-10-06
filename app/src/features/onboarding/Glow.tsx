import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Soft indigo glow used behind the splash and the "You're ready" screen — the CSS
 * `radial-gradient(rx ry at cx cy, accent α, transparent stop)` from the design, drawn with SVG so it
 * renders the same on iOS, Android and web.
 */
export function Glow({
  cx = '50%',
  cy = '42%',
  rx = '120%',
  ry = '60%',
  stop = 0.6,
  alpha = 0.09,
  style,
}: {
  cx?: string;
  cy?: string;
  rx?: string;
  ry?: string;
  stop?: number;
  alpha?: number;
  /** Defaults to filling the parent. */
  style?: StyleProp<ViewStyle>;
}) {
  const { c, scheme } = useTheme();
  // The dark accent is lighter, so it needs a touch more opacity to read the same.
  // Unique per instance: on web every SVG id lives in one document.
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const a = scheme === 'dark' ? alpha * 1.4 : alpha;
  return (
    <View pointerEvents="none" style={style ?? StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx={cx} cy={cy} fx={cx} fy={cy} rx={rx} ry={ry} gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={c.acc} stopOpacity={a} />
            <Stop offset={stop} stopColor={c.acc} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
