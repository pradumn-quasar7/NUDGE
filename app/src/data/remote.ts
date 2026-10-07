import type { CopilotAnswer } from '@/lib/ai';
import { requireSupabase } from '@/lib/supabase';
import type {
  AppNotification,
  Channel,
  Commitment,
  CommitmentStatus,
  Customer,
  CustomerEvent,
  CustomerFact,
  EventKind,
  Extraction,
  ExtractionField,
  FactKind,
  ID,
  InboxBucket,
  InboxItem,
  Integration,
  IntegrationStatus,
  Member,
  MemberRole,
  Organization,
  Settings,
} from './types';

/**
 * Supabase repository used by the store in cloud mode (src/data/store.tsx) — same surface as its actions.
 *
 * Rows are snake_case (supabase/migrations), app types camelCase. Timestamps cross the boundary
 * as ISO strings and become epoch milliseconds here. Every call runs as the signed-in user, so
 * RLS decides what is visible; nothing here needs (or has) elevated rights.
 */

/* ───────────── Errors ───────────── */

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

type PgResult<T> = { data: T | null; error: { message: string; code?: string } | null };

function must<T>(res: PgResult<T>, what: string): T {
  if (res.error) throw new RemoteError(`${what}: ${res.error.message}`, res.error.code);
  if (res.data === null) throw new RemoteError(`${what}: not found`, 'not_found');
  return res.data;
}

/* ───────────── Row types ───────────── */

type OrganizationRow = {
  id: string;
  name: string;
  sells: string | null;
  handles: string[];
  channels: Channel[];
  plan: 'free' | 'pro';
  timezone: string;
  settings: {
    share_all_customers?: boolean;
    hand_off_when_away?: boolean;
    members_can_delete?: boolean;
    notifications?: Settings['notifications'];
  };
};

type MemberRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: MemberRole;
  title: string | null;
  status: 'active' | 'invited';
  invited_at: string | null;
};

type CustomerRow = {
  id: string;
  org_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  preferred_channel: Channel;
  customer_since: string;
  lifetime_value: number | string;
  summary: string | null;
  summary_message_count: number | null;
  summary_call_count: number | null;
  summary_updated_at: string | null;
  headline: string;
  source: string | null;
  owner_member_id: string | null;
  archived_at: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  org_id: string;
  customer_id: string;
  kind: EventKind;
  channel: Channel;
  direction: CustomerEvent['direction'];
  occurred_at: string;
  title: string;
  body: string | null;
  amount: number | string | null;
  ref: string | null;
  author_member_id: string | null;
  event_annotations?: { kind: 'ai_note' | 'ai_title'; text: string }[] | null;
};

type FactRow = {
  id: string;
  customer_id: string;
  kind: FactKind;
  text: string;
  valid_until: string | null;
  source_event_id: string | null;
  confidence: number | string;
  created_at: string;
};

type CommitmentRow = {
  id: string;
  customer_id: string;
  title: string;
  owner_member_id: string | null;
  due_at: string;
  status: CommitmentStatus;
  promisor: Commitment['promisor'];
  source_event_id: string | null;
  quote: string | null;
  quote_by: string | null;
  confidence: number | string;
  created_at: string;
  completed_at: string | null;
  snoozed_until: string | null;
  draft_hint: string | null;
};

type ExtractionRow = {
  id: string;
  customer_id: string;
  source_event_id: string | null;
  source_label: string;
  title: string;
  due_at: string | null;
  fields: ExtractionField[];
  status: Extraction['status'];
  created_at: string;
};

const CUSTOMER_COLS =
  'id, org_id, name, company, phone, email, preferred_channel, customer_since, lifetime_value, summary, summary_message_count, summary_call_count, summary_updated_at, headline, source, owner_member_id, archived_at, created_at';
const EVENT_COLS =
  'id, org_id, customer_id, kind, channel, direction, occurred_at, title, body, amount, ref, author_member_id, event_annotations(kind, text)';
