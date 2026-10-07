import { requireSupabase } from '@/lib/supabase';
import type { DraftChannel, DraftIntent } from '@/lib/draft';
import type { ID } from './types';

/**
 * Cloud calls for message drafts and contact preferences (supabase/migrations/20261007000009_drafts.sql,
 * supabase/functions/draft-message). Every call runs as the signed-in user under RLS. Callers refresh the
 * store with `reload()` after writes.
 */

export class DraftError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

type PgError = { message: string; code?: string } | null;
const fail = (what: string, e: NonNullable<PgError>) => new DraftError(`${what}: ${e.message}`, e.code);

/* ───────────── Drafts ───────────── */

export type ServerDraft = {
  draftId: ID;
  channel: DraftChannel;
  body: string;
  subject: string | null;
  language: string;
  sendHint: string | null;
  evidenceEventIds: ID[];
  intent: DraftIntent;
  availableChannels: DraftChannel[];
};

/**
 * Asks the `draft-message` edge function for a draft (it is saved as a message_drafts row).
 * Error codes: `opted_out` (409, `message` is user-facing), `rate_limited` (429), `ai_unavailable`,
 * `draft_unavailable`, `draft_rejected`, `customer_not_found`, `draft_failed`.
 */
export async function requestDraft(input: {
  orgId: ID;
  customerId: ID;
  commitmentId?: ID;
  suggestionId?: ID;
  intent?: DraftIntent;
  instructions?: string;
}): Promise<ServerDraft> {
  const db = requireSupabase();
  const { data, error } = await db.functions.invoke<ServerDraft>('draft-message', {
    body: {
      org_id: input.orgId,
      customer_id: input.customerId,
      commitment_id: input.commitmentId ?? null,
      suggestion_id: input.suggestionId ?? null,
      intent: input.intent ?? null,
      instructions: input.instructions?.trim() || null,
    },
  });
  if (error) {
    let code = 'draft_failed';
    let message = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      const body = (await ctx.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
      if (typeof body?.error === 'string') code = body.error;
      if (typeof body?.message === 'string') message = body.message;
    }
    throw new DraftError(message, code);
  }
  if (!data || typeof data.body !== 'string' || !data.draftId) throw new DraftError('Draft: empty response', 'draft_failed');
  return data;
}

/** When the AI can't draft: keep the on-device draft as a row, so "Sent it?" records it the same way. */
export async function saveDeviceDraft(
  orgId: ID,
  d: {
    customerId: ID;
    commitmentId?: ID;
    suggestionId?: ID;
    intent: DraftIntent;
    channel: DraftChannel;
    subject: string | null;
    body: string;
    language: string;
    evidenceEventIds: ID[];
    sendHint: string | null;
  },
): Promise<ID> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('message_drafts')
    .insert({
      org_id: orgId,
      customer_id: d.customerId,
      commitment_id: d.commitmentId ?? null,
      suggestion_id: d.suggestionId ?? null,
      intent: d.intent,
      channel: d.channel,
      subject: d.subject,
      body: d.body,
      language: d.language,
      evidence_event_ids: d.evidenceEventIds,
      send_hint: d.sendHint,
    })
    .select('id')
    .single<{ id: ID }>();
  if (error) throw fail('Save draft', error);
  if (!data) throw new DraftError('Save draft: not saved', 'not_found');
  return data.id;
}

/**
 * The person sent it from their own app and tapped "Yes, sent": one transaction records the outbound
 * event on the timeline, marks the draft sent and resolves the linked inbox item. `42501` = opted out.
 */
export async function markDraftSent(draftId: ID, channel: DraftChannel, finalBody: string): Promise<{ eventId: ID; alreadySent: boolean }> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('mark_draft_sent', { draft_id: draftId, channel, final_body: finalBody });
  if (error) throw fail('Record message', error);
  const row = data as { event_id: ID; already_sent: boolean } | null;
  if (!row?.event_id) throw new DraftError('Record message: no event', 'not_found');
  return { eventId: row.event_id, alreadySent: !!row.already_sent };
}

export async function discardDraft(draftId: ID): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.from('message_drafts').update({ status: 'discarded' }).eq('id', draftId).eq('status', 'draft');
  if (error) throw fail('Discard draft', error);
}

/* ───────────── Contact preferences (contact_policies) ───────────── */

export type ContactMethod = 'whatsapp' | 'call' | 'sms' | 'email';

export type ContactPolicy = {
  method: ContactMethod | null;
  /** "HH:MM" in the workspace's time zone; both null = any time. */
  hoursStart: string | null;
  hoursEnd: string | null;
  /** null = no limit. */
  maxPerWeek: number | null;
  optedOut: boolean;
  optedOutReason: string | null;
  updatedAt?: number;
  updatedBy?: ID;
};

type PolicyRow = {
  preferred_method: ContactMethod | null;
  preferred_hours_start: string | null;
  preferred_hours_end: string | null;
  max_messages_per_week: number | null;
  opted_out: boolean;
  opted_out_reason: string | null;
  updated_at: string;
  updated_by_member_id: string | null;
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export async function getContactPolicy(orgId: ID, customerId: ID): Promise<ContactPolicy | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('contact_policies')
    .select('preferred_method, preferred_hours_start, preferred_hours_end, max_messages_per_week, opted_out, opted_out_reason, updated_at, updated_by_member_id')
    .eq('org_id', orgId)
    .eq('customer_id', customerId)
    .maybeSingle<PolicyRow>();
  if (error) throw fail('Load contact preferences', error);
  if (!data) return null;
  return {
    method: data.preferred_method,
    hoursStart: hhmm(data.preferred_hours_start),
    hoursEnd: hhmm(data.preferred_hours_end),
    maxPerWeek: data.max_messages_per_week,
    optedOut: data.opted_out,
    optedOutReason: data.opted_out_reason,
    updatedAt: Date.parse(data.updated_at),
    updatedBy: data.updated_by_member_id ?? undefined,
  };
}

/** Creates or updates the customer's one policy row (any member who can see the customer). */
export async function saveContactPolicy(orgId: ID, customerId: ID, p: ContactPolicy): Promise<void> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('contact_policies')
    .upsert(
      {
        org_id: orgId,
        customer_id: customerId,
        preferred_method: p.method,
        preferred_hours_start: p.hoursStart && p.hoursEnd ? p.hoursStart : null,
        preferred_hours_end: p.hoursStart && p.hoursEnd ? p.hoursEnd : null,
        max_messages_per_week: p.maxPerWeek,
        opted_out: p.optedOut,
        opted_out_reason: p.optedOut ? p.optedOutReason?.trim() || null : null,
      },
      { onConflict: 'org_id,customer_id' },
    )
    .select('id');
  if (error) throw fail('Save contact preferences', error);
  if (!data?.length) throw new DraftError('Save contact preferences: not allowed', '42501');
}

/** Phone / email on the customer (column grant: members may update these on customers they can see). */
export async function updateCustomerContact(customerId: ID, patch: { phone?: string; email?: string }): Promise<void> {
  const row: Record<string, string | null> = {};
  if (patch.phone !== undefined) row.phone = patch.phone.trim() || null;
  if (patch.email !== undefined) row.email = patch.email.trim().toLowerCase() || null;
  if (!Object.keys(row).length) return;
  const db = requireSupabase();
  const { data, error } = await db.from('customers').update(row).eq('id', customerId).select('id');
  if (error) throw fail('Save contact details', error);
  if (!data?.length) throw new DraftError('Save contact details: not allowed', '42501');
}
