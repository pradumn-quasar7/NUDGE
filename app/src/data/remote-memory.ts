import { requireSupabase } from '@/lib/supabase';
import type { BriefPromise, HandoffBrief } from '@/lib/brief';
import { RemoteError } from './remote';
import type { ID } from './types';

/**
 * Customer Memory + Handoff Brief calls (supabase/migrations/20261007000008_memory.sql,
 * supabase/functions/handoff-brief). Kept apart from remote.ts; callers re-sync the store with
 * `reload()` from useStore() after a write.
 */

/* ───────────── "What matters" refresh ───────────── */

/**
 * queued: summarize-customer was enqueued · pending: one is already on its way (< 2 min ago)
 * fresh: a summary was generated < 2 min ago · unavailable: the server can't call the AI right now.
 */
export type SummaryRequest = { status: 'queued' | 'pending' | 'fresh' | 'unavailable'; retryAfter?: number };

/** RPC request_customer_summary — any member who can see the customer; at most once per 2 minutes per customer. */
export async function requestCustomerSummary(customerId: ID): Promise<SummaryRequest> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('request_customer_summary', { customer_id: customerId });
  if (error) throw new RemoteError(`Refresh summary: ${error.message}`, error.code);
  const r = (data ?? {}) as { status?: string; retry_after?: number };
  const status = r.status === 'queued' || r.status === 'pending' || r.status === 'fresh' ? r.status : 'unavailable';
  return { status, retryAfter: typeof r.retry_after === 'number' ? r.retry_after : undefined };
}

/* ───────────── Handoff brief ───────────── */

type ServerBrief = {
  generatedAt: string;
  customerId: string;
  commitmentId: string | null;
  forMemberId: string | null;
  history: string;
  currentState: string;
  openCommitments: {
    id: string;
    title: string;
    dueAt: string;
    status: BriefPromise['status'];
    promisor: BriefPromise['promisor'];
    ownerMemberId: string | null;
    sourceEventId: string | null;
    note: string | null;
  }[];
  sensitiveNotes: { text: string; eventIds: string[] }[];
  nextAction: string;
  evidenceEventIds: string[];
};

type ServerResponse = { id: string | null; brief: ServerBrief; cached: boolean; aiRunId: string | null; createdAt: string };

export type RemoteBrief = { id: ID | null; brief: HandoffBrief; cached: boolean; aiRunId: ID | null };

const ms = (iso: string) => new Date(iso).getTime();

function toBrief(b: ServerBrief): HandoffBrief {
  return {
    source: 'ai',
    generatedAt: ms(b.generatedAt),
    customerId: b.customerId,
    commitmentId: b.commitmentId ?? undefined,
    forMemberId: b.forMemberId ?? undefined,
    history: b.history,
    currentState: b.currentState,
    openCommitments: (b.openCommitments ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      dueAt: ms(c.dueAt),
      status: c.status,
      promisor: c.promisor,
      ownerId: c.ownerMemberId ?? undefined,
      sourceEventId: c.sourceEventId ?? undefined,
      note: c.note ?? undefined,
    })),
    sensitiveNotes: b.sensitiveNotes ?? [],
    nextAction: b.nextAction,
    evidenceEventIds: b.evidenceEventIds ?? [],
  };
}

/**
 * Edge Function handoff-brief. Error `code` is the function's error code: `not_enough_history`,
 * `rate_limited` (20 / hour / member), `ai_unavailable`, `brief_failed`, `customer_not_found`, …
 */
export async function getHandoffBrief(
  orgId: ID,
  customerId: ID,
  commitmentId?: ID,
  forMemberId?: ID,
  opts: { refresh?: boolean } = {},
): Promise<RemoteBrief> {
  const db = requireSupabase();
  const { data, error } = await db.functions.invoke<ServerResponse>('handoff-brief', {
    body: {
      org_id: orgId,
      customer_id: customerId,
      commitment_id: commitmentId ?? null,
      for_member_id: forMemberId ?? null,
      refresh: opts.refresh === true,
    },
  });
  if (error) {
    let code = 'brief_failed';
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      const body = (await ctx.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === 'string') code = body.error;
    }
    throw new RemoteError(`Handoff brief: ${error.message}`, code);
  }
  if (!data?.brief) throw new RemoteError('Handoff brief: empty response', 'brief_failed');
  return { id: data.id, brief: toBrief(data.brief), cached: data.cached, aiRunId: data.aiRunId };
}
