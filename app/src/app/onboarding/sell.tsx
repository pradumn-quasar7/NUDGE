import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AiLabel, Chip, Screen, Txt, webNoOutline } from '@/components';
import { useStore } from '@/data/store';
import { setDraft, toggle, useDraft } from '@/features/onboarding/draft';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter, OnboardingHeader, StepIntro } from '@/features/onboarding/Header';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

/** AI suggestions under the answer — "Sounds like you also handle". */
const SUGGESTIONS = ['Custom orders', 'Installation', 'Bulk quotes', 'Repairs'];

/** 03 · Onboarding — what you sell. */
export default function Sell() {
  const { state } = useStore();
  const { c } = useTheme();
  const draft = useDraft(state.org);
  const [focus, setFocus] = useState(false);
  const next = () => {
    setDraft({ sells: draft.sells.trim() });
    router.push('/onboarding/channels');
  };

  return (
    <Screen
      gap={32}
      fade
      header={<OnboardingHeader step={1} onSkip={() => router.push('/onboarding/channels')} />}
      contentStyle={{ paddingTop: 24, paddingBottom: FOOTER_SPACE }}
      footer={
        <OnboardingFooter>
          <OnboardingCta label="Continue" onPress={next} disabled={!draft.sells.trim()} />
        </OnboardingFooter>
      }
    >
      <StepIntro
        step={1}
        title="What do you sell?"
        body="A few words is enough. Nudge uses this to recognise orders, quotes and requirements in your chats."
      />

      <View style={{ gap: 8 }}>
        <Txt variant="meta" nativeID="sell-label">
          Your products or services
        </Txt>
        <View
          style={{
            height: 56,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: focus ? c.inv : c.line2,
            backgroundColor: c.card,
            paddingHorizontal: 16,
            justifyContent: 'center',
            boxShadow: focus ? `0 0 0 4px ${c.line}` : undefined,
          }}
        >
          <TextInput
            value={draft.sells}
            onChangeText={(sells) => setDraft({ sells })}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            placeholder="e.g. Furniture, catering, salon services"
            placeholderTextColor={c.t3}
            accessibilityLabel="Your products or services"
            aria-labelledby="sell-label"
            returnKeyType="next"
            onSubmitEditing={() => draft.sells.trim() && next()}
            cursorColor={c.t1}
            selectionColor={c.acc}
            style={[{ fontFamily: fonts.regular, fontSize: 17, color: c.t1, height: '100%' }, webNoOutline]}
          />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <AiLabel>Sounds like you also handle</AiLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="list">
          {SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} on={draft.handles.includes(s)} onPress={() => setDraft({ handles: toggle(draft.handles, s) })} />
          ))}
        </View>
      </View>
    </Screen>
  );
}
