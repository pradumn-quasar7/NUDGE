import { useRef, type ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { Button, Dot, Icon, Num, Sep, Sheet, Tap, Txt, useSheetClose, type IconName } from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { shortDay } from '@/lib/format';
import type { Channel, Integration } from '@/data/types';

/** Seats included in Pro (pricing not decided yet; seat cap is from the design). */
export const PLAN_SEATS = 10;

/* ───────────── Sheet hosted in a Modal (for in-screen sheets that aren't routes) ───────────── */

export function ModalSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Sheet onClose={onClose}>{children}</Sheet>
    </Modal>
  );
}

/** Confirm sheet — closes with the sheet animation, then runs `onConfirm`. */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirmed = useRef(false);
  return (
    <ModalSheet
      open={open}
      onClose={() => {
        onClose();
        if (confirmed.current) {
          confirmed.current = false;
          onConfirm();
        }
      }}
    >
      <ConfirmBody
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        danger={danger}
        onYes={() => {
          confirmed.current = true;
        }}
      />
    </ModalSheet>
  );
}

function ConfirmBody({
  title,
  body,
  confirmLabel,
  danger,
  onYes,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onYes: () => void;
}) {
  const close = useSheetClose();
  return (
    <View style={{ gap: 16, paddingTop: 6 }}>
      <View style={{ gap: 8 }}>
        <Txt variant="h2" accessibilityRole="header">
          {title}
        </Txt>
        <Txt variant="body">{body}</Txt>
      </View>
      <View style={{ gap: 8 }}>
        <Button
          variant={danger ? 'danger' : 'primary'}
          label={confirmLabel}
          full
          size="lg"
          onPress={() => {
            onYes();
            close();
          }}
        />
        <Button variant="secondary" label="Cancel" full size="lg" onPress={close} />
      </View>
    </View>
  );
}

/* ───────────── Radio row ───────────── */

export function RadioRow({
  title,
  subtitle,
  selected,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <>
      <Tap
        onPress={onPress}
        scale={0.99}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingVertical: 12 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontSize: 15.5 }}>{title}</Txt>
          {subtitle ? <Txt variant="meta">{subtitle}</Txt> : null}
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: selected ? 0 : 1.5,
            borderColor: c.line2,
            backgroundColor: selected ? c.inv : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected && <Icon name="check" size={14} color={c.onInv} strokeWidth={2.4} />}
        </View>
      </Tap>
      {!last && <Sep />}
    </>
  );
}

/* ───────────── Usage meter ───────────── */

export function Meter({ label, value, fraction, ok }: { label: string; value: string; fraction: number; ok?: boolean }) {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <View style={{ gap: 8 }} accessible accessibilityLabel={`${label}, ${value.replace(' / ', ' of ')}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="t">{label}</Txt>
        <Num variant="s">{value}</Num>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.bg2, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: ok ? c.okDot : c.inv }} />
      </View>
    </View>
  );
}

/* ───────────── Integration tiles — neutral glyphs/letters only, never third-party logos ───────────── */

const TILE: Record<Integration['kind'], { letters?: string; icon?: IconName }> = {
  instagram: { letters: 'IG' },
  whatsapp: { icon: 'message' },
  gmail: { icon: 'mail' },
  calls: { icon: 'phone' },
  payments: { letters: '₹' },
  calendar: { letters: 'Cal' },
};

export function IntegrationTile({ kind }: { kind: Integration['kind'] }) {
  const { c } = useTheme();
  const t = TILE[kind];
  return (
    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
      {t.icon ? (
        <Icon name={t.icon} size={18} color={c.t1} />
      ) : (
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{t.letters}</Txt>
      )}
    </View>
  );
}

/** Ok dot with an accessible word, for "healthy" connections. */
export function HealthyDot() {
  return (
    <View accessible accessibilityLabel="Healthy" style={{ width: 24, alignItems: 'flex-end' }}>
      <Dot tone="ok" />
    </View>
  );
}

/** "Synced just now" / "Synced 2 min ago" / "Synced 3 h ago" / "Synced Mon". */
export function syncedLabel(ts: number | undefined, now = Date.now()) {
  if (!ts) return 'Not synced yet';
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Synced ${h} h ago`;
  return `Synced ${shortDay(ts, now)}`;
}

/** What stops being remembered while an integration is paused. */
export const PAUSED_NOUN: Record<Integration['kind'], string> = {
  instagram: 'DMs',
  whatsapp: 'chats',
  gmail: 'emails',
  calls: 'calls',
  payments: 'payments',
  calendar: 'events',
};

/** "yesterday", "today", "Mon", "Sep 30" — for "Everything up to … is safe." */
export function upTo(ts: number | undefined, now = Date.now()) {
  if (!ts) return 'now';
  const d = shortDay(ts, now);
  return d === 'Today' || d === 'Yesterday' ? d.toLowerCase() : d;
}

export const CHANNEL_SOURCE: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  phone: 'a call',
  email: 'email',
  instagram: 'Instagram',
  manual: 'a note',
  upi: 'UPI',
};
