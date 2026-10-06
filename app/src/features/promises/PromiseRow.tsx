import { useCallback } from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Tap, Txt, useToast } from '@/components';
import { commitmentRisk, riskBadge } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { Commitment, Customer, ID } from '@/data/types';
import { promiseMeta } from './format';

/** A promise in a grouped card: avatar · title + due meta · status badge. */
export function PromiseRow({
  commitment,
  customer,
  onPress,
  now = Date.now(),
}: {
  commitment: Commitment;
  customer?: Customer;
  onPress?: () => void;
  now?: number;
}) {
  const risk = riskBadge[commitmentRisk(commitment, now)];
  return (
    <Tap
      onPress={onPress}
      scale={0.99}
      accessibilityRole="button"
      accessibilityLabel={`${commitment.title}, ${risk.label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 68, paddingVertical: 10 }}
    >
      <Avatar name={customer?.name ?? '?'} size={30} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="medium">{commitment.title}</Txt>
        <Txt variant="meta">{promiseMeta(commitment, now)}</Txt>
      </View>
      <Badge tone={risk.tone} label={risk.label} />
    </Tap>
  );
}

/** Complete a promise with the "Promise completed · Undo" toast. */
export function useCompletePromise() {
  const { actions } = useStore();
  const toast = useToast();
  return useCallback(
    (id: ID) => {
      actions.completeCommitment(id);
      toast({ text: 'Promise completed', icon: 'check', action: { label: 'Undo', onPress: () => actions.undoComplete(id) } });
    },
    [actions, toast],
  );
}
