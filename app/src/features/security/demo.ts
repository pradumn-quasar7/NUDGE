import type { AppState } from '@/data/store';
import type { ActivityItem } from '@/data/remote-security';
import type { ID } from '@/data/types';

/** Demo mode: the workspace on this device, shaped like the cloud export (export_workspace). */
export function demoExport(state: AppState) {
  const counts = {
    customers: state.customers.length,
    events: state.events.length,
    facts: state.facts.length,
    commitments: state.commitments.length,
    extractions: state.extractions.length,
  };
  return {
    format: 'nudge.workspace-export',
    version: 1,
    demo: true,
    exported_at: new Date().toISOString(),
    organization: { ...state.org, settings: state.settings },
    members: state.members.map(({ id, name, email, role, title, status }) => ({ id, name, email, role, title, status })),
    customers: state.customers,
    events: state.events,
    facts: state.facts,
    commitments: state.commitments,
    extractions: state.extractions,
    integrations: state.integrations.map(({ id, name, kind, status }) => ({ id, name, kind, status })),
    counts,
    truncated: false,
    truncated_sections: [],
  };
}

/**
 * Demo mode: a believable activity log derived from the store (there is no server audit trail on a
 * device), so the screen shows the same kinds of lines as in the cloud.
 */
export function demoActivity(state: AppState, now = Date.now()): ActivityItem[] {
  const nameOf = (id?: ID) => state.members.find((m) => m.id === id)?.name ?? 'A former teammate';
  const owner = state.members.find((m) => m.role === 'owner' && m.status === 'active');
  const items: Omit<ActivityItem, 'id'>[] = [];
  const add = (at: number | undefined, actorId: ID | null, summary: string, entityType: string, entityId?: ID, action: ActivityItem['action'] = 'update') => {
    if (!at || at > now) return;
    items.push({
      at,
      action,
      entityType,
      entityId,
      actorKind: actorId ? 'user' : 'service',
      actorMemberId: actorId ?? undefined,
      actorName: actorId ? nameOf(actorId) : 'Nudge',
      summary,
    });
  };

  for (const c of state.commitments) {
    if (c.completedAt) add(c.completedAt, c.ownerId, `completed a promise · ${c.title}`, 'commitments', c.id);
    add(c.createdAt, c.ownerId, `added a promise · ${c.title}`, 'commitments', c.id, 'insert');
  }
  for (const c of state.customers) {
    add(c.createdAt, c.ownerId, `added a customer · ${c.name}`, 'customers', c.id, 'insert');
  }
  for (const f of state.facts) {
    add(f.createdAt, null, `remembered a fact · ${f.text}`, 'customer_facts', f.id, 'insert');
  }
  for (const m of state.members) {
    if (m.status === 'invited') add(m.invitedAt, owner?.id ?? null, `invited a teammate · ${m.email}`, 'organization_members', m.id, 'insert');
  }
  for (const i of state.integrations) {
    if (i.status === 'paused') add(i.lastSyncAt ?? now - 3_600_000, owner?.id ?? null, `paused an integration · ${i.name}`, 'integration_accounts', i.id);
  }

  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, 40)
    .map((x, i) => ({ ...x, id: 40 - i }));
}
