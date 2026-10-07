// Pure helpers for the draft-message function (unit-tested in policy_test.ts).

import { localParts, timeToMinutes } from "../_shared/time.ts";

export type DraftChannel = "whatsapp" | "sms" | "email";
export type DraftIntent = "reply" | "quote_follow_up" | "payment_reminder" | "check_in" | "custom";
export type ContactMethod = "whatsapp" | "call" | "sms" | "email";

export const DRAFT_CHANNELS: readonly DraftChannel[] = ["whatsapp", "sms", "email"];

/** Phone → E.164 digits without '+'. 10-digit numbers are taken as Indian mobiles (the product's home market). */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Channels we can actually open for this customer: a phone number gives WhatsApp + SMS, an email gives Email. */
export function availableChannels(c: { phone: string | null; email: string | null }): DraftChannel[] {
  const out: DraftChannel[] = [];
  if (phoneDigits(c.phone)) out.push("whatsapp", "sms");
  if (c.email && EMAIL_RE.test(c.email.trim())) out.push("email");
  return out;
}

/** Contact policy method first, then the customer's usual channel, then whatever we can open. */
export function preferredChannel(
  available: DraftChannel[],
  method: ContactMethod | null | undefined,
  customerChannel: string | null | undefined,
): DraftChannel {
  const wanted: DraftChannel[] = [];
  if (method === "whatsapp" || method === "sms" || method === "email") wanted.push(method);
  if (method === "call") wanted.push("whatsapp", "sms");
  if (customerChannel === "whatsapp") wanted.push("whatsapp");
  if (customerChannel === "email") wanted.push("email");
  if (customerChannel === "phone") wanted.push("sms");
  for (const w of wanted) if (available.includes(w)) return w;
  return available[0] ?? (wanted[0] ?? "whatsapp");
}

/** Intent from the promise / suggestion when the app didn't say. */
export function inferIntent(opts: { commitmentTitle?: string | null; suggestionBucket?: string | null; suggestionLabel?: string | null }): DraftIntent {
  const t = `${opts.commitmentTitle ?? ""} ${opts.suggestionLabel ?? ""}`.toLowerCase();
  if (/quot/.test(t)) return "quote_follow_up";
  if (/payment|pay link|invoice|balance/.test(t)) return "payment_reminder";
  if (opts.suggestionBucket === "waiting" && !opts.commitmentTitle) return "check_in";
  return "reply";
}

/** "6 pm", "6:30 pm", "12 pm" from "18:00:00". */
export function clock(value: string): string {
  const m = timeToMinutes(value);
  const h24 = Math.floor(m / 60) % 24;
  const min = m % 60;
  const h = h24 % 12 || 12;
  return `${h}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "am" : "pm"}`;
}

/** Whether `now` (in `timeZone`) falls inside the daily window [start, end); the window may wrap midnight. */
export function insideWindow(now: Date, timeZone: string, start: string, end: string): boolean {
  const p = localParts(now, timeZone);
  const cur = p.hour * 60 + p.minute;
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === e) return true;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** "after 6 pm", "before 11 am", "between 10 am and 8 pm". */
export function windowPhrase(start: string, end: string): string {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (e === 0 || e >= 23 * 60 + 30 || s > e) return `after ${clock(start)}`;
  if (s === 0) return `before ${clock(end)}`;
  return `between ${clock(start)} and ${clock(end)}`;
}

export type PolicyFacts = {
  firstName: string;
  now: Date;
  timeZone: string;
  hoursStart: string | null;
  hoursEnd: string | null;
  maxPerWeek: number | null;
  outboundLast7d: number;
  method: ContactMethod | null;
};

/**
 * One calm line for the draft sheet when the contact policy suggests waiting — never a block
 * (opt-out is handled before drafting). null when nothing applies.
 */
export function sendHint(f: PolicyFacts): string | null {
  if (f.maxPerWeek != null && f.outboundLast7d >= f.maxPerWeek) {
    return `You’ve messaged ${f.firstName} ${f.outboundLast7d}× this week · their limit is ${f.maxPerWeek}`;
  }
  if (f.hoursStart && f.hoursEnd && !insideWindow(f.now, f.timeZone, f.hoursStart, f.hoursEnd)) {
    return `${f.firstName} prefers messages ${windowPhrase(f.hoursStart, f.hoursEnd)}`;
  }
  if (f.method === "call") return `${f.firstName} usually prefers a call`;
  return null;
}

const HINGLISH = /\b(hai|hain|kya|karo|karna|kar|bhej|bhejo|bhejna|ji|kal|chahiye|aap|aapka|nahi|nahin|haan|theek|thik|accha|acha|bhai|abhi|kitna|kab|sir ji|ho jayega|dena|dijiye)\b/gi;

/** Rough register of the customer's own messages, as a hint for the model (it decides). */
export function guessLanguage(customerTexts: string[]): "Hinglish" | "Hindi" | "English" | "Unknown" {
  const text = customerTexts.join(" ").trim();
  if (!text) return "Unknown";
  if (/[ऀ-ॿ]/.test(text)) return "Hindi";
  const words = text.split(/\s+/).length;
  const hits = text.match(HINGLISH)?.length ?? 0;
  return hits >= 2 || (words > 0 && hits / words > 0.08) ? "Hinglish" : "English";
}

const EMOJI = /\p{Extended_Pictographic}️?/gu;

export function usesEmoji(texts: string[]): boolean {
  return texts.some((t) => /\p{Extended_Pictographic}/u.test(t));
}

/** Tidies the model's message: no wrapping quotes, no emoji unless the customer uses them, sane whitespace. */
export function cleanBody(body: string, allowEmoji: boolean): string {
  let out = body.replace(/\r\n?/g, "\n").trim();
  if (/^["“].*["”]$/s.test(out)) out = out.slice(1, -1).trim();
  if (!allowEmoji) out = out.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.!?;:])/g, "$1");
  return out
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}
