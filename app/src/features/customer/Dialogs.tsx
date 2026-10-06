import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Sep, Tap, Txt, type IconName } from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

/** Small anchored menu for the profile "…" button. */
export function ActionMenu({
  visible,
  onClose,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  items: { label: string; icon: IconName; danger?: boolean; onPress: () => void }[];
}) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Close menu">
        <View
          style={{
            position: 'absolute',
            top: insets.top + 56,
            right: 14,
            minWidth: 230,
            backgroundColor: c.card,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: c.line,
            paddingHorizontal: 16,
            boxShadow: shadow.e3,
          }}
        >
          {items.map((it, i) => (
            <View key={it.label}>
              {i > 0 && <Sep />}
              <Tap
                onPress={() => {
                  onClose();
                  it.onPress();
                }}
                accessibilityRole="menuitem"
                scale={0.99}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 }}
              >
                <Icon name={it.icon} size={18} color={it.danger ? c.bad : c.t2} />
                <Txt style={{ fontSize: 15.5 }} tone={it.danger ? 'bad' : 't1'}>
                  {it.label}
                </Txt>
              </Tap>
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Confirm dialog (Components board · "Remove Vikram?"). */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { c, shadow } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }}
          onPress={onCancel}
          accessibilityLabel="Cancel"
        />
        <View
          accessibilityRole="alert"
          style={{ width: '100%', maxWidth: 340, backgroundColor: c.card, borderRadius: 24, padding: 18, gap: 6, boxShadow: shadow.e3 }}
        >
          <Txt style={{ fontFamily: fonts.semibold }}>{title}</Txt>
          <Txt variant="meta" style={{ lineHeight: 18 }}>
            {body}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button variant="secondary" label="Cancel" flex style={{ paddingHorizontal: 8 }} onPress={onCancel} />
            <Button variant="danger" label={confirmLabel} flex style={{ paddingHorizontal: 8 }} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