const FACT_COLS = 'id, customer_id, kind, text, valid_until, source_event_id, confidence, created_at';
const COMMITMENT_COLS =
  'id, customer_id, title, owner_member_id, due_at, status, promisor, source_event_id, quote, quote_by, confidence, created_at, completed_at, snoozed_until, draft_hint';
const EXTRACTION_COLS = 'id, customer_id, source_event_id, source_label, title, due_at, fields, status, created_at';
const MEMBER_COLS = 'id, org_id, user_id, name, email, role, title, status, invited_at';

/* ───────────── Mappers ───────────── */

const ms = (iso: string) => Date.parse(iso);
const msOpt = (iso: string | null | undefined) => (iso ? Date.parse(iso) : undefined);
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const iso = (t: number) => new Date(t).toISOString();

export function toOrganization(r: OrganizationRow): Organization {
  return { id: r.id, name: r.name, sells: r.sells ?? '', handles: r.handles, channels: r.channels, plan: r.plan };
}

export function toSettings(r: OrganizationRow): Settings {
  return {
    shareAllCustomers: r.settings.share_all_customers ?? true,
    handOffWhenAway: r.settings.hand_off_when_away ?? true,
    membersCanDelete: r.settings.members_can_delete ?? false,
    notifications: r.settings.notifications ?? 'needs_you',
  };
}

export function toMember(r: MemberRow): Member {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    title: opt(r.title),
    status: r.status,
    invitedAt: msOpt(r.invited_at),
  };
}

export function toCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    company: opt(r.company),
    phone: opt(r.phone),
    email: opt(r.email),
    preferredChannel: r.preferred_channel,
    customerSince: ms(r.customer_since),
    lifetimeValue: Number(r.lifetime_value),
    summary: opt(r.summary),
    summarySources: r.summary_updated_at
      ? { messages: r.summary_message_count ?? 0, calls: r.summary_call_count ?? 0, updatedAt: ms(r.summary_updated_at) }
      : undefined,
    headline: r.headline,
    source: opt(r.source),
    ownerId: r.owner_member_id ?? '',
    archived: r.archived_at ? true : undefined,
    createdAt: ms(r.created_at),
  };
}

export function toEvent(r: EventRow): CustomerEvent {
  const note = r.event_annotations?.find((a) => a.kind === 'ai_note');
  const aiTitle = r.event_annotations?.find((a) => a.kind === 'ai_title');
  return {
    id: r.id,
    customerId: r.customer_id,
    kind: r.kind,
    channel: r.channel,
    direction: r.direction,
    at: ms(r.occurred_at),
    // Raw titles from integrations are generic ("WhatsApp message"); prefer the AI label.
    title: aiTitle?.text ?? r.title,
    body: opt(r.body),
    amount: r.amount === null ? undefined : Number(r.amount),
    ref: opt(r.ref),
    authorId: opt(r.author_member_id),
    aiNote: note?.text,
  };
}

export function toFact(r: FactRow): CustomerFact {
  return {
    id: r.id,
    customerId: r.customer_id,
    kind: r.kind,
    text: r.text,
    validUntil: msOpt(r.valid_until),
    sourceEventId: opt(r.source_event_id),
    confidence: Number(r.confidence),
    createdAt: ms(r.created_at),
  };
}

export function toCommitment(r: CommitmentRow): Commitment {
  return {
    id: r.id,
    customerId: r.customer_id,
    title: r.title,
    ownerId: r.owner_member_id ?? '',
    dueAt: ms(r.due_at),
    status: r.status,
    promisor: r.promisor,
    sourceEventId: opt(r.source_event_id),
    quote: opt(r.quote),
    quoteBy: opt(r.quote_by),
    confidence: Number(r.confidence),
    createdAt: ms(r.created_at),
    completedAt: msOpt(r.completed_at),
    snoozedUntil: msOpt(r.snoozed_until),
    draftHint: opt(r.draft_hint),
  };
}

