import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, type as typeRamp, type Palette, type TypeVariant } from '@/theme/tokens';

export type Tone = 't1' | 't2' | 't3' | 'acc' | 'ok' | 'warn' | 'bad' | 'onInv' | 'onAcc';

const toneKey: Record<Tone, keyof Palette> = {
  t1: 't1',
  t2: 't2',
  t3: 't3',
  acc: 'accText',
  ok: 'ok',
  warn: 'warn',
  bad: 'bad',
  onInv: 'onInv',
  onAcc: 'onAcc',
};

/** Default tone per variant, mirroring the design's .b/.s/.m/.cap classes. */
const defaultTone: Partial<Record<TypeVariant, Tone>> = {
  body: 't2',
  s: 't2',
  meta: 't3',
  cap: 't3',
};

export type TxtProps = TextProps & {
  variant?: TypeVariant;
  tone?: Tone;
  color?: string;
  weight?: 'regular' | 'medium' | 'semibold';
  mono?: boolean;
  center?: boolean;
  strike?: boolean;
};

export function Txt({ variant = 't', tone, color, weight, mono, center, strike, style, ...rest }: TxtProps) {
  const { c } = useTheme();
  const base = typeRamp[variant] as TextStyle;
  const t = tone ?? defaultTone[variant] ?? 't1';
  const family = mono
    ? weight && weight !== 'regular'
      ? fonts.monoMedium
      : fonts.mono
    : weight
      ? fonts[weight]
      : base.fontFamily;
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: color ?? c[toneKey[t]], fontFamily: family },
        center && { textAlign: 'center' },
        strike && { textDecorationLine: 'line-through' },
        style,
      ]}
    />
  );
}

/** Inline mono numerals (₹84,500 · 2.1×) — Geist Mono with tabular figures. */
export function Num({ children, style, weight, ...rest }: TxtProps) {
  return (
    <Txt {...rest} mono weight={weight} style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {children}
    </Txt>
  );
}
