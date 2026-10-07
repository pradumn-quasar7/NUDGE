import type { AppState } from '@/data/store';
import { customerCommitments, eventsFor } from '@/data/selectors';
import type { Channel, Commitment, Customer, CustomerEvent, ID, InboxItem } from '@/data/types';
import { dayDiff, firstName, shortDay, time12 } from './format';

/**
 * Message drafts — the on-device side of the `draft-message` edge function: same output contract,
 * deterministic, built only from the store (never invents prices, dates or links: unknowns become
 * placeholders like [price]). Also the helpers that open the person's own WhatsApp / SMS / mail app.
 * Nudge never sends a message itself.
 */

export type DraftIntent = 'reply' | 'quote_follow_up' | 'payment_reminder' | 'check_in' | 'custom';
export type DraftChannel = 'whatsapp' | 'sms' | 'email';

export type Draft = {
  channel: DraftChannel;
  body: string;
  subject: string | null;
  language: string;
  sendHint: string | null;
  evidenceEventIds: ID[];
};

export const DRAFT_CHANNEL_LABEL: Record<DraftChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
export const SEND_LABEL: Record<DraftChannel, string> = { whatsapp: 'Send on WhatsApp', sms: 'Send as SMS', email: 'Send by email' };

/** The timeline channel a sent draft is recorded on (SMS goes out on the phone number). */
export const EVENT_CHANNEL: Record<DraftChannel, Channel> = { whatsapp: 'whatsapp', sms: 'phone', email: 'email' };

/** Same titles as mark_draft_sent() writes on the server. */
export const SENT_TITLE: Record<DraftIntent, string> = {
  quote_follow_up: 'You sent a quotation follow-up',
  payment_reminder: 'You sent a payment reminder',
  check_in: 'You checked in',
  reply: 'You replied',
  custom: 'You sent a message',
};

