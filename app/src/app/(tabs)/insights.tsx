import { View } from 'react-native';
import { router } from 'expo-router';
import { AiCard, AiLabel, Badge, Button, Card, Dot, LargeTitle, Num, Screen, Sep, Txt } from '@/components';
import { useStore } from '@/data/store';
import { commitmentRisk, insights, openCommitments } from '@/data/selectors';
import { inr, monthName, plural } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { useNow } from '@/lib/useNow';

/**
 * 20 Insights — observations Nudge can stand behind, each with something to do. Not a dashboard.
 */

// TODO(lead): move the observation into `insights()` once the backend computes it from quotes.
const OBSERVATION = {
  text: 'Your fastest-converting customers usually receive a follow-up within 24 hours.',
  basis: 'Based on 61 quotes since July',
};

export default function Insights() {
  const { state } = useStore();
  const { c } = useTheme();
  const now = useNow();
  const k = insights(state);
  const lastMonth = monthName(new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1).getTime());
  const peak = Math.max(...k.trend) / 0.78;
  const atRisk = new Set(
    openCommitments(state)
      .filter((p) => commitmentRisk(p, now) !== 'on_track')
      .map((p) => p.customerId),
  ).size;
  const up = k.responseDelta >= 0;

  return (
    <Screen tabBar gap={20}>
      <LargeTitle right={<Txt variant="meta">This month</Txt>}>Insights</LargeTitle>

      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="h3">Business pulse</Txt>
          <Badge tone={up ? 'ok' : 'warn'} label={up ? 'Steady' : 'Slowing'} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Txt variant="meta">Customer response rate</Txt>
            <Num weight="semibold" style={{ fontSize: 52, lineHeight: 60, letterSpacing: -1.6 }}>
              {k.responseRate}%
            </Num>
            <Txt variant="s" tone={up ? 'ok' : 'warn'} style={{ fontFamily: fonts.medium }}>
              {up ? '↑' : '↓'} {Math.abs(k.responseDelta)}% vs {lastMonth}
            </Txt>
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Response rate by week, rising from ${k.trend[0]}% to ${k.trend[k.trend.length - 1]}%`}
            style={{ width: 120, height: 48, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}
          >
            {k.trend.map((v, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.round((v / peak) * 100)}%`,
                  borderRadius: 3,
                  backgroundColor: i >= k.trend.length - 2 ? c.inv : c.line2,
                }}
              />
            ))}
          </View>
        </View>
        <Sep />
        <View style={{ flexDirection: 'row' }}>
          <Stat label="Avg. reply time" value={`${k.avgReplyHours} h`} />
          <Stat label="Promises kept" value={`${k.promisesKept}%`} />
          <Stat label="Collected" value={inr(k.collected, { compact: true })} />
        </View>
      </Card>

      <AiCard>
        <AiLabel>Nudge noticed</AiLabel>
        <Txt style={{ fontSize: 16, lineHeight: 23 }}>{OBSERVATION.text}</Txt>
        <Txt variant="meta">{OBSERVATION.basis}</Txt>
        <View style={{ flexDirection: 'row' }}>
          <Button
            variant="ghost"
            label="See who’s waiting now"
            style={{ paddingHorizontal: 0 }}
            onPress={() => router.push({ pathname: '/search', params: { q: 'People I haven’t contacted this week' } })}
          />
        </View>
      </AiCard>

      {atRisk > 0 ? (
        <Card style={{ gap: 12, paddingVertical: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Dot tone="warn" />
            <Txt variant="cap" tone="warn">
              At risk
            </Txt>
          </View>
          <Txt style={{ fontFamily: fonts.medium }}>
            {plural(atRisk, 'customer')} {atRisk === 1 ? 'hasn’t' : 'haven’t'} received promised follow-ups.
          </Txt>
          <Button variant="secondary" label="Review" full onPress={() => router.push('/radar')} />
        </Card>
      ) : (
        <Card style={{ gap: 12, paddingVertical: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Dot tone="ok" />
            <Txt variant="cap" tone="ok">
              On track
            </Txt>
          </View>
          <Txt style={{ fontFamily: fonts.medium }}>Every promise is on track.</Txt>
          <Button variant="secondary" label="Open radar" full onPress={() => router.push('/radar')} />
        </Card>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt variant="meta">{label}</Txt>
      <Num weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
        {value}
      </Num>
    </View>
  );
}
