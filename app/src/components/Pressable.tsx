import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { motion } from '@/theme/tokens';

/** Tap feedback: 120ms ease-out, scale .97 (Design system · Motion). */
export function Tap({
  style,
  children,
  scale = 0.97,
  haptic = false,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  scale?: number;
  haptic?: boolean;
}) {
  const v = useRef(new Animated.Value(1)).current;
  // Layout keys belong on the outer Pressable so `flex`, `alignSelf` and absolute positioning work as expected.
  const flat = StyleSheet.flatten(style) ?? {};
  const { flex, flexGrow, flexShrink, flexBasis, alignSelf, position, top, left, right, bottom, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, zIndex, ...inner } = flat;
  const outer: ViewStyle = { flex, flexGrow, flexShrink, flexBasis, alignSelf, position, top, left, right, bottom, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, zIndex };
  const fill = flex != null || alignSelf === 'stretch';
  const to = (val: number) =>
    Animated.timing(v, { toValue: val, duration: motion.tap, useNativeDriver: Platform.OS !== 'web' }).start();
  return (
    <Pressable
      {...rest}
      style={outer}
      onPressIn={(e) => {
        to(scale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
    >
      <Animated.View style={[inner, fill && { flexGrow: 1 }, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