export function toExtraction(r: ExtractionRow): Extraction {
  return {
    id: r.id,
    customerId: r.customer_id,
    sourceEventId: opt(r.source_event_id),
    sourceLabel: r.source_label,
    title: r.title,
    dueAt: msOpt(r.due_at),
    fields: Array.isArray(r.fields) ? r.fields : [],
    status: r.status,
    createdAt: ms(r.created_at),
  };
}

/* ───────────── Workspace ───────────── */

export type Workspace = { org: Organization; settings: Settings; me: Member; members: Member[]; timezone: string };

/** The signed-in user's workspace (first active membership unless `orgId` is given), or null if none yet. */
export async function getWorkspace(orgId?: ID): Promise<Workspace | null> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  let mine = db.from('organization_members').select(MEMBER_COLS).eq('user_id', auth.user.id).eq('status', 'active');
  if (orgId) mine = mine.eq('org_id', orgId);
  const memberships = must(await mine.order('created_at').limit(1).returns<MemberRow[]>(), 'Load membership');
  const me = memberships[0];
  if (!me) return null;

  const [org, members] = await Promise.all([
    db.from('organizations').select('id, name, sells, handles, channels, plan, timezone, settings').eq('id', me.org_id).single<OrganizationRow>(),
    db.from('organization_members').select(MEMBER_COLS).eq('org_id', me.org_id).order('created_at').returns<MemberRow[]>(),
  ]);
  const orgRow = must(org, 'Load workspace');
  return {
    org: toOrganization(orgRow),
    settings: toSettings(orgRow),
    me: toMember(me),
    members: must(members, 'Load team').map(toMember),
    timezone: orgRow.timezone,
  };
}

/** Onboarding: creates the workspace and makes the caller its owner. Returns the org id. */
export async function createOrganization(name: string, sells?: string): Promise<ID> {
  const db = requireSupabase();
  return must(await db.rpc('create_organization', { name: name.trim(), sells: sells?.trim() || null }), 'Create workspace') as ID;
}

/* ───────────── Reads ───────────── */

export async function listCustomers(orgId: ID, opts: { includeArchived?: boolean } = {}): Promise<Customer[]> {
  const db = requireSupabase();
  let q = db.from('customers').select(CUSTOMER_COLS).eq('org_id', orgId);
  if (!opts.includeArchived) q = q.is('archived_at', null);
  return must(await q.order('updated_at', { ascending: false }).returns<CustomerRow[]>(), 'Load customers').map(toCustomer);
}

/** Events, newest first. Pass `customerId` for one customer's timeline. */
export async function listEvents(orgId: ID, opts: { customerId?: ID; since?: number; limit?: number } = {}): Promise<CustomerEvent[]> {
  const db = requireSupabase();
  let q = db.from('conversation_events').select(EVENT_COLS).eq('org_id', orgId);
  if (opts.customerId) q = q.eq('customer_id', opts.customerId);
  if (opts.since) q = q.gte('occurred_at', iso(opts.since));
  const rows = must(
    await q.order('occurred_at', { ascending: false }).limit(opts.limit ?? 200).returns<EventRow[]>(),
    'Load events',
  );
  return rows.map(toEvent);
}

export async function listFacts(orgId: ID, customerId?: ID): Promise<CustomerFact[]> {
  const db = requireSupabase();
  let q = db.from('customer_facts').select(FACT_COLS).eq('org_id', orgId).is('superseded_by', null).is('forgotten_at', null);
  if (customerId) q = q.eq('customer_id', customerId);
  return must(await q.order('created_at', { ascending: false }).returns<FactRow[]>(), 'Load facts').map(toFact);
}

export async function listCommitments(orgId: ID, opts: { status?: CommitmentStatus[]; customerId?: ID } = {}): Promise<Commitment[]> {
  const db = requireSupabase();
  let q = db.from('commitments').select(COMMITMENT_COLS).eq('org_id', orgId);
  if (opts.status?.length) q = q.in('status', opts.status);
  if (opts.customerId) q = q.eq('customer_id', opts.customerId);
  return must(await q.order('due_at', { ascending: true }).returns<CommitmentRow[]>(), 'Load promises').map(toCommitment);
}

