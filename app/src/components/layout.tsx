import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, gutter, motion } from '@/theme/tokens';
import { IconButton } from './Button';
import { Icon } from './Icon';
import { Glass, CheckCircle } from './primitives';
import { Tap } from './Pressable';
import { Txt } from './Text';
import { useAnimatedValue } from '@/lib/useAnimatedValue';

export const TAB_BAR_SPACE = 140;
export const TABLET_MIN_WIDTH = 768;

export function useIsTablet() {
  const { width } = useWindowDimensions();
  return width >= TABLET_MIN_WIDTH;
}

/* ───────────── Screen ───────────── */

/**
 * Standard scrolling screen: 20pt gutter, 24pt section gap, room for the floating tab bar / ask bar,
 * and a soft fade where content scrolls under floating glass.
 */
export function Screen({
  children,
  header,
  footer,
  tabBar = false,
  askBar = false,
  gap = 24,
  scroll = true,
  contentStyle,
  scrollProps,
  fade,
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  tabBar?: boolean;
  askBar?: boolean;
  gap?: number;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scrollProps?: ScrollViewProps;
  fade?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const isTablet = useIsTablet();
  const bottomSpace = (tabBar && !isTablet ? TAB_BAR_SPACE - 20 : 24) + (askBar ? 64 : 0) + insets.bottom;
  // Tablet: single-column screens stay a readable width instead of stretching edge to edge.
  const column: ViewStyle | undefined = isTablet ? { maxWidth: 760, width: '100%', alignSelf: 'center' } : undefined;
  const body = (
    <View style={[{ paddingHorizontal: gutter, gap, paddingBottom: bottomSpace }, column, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[{ paddingTop: insets.top + 6 }, column]}>{header}</View>
      {scroll ? (
        <ScrollView
          {...scrollProps}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: header ? 8 : 18 }}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: header ? 8 : 18 }}>{body}</View>
      )}
      {(fade ?? (tabBar || askBar)) && (
        <LinearGradient
          pointerEvents="none"
          colors={[c.bg + '00', c.bg]}
          locations={[0, 0.78]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: (tabBar && !isTablet ? 200 : 120) + insets.bottom }}
        />
      )}
      {footer}
    </View>
  );
}

/* ───────────── Top bar ───────────── */

export function TopBar({
  back = true,
  title,
  subtitle,
  left,
  right,
  center,
  onBack,
}: {
  back?: boolean;
  title?: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  center?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.top}>
      <View style={styles.topSide}>
        {back ? (
          <IconButton
            name="back"
            label="Back"
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          />
        ) : null}
        {left}
      </View>
      <View style={styles.topCenter} pointerEvents="box-none">
        {center ??
          (title ? (
            <View style={{ alignItems: 'center' }}>
              <Txt variant="t" weight="medium" style={{ fontSize: 16 }} numberOfLines={1}>
                {title}
              </Txt>
              {subtitle ? <Txt variant="meta">{subtitle}</Txt> : null}
            </View>
          ) : null)}
      </View>
      <View style={[styles.topSide, { justifyContent: 'flex-end' }]}>{right}</View>
    </View>
  );
}

/** Large screen title (Customers, Inbox, More…) with optional right accessory. */
export function LargeTitle({ children, right, sub }: { children: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Txt variant="h1" accessibilityRole="header">
          {children}
        </Txt>
        {right}
      </View>
      {sub}
    </View>
  );
}

/* ───────────── Ask bar ───────────── */

export function AskBar({
  placeholder = 'Ask about your business…',
  customerId,
  bottom,
  inline,
}: {
  placeholder?: string;
  customerId?: string;
  bottom?: number;
  inline?: boolean;
}) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const open = (voice?: boolean) =>
    customerId
      ? router.push({ pathname: '/customer/[id]/ask', params: { id: customerId } })
      : voice
        ? router.push('/voice')
        : router.push('/copilot');
  return (
    <View
      style={
        inline
          ? undefined
          : { position: 'absolute', left: 16, right: 16, bottom: (bottom ?? 24) + insets.bottom, alignItems: 'center' }
      }
      pointerEvents="box-none"
    >
      <Glass style={[styles.ask, { boxShadow: shadow.e2, maxWidth: 760, width: '100%' }]}>
        <Pressable
          onPress={() => open()}
          accessibilityRole="search"
          accessibilityLabel={placeholder}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: '100%' }}
        >
          <Icon name="spark" size={20} color={c.accText} />
          <Txt style={{ fontSize: 15.5 }} tone="t3">
            {placeholder}
          </Txt>
        </Pressable>
        <IconButton name="mic" label="Ask by voice" onPress={() => open(true)} size={40} />
      </Glass>
    </View>
  );
}

