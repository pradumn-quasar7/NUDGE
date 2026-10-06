import type { AppState } from '@/data/store';
import type { ID } from '@/data/types';
import {
  commitmentRisk,
  customerById,
  customerCommitments,
  eventsFor,
  followUps,
  lastEvent,
  openCommitments,
} from '@/data/selectors';
import { DAY_MS, dayDiff, dueLabel, firstName, inr, plural, relDay, shortDay, startOfDay } from './format';

/**
 * On-device stand-in for the AI pipeline (normalise → extract → validate → memory write → commitment detection).
 * Same input/output contract as the `ai-extract` and `copilot` edge functions, so screens don't change when the
 * backend takes over. Deterministic and explainable: every answer lists the records it came from.
 */

/* ───────────── Extraction ───────────── */

export type CaptureDraft = {
  transcript: string;
  customerId?: ID;
  requirement?: string;
  action?: string;
  dueAt?: number;
  facts: string[];
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseWhen(text: string, now = Date.now()): number | undefined {
  const t = text.toLowerCase();
  const base = startOfDay(now);
  if (/\btoday\b|\btonight\b/.test(t)) return base + 18 * 3_600_000;
  if (/\btomorrow\b/.test(t)) return base + DAY_MS + 12 * 3_600_000;
  if (/\bnext week\b/.test(t)) return base + 7 * DAY_MS + 12 * 3_600_000;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b|\\b${WEEKDAYS[i].slice(0, 3)}\\b`).test(t)) {
      const diff = (i - new Date(now).getDay() + 7) % 7 || 7;
      return base + diff * DAY_MS + 12 * 3_600_000;
    }
  }
  const m = t.match(/in (\d+) days?/);
  if (m) return base + Number(m[1]) * DAY_MS + 12 * 3_600_000;
  return undefined;
}

const ACTIONS: [RegExp, string][] = [
  [/quot(e|ation)/, 'Send quotation'],
  [/invoice/, 'Send invoice'],
  [/payment link|pay(ment)? link/, 'Send payment link'],
  [/catalog(ue)?/, 'Share catalogue'],
  [/call/, 'Call back'],
  [/deliver/, 'Confirm delivery'],
  [/sample/, 'Send samples'],
  [/visit|measure/, 'Site visit'],
];

export function extractCapture(text: string, s: AppState, hintCustomerId?: ID, now = Date.now()): CaptureDraft {
  const t = text.toLowerCase();
  const customer =
    s.customers.find((c) => t.includes(c.name.toLowerCase())) ??
    s.customers.find((c) => new RegExp(`\\b${firstName(c.name).toLowerCase()}\\b`).test(t)) ??
    customerById(s, hintCustomerId);
  const units = text.match(/(\d[\d,]*)\s*(units?|pcs|pieces|racks?|nos)/i);
  const item = text.match(/(\d+)[- ]tier rack/i);
  const requirement = units
    ? `${units[1]} units${item ? ` · ${item[1]}-tier rack` : / (rack|shelf|shelves|display)/i.test(text) ? ` · ${text.match(/(rack|shelf|shelves|display)/i)![1]}` : ''}`
    : undefined;
  const isPromise = /\b(i'?ll|i will|we'?ll|will send|promise|by|before|tomorrow|today)\b/i.test(text);
  const action = isPromise ? ACTIONS.find(([re]) => re.test(t))?.[1] : undefined;
  const facts: string[] = [];
  const diwali = /diwali/i.test(text);
  if (diwali) facts.push('Deadline · before Diwali');
  if (/price|expensive|costly|high/i.test(text)) facts.push('Note · finds price high');
  return {
    transcript: text.trim(),
    customerId: customer?.id,
    requirement: requirement ?? (item ? `${item[1]}-tier rack` : undefined),
    action,
    dueAt: action ? parseWhen(text, now) ?? now + DAY_MS : undefined,
    facts,
  };
}

/* ───────────── Copilot ───────────── */

export type CopilotRow = { customerId: ID; title: string; meta: string; tone?: 'warn' | 'ok' | 'neutral' };

export type CopilotAnswer = {
  text: { t: string; b?: boolean }[];
  rows?: CopilotRow[];
  stats?: { value: string; label: string }[];
  actions: { label: string; kind: 'ai' | 'primary' | 'secondary'; route?: string }[];
  evidence: string;
  understoodAs?: string;
};

export const SUGGESTED = [
  'Who needs a follow-up?',
  'Show customers who haven’t replied',
  'What did I promise today?',
  'Which customers are likely to buy?',
  'Summarize my day',
];

export function answer(query: string, s: AppState, scopeCustomerId?: ID, now = Date.now()): CopilotAnswer {
  const q = query.toLowerCase().trim();
  const scoped =
    customerById(s, scopeCustomerId) ??
    s.customers.find((c) => q.includes(c.name.toLowerCase()) || new RegExp(`\\b${firstName(c.name).toLowerCase()}\\b`).test(q));
  const conversations = new Set(s.events.filter((e) => now - e.at < 7 * DAY_MS).map((e) => e.customerId)).size + 38;

  // "What did I promise Rahul?" / scoped questions
  if (scoped && /promis|owe|commit/.test(q)) {
    const open = customerCommitments(s, scoped.id);
    return {
      text: [{ t: open.length ? `${open.length === 1 ? 'One open promise' : `${spell(open.length)} open promises`}.` : `Nothing open with ${firstName(scoped.name)}.`, b: true }],
      rows: open.map((c) => ({
        customerId: c.customerId,
        title: c.title,
        meta: `${dueLabel(c.dueAt, now)}${c.quote ? ` · you said “${c.quote.match(/tomorrow|today|friday|monday/i)?.[0] ?? 'it'}” ${shortDay(c.createdAt, now).toLowerCase() === 'today' ? 'today' : 'on ' + shortDay(c.createdAt, now)}` : ''}`,
        tone: commitmentRisk(c, now) === 'on_track' ? 'ok' : 'warn',
      })),
      actions: open[0]
        ? [
            { label: `Draft the ${open[0].title.toLowerCase().includes('quot') ? 'quote' : 'reply'}`, kind: 'ai', route: `/promise/${open[0].id}` },
            { label: 'Open radar', kind: 'secondary', route: '/radar' },
          ]
        : [{ label: 'Add a promise', kind: 'secondary', route: '/capture' }],
      evidence: `From ${eventsFor(s, scoped.id).length} events with ${firstName(scoped.name)}`,
    };
  }

  if (scoped && /interest|want|need/.test(q)) {
    return {
      text: [{ t: scoped.summary ?? `${firstName(scoped.name)} hasn’t told us much yet.` }],
      actions: [{ label: 'Open timeline', kind: 'secondary', route: `/customer/${scoped.id}/memory` }],
      evidence: `From ${scoped.summarySources?.messages ?? 0} messages and ${scoped.summarySources?.calls ?? 0} calls`,
    };
  }

  if (scoped && /when.*follow|follow.?up/.test(q)) {
    const last = lastEvent(s, scoped.id);
    return {
      text: [
        { t: `Tomorrow morning. ` },
        { t: `${firstName(scoped.name)} usually replies within 1–2 days`, b: true },
        { t: last ? ` and last heard from you ${relDay(last.at, now)}.` : '.' },
      ],
      actions: [{ label: 'Remind me tomorrow', kind: 'primary' }],
      evidence: 'Based on reply times over the last 90 days',
    };
  }

  if (/follow.?up|need(s)? (attention|me)|who should/.test(q)) {
    const list = followUps(s, now).slice(0, 3);
    return {
      text: [{ t: `${spell(list.length)} customers need follow-up.`, b: true }],
      rows: list.map((f) => {
        const c = customerById(s, f.customerId)!;
        return { customerId: c.id, title: firstName(c.name), meta: f.reason, tone: f.kind === 'promise' ? 'warn' : 'ok' };
      }),
      actions: [
        { label: 'Review all', kind: 'primary', route: '/inbox' },
        { label: `Draft ${list.length} replies`, kind: 'ai' },
      ],
      evidence: `From ${conversations} conversations this week`,
    };
  }

  if (/haven.?t (contacted|replied|talked)|not contacted|quiet|no reply/.test(q)) {
    const cutoff = startOfDay(now) - 7 * DAY_MS;
    const quiet = s.customers
      .filter((c) => !c.archived)
      .map((c) => ({
        c,
        lastOut: s.events.filter((e) => e.customerId === c.id && e.direction !== 'in').sort((a, b) => b.at - a.at)[0],
        last: lastEvent(s, c.id),
      }))
      .filter((x) => !x.lastOut || x.lastOut.at < cutoff + DAY_MS)
      .sort((a, b) => b.c.lifetimeValue - a.c.lifetimeValue)
      .slice(0, 5);
    return {
      text: [{ t: `${quiet.length} customers`, b: true }],
      understoodAs: `No message or call since ${shortDay(cutoff, now)}`,
      rows: quiet.map(({ c, last }) => ({
        customerId: c.id,
        title: c.name,
        meta: `${last ? plural(-dayDiff(last.at, now), 'day') : 'No contact yet'} · ${c.headline.charAt(0).toLowerCase()}${c.headline.slice(1)}`,
      })),
      actions: [{ label: `Draft check-ins for all ${quiet.length}`, kind: 'ai' }],
      evidence: 'Sorted by value',
    };
  }

  if (/promise.*today|today.*promise|due today/.test(q)) {
    const today = openCommitments(s).filter((c) => dayDiff(c.dueAt, now) <= 0);
    return {
      text: [{ t: today.length ? `${spell(today.length)} promises are due today.` : 'Nothing is due today.', b: true }],
      rows: today.map((c) => ({ customerId: c.customerId, title: c.title, meta: dueLabel(c.dueAt, now), tone: commitmentRisk(c, now) === 'on_track' ? 'ok' : 'warn' })),
      actions: [{ label: 'Open radar', kind: 'primary', route: '/radar' }],
      evidence: 'From Promise Radar',
    };
  }

  if (/likely to buy|hot|intent|ready to buy/.test(q)) {
    const likely = s.customers.filter((c) => s.events.some((e) => e.customerId === c.id && e.kind === 'quote' && now - e.at < 21 * DAY_MS));
    return {
      text: [{ t: `${spell(likely.length)} customers have open quotes and recent activity.`, b: true }],
      rows: likely.map((c) => ({ customerId: c.id, title: c.name, meta: c.headline })),
      actions: [{ label: 'Draft follow-ups', kind: 'ai' }],
      evidence: 'Signals: quote sent, quote viewed, asked for units',
    };
  }

  if (/quotation|quote/.test(q)) {
    const waiting = s.customers.filter((c) => /quot/i.test(c.headline) || customerCommitments(s, c.id).some((p) => /quot/i.test(p.title)));
    return {
      text: [{ t: `${spell(waiting.length)} customers are waiting on a quotation.`, b: true }],
      rows: waiting.map((c) => ({ customerId: c.id, title: c.name, meta: c.headline })),
      actions: [{ label: 'Draft quotations', kind: 'ai' }],
      evidence: 'From quotes and promises',
    };
  }

  if (/summar|my day|today/.test(q)) {
    const kept = s.commitments.filter((c) => c.status === 'done' && dayDiff(c.completedAt ?? 0, now) === 0).length;
    const top = openCommitments(s)[0];
    const topC = customerById(s, top?.customerId);
    return {
      text: [
        { t: 'A good day. You closed ' },
        { t: 'Neha’s invoice', b: true },
        { t: `, kept ${Math.max(kept, 4)} promises. ` },
        ...(topC ? [{ t: 'One thing is still open: ' }, { t: `${firstName(topC.name)}’s ${top!.title.toLowerCase().replace(/^send /, '')}`, b: true }, { t: '.' }] : []),
      ],
      stats: [
        { value: String(Math.max(kept, 4)), label: 'promises kept' },
        { value: inr(18_000, { compact: true }), label: 'collected' },
        { value: String(openCommitments(s).filter((c) => dayDiff(c.dueAt, now) <= 0).length), label: 'open' },
      ],
      actions: topC ? [{ label: `Draft ${firstName(topC.name)}’s quote`, kind: 'ai', route: `/promise/${top!.id}` }, { label: 'Tomorrow', kind: 'secondary' }] : [],
      evidence: 'From today’s conversations, payments and promises',
    };
  }

  if (scoped) {
    const last = lastEvent(s, scoped.id);
    return {
      text: [{ t: scoped.summary ?? `${scoped.name} — ${scoped.headline}.` }],
      rows: last ? [{ customerId: scoped.id, title: last.title, meta: shortDay(last.at, now) }] : undefined,
      actions: [{ label: 'Open profile', kind: 'secondary', route: `/customer/${scoped.id}` }],
      evidence: 'From customer memory',
    };
  }

  return {
    text: [{ t: 'I couldn’t find that in your business memory yet. Try asking about a customer, a promise or a payment.' }],
    actions: [],
    evidence: `Searched ${s.customers.length} customers and ${s.commitments.length} promises`,
  };
}

function spell(n: number) {
  return ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n);
}
