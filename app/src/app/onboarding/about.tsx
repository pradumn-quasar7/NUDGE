import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Input, Screen, Txt } from '@/components';
import { useSession } from '@/data/session';
import { useStore } from '@/data/store';
import { setDraft, useDraft } from '@/features/onboarding/draft';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter } from '@/features/onboarding/Header';

/**
 * About you (cloud mode, before step 1) — the two things Nudge can't learn from conversations:
 * what to call you and your business. Demo mode skips straight to the seeded workspace.
 */
export default function About() {
  const session = useSession();
  const { state, hasWorkspace } = useStore();
  const draft = useDraft(state.org);
  const [name, setName] = useState(draft.ownerName ?? '');
  const [business, setBusiness] = useState(draft.businessName ?? '');
  const [busy, setBusy] = useState(false);

  if (session.mode === 'demo') return <Redirect href="/onboarding/sell" />;
  if (!session.userId) return <Redirect href="/sign-in" />;
  if (hasWorkspace) return <Redirect href="/" />;

  const valid = name.trim().length > 0 && business.trim().length > 0;
  const next = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await session.saveName(name);
    } catch {
      // The name can be fixed later in Team; never block setup on it.
    }
    setDraft({ ownerName: name.trim(), businessName: business.trim() });
    setBusy(false);
    router.push('/onboarding/sell');
  };

  return (
    <Screen
      gap={28}
      fade
      contentStyle={{ paddingTop: 36, paddingBottom: FOOTER_SPACE }}
      footer={
        <OnboardingFooter>
          <OnboardingCta label="Continue" onPress={() => void next()} disabled={!valid} loading={busy} />
        </OnboardingFooter>
      }
    >
      <View style={{ gap: 10 }}>
        <Txt variant="meta" mono>
          Welcome
        </Txt>
        <Txt variant="h1" accessibilityRole="header">
          Let’s set up your business memory
        </Txt>
        <Txt variant="body">Two quick details. Everything else Nudge learns from your conversations.</Txt>
      </View>
      <View style={{ gap: 8 }}>
        <Txt variant="meta">Your name</Txt>
        <Input value={name} onChangeText={setName} placeholder="Your full name" autoComplete="name" textContentType="name" focusTone="ink" autoFocus />
      </View>
      <View style={{ gap: 8 }}>
        <Txt variant="meta">Business name</Txt>
        <Input
          value={business}
          onChangeText={setBusiness}
          placeholder="e.g. Sharma Retail"
          textContentType="organizationName"
          focusTone="ink"
          returnKeyType="next"
          onSubmitEditing={() => void next()}
        />
      </View>
    </Screen>
  );
}
