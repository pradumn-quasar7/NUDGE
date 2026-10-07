import { View } from 'react-native';
import { Button, Card, Group, LargeTitle, Screen, SectionLabel, Sep, TopBar, Txt, useToast } from '@/components';
import { useStore } from '@/data/store';
import type { Integration } from '@/data/types';
import { useTheme } from '@/theme/ThemeProvider';
import { HealthyDot, IntegrationTile, PAUSED_NOUN, syncedLabel, upTo } from '@/features/settings/ui';
import { useNow } from '@/lib/useNow';

/** 23 · Integrations — honest status for every connection. */
export default function Integrations() {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const now = useNow();

  const paused = state.integrations.filter((i) => i.status === 'paused');
  const connected = state.integrations.filter((i) => i.status === 'connected');
  const available = state.integrations.filter((i) => i.status === 'available');

  const connect = (i: Integration, verb: string) => {
    actions.setIntegration(i.id, { status: 'connected' });
    toast({ text: `${i.name} ${verb}`, icon: 'check' });
  };

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">Where your conversations and money move.</Txt>}>Integrations</LargeTitle>

      {paused.map((i) => (
        <Card key={i.id} padding={16} style={{ gap: 12, paddingVertical: 14, borderColor: c.warnDot + '59' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <IntegrationTile kind={i.kind} />
            <View style={{ flex: 1 }}>
              <Txt variant="t" weight="medium">
                {i.name}
              </Txt>
              <Txt variant="meta" tone="warn">
                {i.detail.startsWith('Paused') ? i.detail : 'Paused · by you'}
              </Txt>
            </View>
          </View>
          <Txt variant="s">
            New {PAUSED_NOUN[i.kind]} aren’t being remembered. Everything up to {upTo(i.lastSyncAt, now)} is safe.
          </Txt>
          <Button label="Reconnect" full onPress={() => connect(i, 'reconnected · catching up now')} />
        </Card>
      ))}

      {connected.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel style={{ paddingLeft: 4 }}>Connected</SectionLabel>
          <Group>
            {connected.map((i, n) => (
              <View key={i.id}>
                {n > 0 && <Sep />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10 }}>
                  <IntegrationTile kind={i.kind} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="t" weight="medium">
                      {i.name}
                    </Txt>
                    <Txt variant="meta">{syncedLabel(i.lastSyncAt, now)}</Txt>
                  </View>
                  <HealthyDot />
                </View>
              </View>
            ))}
          </Group>
        </View>
      )}

      {available.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel style={{ paddingLeft: 4 }}>Suggested for you</SectionLabel>
          <Group>
            {available.map((i, n) => (
              <View key={i.id}>
                {n > 0 && <Sep />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10 }}>
                  <IntegrationTile kind={i.kind} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="t" weight="medium">
                      {i.name}
                    </Txt>
                    <Txt variant="meta">{i.detail}</Txt>
                  </View>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Connect"
                    accessibilityLabel={`Connect ${i.name}`}
                    style={{ paddingHorizontal: 14, borderRadius: 12 }}
                    onPress={() => connect(i, 'connected')}
                  />
                </View>
              </View>
            ))}
          </Group>
        </View>
      )}
    </Screen>
  );
}
