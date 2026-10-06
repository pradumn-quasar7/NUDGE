import { View } from 'react-native';
import { Badge, Group, Icon, LargeTitle, Num, Screen, SectionLabel, Sep, Tap, TopBar, Txt, Button, useToast } from '@/components';
import { useStore } from '@/data/store';
import { monthName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius } from '@/theme/tokens';
import { Meter, PLAN_SEATS } from '@/features/settings/ui';

/** Voice minutes in the plan. Usage isn't tracked in the store yet (see report). */
const VOICE_INCLUDED = 300;
const VOICE_USED = 42;

const dayMonth = (ts: number) => `${new Date(ts).getDate()} ${monthName(ts)}`;

/** 25 · Billing — pricing isn't decided, so the price stays a placeholder. Payments are out of scope. */
export default function Billing() {
  const { state } = useStore();
  const { c, scheme } = useTheme();
  const toast = useToast();

  const renew = new Date();
  renew.setMonth(renew.getMonth() + 1, 1);
  const seats = state.members.filter((m) => m.status === 'active').length;
  const customers = state.customers.filter((x) => !x.archived).length;
  const invoices = [...state.invoices].sort((a, b) => b.date - a.date);
  const pro = state.org.plan === 'pro';

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle>Billing</LargeTitle>

      <View style={{ backgroundColor: c.inv, borderRadius: radius.card, padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="h3" color={c.onInv}>
            {pro ? 'Nudge Pro' : 'Nudge Free'}
          </Txt>
          <View
            style={{
              height: 24,
              paddingHorizontal: 9,
              borderRadius: 999,
              justifyContent: 'center',
              backgroundColor: scheme === 'dark' ? 'rgba(11,11,14,0.1)' : 'rgba(255,255,255,0.14)',
            }}
          >
            <Txt style={{ fontFamily: fonts.medium, fontSize: 12 }} color={c.onInv}>
              Active
            </Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }} accessible accessibilityLabel="Price to be announced, per month">
          <Num weight="medium" color={c.onInv} style={{ fontSize: 32, lineHeight: 38, letterSpacing: -0.96 }}>
            [PRICE]
          </Num>
          <Txt color={c.onInv} style={{ fontSize: 14, opacity: 0.7 }}>
            / month
          </Txt>
        </View>
        <Txt color={c.onInv} style={{ fontSize: 13, lineHeight: 18, opacity: 0.72 }}>
          Renews {dayMonth(renew.getTime())} · UPI AutoPay
        </Txt>
      </View>

      <View style={{ gap: 14 }}>
        <Meter label="Seats" value={`${seats} / ${PLAN_SEATS}`} fraction={seats / PLAN_SEATS} />
        <Meter label="Customers remembered" value={`${customers} / unlimited`} fraction={Math.max(0.04, customers / 500)} ok />
        <Meter label="Voice minutes" value={`${VOICE_USED} / ${VOICE_INCLUDED}`} fraction={VOICE_USED / VOICE_INCLUDED} />
      </View>

      {invoices.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel style={{ paddingLeft: 4 }}>Invoices</SectionLabel>
          <Group>
            {invoices.map((inv, i) => (
              <View key={inv.id}>
                {i > 0 && <Sep />}
                <Tap
                  scale={0.99}
                  onPress={() => toast({ text: 'Invoice PDFs are coming soon' })}
                  accessibilityRole="button"
                  accessibilityLabel={`Invoice ${dayMonth(inv.date)}, ${inv.status === 'paid' ? 'paid' : 'due'}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}
                >
                  <Txt variant="t" style={{ flex: 1 }}>
                    {dayMonth(inv.date)}
                  </Txt>
                  {inv.status === 'paid' ? <Badge tone="ok" label="Paid" dot={false} /> : <Badge tone="warn" label="Due" />}
                  <Icon name="chevron" size={16} color={c.t3} />
                </Tap>
              </View>
            ))}
          </Group>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button variant="secondary" label="Change plan" flex onPress={() => toast({ text: 'Plan changes are coming soon' })} />
        <Button variant="secondary" label="Payment method" flex onPress={() => toast({ text: 'Paying with UPI AutoPay' })} />
      </View>
    </Screen>
  );
}
