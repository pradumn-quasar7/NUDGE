import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Button, Card, Icon, Screen, Sep, Txt, useToast, type IconName } from '@/components';
import { useStore } from '@/data/store';
import type { Integration } from '@/data/types';
import { FOOTER_SPACE, OnboardingCta, OnboardingFooter, OnboardingHeader, StepIntro } from '@/features/onboarding/Header';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

type Kind = Extract<Integration['kind'], 'whatsapp' | 'gmail' | 'calls' | 'calendar'>;

const ROWS: { kind: Kind; title: string; detail: string; icon: IconName }[] = [
  { kind: 'whatsapp', title: 'WhatsApp Business', detail: 'Chats, voice notes and photos', icon: 'message' },
  { kind: 'gmail', title: 'Gmail', detail: 'Quotes, invoices, threads', icon: 'mail' },
  { kind: 'calls', title: 'Calls', detail: 'Log calls, add voice notes', icon: 'phone' },
  { kind: 'calendar', title: 'Calendar', detail: 'Meetings and site visits', icon: 'calendar' },
];

/** 05 · Integration setup — connect where conversations happen. */
export default function Connect() {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const byKind = (k: Kind) => state.integrations.find((i) => i.kind === k);
  // First run: WhatsApp Business is the account the user just signed in with; everything else starts unlinked.
  const [linked, setLinked] = useState<Record<Kind, boolean>>(() => ({
    whatsapp: byKind('whatsapp')?.status === 'connected',
    gmail: false,
    calls: false,
    calendar: false,
  }));
  const [pending, setPending] = useState<Kind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const connect = (kind: Kind, title: string) => {
    if (pending) return;
    setPending(kind);
    timer.current = setTimeout(() => {
      const integration = byKind(kind);
      if (integration) actions.setIntegration(integration.id, { status: 'connected', lastSyncAt: Date.now() });
      setLinked((l) => ({ ...l, [kind]: true }));
      setPending(null);
      toast({ text: `${title} connected`, icon: 'check' });
    }, 700);
  };

  const next = () => router.push('/onboarding/ready');

  return (
    <Screen
      gap={26}
      fade
      header={<OnboardingHeader step={3} skipLabel="Later" onSkip={next} />}
      contentStyle={{ paddingTop: 24, paddingBottom: FOOTER_SPACE }}
      footer={
        <OnboardingFooter>
          <OnboardingCta label="Continue" onPress={next} />
        </OnboardingFooter>
      }
    >
      <StepIntro step={3} title="Connect where conversations happen" />

      <Card padding={0} style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
        {ROWS.map((r, i) => {
          const integration = byKind(r.kind);
          const on = linked[r.kind];
          // Once linked, show what was found (e.g. "214 chats from the last 90 days").
          const detail = on && r.kind === 'whatsapp' && integration ? integration.detail : r.detail;
          return (
            <View key={r.kind}>
              {i > 0 && <Sep />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={r.icon} size={20} color={c.t1} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontFamily: fonts.medium }}>{r.title}</Txt>
                  <Txt variant="meta">{detail}</Txt>
                </View>
                {on ? (
                  <Badge tone="ok" dot={false} icon="check" label="Connected" />
                ) : (
                  <Button
                    variant="secondary"
                    label="Connect"
                    accessibilityLabel={`Connect ${r.title}`}
                    loading={pending === r.kind}
                    disabled={!!pending && pending !== r.kind}
                    onPress={() => connect(r.kind, r.title)}
                    style={{ paddingHorizontal: 14, minWidth: 92 }}
                  />
                )}
              </View>
            </View>
          );
        })}
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ marginTop: 1 }}>
          <Icon name="shieldCheck" size={20} color={c.ok} />
        </View>
        <Txt variant="s" style={{ flex: 1 }}>
          Nudge reads conversations only to remember people and promises. Nothing is sent on your behalf without a tap. Disconnect any time.
        </Txt>
      </View>
    </Screen>
  );
}
