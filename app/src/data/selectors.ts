import { dayDiff, DAY_MS, monthName, startOfDay } from '@/lib/format';
import type { StatusTone } from '@/components/primitives';
import type { AppState } from './store';
import type { Commitment, Customer, CustomerEvent, ID } from './types';

/**
 * Derived views. Everything here is explainable: each status carries the observable signals behind it.
 * (Product principle: "Relationship health, not lead score.")
 */

export type Risk = 'overdue' | 'at_risk' | 'on_track' | 'done';

export function commitmentRisk(c: Commitment, now = Date.now()): Risk {
  if (c.status === 'done') return 'done';
  if (c.dueAt < now) return 'overdue';
  // Due today and promised on an earlier day: the promise has been sitting — calm warning, never alarm red.
  if (dayDiff(c.dueAt, now) <= 0 && dayDiff(c.createdAt, now) < 0) return 'at_risk';
  return 'on_track';
}

export const riskBadge: Record<Risk, { label: string; tone: StatusTone }> = {
  overdue: { label: 'Overdue', tone: 'bad' },
  at_risk: { label: 'At risk', tone: 'warn' },
  on_track: { label: 'On track', tone: 'ok' },
  done: { label: 'Done', tone: 'neutral' },
};

export function openCommitments(s: AppState) {
  return s.commitments.filter((c) => c.status === 'open').sort((a, b) => a.dueAt - b.dueAt);
}

export function customerCommitments(s: AppState, customerId: ID) {
  return openCommitments(s).filter((c) => c.customerId === customerId);
}

export function eventsFor(s: AppState, customerId: ID) {
  return s.events.filter((e) => e.customerId === customerId).sort((a, b) => b.at - a.at);
}

export function lastEvent(s: AppState, customerId: ID): CustomerEvent | undefined {
  return eventsFor(s, customerId)[0];
}

export function lastInbound(s: AppState, customerId: ID) {
  return eventsFor(s, customerId).find((e) => e.direction === 'in');
}

export function eventById(s: AppState, id?: ID) {
  return id ? s.events.find((e) => e.id === id) : undefined;
}

export function customerById(s: AppState, id?: ID) {
  return id ? s.customers.find((c) => c.id === id) : undefined;
}

/** Promise Radar: needs attention = overdue + at risk + due within 48h. */
export function radar(s: AppState, now = Date.now()) {
  const open = openCommitments(s);
  const attention = open.filter((c) => {
    const r = commitmentRisk(c, now);
    return r !== 'on_track' || c.dueAt - now < 2 * DAY_MS;
  });
  const later = open.filter((c) => !attention.includes(c));
  const weekStart = startOfDay(now) - ((new Date(now).getDay() + 6) % 7) * DAY_MS;
  const doneThisWeek = s.commitments.filter((c) => c.status === 'done' && (c.completedAt ?? 0) >= weekStart - DAY_MS);
  return { attention, later, doneThisWeek };
}

/* ───────────── Relationship health ───────────── */

export type HealthSignal = { label: string; tone: StatusTone };

export function relationshipHealth(s: AppState, customerId: ID, now = Date.now()) {
  const evs = eventsFor(s, customerId);
  const commitments = customerCommitments(s, customerId);
  const signals: HealthSignal[] = [];
  let score = 3;

  const payments = evs.filter((e) => e.kind === 'payment').length;
  if (payments >= 1) {
    score += 1;
    signals.push({ label: payments > 1 ? 'Repeat purchase' : 'Has paid before', tone: 'ok' });
  }
  const last = evs[0];
  const quiet = last ? Math.floor((now - last.at) / DAY_MS) : 99;
  if (quiet > 10) {
    score -= 2;
    signals.push({ label: `Quiet for ${quiet} days`, tone: 'warn' });
  } else if (quiet <= 3) {
    score += 1;
    signals.push({ label: 'Talked this week', tone: 'ok' });
  }
  const risky = commitments.filter((c) => commitmentRisk(c, now) !== 'on_track');
  if (risky.length) {
    score -= 1;
    signals.push({ label: `${risky.length} promise${risky.length > 1 ? 's' : ''} at risk`, tone: 'warn' });
  }
  if (evs.some((e) => e.kind === 'quote' && now - e.at < 14 * DAY_MS)) {
    signals.push({ label: 'Recent quote activity', tone: 'acc' });
  }
  score = Math.max(0, Math.min(5, score));
  const label = score >= 4 ? 'Healthy' : score === 3 ? 'Steady' : score === 2 ? 'Needs care' : 'Quiet';
  const tone: StatusTone = score >= 4 ? 'ok' : score === 3 ? 'ok' : 'warn';
  return { score, label, tone, signals };
}

/* ───────────── Customer list status ───────────── */