export async function listExtractions(orgId: ID, status: Extraction['status'] = 'pending'): Promise<Extraction[]> {
  const db = requireSupabase();
  const rows = must(
    await db
      .from('extractions')
      .select(EXTRACTION_COLS)
      .eq('org_id', orgId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .returns<ExtractionRow[]>(),
    'Load AI suggestions',
  );
  return rows.map(toExtraction);
}

/* ───────────── Promise actions ───────────── */

export async function completeCommitment(id: ID): Promise<Commitment> {
  const db = requireSupabase();
  // completed_at is set by a trigger when status becomes 'done'.
  const row = must(
    await db.from('commitments').update({ status: 'done' }).eq('id', id).select(COMMITMENT_COLS).single<CommitmentRow>(),
    'Complete promise',
  );
  return toCommitment(row);
}

/** Undo for the "Kept" toast. */
export async function reopenCommitment(id: ID): Promise<Commitment> {
  const db = requireSupabase();
  const row = must(
    await db.from('commitments').update({ status: 'open' }).eq('id', id).select(COMMITMENT_COLS).single<CommitmentRow>(),
    'Reopen promise',
  );
  return toCommitment(row);
}

/** Same semantics as the local store: stays open, hidden from reminders until `until`, due date pushed if earlier. */
export async function snoozeCommitment(id: ID, until: number): Promise<Commitment> {
  const db = requireSupabase();
  const current = must(await db.from('commitments').select('due_at').eq('id', id).single<{ due_at: string }>(), 'Load promise');
  const dueAt = Math.max(ms(current.due_at), until);
  const row = must(
    await db
      .from('commitments')
      .update({ status: 'open', snoozed_until: iso(until), due_at: iso(dueAt) })
      .eq('id', id)
      .select(COMMITMENT_COLS)
      .single<CommitmentRow>(),
    'Snooze promise',
  );
  return toCommitment(row);
}

/* ───────────── AI suggestions (human confirmation) ───────────── */

/** Creates the commitment (owned by the caller) + facts for checked fields. Idempotent. */
export async function confirmExtraction(id: ID, fields: ExtractionField[], dueAt?: number, title?: string): Promise<Commitment> {
  const db = requireSupabase();
  const commitmentId = must(
    await db.rpc('confirm_extraction', {
      extraction_id: id,
      fields,
      due_at: dueAt === undefined ? null : iso(dueAt),
      title: title ?? null,
    }),
    'Confirm suggestion',
  ) as ID;
  const row = must(
    await db.from('commitments').select(COMMITMENT_COLS).eq('id', commitmentId).single<CommitmentRow>(),
    'Load promise',
  );
  return toCommitment(row);
}

export async function ignoreExtraction(id: ID): Promise<void> {
  const db = requireSupabase();
  // decided_at / decided_by are filled in by a trigger.
  const { error } = await db.from('extractions').update({ status: 'ignored' }).eq('id', id);
  if (error) throw new RemoteError(`Ignore suggestion: ${error.message}`, error.code);
}

/* ───────────── Capture ───────────── */

export async function addCustomer(
  orgId: ID,
  input: { name: string; company?: string; phone?: string; email?: string },
  ownerMemberId: ID,
): Promise<Customer> {
  const db = requireSupabase();
  const row = must(
    await db
      .from('customers')
      .insert({
        org_id: orgId,
        name: input.name.trim(),
        company: input.company?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        preferred_channel: 'whatsapp',
        headline: 'New customer',
        owner_member_id: ownerMemberId,
      })
      .select(CUSTOMER_COLS)
      .single<CustomerRow>(),
    'Add customer',
  );
  return toCustomer(row);
}

/** Internal note on the customer's timeline (an immutable event authored by the caller). */
export async function addNote(orgId: ID, customerId: ID, body: string, authorMemberId: ID): Promise<CustomerEvent> {
  const db = requireSupabase();
  const row = must(
    await db
      .from('conversation_events')
      .insert({
        org_id: orgId,
        customer_id: customerId,
        kind: 'note',
        channel: 'manual',
        direction: 'internal',
        title: 'Note',
        body: body.trim(),
        author_member_id: authorMemberId,
      })
      .select(EVENT_COLS)
      .single<EventRow>(),
    'Add note',
  );
  return toEvent(row);
}

/* ───────────── Copilot ───────────── */

export type RemoteCopilotAnswer = CopilotAnswer & { evidenceEventIds: ID[]; aiRunId: ID | null };

/** "What did I promise?" — answered server-side from the user's own records (see supabase/functions/copilot). */
export async function askCopilot(orgId: ID, question: string, customerId?: ID): Promise<RemoteCopilotAnswer> {
  const db = requireSupabase();
  const { data, error } = await db.functions.invoke<RemoteCopilotAnswer>('copilot', {
    body: { org_id: orgId, question, customer_id: customerId ?? null },
  });
  if (error) throw new RemoteError(`Ask: ${error.message}`, 'copilot_failed');
  if (!data) throw new RemoteError('Ask: empty response', 'copilot_failed');
  return data;
}

/* ───────────── Notifications, inbox, integrations (Phase 3) ───────────── */

type NotificationRow = {
  id: string;
  kind: AppNotification['kind'];
  customer_id: string | null;
  title: AppNotification['title'];
  meta: string;
  actions: AppNotification['actions'] | null;
  read: boolean;
  created_at: string;
};

type SuggestionRow = {
  id: string;
  customer_id: string;
  bucket: InboxBucket;
  what: string;
  why: string;
  why_tone: InboxItem['whyTone'];
  why_ai: boolean;
  amount: number | string | null;
  action_label: string;
  action_variant: InboxItem['action']['variant'];
  at: string;
  resolved_at: string | null;
};

type IntegrationRow = {
  id: string;
  provider: Integration['kind'];
  name: string;
  status: IntegrationStatus;
  detail: string;
  last_sync_at: string | null;
};

export function toNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    customerId: opt(r.customer_id),
    title: Array.isArray(r.title) ? r.title : [{ t: String(r.title) }],
    meta: r.meta,
    at: ms(r.created_at),
    read: r.read,
    actions: opt(r.actions),
  };
}

