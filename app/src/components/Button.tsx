import { useEffect } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Tap } from './Pressable';
import { Txt } from './Text';
import { useAnimatedValue } from '@/lib/useAnimatedValue';

/**
 * Buttons — primary actions are ink, not accent; indigo is reserved for anything the AI does.
 * One primary per card. Minimum 44pt tall.
 */
export type ButtonVariant = 'primary' | 'ai' | 'secondary' | 'tonal' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  full,
  flex,
  size = 'md',
  style,
  accessibilityLabel,
}: {
  label?: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /** Pass `null` to hide the spark that AI buttons get by default. */
  icon?: IconName | null;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  flex?: boolean;
  size?: 'md' | 'lg' | 'sm';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.inv, fg: c.onInv },
    ai: { bg: c.acc, fg: c.onAcc },
    secondary: { bg: c.card, fg: c.t1, border: c.line2 },
    tonal: { bg: c.accWash, fg: c.accText },
    ghost: { bg: 'transparent', fg: c.accText },
    danger: { bg: c.badWash, fg: c.bad },
  };
  const p = palette[variant];
  const height = size === 'lg' ? 56 : size === 'sm' ? 36 : 44;
  const iconName: IconName | undefined = icon === null ? undefined : (icon ?? (variant === 'ai' ? 'spark' : undefined));

  return (
    <Tap
      onPress={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      haptic
      style={[
        styles.base,
        {
          height,
          minHeight: 44,
          backgroundColor: p.bg,
          borderColor: p.border ?? 'transparent',
          borderWidth: p.border ? 1 : 0,
          paddingHorizontal: variant === 'ghost' ? 8 : 18,
          opacity: disabled ? (variant === 'primary' || variant === 'ai' ? 0.32 : 0.4) : 1,
          borderRadius: size === 'lg' ? 18 : radius.btn,
        },
        full && { alignSelf: 'stretch' },
        flex && { flex: 1 },
        style,
      ]}
    >
      {loading ? (
        <Spinner color={p.fg} />
      ) : (
        <>
          {iconName && <Icon name={iconName} size={16} color={p.fg} />}
          {label ? (
            <Txt numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: size === 'lg' ? 16 : 15, letterSpacing: -0.08 }} color={p.fg}>
              {label}
            </Txt>
          ) : null}
        </>
      )}
    </Tap>
  );
}

export function Spinner({ color, size = 16 }: { color: string; size?: number }) {
  const spin = useAnimatedValue(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  if (Platform.OS === 'android') return <ActivityIndicator size="small" color={color} />;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="spinner" size={size} color={color} strokeWidth={2.2} />
    </Animated.View>
  );
}

/** 44×44 round icon button (top bars). */
export function IconButton({
  name,
  onPress,
  label,
  color,
  bordered,
  dot,
  size = 44,
  bg,
}: {
  name: IconName;
  onPress?: () => void;
  label: string;
  color?: string;
  bordered?: boolean;
  dot?: boolean;
  size?: number;
  bg?: string;
}) {
  const { c } = useTheme();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.icon,
        { width: size, height: size, borderRadius: bordered ? 14 : size / 2, backgroundColor: bg ?? 'transparent' },
        bordered && { borderWidth: 1, borderColor: c.line2, backgroundColor: bg ?? c.card },
      ]}
    >
      <Icon name={name} size={20} color={color ?? c.t1} />
      {dot && <View style={[styles.dot, { backgroundColor: c.acc, borderColor: c.bg }]} />}
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
});
