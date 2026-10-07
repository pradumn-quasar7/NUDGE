import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * A stable Animated.Value for the component's lifetime. React Native ships `useAnimatedValue`, but
 * react-native-web does not, so the app uses this cross-platform equivalent.
 */
export function useAnimatedValue(initial: number) {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}