export function toInboxItem(r: SuggestionRow): InboxItem {
  return {
    id: r.id,
    customerId: r.customer_id,
    bucket: r.resolved_at ? 'done' : r.bucket,
    what: r.what,
    why: r.why,
    whyTone: r.why_tone,
    whyAi: r.why_ai || undefined,
    amount: r.amount === null ? undefined : Number(r.amount),
    action: { label: r.action_label, variant: r.action_variant },
    at: ms(r.at),
  };
}

export function toIntegration(r: IntegrationRow): Integration {
  return { id: r.id, name: r.name, kind: r.provider, status: r.status, detail: r.detail, lastSyncAt: msOpt(r.last_sync_at) };
}

export async function listNotifications(orgId: ID, limit = 50): Promise<AppNotification[]> {
  const db = requireSupabase();
  const rows = must(
    await db
      // Read state is per member (notification_reads), exposed by this security_invoker view.
      .from('notification_feed')
      .select('id, kind, customer_id, title, meta, actions, read, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<NotificationRow[]>(),
    'Load notifications',
  );
  return rows.map(toNotification);
}

/** Open follow-up suggestions plus anything resolved in the last week (the inbox "Done" bucket). */
export async function listInbox(orgId: ID): Promise<InboxItem[]> {
  const db = requireSupabase();
  const weekAgo = iso(Date.now() - 7 * 86_400_000);
  const rows = must(
    await db
      .from('followup_suggestions')
      .select('id, customer_id, bucket, what, why, why_tone, why_ai, amount, action_label, action_variant, at, resolved_at')
      .eq('org_id', orgId)
      .or(`resolved_at.is.null,resolved_at.gte.${weekAgo}`)
      .order('at', { ascending: false })
      .returns<SuggestionRow[]>(),
    'Load inbox',
  );
  return rows.map(toInboxItem);
}

export async function listIntegrations(orgId: ID): Promise<Integration[]> {
  const db = requireSupabase();
  const rows = must(
    await db
      .from('integration_accounts')
      .select('id, provider, name, status, detail, last_sync_at')
      .eq('org_id', orgId)
      .order('created_at')
      .returns<IntegrationRow[]>(),
    'Load integrations',
  );
  return rows.map(toIntegration);
}

/** Everything the app shows for one workspace, loaded in parallel. */
export async function loadWorkspaceData(orgId: ID) {
  const [customers, events, facts, commitments, extractions, notifications, inbox, integrations] = await Promise.all([
    listCustomers(orgId, { includeArchived: true }),
    listEvents(orgId, { limit: 500 }),
    listFacts(orgId),
    listCommitments(orgId, { status: ['open', 'done', 'snoozed'] }),
    listExtractions(orgId, 'pending'),
    listNotifications(orgId),
    listInbox(orgId),
    listIntegrations(orgId),
  ]);
  return { customers, events, facts, commitments, extractions, notifications, inbox, integrations };
}

/* ───────────── Writes (Phase 3) ───────────── */

async function ok(res: { error: { message: string; code?: string } | null }, what: string) {
  if (res.error) throw new RemoteError(`${what}: ${res.error.message}`, res.error.code);
}

/** RLS turns a forbidden UPDATE into "0 rows" rather than an error — treat that as not allowed. */
async function affected(res: PgResult<{ id: string }[]>, what: string) {
  const rows = must(res, what);
  if (!rows.length) throw new RemoteError(`${what}: not allowed`, '42501');
}

/** Joins any workspace this email was invited to (no-op when there are none). */
export async function acceptInvites(): Promise<number> {
  const db = requireSupabase();
  return (must(await db.rpc('accept_member_invites'), 'Accept invites') as number) ?? 0;
}

export async function markNotificationsRead(orgId: ID, ids?: ID[]): Promise<void> {
  const db = requireSupabase();
  await ok(await db.rpc('mark_notifications_read', { ids: ids?.length ? ids : null, org_id: orgId }), 'Mark read');
}

export async function resolveSuggestion(id: ID): Promise<void> {
  const db = requireSupabase();
  await affected(
    await db.from('followup_suggestions').update({ resolved_at: iso(Date.now()), bucket: 'done' }).eq('id', id).select('id'),
    'Resolve',
  );
}

/** Owner-only: business profile. */
export async function updateOrganization(orgId: ID, patch: { name?: string; sells?: string; handles?: string[]; channels?: Channel[] }): Promise<void> {
  const db = requireSupabase();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.sells !== undefined) row.sells = patch.sells.trim() || null;
  if (patch.handles) row.handles = patch.handles;
  if (patch.channels) row.channels = patch.channels;
  if (!Object.keys(row).length) return;
  await affected(await db.from('organizations').update(row).eq('id', orgId).select('id'), 'Save workspace');
}

