import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { useStore } from '@/data/store';
import { Icon, type IconName } from './Icon';
import { Glass } from './primitives';
import { Tap } from './Pressable';
import { Txt } from './Text';

export const TABS: { key: string; route: string; label: string; icon: IconName }[] = [
  { key: 'index', route: '/', label: 'Home', icon: 'home' },
  { key: 'customers', route: '/customers', label: 'Customers', icon: 'customers' },
  { key: 'inbox', route: '/inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'insights', route: '/insights', label: 'Insights', icon: 'insights' },
  { key: 'more', route: '/more', label: 'More', icon: 'more' },
];

function useInboxDot() {
  const { state } = useStore();
  return state.inbox.some((i) => i.bucket === 'needs_reply');
}

/**
 * Floating glass bar: five destinations plus the universal capture button.
 * Inbox dot = needs reply. (Component · Tab bar)
 */
export function FloatingTabBar({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const dot = useInboxDot();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom - 6, 16), alignItems: 'center' }}
    >
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, width: '100%', maxWidth: 520 }}>
        <Glass
          bg={c.tabGlass}
          border={c.tabEdge}
          style={{ flex: 1, height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 6, boxShadow: shadow.tab }}
        >
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <Tap
                key={t.key}
                onPress={() => onSelect(t.key)}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: on }}
                style={{ minWidth: 52, height: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}
              >
                <View>
                  <Icon name={t.icon} size={22} color={on ? c.accText : c.tabOff} />
                  {t.key === 'inbox' && dot && (
                    <View style={{ position: 'absolute', top: -2, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: c.acc, borderWidth: 1.5, borderColor: c.card }} />
                  )}
                </View>
                <Txt style={{ fontSize: 10.5, lineHeight: 12, fontFamily: on ? fonts.semibold : fonts.medium }} color={on ? c.accText : c.tabOff}>
                  {t.label}
                </Txt>
              </Tap>
            );
          })}
        </Glass>
        <CaptureFab />
      </View>
    </View>
  );
}

export function CaptureFab({ size = 64 }: { size?: number }) {
  const { c, shadow } = useTheme();
  return (
    <Tap
      haptic
      onPress={() => router.push('/capture')}
      accessibilityRole="button"
      accessibilityLabel="Capture"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.fab }}
    >
      <Icon name="plus" size={26} color={c.onInv} strokeWidth={2} />
    </Tap>
  );
}

/** Tablet: the tab bar becomes a slim rail. */
export function Rail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const dot = useInboxDot();
  return (
    <View style={{ width: 88, borderRightWidth: 1, borderRightColor: c.line, backgroundColor: c.bg, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
        <Icon name="logo" size={22} color={c.onInv} />
      </View>
      <View style={{ gap: 10, flex: 1 }}>
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <Tap
              key={t.key}
              onPress={() => onSelect(t.key)}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}
              style={{ width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.card : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.line }}
            >
              <Icon name={t.icon} size={22} color={on ? c.accText : c.tabOff} />
              {t.key === 'inbox' && dot && (
                <View style={{ position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: c.acc }} />
              )}
            </Tap>
          );
        })}
      </View>
      <CaptureFab size={56} />
    </View>
  );
}
