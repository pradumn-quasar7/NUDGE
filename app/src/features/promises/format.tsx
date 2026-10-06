import { Num, Txt, type TxtProps } from '@/components';
import { commitmentRisk } from '@/data/selectors';
import type { Channel, Commitment } from '@/data/types';
import { DAY_MS, dayDiff, dueLabel, hoursUntil, shortDay, startOfDay, time12 } from '@/lib/format';

export const channelLabel: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Call',
  email: 'Email',
  instagram: 'Instagram',
  manual: 'Note',
  upi: 'UPI',
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 6:00 pm" */
export function dueWhen(ts: number, now = Date.now()) {
  return `${shortDay(ts, now)}, ${time12(ts)}`;
}

/** "Today, Tue 6 Oct" */
export function dueDay(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const rel = shortDay(ts, now);
  const full = `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
  return rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ${full}` : full;
}

/** Badge copy for a promise: "At risk · due in 7 h", "On track · due tomorrow". */
export function riskLine(c: Commitment, now = Date.now()) {
  const r = commitmentRisk(c, now);
  const h = hoursUntil(c.dueAt, now);
  if (r === 'done') return 'Done';
  if (r === 'overdue') {
    const d = -dayDiff(c.dueAt, now);
    return d > 0 ? `Overdue · ${d}d` : `Overdue · ${Math.max(1, -h)} h`;
  }
  if (r === 'at_risk') return h >= 1 ? `At risk · due in ${h} h` : 'At risk · due now';
  // Lower-case only the leading "Due" so weekday and month names keep their capitals ("due Sat").
  return `On track · ${dueLabel(c.dueAt, now).replace(/^Due/, 'due')}`;
}

/** "Due today · asked on Sat" — the second half only when the customer asked for it. */
export function promiseMeta(c: Commitment, now = Date.now()) {
  const asked = c.quoteBy && c.quoteBy.toLowerCase() !== 'you' ? ` · asked ${shortDay(c.createdAt, now) === 'Yesterday' ? 'yesterday' : `on ${shortDay(c.createdAt, now)}`}` : '';
  return `${dueLabel(c.dueAt, now)}${asked}`;
}

/** Snooze choices: Tonight / Tomorrow / Mon. */
export function snoozeOptions(now = Date.now()) {
  const t0 = startOfDay(now);
  const tonight = t0 + 20 * 3_600_000;
  const first = tonight - now > 30 * 60_000 ? { label: 'Tonight', until: tonight } : { label: 'In 2 hours', until: now + 2 * 3_600_000 };
  const day = new Date(now).getDay();
  let toMon = (1 - day + 7) % 7 || 7;
  if (toMon === 1) toMon = 8;
  return [
    first,
    { label: 'Tomorrow', until: t0 + DAY_MS + 10 * 3_600_000 },
    { label: toMon === 8 ? 'Next Mon' : 'Mon', until: t0 + toMon * DAY_MS + 10 * 3_600_000 },
  ];
}

/** Body text with ₹ amounts set in Geist Mono. */
export function MoneyText({ children, size = 15, style, ...props }: TxtProps & { children: string; size?: number }) {
  const parts = children.split(/(₹[\d,]+(?:\.\d+)?)/g);
  return (
    <Txt {...props} style={[{ fontSize: size }, style]}>
      {parts.map((p, i) =>
        /^₹/.test(p) ? (
          <Num key={i} style={{ fontSize: size }}>
            {p}
          </Num>
        ) : (
          p
        ),
      )}
    </Txt>
  );
}