/** Owner-only: merges a settings patch server-side (validated by a check constraint). */
export async function updateSettings(orgId: ID, patch: Partial<Settings>): Promise<void> {
  const db = requireSupabase();
  const body: Record<string, unknown> = {};
  if (patch.shareAllCustomers !== undefined) body.share_all_customers = patch.shareAllCustomers;
  if (patch.handOffWhenAway !== undefined) body.hand_off_when_away = patch.handOffWhenAway;
  if (patch.membersCanDelete !== undefined) body.members_can_delete = patch.membersCanDelete;
  if (patch.notifications !== undefined) body.notifications = patch.notifications;
  await ok(await db.rpc('update_workspace_settings', { org_id: orgId, patch: body }), 'Save settings');
}

export async function setIntegrationStatus(id: ID, status: IntegrationStatus): Promise<void> {
  const db = requireSupabase();
  const row: Record<string, unknown> = { status };
  if (status === 'connected') row.last_sync_at = iso(Date.now());
  await affected(await db.from('integration_accounts').update(row).eq('id', id).select('id'), 'Update integration');
}

export async function inviteMember(orgId: ID, email: string): Promise<void> {
  const db = requireSupabase();
  await ok(await db.rpc('invite_member', { org_id: orgId, email: email.trim().toLowerCase() }), 'Invite');
}

