import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme/ThemeProvider';
import { avatarTints, fonts, motion, radius } from '@/theme/tokens';
import { initials, nameHash } from '@/lib/format';
import { Icon, type IconName } from './Icon';
import { Tap } from './Pressable';
import { Txt } from './Text';
import { useAnimatedValue } from '@/lib/useAnimatedValue';

/* ───────────── Avatar — initials on six muted tints, assigned by name hash ───────────── */

export function Avatar({ name, size = 40, ring }: { name: string; size?: number; ring?: boolean }) {
  const { scheme, c } = useTheme();
  const tint = avatarTints[scheme][nameHash(name) % 6];
  const fontSize = size <= 28 ? 11 : size <= 32 ? 12 : size <= 44 ? 14 : Math.round(size * 0.35);
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint.bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: c.card,
      }}
    >
      <Txt style={{ fontFamily: fonts.semibold, fontSize, letterSpacing: -0.14 }} color={tint.fg}>
        {initials(name)}
      </Txt>
    </View>
  );
}

export function AvatarStack({ names, size = 32, max = 3 }: { names: string[]; size?: number; max?: number }) {
  const { c } = useTheme();
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <View style={{ flexDirection: 'row' }}>
      {shown.map((n, i) => (
        <View key={n} style={{ marginLeft: i ? -8 : 0 }}>
          <Avatar name={n} size={size} ring />
        </View>
      ))}
      {rest > 0 && (
        <View
          style={{
            marginLeft: -8,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: c.bg2,
            borderWidth: 2,
            borderColor: c.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt style={{ fontSize: 11, fontFamily: fonts.semibold }} tone="t2">
            +{rest}
          </Txt>
        </View>
      )}
    </View>
  );
}

/* ───────────── Status badge — always dot + word, never colour alone ───────────── */

export type StatusTone = 'ok' | 'warn' | 'bad' | 'acc' | 'neutral';

export function Badge({
  tone = 'neutral',
  label,
  dot = tone !== 'neutral' && tone !== 'acc',
  icon,
  mono,
}: {
  tone?: StatusTone;
  label: string;
  dot?: boolean;
  icon?: IconName;
  mono?: boolean;
}) {
  const { c } = useTheme();
  const map = {
    ok: { bg: c.okWash, fg: c.ok, d: c.okDot },
    warn: { bg: c.warnWash, fg: c.warn, d: c.warnDot },
    bad: { bg: c.badWash, fg: c.bad, d: c.badDot },
    acc: { bg: c.accWash, fg: c.accText, d: c.acc },
    neutral: { bg: c.bg2, fg: c.t2, d: c.t3 },
  }[tone];
  // The row wrapper keeps the pill content-sized in columns while still centring vertically in rows.
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={[styles.badge, { backgroundColor: map.bg }]}>
        {dot && <View style={[styles.dot, { backgroundColor: map.d }]} />}
        {icon && <Icon name={icon} size={12} color={map.fg} strokeWidth={2.2} />}
        <Txt mono={mono} style={{ fontFamily: mono ? fonts.monoMedium : fonts.medium, fontSize: 12 }} color={map.fg}>
          {label}
        </Txt>
      </View>
    </View>
  );
}

export function Dot({ tone, size = 7 }: { tone: StatusTone; size?: number }) {
  const { c } = useTheme();
  const color = { ok: c.okDot, warn: c.warnDot, bad: c.badDot, acc: c.acc, neutral: c.t3 }[tone];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Status line — "● 3 things need your attention". */
export function StatusLine({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Dot tone={tone} />
      <Txt variant="s" tone="t1" style={{ fontSize: 14 }}>
        {children}
      </Txt>
    </View>
  );
}

/* ───────────── Chips & segmented ───────────── */

export function Chip({
  label,
  count,
  on,
  ai,
  onPress,
  small,
}: {
  label: string;
  count?: number;
  on?: boolean;
  ai?: boolean;
  onPress?: () => void;
  small?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[
        styles.chip,
        { height: small ? 36 : 44, paddingHorizontal: small ? 12 : 16 },
        on
          ? { backgroundColor: c.inv, borderColor: 'transparent' }
          : { backgroundColor: c.card, borderColor: c.line2 },
      ]}
    >
      {ai && <Icon name="spark" size={16} color={c.accText} />}
      <Txt style={{ fontSize: small ? 13.5 : 14.5 }} color={on ? c.onInv : c.t1}>
        {label}
      </Txt>
      {count != null && (
        <Txt style={{ fontSize: 14 }} color={on ? c.onInv : c.t3}>
          {count}
        </Txt>
      )}
    </Tap>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.seg, { backgroundColor: c.bg2 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tap
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            scale={1}
            style={[
              styles.segBtn,
              on && { backgroundColor: c.card, boxShadow: '0 1px 3px rgba(20,20,28,0.08)' },
            ]}
          >
            <Txt style={{ fontSize: 14, fontFamily: fonts.medium }} color={on ? c.t1 : c.t2}>
              {o.label}
            </Txt>
          </Tap>
        );
      })}
    </View>
  );
}

