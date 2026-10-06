import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, Tap, Txt, useIsTablet } from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

export const ONBOARDING_STEPS = 4;

/**
 * Onboarding top row: back · 4 progress dashes · Skip/Later (02 · Splash, welcome & onboarding).
 * The design pulls the row 8pt into the 20pt gutter, so it sits on a 12pt inset.
 */
export function OnboardingHeader({
  step,
  skipLabel = 'Skip',
  onSkip,
  onBack,
}: {
  step: number;
  skipLabel?: string;
  onSkip?: () => void;
  onBack?: () => void;
}) {
  const { c } = useTheme();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/welcome')));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 44 }}>
      <IconButton name="back" label="Back" onPress={back} />
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step} of ${ONBOARDING_STEPS}`}
        accessibilityValue={{ min: 0, max: ONBOARDING_STEPS, now: step }}
        style={{ flexDirection: 'row', gap: 6, width: 140 }}
      >
        {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? c.inv : c.line2 }} />
        ))}
      </View>
      {onSkip ? (
        <Tap
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
          style={{ height: 44, minWidth: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Txt style={{ fontFamily: fonts.medium, fontSize: 15 }} tone="t2">
            {skipLabel}
          </Txt>
        </Tap>
      ) : (
        <View style={{ width: 44 }} />
      )}
    </View>
  );
}

/** "1 of 4" + title + optional body — the question block at the top of each step. */
export function StepIntro({ step, title, body }: { step: number; title: string; body?: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="meta" mono>
        {step} of {ONBOARDING_STEPS}
      </Txt>
      <Txt variant="h1" accessibilityRole="header">
        {title}
      </Txt>
      {body ? <Txt variant="body">{body}</Txt> : null}
    </View>
  );
}

/** Primary action pinned 40pt above the bottom edge (design `.foot`), over a soft fade. */
export function OnboardingFooter({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const isTablet = useIsTablet();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 20, right: 20, bottom: Math.max(insets.bottom + 6, 24), alignItems: 'center' }}
    >
      <View style={{ width: '100%', maxWidth: isTablet ? 520 : undefined, gap: 8 }}>{children}</View>
    </View>
  );
}

/** Large ink CTA (design `.btn.p.lg.w`: 56pt, radius 18). */
export function OnboardingCta({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Button label={label} onPress={onPress} disabled={disabled} size="lg" full style={{ height: 56, borderRadius: 18 }} />;
}

/** Space reserved under scrolling content so the pinned footer never covers it. */
export const FOOTER_SPACE = 120;