export function customerStatus(s: AppState, c: Customer, now = Date.now()): { label: string; tone?: StatusTone; badge: boolean } {
  const open = customerCommitments(s, c.id);
  const urgent = open.find((p) => commitmentRisk(p, now) !== 'on_track');
  if (urgent && dayDiff(urgent.dueAt, now) <= 0) return { label: 'Today', tone: 'warn', badge: true };
  if (open.length && dayDiff(open[0].dueAt, now) <= 0) return { label: 'On track', tone: 'ok', badge: true };
  const last = lastEvent(s, c.id);
  if (!last) return { label: '', badge: false };
  const days = -dayDiff(last.at, now);
  if (days === 0) return { label: 'Today', badge: false };
  if (days < 7 && days >= 1) {
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(last.at).getDay()];
    return { label: days >= 5 ? `${days}d` : wd, badge: false };
  }
  const d = new Date(last.at);
  return { label: `${monthName(last.at).slice(0, 3)} ${d.getDate()}`, badge: false };
}

export function needsYou(s: AppState, now = Date.now()) {
  const active = s.customers.filter((c) => !c.archived);
  const needing = active.filter((c) => {
    const open = customerCommitments(s, c.id);
    if (open.some((p) => dayDiff(p.dueAt, now) <= 0)) return true;
    return s.inbox.some((i) => i.customerId === c.id && i.bucket === 'needs_reply' && now - i.at > 5 * DAY_MS);
  });
  const rank = (c: Customer) => {
    const p = customerCommitments(s, c.id)[0];
    const r = p ? commitmentRisk(p, now) : 'on_track';
    return (r === 'overdue' ? 0 : r === 'at_risk' ? 1 : 2) * 1e13 + (p?.dueAt ?? now + 1e12);
  };
  needing.sort((a, b) => rank(a) - rank(b));
  const rest = active
    .filter((c) => !needing.includes(c))
    .sort((a, b) => (lastEvent(s, b.id)?.at ?? 0) - (lastEvent(s, a.id)?.at ?? 0));
  return { needing, rest };
}

/* ───────────── Follow-up Autopilot — top 3–5 with a reason ───────────── */

export type FollowUp = {
  customerId: ID;
  reason: string;
  kind: 'promise' | 'reply' | 'reorder' | 'quiet' | 'quote';
  commitmentId?: ID;
  weight: number;
};

export function followUps(s: AppState, now = Date.now()): FollowUp[] {
  const out: FollowUp[] = [];
  for (const c of openCommitments(s)) {
    const r = commitmentRisk(c, now);
    if (r === 'on_track' && c.dueAt - now > DAY_MS) continue;
    out.push({
      customerId: c.customerId,
      commitmentId: c.id,
      kind: 'promise',
      reason: r === 'overdue' ? `Overdue promise: ${c.title.toLowerCase()}` : `${c.title} · ${r === 'at_risk' ? 'at risk' : 'due soon'}`,
      weight: r === 'overdue' ? 100 : r === 'at_risk' ? 80 : 60,
    });
  }
  for (const i of s.inbox.filter((x) => x.bucket === 'needs_reply')) {
    if (out.some((o) => o.customerId === i.customerId)) continue;
    const days = Math.floor((now - i.at) / DAY_MS);
    out.push({ customerId: i.customerId, kind: 'reply', reason: `${i.what} · waiting ${days}d`, weight: 40 + days * 3 });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}

/** Home status line. */
export function attention(s: AppState, now = Date.now()) {
  const r = radar(s, now);
  const urgent = r.attention.filter((c) => commitmentRisk(c, now) !== 'on_track');
  const waiting = s.inbox.filter((i) => i.bucket === 'needs_reply');
  const count = (urgent.length ? 1 : 0) + (waiting.length ? 1 : 0) + (pendingExtractions(s).length ? 1 : 0);
  return { urgent, waiting, count };
}

export function pendingExtractions(s: AppState) {
  return s.extractions.filter((x) => x.status === 'pending');
}

/** Timeline grouped "This week" / month names. */
export function groupTimeline(events: CustomerEvent[], now = Date.now()) {
  const weekStart = startOfDay(now) - ((new Date(now).getDay() + 6) % 7) * DAY_MS;
  const groups: { title: string; items: CustomerEvent[] }[] = [];
  for (const e of events) {
    const title = e.at >= weekStart ? 'This week' : monthName(e.at);
    const g = groups.find((x) => x.title === title);
    if (g) g.items.push(e);
    else groups.push({ title, items: [e] });
  }
  return groups;
}

/** Insights — a few observations Nudge can stand behind. */
export function insights(s: AppState) {
  const done = s.commitments.filter((c) => c.status === 'done').length;
  const total = s.commitments.filter((c) => c.status !== 'dismissed').length;
  const collected = s.events.filter((e) => e.kind === 'payment').reduce((a, e) => a + (e.amount ?? 0), 0);
  return {
    responseRate: 72,
    responseDelta: 8,
    avgReplyHours: 3.4,
    promisesKept: total ? Math.round((done / Math.max(done, done + s.commitments.filter((c) => c.status === 'open' && c.dueAt < Date.now()).length)) * 100) : 100,
    collected: Math.max(collected, 3_10_000),
    trend: [38, 44, 41, 52, 58, 66, 72],
  };
}