/* ───────────── Surfaces ───────────── */

export function Card({
  children,
  style,
  padding = 18,
  onPress,
  elevated,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  onPress?: () => void;
  elevated?: boolean;
}) {
  const { c, shadow } = useTheme();
  const s: StyleProp<ViewStyle> = [
    {
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
      padding,
      boxShadow: elevated ? shadow.e2 : shadow.e1,
    },
    style,
  ];
  return onPress ? (
    <Tap onPress={onPress} scale={0.985} style={s}>
      {children}
    </Tap>
  ) : (
    <View style={s}>{children}</View>
  );
}

/**
 * Glass — reserved for tab bar, copilot, bottom sheets, quick actions, overlays and toasts.
 * Native iOS uses a real blur; web uses backdrop-filter; Android falls back to a near-solid surface.
 */
export function Glass({
  children,
  style,
  intensity = 40,
  bg,
  border,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  bg?: string;
  border?: string;
}) {
  const { c, scheme } = useTheme();
  const flat = StyleSheet.flatten(style) ?? {};
  const fill = bg ?? c.glass;
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          { backgroundColor: fill, borderWidth: 1, borderColor: border ?? c.glassBorder },
          // @ts-expect-error web-only style
          { backdropFilter: 'blur(24px) saturate(170%)', WebkitBackdropFilter: 'blur(24px) saturate(170%)' },
          style,
        ]}
      >
        {children}
      </View>
    );
  }
  if (Platform.OS === 'android') {
    return (
      <View style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: border ?? c.line }, style]}>{children}</View>
    );
  }
  return (
    <View style={[{ overflow: 'hidden', borderWidth: 1, borderColor: border ?? c.glassBorder }, style]}>
      <BlurView
        intensity={intensity}
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={[StyleSheet.absoluteFill, { borderRadius: flat.borderRadius }]}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
    </View>
  );
}

/** AI surface — the indigo wash and the spark. */
export function AiCard({ children, style, padding = 18 }: { children: ReactNode; style?: StyleProp<ViewStyle>; padding?: number }) {
  const { c, shadow, scheme } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius.aiCard,
          borderWidth: 1,
          borderColor: c.aiBorder,
          backgroundColor: scheme === 'dark' ? c.card : 'rgba(255,255,255,0.72)',
          boxShadow: shadow.e2,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <LinearGradient
        colors={[c.accWash2, c.accWash, 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 0.8]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ padding, gap: 10 }}>{children}</View>
    </View>
  );
}

export function AiLabel({ children, size = 13 }: { children: ReactNode; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="spark" size={16} color={c.accText} />
      <Txt style={{ fontSize: size, fontFamily: fonts.semibold }} color={c.accText}>
        {children}
      </Txt>
    </View>
  );
}

/** The customer's own words, kept as proof. */
export function Quote({ children, by }: { children: ReactNode; by?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.bg2, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Txt variant="s">
        {children}
        {by ? <Txt variant="meta"> {by}</Txt> : null}
      </Txt>
    </View>
  );
}

export function Sep({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line, marginLeft: inset }} />;
}

export function SectionLabel({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, style]}>
      <Txt variant="cap">{children}</Txt>
      {right}
    </View>
  );
}

/* ───────────── Inputs ───────────── */

