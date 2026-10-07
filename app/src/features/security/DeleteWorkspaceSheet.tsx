import { useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Txt, useSheetClose } from '@/components';
import { ModalSheet } from '@/features/settings/ui';

/** Same rule as delete_workspace(): the business name, ignoring case and surrounding spaces. */
export const namesMatch = (typed: string, name: string) => typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim().length > 0;

/**
 * "Delete workspace" confirmation: the owner types the business name before the button unlocks.
 * `onDelete(typedName)` runs while the sheet stays open (button shows progress); a thrown error is shown inline.
 */
export function DeleteWorkspaceSheet({
  open,
  orgName,
  detail,
  onDelete,
  onClose,
}: {
  open: boolean;
  orgName: string;
  detail: string;
  onDelete: (typedName: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ModalSheet open={open} onClose={onClose}>
      <Body orgName={orgName} detail={detail} onDelete={onDelete} />
    </ModalSheet>
  );
}

function Body({ orgName, detail, onDelete }: { orgName: string; detail: string; onDelete: (typedName: string) => Promise<void> }) {
  const close = useSheetClose();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ready = namesMatch(typed, orgName);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(typed);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Couldn’t delete the workspace. Nothing was removed.');
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 16, paddingTop: 6 }}>
      <View style={{ gap: 8 }}>
        <Txt variant="h2" accessibilityRole="header">
          Delete {orgName}?
        </Txt>
        <Txt variant="body">{detail}</Txt>
      </View>
      <View style={{ gap: 8 }}>
        <Txt variant="s">
          Type <Txt variant="s" weight="medium" tone="t1">{orgName}</Txt> to confirm.
        </Txt>
        <Input
          value={typed}
          onChangeText={(t) => {
            setTyped(t);
            setError(undefined);
          }}
          placeholder={orgName}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`Type ${orgName} to confirm`}
          focusTone="ink"
          editable={!busy}
          error={error}
          returnKeyType="done"
          onSubmitEditing={() => void confirm()}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Button variant="danger" label="Delete workspace for everyone" full size="lg" disabled={!ready} loading={busy} onPress={() => void confirm()} />
        <Button variant="secondary" label="Cancel" full size="lg" disabled={busy} onPress={close} />
      </View>
    </View>
  );
}
