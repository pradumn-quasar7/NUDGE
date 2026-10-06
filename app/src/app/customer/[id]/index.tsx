import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { AskBar, Button, EmptyState, IconButton, Screen, TopBar, useIsTablet, useToast } from '@/components';
import { useStore } from '@/data/store';
import { firstName } from '@/lib/format';
import { ProfileBody, useContactActions } from '@/features/customer/ProfileBody';
import { ActionMenu, ConfirmDialog } from '@/features/customer/Dialogs';

/** 09 · Customer profile — a living summary: what matters, what was promised, how the relationship is going. */
export default function CustomerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const toast = useToast();
  const isTablet = useIsTablet();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const customer = state.customers.find((c) => c.id === id);
  const contact = useContactActions(customer);

  if (!customer || customer.archived) {
    return (
      <Screen header={<TopBar />}>
        <EmptyState title="Customer not found" body="They may have been removed. Their history stays in your memory for 30 days.">
          <Button label="Back to customers" full onPress={() => router.replace('/customers')} />
        </EmptyState>
      </Screen>
    );
  }

  const first = firstName(customer.name);
  const remove = () => {
    setConfirm(false);
    actions.archiveCustomer(customer.id);
    toast({ text: `${first} removed`, icon: 'check', action: { label: 'Undo', onPress: () => actions.unarchiveCustomer(customer.id) } });
    if (router.canGoBack()) router.back();
    else router.replace('/customers');
  };

  return (
    <Screen
      askBar
      gap={22}
      header={
        <TopBar
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/customers'))}
          right={<IconButton name="more" label="More options" onPress={() => setMenu(true)} />}
        />
      }
      contentStyle={isTablet ? { maxWidth: 1040, width: '100%', alignSelf: 'center', paddingHorizontal: 36 } : undefined}
      footer={<AskBar placeholder={`Ask about ${first}…`} customerId={customer.id} bottom={24} />}
    >
      <ProfileBody customerId={customer.id} layout={isTablet ? 'tablet' : 'phone'} />

      <ActionMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          { label: 'Add note', icon: 'pencil', onPress: contact.note },
          { label: 'Open full memory', icon: 'clock', onPress: () => router.push(`/customer/${customer.id}/memory`) },
          { label: 'Archive', icon: 'close', danger: true, onPress: () => setConfirm(true) },
        ]}
      />
      <ConfirmDialog
        visible={confirm}
        title={`Remove ${first}?`}
        body={`${first}’s history stays in your memory for 30 days.`}
        confirmLabel="Remove"
        onCancel={() => setConfirm(false)}
        onConfirm={remove}
      />
    </Screen>
  );
}