export function Input({
  error,
  icon,
  style,
  onFocus,
  onBlur,
  focusTone = 'acc',
  ...props
}: TextInputProps & { error?: string; icon?: IconName; focusTone?: 'acc' | 'ink' }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <View
        style={[
          styles.input,
          { backgroundColor: c.card, borderColor: error ? c.badDot : focus ? (focusTone === 'ink' ? c.t1 : c.acc) : c.line2 },
          focus && !error && { boxShadow: `0 0 0 4px ${focusTone === 'ink' ? c.line : c.accWash2}` },
          props.multiline && { height: undefined, minHeight: 104, alignItems: 'flex-start', paddingVertical: 14 },
        ]}
      >
        {icon && <Icon name={icon} size={20} color={c.t3} />}
        <TextInput
          {...props}
          onFocus={(e) => {
            setFocus(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            onBlur?.(e);
          }}
          placeholderTextColor={c.t3}
          style={[{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: c.t1, height: props.multiline ? undefined : '100%', minHeight: props.multiline ? 76 : undefined, textAlignVertical: props.multiline ? 'top' : 'center' }, webNoOutline, style]}
        />
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="alert" size={16} color={c.bad} />
          <Txt style={{ fontSize: 13 }} tone="bad">
            {error}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

export const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {};

/* ───────────── Lists & settings ───────────── */

export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, shadow } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, boxShadow: shadow.e1 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  valueTone,
  onPress,
  last,
  right,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: StatusTone;
  onPress?: () => void;
  last?: boolean;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <>
      <Tap onPress={onPress} scale={onPress ? 0.99 : 1} disabled={!onPress} style={styles.srow}>
        {icon && (
          <View style={[styles.sicon, { backgroundColor: c.bg2 }]}>
            <Icon name={icon} size={18} color={c.t2} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontSize: 15.5 }}>{title}</Txt>
          {subtitle ? <Txt variant="meta">{subtitle}</Txt> : null}
        </View>
        {value ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {valueTone && <Dot tone={valueTone} />}
            <Txt variant="s" tone="t3">
              {value}
            </Txt>
          </View>
        ) : null}
        {right}
        {onPress && !right ? <Icon name="chevron" size={16} color={c.t3} /> : null}
      </Tap>
      {!last && <Sep inset={icon ? 48 : 0} />}
    </>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c } = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      trackColor={{ false: c.bg2, true: c.inv }}
      thumbColor={Platform.OS === 'android' ? c.card : undefined}
      ios_backgroundColor={c.bg2}
      {...(Platform.OS === 'web' ? ({ activeThumbColor: c.card } as object) : {})}
    />
  );
}

/* ───────────── Timeline ───────────── */

export function TimelineGlyph({ icon, tone }: { icon: IconName; tone?: 'ok' | 'warn' | 'acc' }) {
  const { c } = useTheme();
  const map = {
    ok: { bg: c.okWash, fg: c.ok },
    warn: { bg: c.warnWash, fg: c.warn },
    acc: { bg: c.accWash, fg: c.accText },
  };
  const t = tone ? map[tone] : { bg: c.bg, fg: c.t2 };
  return (
    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', borderWidth: tone ? 0 : 1, borderColor: c.line2 }}>
      <Icon name={icon} size={16} color={t.fg} />
    </View>
  );
}

/* ───────────── Skeleton — mirrors the real layout, shimmers every 1.4s ───────────── */

export function Skeleton({ w = '100%', h = 12, r = 8, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const o = useAnimatedValue(0.6);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: motion.skeleton / 2, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(o, { toValue: 0.6, duration: motion.skeleton / 2, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.bg2, opacity: o }, style]} />;
}

/** Spark pulse — AI processing, 1.6s loop. */
export function SparkPulse({ size = 22 }: { size?: number }) {
  const { c } = useTheme();
  const o = useAnimatedValue(1);
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
    <Animated.View style={{ opacity: o }}>
      <Icon name="spark" size={size} color={c.accText} />
    </Animated.View>
  );
}

/** Round success check (promise completed, understood). */
export function CheckCircle({ size = 24 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.okDot, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="check" size={size * 0.58} color="#FFFFFF" strokeWidth={2.4} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 9, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, borderWidth: 1 },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 2 },
  segBtn: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  input: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16 },
  srow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingVertical: 10 },
  sicon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
