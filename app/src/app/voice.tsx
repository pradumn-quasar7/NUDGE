import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button, IconButton, Num, Sheet, Tap, Txt, useSheetClose } from '@/components';
import { useStore } from '@/data/store';
import { customerById } from '@/data/selectors';
import type { CaptureDraft } from '@/lib/ai';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { cancelRecording, startRecording, stopRecording } from '@/features/capture/recorder';
import { NoteField, UNDERSTAND_MS, UnderstandingView, UnderstoodView, understandText } from '@/features/capture/Understood';
import { Waveform } from '@/features/capture/Waveform';

/**
 * 16 Voice capture · listening → 16b understood.
 * Speak naturally, see exactly what was understood, confirm. Nothing is saved until "Save".
 */
export default function VoiceCapture() {
  return (
    <Sheet full>
      <VoiceBody />
    </Sheet>
  );
}

type Phase = 'listening' | 'typing' | 'understanding' | 'understood';

function VoiceBody() {
  const { state } = useStore();
  const close = useSheetClose();
  const params = useLocalSearchParams<{ customerId?: string; text?: string }>();
  const hint = typeof params.customerId === 'string' ? params.customerId : undefined;
  const [phase, setPhase] = useState<Phase>(params.text ? 'typing' : 'listening');
  const [partial, setPartial] = useState('');
  const [text, setText] = useState(typeof params.text === 'string' ? params.text : '');
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [session, setSession] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Demo speech mentions a real customer from the store (the hinted one, else the first active one).
  const speaker = customerById(state, hint) ?? state.customers.find((c) => !c.archived);
  const script = `${speaker ? firstName(speaker.name) : 'Rahul'} wants 50 units and I’ll send the quotation tomorrow`;

  useEffect(() => () => {
    cancelRecording();
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const understand = (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    setText(clean);
    setPhase('understanding');
    timer.current = setTimeout(() => {
      setDraft(understandText(clean, state, hint));
      setPhase('understood');
    }, UNDERSTAND_MS);
  };

  if (phase === 'listening') {
    return (
      <Listening
        key={session}
        script={script}
        partial={partial}
        setPartial={setPartial}
        onStop={async () => {
          const res = await stopRecording();
          understand(res.transcript || partial);
        }}
        onCancel={() => {
          cancelRecording();
          close();
        }}
        onType={() => {
          cancelRecording();
          setText(partial);
          setPhase('typing');
        }}
      />
    );
  }

  if (phase === 'typing') {
    return (
      <View style={{ flex: 1, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2, flex: 1 }}>
            <Txt variant="h2" accessibilityRole="header">
              Type it
            </Txt>
            <Txt variant="meta">Nudge files it to the right customer.</Txt>
          </View>
          <IconButton
            name="mic"
            label="Switch to voice"
            bordered
            onPress={() => {
              setPartial('');
              setSession((n) => n + 1);
              setPhase('listening');
            }}
          />
        </View>
        <NoteField
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder={`e.g. ${script}`}
          accessibilityLabel="What happened?"
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 'auto' }}>
          <Button variant="secondary" size="lg" label="Cancel" style={{ flex: 1 }} onPress={close} />
          <Button variant="ai" size="lg" label="Understand" style={{ flex: 2 }} disabled={!text.trim()} onPress={() => understand(text)} />
        </View>
      </View>
    );
  }

  if (phase === 'understanding' || !draft) return <UnderstandingView transcript={text} fill />;

  return (
    <UnderstoodView
      fill
      draft={draft}
      kind="voice"
      onEdit={(t) => {
        setText(t);
        setDraft(null);
        setPhase('typing');
      }}
    />
  );
}

function Listening({
  script,
  partial,
  setPartial,
  onStop,
  onCancel,
  onType,
}: {
  script: string;
  partial: string;
  setPartial: (t: string) => void;
  onStop: () => void;
  onCancel: () => void;
  onType: () => void;
}) {
  const { c } = useTheme();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const { startedAt } = startRecording({ script, onPartial: setPartial });
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(tick);
  }, [script, setPartial]);

  const words = partial.split(' ').filter(Boolean);
  const head = words.slice(0, -1).join(' ');
  const last = words[words.length - 1];
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }} accessibilityLabel={`Listening, ${elapsed} seconds`}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.badDot }} />
        <Num variant="s">Listening · {clock}</Num>
      </View>

      <Txt
        center
        accessibilityLiveRegion="polite"
        style={{ fontSize: 24, lineHeight: 32, letterSpacing: -0.48, paddingTop: 34, paddingHorizontal: 8 }}
        weight="medium"
      >
        {words.length === 0 ? (
          <Txt tone="t3" weight="medium" style={{ fontSize: 24, lineHeight: 32 }}>
            Start talking…
          </Txt>
        ) : (
          <>
            {head ? `${head} ` : ''}
            <Txt tone="t3" weight="medium" style={{ fontSize: 24, lineHeight: 32 }}>
              {last}
            </Txt>
          </>
        )}
      </Txt>

      <View style={{ flex: 1 }} />
      <Waveform active />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, paddingHorizontal: 10 }}>
        <IconButton name="close" label="Cancel recording" size={56} bg={c.bg2} onPress={onCancel} />
        <Tap
          haptic
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Stop and review"
          style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 8px ${c.line}` }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: c.onInv }} />
        </Tap>
        <IconButton name="keyboard" label="Type instead" size={56} bg={c.bg2} onPress={onType} />
      </View>
    </View>
  );
}