export async function setCustomerArchived(id: ID, archived: boolean): Promise<void> {
  const db = requireSupabase();
  await affected(
    await db.from('customers').update({ archived_at: archived ? iso(Date.now()) : null }).eq('id', id).select('id'),
    archived ? 'Remove' : 'Restore',
  );
}

/** Tombstone, not a delete: audited, reversible, and the AI never re-learns it. */
export async function forgetFact(id: ID): Promise<void> {
  const db = requireSupabase();
  await ok(await db.rpc('forget_fact', { fact_id: id }), 'Forget');
}

export async function unforgetFact(id: ID): Promise<void> {
  const db = requireSupabase();
  await ok(await db.rpc('unforget_fact', { fact_id: id }), 'Undo forget');
}

export async function handOffCommitment(id: ID, memberId: ID): Promise<void> {
  const db = requireSupabase();
  await affected(await db.from('commitments').update({ owner_member_id: memberId }).eq('id', id).select('id'), 'Hand off');
}

/** Voice/note capture in one transaction: the note event, an optional promise and facts, all linked to the note. */
export async function saveCapture(input: {
  customerId: ID;
  body: string;
  kind: 'note' | 'voice';
  promise?: { title: string; dueAt: number };
  facts?: string[];
}): Promise<{ eventId: ID; commitmentId: ID | null }> {
  const db = requireSupabase();
  const res = must(
    await db.rpc('save_capture', {
      customer_id: input.customerId,
      body: input.body,
      kind: input.kind,
      promise_title: input.promise?.title ?? null,
      promise_due_at: input.promise ? iso(input.promise.dueAt) : null,
      facts: input.facts?.length ? input.facts : null,
    }),
    'Save capture',
  ) as { event_id: ID; commitment_id: ID | null };
  return { eventId: res.event_id, commitmentId: res.commitment_id };
}

export async function addCommitment(
  orgId: ID,
  input: { customerId: ID; title: string; dueAt: number; ownerId: ID; sourceEventId?: ID; quote?: string; quoteBy?: string },
): Promise<void> {
  const db = requireSupabase();
  await ok(
    await db.from('commitments').insert({
      org_id: orgId,
      customer_id: input.customerId,
      title: input.title,
      owner_member_id: input.ownerId,
      due_at: iso(input.dueAt),
      status: 'open',
      promisor: 'us',
      source_event_id: input.sourceEventId ?? null,
      quote: input.quote ?? null,
      quote_by: input.quoteBy ?? null,
      confidence: 0.85,
    }),
    'Add promise',
  );
}

export async function addFacts(orgId: ID, customerId: ID, texts: string[], sourceEventId?: ID): Promise<void> {
  if (!texts.length) return;
  const db = requireSupabase();
  await ok(
    await db.from('customer_facts').insert(
      texts.map((text) => ({ org_id: orgId, customer_id: customerId, kind: 'temporal', text, source_event_id: sourceEventId ?? null, confidence: 0.8 })),
    ),
    'Remember',
  );
}

/** A message the user sent from the app (reply, payment link…), recorded as an immutable outbound event. */
export async function addOutboundMessage(
  orgId: ID,
  input: { customerId: ID; channel: Channel; title: string; body?: string; authorId: ID },
): Promise<void> {
  const db = requireSupabase();
  await ok(
    await db.from('conversation_events').insert({
      org_id: orgId,
      customer_id: input.customerId,
      kind: 'message',
      channel: input.channel,
      direction: 'out',
      title: input.title,
      body: input.body ?? null,
      author_member_id: input.authorId,
    }),
    'Record message',
  );
}
