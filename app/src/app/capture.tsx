import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Icon, IconButton, Sheet, Tap, Txt, useSheetClose, useToast, type IconName } from '@/components';
import { useStore } from '@/data/store';
import { customerById } from '@/data/selectors';
import type { CaptureDraft } from '@/lib/ai';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { NoteField, UNDERSTAND_MS, UnderstandingView, UnderstoodView, understandText } from '@/features/capture/Understood';

/**
 * 15 Quick capture — one capture button everywhere. Voice is the fastest path; a quick note runs the
 * same understanding flow. `?customerId=` pre-assigns the customer.
 */
export default function Capture() {
  return (
    <Sheet>
      <CaptureBody />
    </Sheet>
  );
}

type Mode = 'menu' | 'note' | 'understanding' | 'understood';

const TILES: { key: string; label: string; icon: IconName }[] = [
  { key: 'note', label: 'Quick note', icon: 'pencil' },
  { key: 'photo', label: 'Photo', icon: 'camera' },
  { key: 'document', label: 'Document', icon: 'doc' },
  { key: 'link', label: 'Link', icon: 'link' },
  { key: 'conversation', label: 'Conversation', icon: 'message' },
  { key: 'customer', label: 'Customer', icon: 'userPlus' },
];

function CaptureBody() {
  const { state } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const close = useSheetClose();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const hint = typeof params.customerId === 'string' ? params.customerId : undefined;
  const hinted = customerById(state, hint);
  const [mode, setMode] = useState<Mode>('menu');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const last = state.events
    .filter((e) => e.kind === 'note' && e.authorId === state.me)
    .sort((a, b) => b.at - a.at)[0];
  const lastCustomer = customerById(state, last?.customerId);

  const onTile = (key: string) => {
    if (key === 'note') return setMode('note');
    if (key === 'customer') return router.replace('/customer/new');
    toast({ text: 'Coming soon' });
  };

  const understand = () => {
    const clean = text.trim();
    if (!clean) return;
    setMode('understanding');
    timer.current = setTimeout(() => {
      setDraft(understandText(clean, state, hint));
      setMode('understood');
    }, UNDERSTAND_MS);
  };

  if (mode === 'understanding') return <UnderstandingView transcript={text.trim()} />;
  if (mode === 'understood' && draft)
    return (
      <UnderstoodView
        draft={draft}
        kind="note"
        onEdit={(t) => {
          setText(t);
          setDraft(null);
          setMode('note');
        }}
      />
    );

  if (mode === 'note') {
    return (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ marginLeft: -10 }}>
            <IconButton name="back" label="Back to capture options" onPress={() => setMode('menu')} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2" accessibilityRole="header">
              Quick note
            </Txt>
            <Txt variant="meta">{hinted ? `Filed to ${hinted.name}.` : 'Write it like you’d say it.'}</Txt>
          </View>
          <IconButton name="close" label="Close" bg={c.bg2} onPress={close} />
        </View>
        <NoteField
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder={`e.g. ${hinted ? firstName(hinted.name) : 'Rahul'} wants 50 units and I’ll send the quotation tomorrow`}
          accessibilityLabel="Note"
        />
        <Button variant="ai" size="lg" label="Understand" full disabled={!text.trim()} onPress={understand} />
      </>
    );
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt variant="h2" accessibilityRole="header">
            Capture
          </Txt>
          <Txt variant="meta">{hinted ? `Nudge files it to ${hinted.name}.` : 'Nudge files it to the right customer.'}</Txt>
        </View>
        <View style={{ marginRight: -4 }}>
          <IconButton name="close" label="Close" bg={c.bg2} onPress={close} />
        </View>
      </View>

      <Tap
        haptic
        onPress={() => router.replace(hint ? { pathname: '/voice', params: { customerId: hint } } : '/voice')}
        accessibilityRole="button"
        accessibilityLabel="Voice note. Just talk."
        style={{ height: 76, borderRadius: 22, backgroundColor: c.inv, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14 }}
      >
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.onInv + '24', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mic" size={20} color={c.onInv} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt color={c.onInv} weight="semibold">
            Voice note
          </Txt>
          <Txt color={c.onInv} style={{ fontSize: 12.5, lineHeight: 16, opacity: 0.7 }} numberOfLines={1}>
            Just talk — “{hinted ? firstName(hinted.name) : 'Rahul'} wants 50 units…”
          </Txt>
        </View>
      </Tap>

      <View style={{ gap: 10 }}>
        {[TILES.slice(0, 3), TILES.slice(3)].map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 10 }}>
            {row.map((t) => (
              <Tap
                key={t.key}
                onPress={() => onTile(t.key)}
                accessibilityRole="button"
                accessibilityLabel={t.key === 'customer' ? 'New customer' : t.label}
                style={{ flex: 1, height: 104, padding: 14, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, justifyContent: 'space-between' }}
              >
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={t.icon} size={20} color={c.t1} />
                </View>
                <Txt variant="s" tone="t1" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontFamily: fonts.medium, fontSize: 13 }}>
                  {t.label}
                </Txt>
              </Tap>
            ))}
          </View>
        ))}
      </View>

      {last && lastCustomer ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
          <Icon name="clock" size={16} color={c.t3} />
          <Txt variant="meta" style={{ flex: 1 }} numberOfLines={1}>
            Last: {last.title === 'Voice note' ? 'voice note' : 'note'} about {firstName(lastCustomer.name)}, filed {age(last.at)}
          </Txt>
        </View>
      ) : null}
    </>
  );
}

function age(ts: number, now = Date.now()) {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
