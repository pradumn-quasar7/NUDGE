import { View } from 'react-native';
import { router } from 'expo-router';
import { Icon, Screen, Tap, Txt, type IconName } from '@/components';
import { useStore } from '@/data/store';
import type { Channel } from '@/data/types';
import { setDraft, toggle, useDraft } from '@/features/onboarding/draft';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter, OnboardingHeader, StepIntro } from '@/features/onboarding/Header';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

/** "Something else" is stored as `manual` — Nudge still remembers what you log by hand. */
const OPTIONS: { channel: Channel; label: string; icon: IconName }[] = [
  { channel: 'whatsapp', label: 'WhatsApp', icon: 'message' },
  { channel: 'phone', label: 'Phone', icon: 'phone' },
  { channel: 'email', label: 'Email', icon: 'mail' },
  { channel: 'instagram', label: 'Instagram', icon: 'instagram' },
  { channel: 'manual', label: 'Something else', icon: 'plus' },
];

/** 04 · Business setup — how customers contact you. */
export default function Channels() {
  const { state } = useStore();
  const draft = useDraft(state.org);

  return (
    <Screen
      gap={28}
      fade
      header={<OnboardingHeader step={2} onSkip={() => router.push('/onboarding/connect')} />}
      contentStyle={{ paddingTop: 24, paddingBottom: FOOTER_SPACE }}
      footer={
        <OnboardingFooter>
          <OnboardingCta label="Continue" onPress={() => router.push('/onboarding/connect')} disabled={draft.channels.length === 0} />
        </OnboardingFooter>
      }
    >
      <StepIntro step={2} title="How do customers usually contact you?" body="Pick all that apply." />

      <View style={{ gap: 10 }} accessibilityRole="list" accessibilityLabel="Contact channels">
        {OPTIONS.map((o) => (
          <Option
            key={o.channel}
            {...o}
            on={draft.channels.includes(o.channel)}
            onPress={() => setDraft({ channels: toggle(draft.channels, o.channel) })}
          />
        ))}
      </View>
    </Screen>
  );
}

function Option({ label, icon, on, onPress }: { label: string; icon: IconName; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Tap
      onPress={onPress}
      haptic
      scale={0.985}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 64,
        paddingHorizontal: 16,
        borderRadius: 18,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: on ? c.inv : c.line,
        boxShadow: on ? `0 0 0 1px ${c.inv}` : undefined,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={c.t1} />
      </View>
      <Txt style={{ flex: 1, fontFamily: fonts.medium }}>{label}</Txt>
      <CheckDot on={on} />
    </Tap>
  );
}

/** Round multi-select check: empty ring → ink fill with a check. */
function CheckDot({ on }: { on: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: on ? c.inv : c.line2,
        backgroundColor: on ? c.inv : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <Icon name="check" size={14} color={c.onInv} strokeWidth={2.4} />}
    </View>
  );
}
