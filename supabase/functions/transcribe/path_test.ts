// deno test supabase/functions/transcribe/path_test.ts
import { checkVoicePath, cleanTranscript } from "./path.ts";
import { bytesToBase64, geminiAudioMimeType } from "../_shared/gemini.ts";

const ORG = "b1000000-0000-4000-8000-000000000001";
const ME = "b2000000-0000-4000-8000-000000000001";
const OTHER = "b2000000-0000-4000-8000-000000000002";
const FILE = "0f8fad5b-d9cb-469f-a165-70867728950e.m4a";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("checkVoicePath accepts only the caller's own folder", () => {
  assertEquals(checkVoicePath(`${ORG}/${ME}/${FILE}`, ORG, ME), { ok: true, fileName: FILE });
  assertEquals(checkVoicePath(`${ORG}/${OTHER}/${FILE}`, ORG, ME).ok, false, "other member");
  assertEquals(checkVoicePath(`${OTHER}/${ME}/${FILE}`, ORG, ME).ok, false, "other org");
  assertEquals(checkVoicePath(`${ORG}/${FILE}`, ORG, ME).ok, false, "no member folder");
  assertEquals(checkVoicePath(`${ORG}/${ME}/x/${FILE}`, ORG, ME).ok, false, "nested");
  assertEquals(checkVoicePath(`${ORG}/${ME}/..`, ORG, ME).ok, false, "dot-dot");
  assertEquals(checkVoicePath(`${ORG}/${ME}/.hidden`, ORG, ME).ok, false, "leading dot");
  assertEquals(checkVoicePath(`${ORG}/${ME}/a..m4a`, ORG, ME).ok, false, "embedded dot-dot");
  assertEquals(checkVoicePath(`/${ORG}/${ME}/${FILE}`, ORG, ME).ok, false, "leading slash");
  assertEquals(checkVoicePath("", ORG, ME).ok, false, "empty");
  assertEquals(checkVoicePath(`${ORG}/${ME}/${FILE}`, "not-a-uuid", ME).ok, false, "bad org id");
});

Deno.test("geminiAudioMimeType maps MP4 audio to audio/m4a and rejects non-audio", () => {
  assertEquals(geminiAudioMimeType("audio/mp4", FILE), "audio/m4a");
  assertEquals(geminiAudioMimeType("audio/x-m4a"), "audio/m4a");
  assertEquals(geminiAudioMimeType("audio/mpeg; charset=binary"), "audio/mpeg");
  assertEquals(geminiAudioMimeType("application/octet-stream", FILE), "audio/m4a", "falls back to extension");
  assertEquals(geminiAudioMimeType("", "note.webm"), "audio/webm");
  assertEquals(geminiAudioMimeType("image/png", "x.png"), null);
  assertEquals(geminiAudioMimeType(null, "x"), null);
});

Deno.test("bytesToBase64 matches btoa for small and chunk-crossing inputs", () => {
  assertEquals(bytesToBase64(new Uint8Array([104, 105])), btoa("hi"));
  const big = new Uint8Array(0x8000 * 2 + 7).map((_, i) => (i * 31) % 256);
  assertEquals(bytesToBase64(big), btoa(String.fromCharCode(...Array.from(big))));
});

Deno.test("cleanTranscript trims and collapses whitespace, keeps paragraphs", () => {
  assertEquals(cleanTranscript("  Rahul ko   50 units\nchahiye.  "), "Rahul ko 50 units chahiye.");
  assertEquals(cleanTranscript("One.\r\n\r\n\r\nTwo."), "One.\n\nTwo.");
  assertEquals(cleanTranscript(" \n "), "");
});
