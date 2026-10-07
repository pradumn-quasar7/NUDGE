import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Button, Icon, IconButton, Input, Screen, Txt, webNoOutline } from '@/components';
import { useSession } from '@/data/session';
import { useStore } from '@/data/store';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter } from '@/features/onboarding/Header';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { useNow } from '@/lib/useNow';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Sign in (cloud mode) — email, then the 6-digit code from the email. One screen, two steps.
 * New and returning people use the same flow; the store decides afterwards whether they still
 * need to set up a workspace.
 */
export default function SignIn() {
  const session = useSession();
  const { ready, hasWorkspace } = useStore();
  const { c } = useTheme();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [resentAt, setResentAt] = useState<number | null>(null);
  const codeRef = useRef<TextInput>(null);
  const now = useNow(5_000);

  // Signed in and the workspace (or its absence) is known → continue.
  useEffect(() => {
    if (!session.userId || !ready) return;
    router.replace(hasWorkspace ? '/' : '/onboarding/about');
  }, [session.userId, ready, hasWorkspace]);

  if (session.mode === 'demo') return <Redirect href="/welcome" />;

  const validEmail = EMAIL.test(email.trim());

  const send = async () => {
    if (!validEmail || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await session.sendCode(email);
      setStep('code');
      setResentAt(Date.now());
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await session.verifyCode(email, value);
      // Navigation happens in the effect above once the workspace has loaded.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCode('');
      setBusy(false);
    }
  };

  return (
    <Screen
      gap={28}
      fade
      header={
        <View style={{ paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' }}>
          <IconButton
            name="back"
            label="Back"
            onPress={() => (step === 'code' ? (setStep('email'), setCode(''), setError(undefined)) : router.canGoBack() ? router.back() : router.replace('/welcome'))}
          />
        </View>
      }
      contentStyle={{ paddingTop: 24, paddingBottom: FOOTER_SPACE }}
      footer={
        <OnboardingFooter>
          {step === 'email' ? (
            <OnboardingCta label="Send code" onPress={() => void send()} disabled={!validEmail} loading={busy} />
          ) : (
            <OnboardingCta label="Continue" onPress={() => void verify()} disabled={code.length !== 6} loading={busy} />
          )}
        </OnboardingFooter>
      }
    >
      {step === 'email' ? (
        <>
          <View style={{ gap: 10 }}>
            <Txt variant="h1" accessibilityRole="header">
              Sign in to Nudge
            </Txt>
            <Txt variant="body">We’ll email you a 6-digit code. No password to remember.</Txt>
          </View>
          <View style={{ gap: 8 }}>
            <Txt variant="meta">Work email</Txt>
            <Input
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(undefined);
              }}
              placeholder="you@business.in"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              error={error}
              focusTone="ink"
              autoFocus
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="shieldCheck" size={18} color={c.t3} />
            <Txt variant="meta" style={{ flex: 1, lineHeight: 18 }}>
              Your customers’ conversations stay in your workspace. Nudge never messages anyone without a tap from you.
            </Txt>
          </View>
        </>
      ) : (
        <>
          <View style={{ gap: 10 }}>
            <Txt variant="h1" accessibilityRole="header">
              Check your email
            </Txt>
            <Txt variant="body">
              Enter the 6-digit code we sent to <Txt variant="body" tone="t1" weight="medium">{email.trim().toLowerCase()}</Txt>.
            </Txt>
          </View>
          <View style={{ gap: 8 }}>
            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={(t) => {
                const digits = t.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                setError(undefined);
                if (digits.length === 6) void verify(digits);
              }}
              accessibilityLabel="6-digit code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={c.line2}
              style={[
                {
                  height: 64,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: error ? c.badDot : c.line2,
                  backgroundColor: c.card,
                  color: c.t1,
                  fontFamily: fonts.monoMedium,
                  fontSize: 28,
                  letterSpacing: 12,
                  textAlign: 'center',
                },
                webNoOutline,
              ]}
            />
            {error ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="alert" size={16} color={c.bad} />
                <Txt style={{ fontSize: 13, flex: 1 }} tone="bad">
                  {error}
                </Txt>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt variant="meta">Didn’t get it?</Txt>
            <Button
              variant="ghost"
              label="Send a new code"
              icon={null}
              disabled={busy || (resentAt !== null && now - resentAt < 30_000)}
              onPress={() => void send()}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
