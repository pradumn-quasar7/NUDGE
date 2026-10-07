import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button, Icon, IconButton, Num, Sheet, Tap, Txt, useSheetClose } from '@/components';
import * as remote from '@/data/remote';
import { backendMode } from '@/data/session';
import { useStore } from '@/data/store';
import { customerById } from '@/data/selectors';
import type { CaptureDraft } from '@/lib/ai';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import {
  cancelRecording,
  deleteLocalRecording,
  hasMicPermission,
  MAX_RECORDING_MS,
  realRecording,
  startRecording,
  stopRecording,
  useVoiceRecorder,
  type RecordingResult,
} from '@/features/capture/recorder';
import { NoteField, UNDERSTAND_MS, UnderstandingView, UnderstoodView, understandText } from '@/features/capture/Understood';
import { Waveform } from '@/features/capture/Waveform';

/**
 * 16 Voice capture · listening → 16b understood.
 * Speak naturally, see exactly what was understood, confirm. Nothing is saved until "Save".
 *
 * Cloud mode on a phone records for real: on Stop the recording is uploaded to the private voice-notes bucket and
 * transcribed server-side, then understood on-device like a typed note. The recording is kept (locally and
 * uploaded) until the sheet closes, so a failed transcription can be retried; closing without saving deletes it.
 * Demo mode simulates the microphone. Cloud mode on web has no recorder — it opens on typing.
 */
export default function VoiceCapture() {
  return (
    <Sheet full>
      <VoiceBody />
    </Sheet>
  );
}

type Phase = 'listening' | 'transcribing' | 'typing' | 'understanding' | 'understood' | 'denied' | 'failed';
type Failure = 'transcription' | 'nothing_heard' | 'mic';

/** A real recording: the local file, and the Storage path once uploaded. */
type Recording = { uri: string; durationMs: number; path?: string };

