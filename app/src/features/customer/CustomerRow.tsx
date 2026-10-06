import { View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Badge, Button, Dot, EmptyState, Icon, Num, Tap, Txt } from '@/components';
import type { AppState } from '@/data/store';
import { customerStatus } from '@/data/selectors';
import type { Customer } from '@/data/types';
import { useTheme } from '@/theme/ThemeProvider';

/** Renders "Paid ₹18,000" with the amount in Geist Mono. */
export function MoneyText({ text, variant = 'meta' }: { text: string; variant?: 'meta' | 's' }) {
  const parts = text.split(/(₹[\d,]+)/);
  return (
    <Txt variant={variant} numberOfLines={1}>
      {parts.map((p, i) =>
        /^₹[\d,]+$/.test(p) ? (
          <Num key={i} variant={variant}>
            {p}
          </Num>
        ) : (
          p
        ),
      )}
    </Txt>
  );
}

/** One customer row: avatar, name, current state, and status (badge on phone, dot on tablet). */
export function CustomerRow({
  state,
  customer,
  variant = 'phone',
  selected,
  onPress,
}: {
  state: AppState;
  customer: Customer;
  variant?: 'phone' | 'tablet';
  selected?: boolean;
  onPress: () => void;
}) {
  const { c, shadow } = useTheme();
  const status = customerStatus(state, customer);
  const tablet = variant === 'tablet';
  return (
    <Tap
      onPress={onPress}
      scale={0.99}
      accessibilityRole="button"
      accessibilityState={tablet ? { selected: !!selected } : undefined}
      accessibilityLabel={`${customer.name}, ${customer.headline}${status.label ? `, ${status.label}` : ''}`}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66 },
        tablet && { paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
        tablet && selected && { backgroundColor: c.card, borderColor: c.line, boxShadow: shadow.e1 },
      ]}
    >
      <Avatar name={customer.name} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Txt weight="medium" style={{ fontSize: 15.5 }} numberOfLines={1}>
          {customer.name}
        </Txt>
        <MoneyText text={customer.headline} />
      </View>
      {tablet ? (
        status.badge && status.tone ? <Dot tone={status.tone} /> : null
      ) : status.badge && status.tone ? (
        <View style={{ alignSelf: 'center' }}>
          <Badge tone={status.tone} label={status.label} />
        </View>
      ) : status.label ? (
        <Txt variant="meta">{status.label}</Txt>
      ) : null}
    </Tap>
  );
}

/** E1 · Empty — no customers yet. */
export function NoCustomers() {
  const { c, shadow } = useTheme();
  const ghost = {
    position: 'absolute' as const,
    top: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.bg2,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    borderColor: c.line2,
  };
  return (
    <EmptyState
      art={
        <View style={{ width: 150, height: 96, marginBottom: 16 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[ghost, { left: 0 }]} />
          <View style={[ghost, { right: 0 }]} />
          <View
            style={{
              position: 'absolute',
              left: 39,
              top: 6,
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: c.card,
              boxShadow: shadow.e2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="plus" size={28} color={c.t1} />
          </View>
        </View>
      }
      title="No customers yet"
      body={'Your customer memory starts here.\nAdd your first customer or connect WhatsApp.'}
    >
      <Button label="Get started" size="lg" full onPress={() => router.push('/customer/new')} />
      <Button variant="ghost" label="Connect WhatsApp" full onPress={() => router.push('/integrations')} />
    </EmptyState>
  );
}