/** The outbound event recorded on the timeline when a draft was sent (demo mode; cloud: mark_draft_sent()). */
export function sentEvent(input: { customerId: ID; channel: DraftChannel; intent: DraftIntent; body: string; authorId: ID }, now = Date.now()): CustomerEvent {
  return {
    id: `e_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    customerId: input.customerId,
    kind: 'message',
    channel: EVENT_CHANNEL[input.channel],
    direction: 'out',
    at: now,
    title: SENT_TITLE[input.intent],
    body: input.body,
    authorId: input.authorId,
  };
}

/** quote_follow_up when the promise mentions a quote, payment_reminder for payment links, else reply. */
export function intentFor(c?: Pick<Commitment, 'title'> | null, item?: Pick<InboxItem, 'what' | 'bucket' | 'action'> | null): DraftIntent {
  const text = `${c?.title ?? ''} ${item?.what ?? ''} ${item?.action.label ?? ''}`.toLowerCase();
  // Chasing someone who went quiet is a check-in, even when the last thing was a quote.
  if (!c && (item?.bucket === 'waiting' || /^(check in|follow up|nudge)$/.test(item?.action.label.toLowerCase() ?? ''))) return 'check_in';
  if (/quot/.test(text)) return 'quote_follow_up';
  if (/payment|pay link|invoice|send link/.test(text)) return 'payment_reminder';
  return 'reply';
}

/* ───────────── Contact details → channels → links ───────────── */

/** E.164 digits without '+'. 10-digit numbers are taken as Indian mobiles (the product's home market). */
export function phoneDigits(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const isEmail = (v?: string | null) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Only the channels we can actually open: a phone number gives WhatsApp + SMS, an email gives Email. */
export function availableChannels(c?: Pick<Customer, 'phone' | 'email'> | null): DraftChannel[] {
  const out: DraftChannel[] = [];
  if (phoneDigits(c?.phone)) out.push('whatsapp', 'sms');
  if (isEmail(c?.email)) out.push('email');
  return out;
}

export function defaultChannel(c: Pick<Customer, 'phone' | 'email' | 'preferredChannel'> | undefined, preferred?: DraftChannel | null): DraftChannel {
  const av = availableChannels(c);
  const usual: DraftChannel | undefined =
    c?.preferredChannel === 'email' ? 'email' : c?.preferredChannel === 'phone' ? 'sms' : c?.preferredChannel === 'whatsapp' ? 'whatsapp' : undefined;
  for (const w of [preferred, usual, 'whatsapp' as const]) if (w && av.includes(w)) return w;
  return av[0] ?? preferred ?? usual ?? 'whatsapp';
}

/**
 * Links that open the person's own app with the message filled in, best first. WhatsApp tries the app
 * scheme, then wa.me (which also works on the web). Nothing is sent until they tap send there.
 */
export function composeUrls(
  channel: DraftChannel,
  to: { phone?: string | null; email?: string | null },
  body: string,
  subject: string | null,
  os: 'ios' | 'android' | 'web' | string,
): string[] {
  const text = encodeURIComponent(body);
  if (channel === 'email') {
    if (!isEmail(to.email)) return [];
    const q = [subject ? `subject=${encodeURIComponent(subject)}` : '', `body=${text}`].filter(Boolean).join('&');
    return [`mailto:${to.email!.trim()}?${q}`];
  }
  const digits = phoneDigits(to.phone);
  if (!digits) return [];
  if (channel === 'sms') return [os === 'ios' ? `sms:+${digits}&body=${text}` : `sms:+${digits}?body=${text}`];
  const web = `https://wa.me/${digits}?text=${text}`;
  return os === 'web' ? [web] : [`whatsapp://send?phone=${digits}&text=${text}`, web];
}

/* ───────────── Evidence + register ───────────── */

const HINGLISH = /\b(hai|hain|kya|karo|karna|bhej|bhejo|ji|kal|chahiye|aap|aapka|nahi|nahin|haan|theek|thik|accha|acha|bhai|abhi|kitna|kab|dena|dijiye)\b/gi;

export function guessLanguage(texts: string[]): 'English' | 'Hinglish' {
  const t = texts.join(' ');
  const hits = t.match(HINGLISH)?.length ?? 0;
  const words = t.split(/\s+/).filter(Boolean).length;
  return hits >= 2 || (words > 0 && hits / words > 0.08) ? 'Hinglish' : 'English';
}

/** "Based on Rahul’s message on Mon, 6:42 pm" — the first customer message in `events` (most relevant first). */
export function evidenceLine(events: CustomerEvent[], customerName: string, now = Date.now()): string | null {
  if (!events.length) return null;
  const e = events.find((x) => x.direction === 'in') ?? events[0];
  const d = shortDay(e.at, now);
  const when = `${d === 'Today' || d === 'Yesterday' ? d.toLowerCase() : `on ${d}`}, ${time12(e.at)}`;
  const what = e.direction === 'in' ? `${firstName(customerName)}’s ${e.kind === 'call' ? 'call' : 'message'}` : e.kind === 'note' ? 'your note' : 'your reply';
  return `Based on ${what} ${when}`;
}

/* ───────────── Local draft ───────────── */

const PREFERS_AFTER = /prefers (calls|messages|whatsapp|texts)[^.]*?after (\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function hintFromFacts(s: AppState, customerId: ID, first: string, now: number): string | null {
  for (const f of s.facts.filter((x) => x.customerId === customerId && x.kind === 'preference')) {
    const m = f.text.match(PREFERS_AFTER);
    if (!m) continue;
    const h = (Number(m[2]) % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
    const mins = h * 60 + Number(m[3] ?? 0);
    const d = new Date(now);
    if (d.getHours() * 60 + d.getMinutes() < mins) return `${first} prefers ${m[1].toLowerCase()} after ${m[2]}${m[3] ? `:${m[3]}` : ''} ${m[4].toLowerCase()}`;
  }
  return null;
}

/** "send revised quotation" → "send the revised quotation"-style action for "I’ll …", in second person. */
function actionPhrase(title: string, first: string) {
  return title
    .replace(new RegExp(`\\b${first}\\b`, 'g'), 'you')
    .replace(/ (to|with) you$/i, '')
    .replace(/^./, (ch) => ch.toLowerCase());
}

function whenPhrase(dueAt: number, now: number, hi = false) {
  const d = dayDiff(dueAt, now);
  if (hi) return d <= 0 ? `aaj ${time12(dueAt)} tak` : d === 1 ? `kal ${time12(dueAt)} tak` : `${shortDay(dueAt, now)} tak`;
  if (d <= 0) return `today by ${time12(dueAt)}`;
  if (d === 1) return `tomorrow by ${time12(dueAt)}`;
  return `by ${shortDay(dueAt, now)}`;
}

/**
 * Deterministic draft from the store: the customer's words, the open promise and current facts.
 * Same register as the customer (Hinglish if they write it), no emojis, placeholders for unknowns.
 */
export function localDraft(
  s: AppState,
  input: { customerId: ID; commitmentId?: ID; intent: DraftIntent; amount?: number; channel?: DraftChannel },
  now = Date.now(),
): Draft {
  const customer = s.customers.find((c) => c.id === input.customerId);
  const first = firstName(customer?.name ?? 'there');
  const events = eventsFor(s, input.customerId);
  const inbound = events.filter((e) => e.direction === 'in');
  const lastIn = inbound[0];
  const language = guessLanguage(inbound.map((e) => e.body ?? ''));
  const hi = language === 'Hinglish';
  const c = input.commitmentId ? s.commitments.find((x) => x.id === input.commitmentId) : customerCommitments(s, input.customerId)[0];
  const need = s.facts.find((f) => f.customerId === input.customerId && f.kind === 'temporal' && /^needs /i.test(f.text));
  const req = need?.text.replace(/^needs /i, '');
  const discount = inbound.some((e) => /discount/i.test(e.body ?? ''));
  const rupees = input.amount != null ? `₹${Math.round(input.amount).toLocaleString('en-IN')}` : inbound.map((e) => e.body?.match(/₹\s?[\d,]+/)?.[0]).find(Boolean);

  let body: string;
  let subject: string | null = null;
  switch (input.intent) {
    case 'quote_follow_up':
      body = hi
        ? `Hi ${first}, aapka revised quotation ready hai${req ? ` (${req})` : ''}: [quotation PDF]. Total [price] hoga.${discount ? ' Discount ka bhi dekh liya hai.' : ''} Confirm kar dijiye, order book kar dete hain.`
        : `Hi ${first}, here’s the revised quotation${req ? ` for ${req}` : ''}: [quotation PDF]. The total comes to [price].${discount ? ' I’ve also looked at the discount you asked about.' : ''} Let me know if it works and I’ll book the order.`;
      subject = 'Your revised quotation';
      break;
    case 'payment_reminder':
      body = hi
        ? `Hi ${first}, payment link bhej raha hoon${rupees ? ` — balance ${rupees}` : ''}: [payment link]. Thank you!`
        : `Hi ${first}, here’s the payment link${rupees ? ` for the balance of ${rupees}` : ''}: [payment link]. Thank you!`;
      subject = 'Payment link';
      break;
    case 'check_in': {
      const quoted = events.find((e) => e.kind === 'quote' && e.direction === 'out' && /quot/i.test(e.title) && now - e.at < 30 * 86_400_000);
      body = hi
        ? `Hi ${first}, bas check kar raha tha${quoted ? ' quotation ke baare mein' : ''}. Kuch chahiye ho toh batayiye.`
        : `Hi ${first}, just checking in${quoted ? ' on the quotation we sent' : ''}. Happy to help with anything you need.`;
      subject = 'Checking in';
      break;
    }
    case 'custom':
      body = `Hi ${first}, `;
      break;
    default: {
      if (c && /catalog/i.test(`${c.title} ${lastIn?.body ?? ''}`)) {
        body = hi ? `Hi ${first}, yeh raha hamara catalogue: [catalogue link]. Kuch pasand aaye toh batayiye.` : `Hi ${first}, here’s our catalogue: [catalogue link]. Let me know what catches your eye.`;
      } else if (c && c.promisor === 'us') {
        body = hi
          ? `Hi ${first}, message ke liye thanks. Main ${whenPhrase(c.dueAt, now, true)} ${actionPhrase(c.title, first)} kar dunga.`
          : `Hi ${first}, thanks for checking. I’ll ${actionPhrase(c.title, first)} ${whenPhrase(c.dueAt, now)}.`;
      } else {
        body = hi ? `Hi ${first}, message ke liye thanks — aaj hi update deta hoon.` : `Hi ${first}, thanks for your message — I’ll get back to you on this today.`;
      }
      subject = 'Re: your message';
    }
  }

  const channel = input.channel ?? defaultChannel(customer);
  // What the draft answers: the promise's source message first, then the latest from the customer.
  const evidence = [...new Set([c?.sourceEventId, lastIn?.id].filter((x): x is ID => !!x))];
  return {
    channel,
    body,
    subject: channel === 'email' ? subject : null,
    language,
    sendHint: hintFromFacts(s, input.customerId, first, now),
    evidenceEventIds: evidence,
  };
}
