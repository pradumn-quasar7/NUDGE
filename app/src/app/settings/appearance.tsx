import { View } from 'react-native';
import { Group, LargeTitle, Screen, TopBar, Txt } from '@/components';
import { useTheme, type AppearancePref } from '@/theme/ThemeProvider';
import { RadioRow } from '@/features/settings/ui';

const OPTIONS: { value: AppearancePref; title: string; subtitle: string }[] = [
  { value: 'system', title: 'System', subtitle: 'Match your phone’s light or dark setting' },
  { value: 'light', title: 'Light', subtitle: 'Warm paper, ink actions' },
  { value: 'dark', title: 'Dark', subtitle: 'Easier on the eyes at night' },
];

export default function Appearance() {
  const { pref, setPref } = useTheme();
  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">How Nudge looks on this device.</Txt>}>Appearance</LargeTitle>
      <View accessibilityRole="radiogroup">
        <Group>
          {OPTIONS.map((o, i) => (
            <RadioRow
              key={o.value}
              title={o.title}
              subtitle={o.subtitle}
              selected={pref === o.value}
              onPress={() => setPref(o.value)}
              last={i === OPTIONS.length - 1}
            />
          ))}
        </Group>
      </View>
    </Screen>
  );
}