const cloudWeb = backendMode === 'cloud' && Platform.OS === 'web';
const clockOf = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function VoiceBody() {
  const { state } = useStore();
  const close = useSheetClose();
  const params = useLocalSearchParams<{ customerId?: string; text?: string }>();
  const hint = typeof params.customerId === 'string' ? params.customerId : undefined;
  const real = realRecording && !!state.org.id && !!state.me;
  const [phase, setPhase] = useState<Phase>(params.text || cloudWeb ? 'typing' : 'listening');
  const [partial, setPartial] = useState('');
  const [text, setText] = useState(typeof params.text === 'string' ? params.text : '');
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [session, setSession] = useState(0);
  const [failure, setFailure] = useState<Failure>('transcription');
  const [audioPath, setAudioPath] = useState<string>();
  const [language, setLanguage] = useState<string>();
  const [recordedMs, setRecordedMs] = useState(0);
  /** Mirrors `recording.current` for rendering. */
  const [hasRecording, setHasRecording] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recording = useRef<Recording | null>(null);
  const saved = useRef(false);
  const closed = useRef(false);
  /** Bumped whenever a recording is discarded, so late upload/transcription results are ignored. */
  const generation = useRef(0);

  // Demo speech mentions a real customer from the store (the hinted one, else the first active one).
  const speaker = customerById(state, hint) ?? state.customers.find((c) => !c.archived);
  const script = `${speaker ? firstName(speaker.name) : 'Rahul'} wants 50 units and I’ll send the quotation tomorrow`;

  /** Drops the current recording: local file always, uploaded object unless the note was saved with it. */
  const discardRecording = useCallback(() => {
    generation.current += 1;
    const r = recording.current;
    recording.current = null;
    setHasRecording(false);
    if (!r) return;
    deleteLocalRecording(r.uri);
    if (r.path && !saved.current) void remote.deleteVoiceNote(r.path).catch(() => {});
  }, []);

  useEffect(
    () => () => {
      closed.current = true;
      cancelRecording();
      if (timer.current) clearTimeout(timer.current);
      discardRecording();
    },
    [discardRecording],
  );

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

  /** Upload (once) + transcribe the current recording, then show what was understood. */
  const transcribe = async () => {
    const r = recording.current;
    if (!r) return;
    const gen = generation.current;
    const orgId = state.org.id;
    setPhase('transcribing');
    try {
      if (!r.path) {
        const path = await remote.uploadVoiceNote(orgId, state.me, r.uri);
        if (closed.current || gen !== generation.current) {
          // Discarded while uploading: don't leave it behind.
          void remote.deleteVoiceNote(path).catch(() => {});
          return;
        }
        r.path = path;
        setAudioPath(path);
      }
      const res = await remote.transcribeVoiceNote(orgId, r.path);
      if (closed.current || gen !== generation.current) return;
      if (!res.transcript.trim()) {
        setFailure('nothing_heard');
        setPhase('failed');
        return;
      }
      setLanguage(res.language);
      setText(res.transcript);
      setDraft(understandText(res.transcript, state, hint));
      setPhase('understood');
    } catch {
      if (closed.current || gen !== generation.current) return;
      setFailure('transcription');
      setPhase('failed');
    }
  };

  const onRecorded = (res: RecordingResult | null) => {
    if (!res?.uri || res.durationMs < 600) {
      deleteLocalRecording(res?.uri);
      setFailure('nothing_heard');
      setPhase('failed');
      return;
    }
    recording.current = { uri: res.uri, durationMs: res.durationMs };
    setHasRecording(true);
    setRecordedMs(res.durationMs);
    setAudioPath(undefined);
    setLanguage(undefined);
    void transcribe();
  };

  const listenAgain = () => {
    discardRecording();
    setAudioPath(undefined);
    setLanguage(undefined);
    setPartial('');
    setSession((n) => n + 1);
    setPhase('listening');
  };

  if (phase === 'listening' && real) {
    return (
      <LiveListening
        key={session}
        onStopped={onRecorded}
        onCancel={close}
        onType={() => {
          setText('');
          setPhase('typing');
        }}
        onDenied={() => setPhase('denied')}
        onFailed={() => {
          setFailure('mic');
          setPhase('failed');
        }}
      />
    );
  }

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

  if (phase === 'denied') {
    return <MicDenied onGranted={listenAgain} onType={() => setPhase('typing')} onClose={close} />;
  }

  if (phase === 'failed') {
    const canRetry = failure === 'transcription' && hasRecording;
    const copy = canRetry
      ? { title: 'Couldn’t understand that recording.', body: 'Your recording is safe — try again or type instead.' }
      : failure === 'mic'
        ? { title: 'Couldn’t start the microphone.', body: 'Another app may be using it. Try again, or type the note instead.' }
        : { title: 'I didn’t catch anything.', body: 'Try again a little closer to the phone, or type it instead.' };
    return (
      <Problem
        title={copy.title}
        body={copy.body}
        retryLabel={canRetry ? 'Try again' : 'Record again'}
        onRetry={canRetry ? () => void transcribe() : listenAgain}
        onType={() => {
          setText('');
          setPhase('typing');
        }}
        onClose={close}
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
            <Txt variant="meta">
              {cloudWeb ? 'Nudge files it to the right customer. Voice notes work in the phone app.' : 'Nudge files it to the right customer.'}
            </Txt>
          </View>
          {cloudWeb ? null : <IconButton name="mic" label={hasRecording ? 'Record again' : 'Switch to voice'} bordered onPress={listenAgain} />}
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

  if (phase === 'transcribing') return <UnderstandingView fill detail={`Your voice note · ${clockOf(recordedMs)}`} />;

  if (phase === 'understanding' || !draft) return <UnderstandingView transcript={text} fill />;

  return (
    <UnderstoodView
      fill
      draft={draft}
      kind="voice"
      audioPath={audioPath}
      language={language}
      onSaved={() => {
        saved.current = !!audioPath;
        close();
      }}
      onEdit={(t) => {
        setText(t);
        setDraft(null);
        setPhase('typing');
      }}
    />
  );
}

/* ───────────── Listening · real microphone (cloud, iOS / Android) ───────────── */

function LiveListening({
  onStopped,
  onCancel,
  onType,
  onDenied,
  onFailed,
}: {
  onStopped: (res: RecordingResult | null) => void;
  onCancel: () => void;
  onType: () => void;
  onDenied: () => void;
  onFailed: () => void;
}) {
  const { c } = useTheme();
  const { start, stop, cancel, isRecording, durationMs, level } = useVoiceRecorder();
  const [started, setStarted] = useState(false);
  const heard = useRef(false);
  const stopping = useRef(false);
  const handlers = useRef({ onStopped, onDenied, onFailed });
  useLayoutEffect(() => {
    handlers.current = { onStopped, onDenied, onFailed };
  });

  useEffect(() => {
    let alive = true;
    void start().then((r) => {
      if (!alive) return;
      if (r === 'recording') setStarted(true);
      else if (r === 'denied') handlers.current.onDenied();
      else handlers.current.onFailed();
    });
    return () => {
      alive = false;
    };
  }, [start]);

  const finish = useCallback(async () => {
    if (stopping.current) return;
    stopping.current = true;
    const res = await stop();
    handlers.current.onStopped(res);
  }, [stop]);

  // Stop at the limit, or when the recorder stopped by itself (forDuration backstop, interruption).
  useEffect(() => {
    if (!started) return;
    if (isRecording) heard.current = true;
    if (durationMs >= MAX_RECORDING_MS || (heard.current && !isRecording)) void finish();
  }, [started, isRecording, durationMs, finish]);

  const nearLimit = durationMs >= MAX_RECORDING_MS - 20_000;
  const clock = clockOf(started ? durationMs : 0);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }}
        accessibilityLabel={started ? `Listening, ${Math.floor(durationMs / 1000)} seconds` : 'Starting the microphone'}
      >
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: started ? c.badDot : c.t3 }} />
        <Num variant="s">{started ? `Listening · ${clock}` : 'Starting…'}</Num>
      </View>

      <Txt
        center
        tone="t3"
        weight="medium"
        accessibilityLiveRegion="polite"
        style={{ fontSize: 24, lineHeight: 32, letterSpacing: -0.48, paddingTop: 34, paddingHorizontal: 8 }}
      >
        Speak naturally — I’ll write it down when you stop.
      </Txt>
      {nearLimit ? (
        <Txt variant="meta" center style={{ paddingTop: 12 }}>
          Voice notes stop at {clockOf(MAX_RECORDING_MS)}.
        </Txt>
      ) : null}

      <View style={{ flex: 1 }} />
      <Waveform active={started && isRecording} level={level} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, paddingHorizontal: 10 }}>
        <IconButton
          name="close"
          label="Cancel recording"
          size={56}
          bg={c.bg2}
          onPress={() => {
            stopping.current = true;
            void cancel().finally(onCancel);
          }}
        />
        <Tap
          haptic
          onPress={() => void finish()}
          accessibilityRole="button"
          accessibilityLabel="Stop and review"
          style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 8px ${c.line}` }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: c.onInv }} />
        </Tap>
        <IconButton
          name="keyboard"
          label="Type instead"
          size={56}
          bg={c.bg2}
          onPress={() => {
            stopping.current = true;
            void cancel().finally(onType);
          }}
        />
      </View>
    </View>
  );
}

/* ───────────── Microphone off ───────────── */

function MicDenied({ onGranted, onType, onClose }: { onGranted: () => void; onType: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const granted = useRef(onGranted);
  useLayoutEffect(() => {
    granted.current = onGranted;
  });
  // Back from Settings with the microphone allowed → start listening.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void hasMicPermission().then((ok) => ok && granted.current());
    });
    return () => sub.remove();
  }, []);

  return (
    <SheetMessage
      onClose={onClose}
      icon={
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mic" size={20} color={c.t2} />
        </View>
      }
      title="Nudge can’t hear you yet."
      body="Microphone access is off. Turn it on in Settings to record voice notes, or type the note instead."
      primary={{ label: 'Open settings', onPress: () => void Linking.openSettings().catch(() => {}) }}
      secondary={{ label: 'Type instead', onPress: onType }}
    />
  );
}

/* ───────────── Upload / transcription problems ───────────── */

function Problem({
  title,
  body,
  retryLabel,
  onRetry,
  onType,
  onClose,
}: {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
  onType: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  return (
    <SheetMessage
      onClose={onClose}
      role="alert"
      icon={
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.badWash, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="alert" size={20} color={c.bad} />
        </View>
      }
      title={title}
      body={body}
      primary={{ label: retryLabel, onPress: onRetry }}
      secondary={{ label: 'Type instead', onPress: onType }}
    />
  );
}

/** Calm message card (board 09 · error): icon + title, one line of reassurance, two actions. */
function SheetMessage({
  icon,
  title,
  body,
  primary,
  secondary,
  onClose,
  role,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary: { label: string; onPress: () => void };
  onClose: () => void;
  role?: 'alert';
}) {
  const { c, shadow } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <IconButton name="close" label="Close" onPress={onClose} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View
          accessibilityRole={role}
          accessibilityLiveRegion="polite"
          style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 18, gap: 12, boxShadow: shadow.e2 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {icon}
            <Txt variant="h3" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </Txt>
          </View>
          <Txt variant="s">{body}</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={primary.label} onPress={primary.onPress} style={{ flex: 1 }} />
            <Button variant="secondary" label={secondary.label} onPress={secondary.onPress} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ───────────── Listening · simulated (demo mode) ───────────── */

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
