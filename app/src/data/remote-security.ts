import { requireSupabase } from '@/lib/supabase';
import type { ID } from './types';

/**
 * Cloud calls for privacy & security (migration 20261007000010_hardening.sql). Every call runs as the
 * signed-in user; the database decides what is allowed (owner-only RPCs raise 42501 otherwise).
 */

export class SecurityError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

type PgError = { message: string; code?: string } | null;

function fail(what: string, error: NonNullable<PgError>): never {
  throw new SecurityError(`${what}: ${error.message}`, error.code);
}

/* ───────────── Export ───────────── */

/** The JSON document returned by export_workspace(): sections of rows plus counts and truncation flags. */
export type WorkspaceExport = {
  format: 'nudge.workspace-export';
  version: number;
  exported_at: string;
  organization: { id: ID; name: string } & Record<string, unknown>;
  members: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  events: Record<string, unknown>[];
  counts: Record<string, number>;
  limits: { events: number; other: number };
  truncated: boolean;
  truncated_sections: string[];
} & Record<string, unknown>;

/** Everything the owner can see in the workspace, as one document. Owner only (42501). Audited. */
export async function exportWorkspace(orgId: ID): Promise<WorkspaceExport> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('export_workspace', { org_id: orgId });
  if (error) fail('Export', error);
  if (!data || typeof data !== 'object') throw new SecurityError('Export: empty response', 'empty');
  return data as WorkspaceExport;
}

/* ───────────── Delete workspace ───────────── */

/**
 * Permanently deletes the workspace and everything in it. Owner only (42501); `confirmName` must match the
 * business name, ignoring case and surrounding spaces (22023). Recordings and files are removed from Storage
 * shortly after by the storage-purge job.
 */
export async function deleteWorkspace(orgId: ID, confirmName: string): Promise<void> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('delete_workspace', { org_id: orgId, confirm_name: confirmName });
  if (error) fail('Delete workspace', error);
  if (data !== true) throw new SecurityError('Delete workspace: not deleted', 'not_deleted');
}

/* ───────────── Activity ───────────── */

export type ActivityItem = {
  id: number;
  at: number;
  action: 'insert' | 'update' | 'delete' | 'export';
  entityType: string;
  entityId?: ID;
  actorKind: 'user' | 'service' | 'system';
  actorMemberId?: ID;
  /** "Alex Fernandes", "A former teammate", or "Nudge" for automatic changes. */
  actorName: string;
  /** "completed a promise · Send revised quotation" — the app prefixes the actor's first name. */
  summary: string;
};

type ActivityRow = {
  id: number;
  at: string;
  action: ActivityItem['action'];
  entity_type: string;
  entity_id: string | null;
  actor_kind: ActivityItem['actorKind'];
  actor_member_id: string | null;
  actor_name: string;
  summary: string;
};

export type ActivityPage = { items: ActivityItem[]; nextCursor: number | null };

/**
 * One page of the workspace's activity log (activity_feed view), newest first. Owners only — for members the
 * view is simply empty. `cursor` is the `nextCursor` of the previous page (keyset paging on the id).
 */
export async function listActivity(orgId: ID, cursor?: number | null, limit = 40): Promise<ActivityPage> {
  const db = requireSupabase();
  let q = db
    .from('activity_feed')
    .select('id, at, action, entity_type, entity_id, actor_kind, actor_member_id, actor_name, summary')
    .eq('org_id', orgId)
    .order('id', { ascending: false })
    .limit(limit);
  if (cursor != null) q = q.lt('id', cursor);
  const { data, error } = await q.returns<ActivityRow[]>();
  if (error) fail('Activity', error);
  const items = (data ?? []).map(
    (r): ActivityItem => ({
      id: Number(r.id),
      at: new Date(r.at).getTime(),
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id ?? undefined,
      actorKind: r.actor_kind,
      actorMemberId: r.actor_member_id ?? undefined,
      actorName: r.actor_name,
      summary: r.summary,
    }),
  );
  return { items, nextCursor: items.length === limit ? items[items.length - 1].id : null };
}