/* ───────────── Bottom sheet (glass) ───────────── */

/**
 * Glass sheet used by transparent-modal routes. Scrim tap dismisses. Spring per spec
 * (response .42, damping .88) approximated with a decelerating timing curve.
 */
export function Sheet({
  children,
  onClose,
  full,
  solid,
  style,
  scrimOpacity = 1,
}: {
  children: ReactNode;
  onClose?: () => void;
  full?: boolean;
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
  scrimOpacity?: number;
}) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const y = useAnimatedValue(height);
  const o = useAnimatedValue(0);
  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: height, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(o, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }),
    ]).start(() => (onClose ? onClose() : router.canGoBack() ? router.back() : router.replace('/')));
  }, [height, o, onClose, y]);
  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(o, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, [o, y]);
  const isTablet = useIsTablet();
  const panel: StyleProp<ViewStyle> = [
    styles.sheet,
    {
      paddingBottom: 26 + Math.max(insets.bottom - 8, 0),
      boxShadow: shadow.e3,
      maxWidth: isTablet ? 560 : undefined,
      alignSelf: isTablet ? 'center' : undefined,
      width: isTablet ? '100%' : undefined,
    },
    full && { top: insets.top + 24 },
    style,
  ];
  return (
    <SheetContext.Provider value={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim, opacity: Animated.multiply(o, scrimOpacity) }]}>
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={{ position: 'absolute', left: 8, right: 8, bottom: 8, top: full ? insets.top + 24 : undefined, transform: [{ translateY: y }] }}
        >
          {solid ? (
            <View style={[panel, { backgroundColor: c.card, flex: full ? 1 : undefined }]}>
              <Grab />
              {children}
            </View>
          ) : (
            <Glass style={[panel, { flex: full ? 1 : undefined }]} bg={c.glass}>
              <Grab />
              {children}
            </Glass>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </SheetContext.Provider>
  );
}

const SheetContext = createContext<() => void>(() => router.back());
/** Close the enclosing sheet with its exit animation. */
export const useSheetClose = () => useContext(SheetContext);

function Grab() {
  const { c } = useTheme();
  return <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.line2, alignSelf: 'center' }} />;
}

/* ───────────── Toasts ───────────── */

type ToastSpec = { text: string; icon?: 'check' | 'spark' | 'error'; action?: { label: string; onPress: () => void } };
const ToastContext = createContext<(t: ToastSpec) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const o = useAnimatedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const show = useCallback(
    (t: ToastSpec) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(t);
      Animated.timing(o, { toValue: 1, duration: motion.nav, useNativeDriver: Platform.OS !== 'web' }).start();
      timer.current = setTimeout(() => {
        Animated.timing(o, { toValue: 0, duration: motion.nav, useNativeDriver: Platform.OS !== 'web' }).start(() => setToast(null));
      }, t.action ? 6000 : 4000);
    },
    [o],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            top: insets.top + 8,
            alignItems: 'center',
            opacity: o,
            transform: [{ translateY: o.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
          }}
        >
          <Glass style={[styles.toast, { boxShadow: shadow.e2 }]}>
            {toast.icon === 'check' && <CheckCircle />}
            {toast.icon === 'spark' && <Icon name="spark" size={20} color={c.accText} />}
            {toast.icon === 'error' && <Icon name="cloudOff" size={20} color={c.bad} />}
            <Txt style={{ flex: 1, fontSize: 15 }} accessibilityLiveRegion="polite">
              {toast.text}
            </Txt>
            {toast.action && (
              <Tap
                onPress={() => {
                  toast.action!.onPress();
                  Animated.timing(o, { toValue: 0, duration: 150, useNativeDriver: Platform.OS !== 'web' }).start(() => setToast(null));
                }}
                style={{ height: 44, paddingHorizontal: 10, justifyContent: 'center' }}
              >
                <Txt style={{ fontFamily: fonts.medium }} tone="acc">
                  {toast.action.label}
                </Txt>
              </Tap>
            )}
          </Glass>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

/* ───────────── Centered empty state ───────────── */

export function EmptyState({ art, title, body, children }: { art?: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 12 }}>
      {art}
      <Txt variant="h2" center style={{ marginTop: 12 }}>
        {title}
      </Txt>
      <Txt variant="body" center>
        {body}
      </Txt>
      {children ? <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 10 },
  topSide: { flexDirection: 'row', alignItems: 'center', minWidth: 88, flexShrink: 0 },
  topCenter: { flex: 1, alignItems: 'center' },
  ask: { height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 },
  sheet: { borderRadius: 44, paddingTop: 10, paddingHorizontal: 20, gap: 16 },
  toast: { borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 10, minHeight: 52, maxWidth: 520, width: '100%' },
});
