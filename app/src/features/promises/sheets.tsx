import type { ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Chip, Sep, Sheet, Tap, Txt, useSheetClose, useToast } from '@/components';
import { useStore } from '@/data/store';
import type { Commitment } from '@/data/types';
import { briefHref } from '@/lib/brief';
import { firstName } from '@/lib/format';
import { snoozeOptions } from './format';

/**
 * An in-screen glass sheet (for overlays that are not their own route).
 * Children can call useSheetClose() to dismiss with the exit animation.
 */
export function SheetModal({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {visible && <Sheet onClose={onClose}>{children}</Sheet>}
    </Modal>
  );
}

/** "Snooze until" — Tonight / Tomorrow / Mon. */
export function SnoozeSheet({ commitment, onClose }: { commitment: Commitment | null; onClose: () => void }) {
  return (
    <SheetModal visible={!!commitment} onClose={onClose}>
      {commitment && <SnoozeBody commitment={commitment} />}
    </SheetModal>
  );
}

function SnoozeBody({ commitment }: { commitment: Commitment }) {
  const { actions } = useStore();
  const toast = useToast();
  const close = useSheetClose();
  const options = snoozeOptions();
  return (
    <View style={{ gap: 16, paddingTop: 4 }}>
      <View style={{ gap: 4 }}>
        <Txt variant="h2" accessibilityRole="header">
          Snooze until
        </Txt>
        <Txt variant="s" numberOfLines={1}>
          {commitment.title}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <Chip
            key={o.label}
            label={o.label}
            onPress={() => {
              actions.snoozeCommitment(commitment.id, o.until);
              toast({ text: `Snoozed until ${o.label === 'Mon' || o.label === 'Next Mon' ? o.label : o.label.toLowerCase()}`, icon: 'check' });
              close();
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** Hand a promise to a teammate. */
export function HandOffSheet({ commitment, visible, onClose }: { commitment: Commitment; visible: boolean; onClose: () => void }) {
  return (
    <SheetModal visible={visible} onClose={onClose}>
      <HandOffBody commitment={commitment} />
    </SheetModal>
  );
}

function HandOffBody({ commitment }: { commitment: Commitment }) {
  const { state, actions } = useStore();
  const toast = useToast();
  const close = useSheetClose();
  const people = state.members.filter((m) => m.status === 'active' && m.id !== commitment.ownerId);
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <View style={{ gap: 4, marginBottom: 4 }}>
        <Txt variant="h2" accessibilityRole="header">
          Hand off to
        </Txt>
        <Txt variant="s">They’ll see it on their Promise Radar, with the source.</Txt>
      </View>
      {people.length === 0 ? (
        <Txt variant="body">No one else is on the team yet.</Txt>
      ) : (
        people.map((m, i) => (
          <View key={m.id}>
            {i > 0 && <Sep inset={44} />}
            <Tap
              accessibilityRole="button"
              accessibilityLabel={`Hand off to ${m.name}`}
              scale={0.99}
              onPress={() => {
                actions.handOff(commitment.id, m.id);
                if (m.id === state.me) toast({ text: 'Taken back', icon: 'check' });
                else
                  // Offer the handoff brief for the new owner (history, promises, what to watch).
                  toast({
                    text: `Handed off to ${firstName(m.name)}`,
                    icon: 'check',
                    action: {
                      label: 'Send a brief',
                      onPress: () => router.push(briefHref(commitment.customerId, { commitmentId: commitment.id, forMemberId: m.id })),
                    },
                  });
                close();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}
            >
              <Avatar name={m.name} size={32} />
              <View style={{ flex: 1 }}>
                <Txt>{m.id === state.me ? 'You' : m.name}</Txt>
                {m.title ? <Txt variant="meta">{m.title}</Txt> : null}
              </View>
            </Tap>
          </View>
        ))
      )}
    </View>
  );
}
