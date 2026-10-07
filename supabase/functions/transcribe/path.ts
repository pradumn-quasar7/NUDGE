// Pure helpers for the transcribe function (unit-tested in path_test.ts).

import { UUID_RE } from "../_shared/auth.ts";

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * A voice-note object name is exactly '{org_id}/{member_id}/{file}' and must be in the
 * caller's own folder — the same rule as the Storage policies and save_capture.
 */
export function checkVoicePath(path: string, orgId: string, memberId: string): { ok: true; fileName: string } | { ok: false } {
  if (!path || path.length > 300 || !UUID_RE.test(orgId) || !UUID_RE.test(memberId)) return { ok: false };
  const parts = path.split("/");
  if (parts.length !== 3) return { ok: false };
  const [org, member, file] = parts;
  if (org.toLowerCase() !== orgId.toLowerCase() || member.toLowerCase() !== memberId.toLowerCase()) return { ok: false };
  if (!FILE_RE.test(file) || file.includes("..")) return { ok: false };
  return { ok: true, fileName: file };
}

/** Trims the model's transcript and collapses runs of whitespace (keeps paragraph breaks). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}
