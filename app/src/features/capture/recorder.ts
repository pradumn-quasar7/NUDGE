/**
 * Voice recorder — one active recording at a time.
 *
 * SIMULATED for now: it "hears" a demo script and streams it back word by word so the listening UI
 * (timer, live transcript, waveform) behaves like the real thing.
 *
 * TODO(voice): replace the simulation with real capture + transcription:
 *   1. `expo-audio` — `requestRecordingPermissionsAsync()`, `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`,
 *      `recorder.prepareToRecordAsync()` / `record()` / `stop()`; feed `recorder.getStatus().metering` into `onLevel`.
 *   2. Upload the file (`recorder.uri`) to Supabase Storage and call the `transcribe` edge function
 *      (supabase/functions/transcribe) which returns `{ transcript, segments }`. Stream partials over a
 *      realtime channel (or poll) into `onPartial`.
 *   3. Keep this module's surface (`startRecording` / `stopRecording` / `cancelRecording`) unchanged so
 *      `app/src/app/voice.tsx` doesn't change.
 */

export type RecordingResult = {
  transcript: string;
  durationMs: number;
  /** Local audio file once real recording lands. */
  uri?: string;
};

export type RecorderOptions = {
  /** Live (partial) transcript as words are recognised. */
  onPartial?: (text: string) => void;
  /** Input level 0…1, ~10×/s, for the waveform. */
  onLevel?: (level: number) => void;
  /** Simulation only: what the "speaker" says. */
  script?: string;
  /** Simulation only: ms per word. */
  wordMs?: number;
};

type Session = {
  startedAt: number;
  words: string[];
  shown: number;
  startTimer?: ReturnType<typeof setTimeout>;
  wordTimer?: ReturnType<typeof setInterval>;
  levelTimer?: ReturnType<typeof setInterval>;
  opts: RecorderOptions;
};

let session: Session | null = null;

/** Permission gate. Simulation always grants. TODO(voice): expo-audio requestRecordingPermissionsAsync(). */
export async function requestPermission(): Promise<boolean> {
  return true;
}

export function isRecording() {
  return session !== null;
}

export function startRecording(opts: RecorderOptions = {}) {
  cancelRecording();
  const words = (opts.script ?? '').split(/\s+/).filter(Boolean);
  const s: Session = { startedAt: Date.now(), words, shown: 0, opts };
  session = s;
  // Short pause before the first word, like a person drawing breath.
  s.startTimer = setTimeout(() => {
    if (session !== s) return;
    s.wordTimer = setInterval(() => {
      if (s.shown >= s.words.length) {
        if (s.wordTimer) clearInterval(s.wordTimer);
        return;
      }
      s.shown += 1;
      s.opts.onPartial?.(s.words.slice(0, s.shown).join(' '));
    }, opts.wordMs ?? 300);
  }, 450);
  s.levelTimer = setInterval(() => {
    const talking = s.shown < s.words.length;
    s.opts.onLevel?.(talking ? 0.45 + Math.random() * 0.55 : 0.08 + Math.random() * 0.12);
  }, 100);
  return { startedAt: s.startedAt };
}

/** Stop and return the final transcript. In the simulation the full script counts as heard. */
export async function stopRecording(): Promise<RecordingResult> {
  const s = session;
  if (!s) return { transcript: '', durationMs: 0 };
  clear(s);
  session = null;
  return { transcript: s.words.join(' '), durationMs: Date.now() - s.startedAt };
}

/** Discard the current recording, if any. */
export function cancelRecording() {
  if (session) clear(session);
  session = null;
}

function clear(s: Session) {
  if (s.startTimer) clearTimeout(s.startTimer);
  if (s.wordTimer) clearInterval(s.wordTimer);
  if (s.levelTimer) clearInterval(s.levelTimer);
}
