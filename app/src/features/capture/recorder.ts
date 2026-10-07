import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { backendMode } from '@/data/session';

/**
 * Voice recorder.
 *
 * - Cloud mode on iOS / Android: REAL recording with expo-audio (`useVoiceRecorder`). The file is uploaded and
 *   transcribed server-side after "Stop" (see `app/src/app/voice.tsx`, `remote.uploadVoiceNote` /
 *   `remote.transcribeVoiceNote`, `supabase/functions/transcribe`). There is no live transcript while talking.
 * - Demo mode: SIMULATED (`startRecording` / `stopRecording` / `cancelRecording`) — it "hears" a demo script and
 *   streams it back word by word so the listening UI behaves like the real thing. Nothing leaves the device.
 */

/** True where the real microphone path is used. */
export const realRecording = backendMode === 'cloud' && Platform.OS !== 'web';

/** Longest voice note; recording stops by itself here. */
export const MAX_RECORDING_MS = 3 * 60_000;

export type RecordingResult = {
  transcript: string;
  durationMs: number;
  /** Local audio file (real recording only). */
  uri?: string;
};

/* ───────────── Real recording (expo-audio) ───────────── */

/**
 * AAC in an .m4a (MP4) container, from the HIGH_QUALITY preset: mono at 64 kbps is plenty for speech and keeps a
 * 3-minute note around 1.4 MB on a mobile connection. Metering drives the waveform.
 */
const VOICE_PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000, isMeteringEnabled: true };

export type StartResult = 'recording' | 'denied' | 'failed';

export type VoiceRecorder = {
  /** Asks for the microphone if needed, configures the audio session and starts recording. */
  start: () => Promise<StartResult>;
  /** Stops and returns the local file (null if nothing was recorded). */
  stop: () => Promise<RecordingResult | null>;
  /** Stops (if recording) and deletes the local file. */
  cancel: () => Promise<void>;
  isRecording: boolean;
  durationMs: number;
  /** Input level 0…1, or null when the platform gives no metering (use a decorative animation instead). */
  level: number | null;
};

/** dBFS (iOS average power / Android peak amplitude, −160…0) → 0…1 for the waveform. */
export function levelFromDb(db: number | undefined): number | null {
  if (db === undefined || !Number.isFinite(db)) return null;
  return Math.min(1, Math.max(0, (db + 50) / 45));
}

/** Best-effort removal of a local recording. */
export function deleteLocalRecording(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Cache files are cleaned up by the OS eventually.
  }
}

/** Microphone permission without prompting (e.g. after the person comes back from Settings). */
export async function hasMicPermission(): Promise<boolean> {
  const p = await getRecordingPermissionsAsync().catch(() => null);
  return !!p?.granted;
}

async function recordingSessionOff() {
  // Back to normal playback routing (iOS keeps the earpiece/record category otherwise).
  await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
}

/**
 * One real recording per component. Mount it only where `realRecording` is true.
 * Operations are serialised so a fast start → cancel (or React's dev double-mount) can't interleave.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(VOICE_PRESET);
  const status = useAudioRecorderState(recorder, 100);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(false);
  const uri = useRef<string | null>(null);
  const longest = useRef(0);

  useEffect(() => {
    if (status.isRecording) longest.current = Math.max(longest.current, status.durationMillis);
  }, [status.isRecording, status.durationMillis]);

  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => {});
    return next;
  }, []);

  const start = useCallback(
    () =>
      serial(async (): Promise<StartResult> => {
        if (active.current) return 'recording';
        const permission = await requestRecordingPermissionsAsync().catch(() => null);
        if (!permission?.granted) return 'denied';
        try {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync();
          longest.current = 0;
          uri.current = recorder.uri;
          // forDuration is a backstop; the screen also stops at MAX_RECORDING_MS.
          recorder.record({ forDuration: MAX_RECORDING_MS / 1000 });
          active.current = true;
          return 'recording';
        } catch {
          await recordingSessionOff();
          return 'failed';
        }
      }),
    [recorder, serial],
  );

  const stop = useCallback(
    () =>
      serial(async (): Promise<RecordingResult | null> => {
        if (!active.current) return null;
        active.current = false;
        let durationMs = longest.current;
        try {
          durationMs = Math.max(durationMs, recorder.getStatus().durationMillis);
          await recorder.stop();
        } catch {
          // Already stopped (e.g. by forDuration).
        }
        await recordingSessionOff();
        let file = uri.current;
        try {
          file = recorder.uri ?? file;
        } catch {
          // Released.
        }
        return file ? { transcript: '', durationMs, uri: file } : null;
      }),
    [recorder, serial],
  );

  const cancel = useCallback(
    () =>
      serial(async () => {
        const file = uri.current;
        const wasActive = active.current;
        active.current = false;
        uri.current = null;
        if (wasActive) {
          try {
            await recorder.stop();
          } catch {
            // Released or already stopped.
          }
          await recordingSessionOff();
        }
        deleteLocalRecording(file);
      }),
    [recorder, serial],
  );

  // Leaving the screen mid-recording discards it.
  useEffect(
    () => () => {
      if (active.current) void cancel();
    },
    [cancel],
  );

  return { start, stop, cancel, isRecording: status.isRecording, durationMs: status.durationMillis, level: levelFromDb(status.metering) };
}

/* ───────────── Simulated recording (demo mode) ───────────── */

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

/** Permission gate for the simulation (always granted). The real path asks in `useVoiceRecorder().start()`. */
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
