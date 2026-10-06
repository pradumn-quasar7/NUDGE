/** Formatting helpers. Currency uses Indian digit grouping (₹1,12,000), the product's home market. */

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Stable small hash so a name always gets the same avatar tint. */
export function nameHash(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function inr(amount: number, opts: { compact?: boolean } = {}) {
  if (opts.compact) {
    if (amount >= 1_00_00_000) return `₹${trim(amount / 1_00_00_000)}Cr`;
    if (amount >= 1_00_000) return `₹${trim(amount / 1_00_000)}L`;
    if (amount >= 1_000) return `₹${trim(amount / 1_000)}k`;
  }
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function trim(n: number) {
  return n.toFixed(1).replace(/\.0$/, '');
}

const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function startOfDay(d: Date | number) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function dayDiff(a: number, b: number = Date.now()) {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}

export function time(ts: number) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function time12(ts: number) {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Yesterday", "Mon" (this week), "Sep 30". */
export function shortDay(ts: number, now = Date.now()) {
  const diff = dayDiff(ts, now);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return WEEKDAYS[new Date(ts).getDay()];
  if (diff < 0 && diff > -7) return WEEKDAYS[new Date(ts).getDay()];
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Relative age for lists: "Mon", "2d", "Sep 30". */
export function ago(ts: number, now = Date.now()) {
  const diff = -dayDiff(ts, now);
  if (diff <= 0) return time(ts);
  if (diff < 7) return `${diff}d`;
  return shortDay(ts, now);
}

export function longDate(ts: number) {
  const d = new Date(ts);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

export function monthYear(ts: number) {
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthName(ts: number) {
  return MONTHS_LONG[new Date(ts).getMonth()];
}

/** "Due today", "Due tomorrow", "Due Fri", "Overdue · 2d". */
export function dueLabel(ts: number, now = Date.now()) {
  const diff = dayDiff(ts, now);
  if (ts < now && diff < 0) return `Overdue · ${-diff}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 7) return `Due ${WEEKDAYS[new Date(ts).getDay()]}`;
  return `Due ${shortDay(ts, now)}`;
}

export function hoursUntil(ts: number, now = Date.now()) {
  return Math.round((ts - now) / 3_600_000);
}

/** "yesterday", "today", "on Mon", "on Sep 30" — for "promised …" phrases. */
export function relDay(ts: number, now = Date.now()) {
  const d = shortDay(ts, now);
  return d === 'Today' || d === 'Yesterday' || d === 'Tomorrow' ? d.toLowerCase() : `on ${d}`;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const DAY_MS = DAY;
