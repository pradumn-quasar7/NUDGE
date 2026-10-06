/**
 * Domain model. Mirrors the Postgres schema in supabase/migrations (snake_case there, camelCase here).
 * Raw events are immutable; AI outputs (facts, commitments, extractions) always point back to a source event.
 */

export type ID = string;
export type Channel = 'whatsapp' | 'phone' | 'email' | 'instagram' | 'manual' | 'upi';
export type MemberRole = 'owner' | 'member';

export type Organization = {
  id: ID;
  name: string;
  sells: string;
  handles: string[];
  channels: Channel[];
  plan: 'free' | 'pro';
};

export type Member = {
  id: ID;
  name: string;
  email: string;
  role: MemberRole;
  title?: string;
  status: 'active' | 'invited';
  invitedAt?: number;
};

export type Health = 'healthy' | 'steady' | 'at_risk' | 'quiet';

export type Customer = {
  id: ID;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  preferredChannel: Channel;
  customerSince: number;
  lifetimeValue: number;
  /** AI briefing — "What matters". Regenerated from events; never hand-edited. */
  summary?: string;
  summarySources?: { messages: number; calls: number; updatedAt: number };
  /** One-line current state shown in lists ("Waiting for revised quotation"). */
  headline: string;
  source?: string;
  ownerId: ID;
  archived?: boolean;
  createdAt: number;
};

export type EventKind = 'message' | 'call' | 'email' | 'quote' | 'payment' | 'note' | 'task' | 'promise' | 'followup';

/** conversation_events — immutable raw history. */
export type CustomerEvent = {
  id: ID;
  customerId: ID;
  kind: EventKind;
  channel: Channel;
  direction: 'in' | 'out' | 'internal';
  at: number;
  title: string;
  body?: string;
  amount?: number;
  ref?: string;
  authorId?: ID;
  /** For call events: the AI one-line takeaway, shown in indigo. */
  aiNote?: string;
};

export type FactKind = 'preference' | 'temporal' | 'note';

/** customer_facts — durable facts vs. time-bound facts, each with evidence. */
export type CustomerFact = {
  id: ID;
  customerId: ID;
  kind: FactKind;
  text: string;
  validUntil?: number;
  sourceEventId?: ID;
  confidence: number;
  createdAt: number;
};

export type CommitmentStatus = 'open' | 'done' | 'snoozed' | 'dismissed';

/** commitments — Promise Radar. */
export type Commitment = {
  id: ID;
  customerId: ID;
  title: string;
  ownerId: ID;
  dueAt: number;
  status: CommitmentStatus;
  /** Who made the promise: us ("I'll send…") or the customer ("I'll confirm Friday"). */
  promisor: 'us' | 'customer';
  sourceEventId?: ID;
  /** Exact words, kept as proof. */
  quote?: string;
  quoteBy?: string;
  confidence: number;
  createdAt: number;
  completedAt?: number;
  snoozedUntil?: number;
  /** AI-prepared starting point for the action ("Ready to draft"). */
  draftHint?: string;
};

export type ExtractionField = { key: string; label: string; value: string; checked: boolean };

/** ai_runs that need human confirmation ("I noticed a commitment"). Nothing is saved until confirmed. */
export type Extraction = {
  id: ID;
  customerId: ID;
  sourceEventId?: ID;
  sourceLabel: string;
  title: string;
  dueAt?: number;
  fields: ExtractionField[];
  status: 'pending' | 'confirmed' | 'ignored';
  createdAt: number;
};

export type NotificationKind = 'customer' | 'promise_due' | 'ai_commitments' | 'payment' | 'task';

export type AppNotification = {
  id: ID;
  kind: NotificationKind;
  customerId?: ID;
  /** Rich title: segments rendered bold when `b` is true. */
  title: { t: string; b?: boolean }[];
  meta: string;
  at: number;
  read: boolean;
  actions?: { label: string; primary?: boolean; route?: string }[];
};

/** Inbox — every item reads Who → What → Why it matters → What to do. */
export type InboxBucket = 'needs_reply' | 'waiting' | 'promises' | 'done';

export type InboxItem = {
  id: ID;
  customerId: ID;
  bucket: InboxBucket;
  what: string;
  why: string;
  whyTone: 'warn' | 'acc' | 'neutral';
  whyAi?: boolean;
  amount?: number;
  action: { label: string; variant: 'primary' | 'tonal' | 'secondary' };
  at: number;
};

export type IntegrationStatus = 'connected' | 'paused' | 'available';

export type Integration = {
  id: ID;
  name: string;
  kind: 'whatsapp' | 'gmail' | 'calls' | 'calendar' | 'instagram' | 'payments';
  status: IntegrationStatus;
  detail: string;
  lastSyncAt?: number;
};

export type Invoice = { id: ID; date: number; amount: number; status: 'paid' | 'due' };

export type Settings = {
  shareAllCustomers: boolean;
  handOffWhenAway: boolean;
  membersCanDelete: boolean;
  notifications: 'needs_you' | 'all' | 'off';
};
