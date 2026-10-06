// Timezone helpers (Intl only; Deno ships full ICU data).

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-05" in the given zone. */
export function localDate(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "Mon 2026-10-05 18:42" in the given zone — unambiguous for prompts. */
export function localStamp(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.weekday} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "6:42 pm" */
export function clockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(date)
    .replace(/\s?([AP]M)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
}

/** UTC offset of `timeZone` at `date`, e.g. "+05:30". */
export function utcOffset(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const minutes = Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "17:00:00" → minutes after midnight. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Earliest moment ≥ `now` that falls inside the daily window [start, end) in `timeZone`.
 * The window may wrap midnight (e.g. 21:00–07:00). Returns `now` when already inside.
 */
export function nextWindowStart(now: Date, timeZone: string, start: string, end: string): Date {
  const p = localParts(now, timeZone);
  const cur = p.hour * 60 + p.minute;
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  const inside = s <= e ? cur >= s && cur < e : cur >= s || cur < e;
  if (inside || s === e) return now;
  const wait = (s - cur + 1440) % 1440;
  // Align to the start of the minute (all zone offsets are whole minutes).
  return new Date(now.getTime() + wait * 60_000 - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
