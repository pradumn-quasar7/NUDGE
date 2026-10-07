import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState as RNAppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import * as remote from './remote';
import { buildSeed, type SeedData } from './seed';
import { backendMode, useSession } from './session';
import type {
  Commitment,
  Customer,
  CustomerEvent,
  CustomerFact,
  Extraction,
  ExtractionField,
  ID,
  Integration,
  Organization,
  Settings,
} from './types';

/**
 * App store. Demo mode: seeded and persisted on-device. Cloud mode (Supabase configured): the signed-in
 * user's workspace, loaded from the server, kept fresh by Realtime. Actions update the screen immediately
 * and then save to the server; if a save fails the store re-syncs and surfaces the error.
 */

export type AppState = SeedData & {
  onboarded: boolean;
  /** Undo buffer for the last completed promise (toast "Undo"). */
  lastCompleted?: ID;
};

const STORAGE_KEY = 'nudge.state.v1';
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'reset' }
  | { type: 'onboard'; org: Partial<Organization>; ownerName?: string }
  | { type: 'completeCommitment'; id: ID }
  | { type: 'undoComplete'; id: ID }
  | { type: 'snoozeCommitment'; id: ID; until: number }
  | { type: 'handOff'; id: ID; memberId: ID }
  | { type: 'addCommitment'; commitment: Commitment }
  | { type: 'confirmExtraction'; id: ID; fields: ExtractionField[]; dueAt?: number; title?: string }
  | { type: 'ignoreExtraction'; id: ID }
  | { type: 'markNotificationsRead' }
  | { type: 'markNotificationRead'; id: ID }
  | { type: 'addCustomer'; customer: Customer }
  | { type: 'archiveCustomer'; id: ID }
  | { type: 'unarchiveCustomer'; id: ID }
  | { type: 'forgetFact'; id: ID }
  | { type: 'addEvent'; event: CustomerEvent }
  | { type: 'addFacts'; facts: CustomerFact[] }
  | { type: 'resolveInbox'; id: ID }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'setIntegration'; id: ID; patch: Partial<Integration> }
  | { type: 'inviteMember'; email: string };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'hydrate':
      return a.state;
    case 'reset':
      return { ...buildSeed(), onboarded: false };
    case 'onboard': {
      const members = a.ownerName
        ? s.members.map((m) => (m.id === s.me ? { ...m, name: a.ownerName! } : m))
        : s.members;
      return { ...s, onboarded: true, org: { ...s.org, ...a.org }, members };
    }
    case 'completeCommitment':
      return {
        ...s,
        lastCompleted: a.id,
        commitments: s.commitments.map((c) => (c.id === a.id ? { ...c, status: 'done', completedAt: Date.now() } : c)),
        inbox: s.inbox.map((i) => {
          const c = s.commitments.find((x) => x.id === a.id);
          return c && i.customerId === c.customerId && i.bucket === 'needs_reply' ? { ...i, bucket: 'done' } : i;
        }),
      };
    case 'undoComplete':
      return {
        ...s,
        lastCompleted: undefined,
        commitments: s.commitments.map((c) => (c.id === a.id ? { ...c, status: 'open', completedAt: undefined } : c)),
      };
    case 'snoozeCommitment':
      return {
        ...s,
        commitments: s.commitments.map((c) =>
          c.id === a.id ? { ...c, status: 'open', snoozedUntil: a.until, dueAt: Math.max(c.dueAt, a.until) } : c,
        ),
      };
    case 'handOff':
      return { ...s, commitments: s.commitments.map((c) => (c.id === a.id ? { ...c, ownerId: a.memberId } : c)) };
    case 'addCommitment':
      return { ...s, commitments: [a.commitment, ...s.commitments] };
    case 'confirmExtraction': {
      const x = s.extractions.find((e) => e.id === a.id);
      if (!x) return s;
      const now = Date.now();
      const commitment: Commitment = {
        id: uid('p'),
        customerId: x.customerId,
        title: (a.title ?? x.title).replace(/\.$/, ''),
        ownerId: s.me,
        dueAt: a.dueAt ?? x.dueAt ?? now + 86_400_000,
        status: 'open',
        promisor: 'us',
        sourceEventId: x.sourceEventId,
        confidence: 0.9,
        createdAt: now,
      };
      const facts: CustomerFact[] = a.fields
        .filter((f) => f.checked)
        .map((f) => ({
          id: uid('f'),
          customerId: x.customerId,
          kind: f.key === 'deadline' || f.key === 'requirement' ? 'temporal' : 'note',
          text: `${f.label}: ${f.value}`,
          sourceEventId: x.sourceEventId,
          confidence: 0.85,
          createdAt: now,
        }));
      return {
        ...s,
        extractions: s.extractions.map((e) => (e.id === a.id ? { ...e, status: 'confirmed', fields: a.fields } : e)),
        commitments: x.status === 'confirmed' ? s.commitments : [commitment, ...s.commitments],
        facts: [...facts, ...s.facts],
      };
    }
    case 'ignoreExtraction':
      return { ...s, extractions: s.extractions.map((e) => (e.id === a.id ? { ...e, status: 'ignored' } : e)) };
    case 'markNotificationsRead':
      return { ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    case 'markNotificationRead':
      return { ...s, notifications: s.notifications.map((n) => (n.id === a.id ? { ...n, read: true } : n)) };
    case 'addCustomer':
      return { ...s, customers: [a.customer, ...s.customers] };
    case 'archiveCustomer':
      return { ...s, customers: s.customers.map((c) => (c.id === a.id ? { ...c, archived: true } : c)) };
    case 'unarchiveCustomer':
      return { ...s, customers: s.customers.map((c) => (c.id === a.id ? { ...c, archived: false } : c)) };
    case 'forgetFact':
      return { ...s, facts: s.facts.filter((f) => f.id !== a.id) };
    case 'addEvent':
      return {
        ...s,
        events: [...s.events, a.event],
        customers: s.customers.map((c) =>
          c.id === a.event.customerId && a.event.kind !== 'note' ? { ...c, headline: a.event.title } : c,
        ),
      };
    case 'addFacts':
      return { ...s, facts: [...a.facts, ...s.facts] };
    case 'resolveInbox':
      return { ...s, inbox: s.inbox.map((i) => (i.id === a.id ? { ...i, bucket: 'done' } : i)) };
    case 'updateSettings':
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case 'setIntegration':
      return { ...s, integrations: s.integrations.map((i) => (i.id === a.id ? { ...i, ...a.patch } : i)) };
    case 'inviteMember':
      return {
        ...s,
        members: [
          ...s.members,
          { id: uid('m'), name: a.email, email: a.email, role: 'member', status: 'invited', invitedAt: Date.now() },
        ],
      };
  }
}

export type SyncState = { status: 'idle' | 'loading' | 'error'; error?: string; loadedAt?: number };

type Store = {
  state: AppState;
  ready: boolean;
  /** Cloud mode only: whether the signed-in user already has a workspace. */
  hasWorkspace: boolean;
  sync: SyncState;
  reload: () => Promise<void>;
  dispatch: React.Dispatch<Action>;
  actions: ReturnType<typeof makeActions>;
};

/** Minimal state for a signed-in user who hasn't created a workspace yet. */
function emptyCloudState(email = ''): AppState {
  const seed = buildSeed();
  return {
    ...seed,
    org: { id: '', name: '', sells: '', handles: [], channels: [], plan: 'free' },
    me: 'me',
    members: [{ id: 'me', name: '', email, role: 'owner', status: 'active' }],
    customers: [],
    events: [],
    facts: [],
    commitments: [],
    extractions: [],
    notifications: [],
    inbox: [],
    integrations: [],
    invoices: [],
    onboarded: false,
  };
}

/** Cloud side effects run after the optimistic local update; failures re-sync from the server. */
type Cloud = {
  /** Present only in cloud mode once a workspace is loaded. */
  ctx: () => { orgId: ID; meId: ID } | null;
  /** `refresh`: re-sync afterwards so rows created optimistically pick up their server ids. */
  run: (label: string, fn: (ctx: { orgId: ID; meId: ID }) => Promise<unknown>, refresh?: boolean) => Promise<void>;
  createWorkspace: (input: { name: string; sells: string; handles: string[]; channels: Organization['channels'] }) => Promise<void>;
};

function makeActions(dispatch: React.Dispatch<Action>, get: () => AppState, cloud: Cloud) {
  const channelOf = (customerId: ID) => get().customers.find((c) => c.id === customerId)?.preferredChannel ?? 'whatsapp';
  return {
    /**
     * Finish onboarding. Demo: marks the seeded workspace as set up. Cloud: creates the workspace
     * (the caller becomes its owner) unless it already exists, then saves the answers.
     */
    onboard: async (org: Partial<Organization>, ownerName?: string) => {
      if (backendMode === 'cloud') {
        const existing = cloud.ctx();
        if (existing) {
          dispatch({ type: 'onboard', org, ownerName });
          await cloud.run('Save your answers', ({ orgId }) =>
            remote.updateOrganization(orgId, { sells: org.sells, handles: org.handles, channels: org.channels }),
          );
        } else {
          await cloud.createWorkspace({
            name: org.name?.trim() || 'My business',
            sells: org.sells ?? '',
            handles: org.handles ?? [],
            channels: org.channels ?? [],
          });
        }
        return;
      }
      dispatch({ type: 'onboard', org, ownerName });
    },
    reset: () => dispatch({ type: 'reset' }),
    completeCommitment: (id: ID) => {
      dispatch({ type: 'completeCommitment', id });
      void cloud.run('Complete promise', () => remote.completeCommitment(id));
    },
    undoComplete: (id: ID) => {
      dispatch({ type: 'undoComplete', id });
      void cloud.run('Undo', () => remote.reopenCommitment(id));
    },
    snoozeCommitment: (id: ID, until: number) => {
      dispatch({ type: 'snoozeCommitment', id, until });
      void cloud.run('Snooze', () => remote.snoozeCommitment(id, until));
    },
    handOff: (id: ID, memberId: ID) => {
      dispatch({ type: 'handOff', id, memberId });
      void cloud.run('Hand off', () => remote.handOffCommitment(id, memberId));
    },
    confirmExtraction: (id: ID, fields: ExtractionField[], dueAt?: number, title?: string) => {
      dispatch({ type: 'confirmExtraction', id, fields, dueAt, title });
      void cloud.run('Add to Promise Radar', () => remote.confirmExtraction(id, fields, dueAt, title), true);
    },
    ignoreExtraction: (id: ID) => {
      dispatch({ type: 'ignoreExtraction', id });
      void cloud.run('Ignore', () => remote.ignoreExtraction(id));
    },
    markNotificationsRead: () => {
      dispatch({ type: 'markNotificationsRead' });
      void cloud.run('Mark read', ({ orgId }) => remote.markNotificationsRead(orgId));
    },
    markNotificationRead: (id: ID) => {
      dispatch({ type: 'markNotificationRead', id });
      void cloud.run('Mark read', ({ orgId }) => remote.markNotificationsRead(orgId, [id]));
    },
    /** Resolve an inbox item; if an outbound action happened, record it as an immutable event on the timeline. */
    resolveInbox: (id: ID, sent?: { title: string; body?: string }) => {
      const item = get().inbox.find((i) => i.id === id);
      dispatch({ type: 'resolveInbox', id });
      if (item && sent) {
        dispatch({
          type: 'addEvent',
          event: {
            id: uid('e'),
            customerId: item.customerId,
            kind: 'message',
            channel: channelOf(item.customerId),
            direction: 'out',
            at: Date.now(),
            title: sent.title,
            body: sent.body,
            authorId: get().me,
          },
        });
      }
      void cloud.run('Save', async ({ orgId, meId }) => {
        await remote.resolveSuggestion(id);
        if (item && sent)
          await remote.addOutboundMessage(orgId, { customerId: item.customerId, channel: channelOf(item.customerId), title: sent.title, body: sent.body, authorId: meId });
      }, !!sent);
    },
    updateSettings: (patch: Partial<Settings>) => {
      dispatch({ type: 'updateSettings', patch });
      void cloud.run('Save settings', ({ orgId }) => remote.updateSettings(orgId, patch));
    },
    setIntegration: (id: ID, patch: Partial<Integration>) => {
      if (patch.status === 'connected' && !patch.lastSyncAt) patch = { ...patch, lastSyncAt: Date.now() };
      dispatch({ type: 'setIntegration', id, patch });
      if (patch.status) void cloud.run('Update integration', () => remote.setIntegrationStatus(id, patch.status!));
    },
    inviteMember: (email: string) => {
      dispatch({ type: 'inviteMember', email });
      void cloud.run('Invite', ({ orgId }) => remote.inviteMember(orgId, email), true);
    },
    archiveCustomer: (id: ID) => {
      dispatch({ type: 'archiveCustomer', id });
      void cloud.run('Remove', () => remote.setCustomerArchived(id, true));
    },
    unarchiveCustomer: (id: ID) => {
      dispatch({ type: 'unarchiveCustomer', id });
      void cloud.run('Restore', () => remote.setCustomerArchived(id, false));
    },
    forgetFact: (id: ID) => {
      dispatch({ type: 'forgetFact', id });
      void cloud.run('Forget', () => remote.forgetFact(id));
    },
    unforgetFact: (fact: CustomerFact) => {
      dispatch({ type: 'addFacts', facts: [fact] });
      void cloud.run('Undo forget', () => remote.unforgetFact(fact.id));
    },
    /** Resolves to the saved customer — in cloud mode with its server id, so callers can navigate to it. */
    addCustomer: async (input: { name: string; company?: string; phone?: string; email?: string }): Promise<Customer> => {
      const ctx = cloud.ctx();
      if (ctx) {
        const saved = await remote.addCustomer(ctx.orgId, input, ctx.meId);
        dispatch({ type: 'addCustomer', customer: saved });
        return saved;
      }
      const now = Date.now();
      const customer: Customer = {
        id: uid('c'),
        name: input.name.trim(),
        company: input.company?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        email: input.email?.trim() || undefined,
        preferredChannel: 'whatsapp',
        customerSince: now,
        lifetimeValue: 0,
        headline: 'New customer',
        ownerId: get().me,
        createdAt: now,
      };
      dispatch({ type: 'addCustomer', customer });
      return customer;
    },
    addNote: (customerId: ID, body: string) => {
      const event: CustomerEvent = {
        id: uid('e'),
        customerId,
        kind: 'note',
        channel: 'manual',
        direction: 'internal',
        at: Date.now(),
        title: 'Note',
        body,
        authorId: get().me,
      };
      dispatch({ type: 'addEvent', event });
      void cloud.run('Save note', ({ orgId, meId }) => remote.addNote(orgId, customerId, body, meId), true);
      return event;
    },
    /** Save a confirmed capture: raw event + optional promise + facts, all linked to the event. */
    saveCapture: (input: {
      customerId: ID;
      transcript: string;
      kind: 'voice' | 'note';
      promise?: { title: string; dueAt: number };
      facts?: string[];
    }) => {
      const now = Date.now();
      const event: CustomerEvent = {
        id: uid('e'),
        customerId: input.customerId,
        kind: 'note',
        channel: 'manual',
        direction: 'internal',
        at: now,
        title: input.kind === 'voice' ? 'Voice note' : 'Note',
        body: input.transcript,
        authorId: get().me,
      };
      dispatch({ type: 'addEvent', event });
      if (input.promise) {
        dispatch({
          type: 'addCommitment',
          commitment: {
            id: uid('p'),
            customerId: input.customerId,
            title: input.promise.title,
            ownerId: get().me,
            dueAt: input.promise.dueAt,
            status: 'open',
            promisor: 'us',
            sourceEventId: event.id,
            quote: input.transcript,
            quoteBy: 'You',
            confidence: 0.85,
            createdAt: now,
          },
        });
      }
      if (input.facts?.length) {
        dispatch({
          type: 'addFacts',
          facts: input.facts.map((text) => ({
            id: uid('f'),
            customerId: input.customerId,
            kind: 'temporal',
            text,
            sourceEventId: event.id,
            confidence: 0.8,
            createdAt: now,
          })),
        });
      }
      // Cloud: one transaction — the note is the immutable source; the promise and facts point back to it.
      void cloud.run(
        'Save capture',
        () => remote.saveCapture({ customerId: input.customerId, body: input.transcript, kind: input.kind, promise: input.promise, facts: input.facts }),
        true,
      );
      return event;
    },
  };
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const cloudMode = backendMode === 'cloud';
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    cloudMode ? emptyCloudState() : { ...buildSeed(), onboarded: false },
  );
  const [localReady, setLocalReady] = useState(cloudMode);
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Latest committed state for action handlers (read in events, never during render).
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  /* ── Demo mode: persisted on-device ── */
  useEffect(() => {
    if (cloudMode) return;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as AppState & { savedAt?: number };
          const sameDay = saved.savedAt && new Date(saved.savedAt).toDateString() === new Date().toDateString();
          // Demo data is relative to "now": keep today's edits, re-anchor the seed on a new day.
          dispatch({
            type: 'hydrate',
            state: sameDay
              ? saved
              : { ...buildSeed(), onboarded: saved.onboarded, org: saved.org, settings: saved.settings, members: saved.members },
          });
        }
      })
      .catch(() => {})
      .finally(() => setLocalReady(true));
  }, [cloudMode]);

  useEffect(() => {
    if (cloudMode || !localReady) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() })).catch(() => {});
  }, [state, localReady, cloudMode]);

  /* ── Cloud mode: the signed-in user's workspace from Supabase ── */
  const loading = useRef<Promise<void> | null>(null);
  const reload = useCallback(async () => {
    if (!cloudMode) return;
    if (loading.current) return loading.current;
    const run = (async () => {
      setSync((s) => ({ ...s, status: 'loading' }));
      try {
        await remote.acceptInvites().catch(() => 0); // join any workspace this email was invited to
        const ws = await remote.getWorkspace();
        if (!ws) {
          setHasWorkspace(false);
          dispatch({ type: 'hydrate', state: emptyCloudState(session.email ?? '') });
        } else {
          const data = await remote.loadWorkspaceData(ws.org.id);
          setHasWorkspace(true);
          dispatch({
            type: 'hydrate',
            state: {
              ...emptyCloudState(ws.me.email),
              ...data,
              org: ws.org,
              settings: ws.settings,
              members: ws.members,
              me: ws.me.id,
              onboarded: true,
              lastCompleted: stateRef.current.lastCompleted,
            },
          });
        }
        setSync({ status: 'idle', loadedAt: Date.now() });
      } catch (e) {
        setSync({ status: 'error', error: e instanceof Error ? e.message : String(e), loadedAt: Date.now() });
      } finally {
        loading.current = null;
      }
    })();
    loading.current = run;
    return run;
  }, [cloudMode, session.email]);

  // Load on sign-in, clear on sign-out.
  useEffect(() => {
    if (!cloudMode || !session.ready) return;
    if (!session.userId) {
      // Signed out elsewhere (token expiry, another tab): drop the workspace from memory.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasWorkspace(false);
      setLoadedFor(null);
      dispatch({ type: 'hydrate', state: emptyCloudState() });
      return;
    }
    reload().finally(() => setLoadedFor(session.userId));
  }, [cloudMode, session.ready, session.userId, reload]);

  // Realtime: any change in this workspace (a teammate, the WhatsApp webhook, the AI pipeline) re-syncs.
  const orgId = hasWorkspace ? state.org.id : '';
  useEffect(() => {
    if (!supabase || !orgId) return;
    const db = supabase;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 600);
    };
    const channel = db.channel(`org:${orgId}`);
    for (const table of REALTIME_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` }, soon);
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [orgId, reload]);

  // Back in the foreground: catch up on anything that happened while away (Realtime may have dropped).
  useEffect(() => {
    if (!orgId) return;
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void reload();
    });
    return () => sub.remove();
  }, [orgId, reload]);

  const cloud = useMemo<Cloud>(() => {
    const ctx = () => {
      const s = stateRef.current;
      return cloudMode && s.org.id && s.me ? { orgId: s.org.id, meId: s.me } : null;
    };
    return {
      ctx,
      async run(label, fn, refresh) {
        const c = ctx();
        if (!c) return;
        try {
          await fn(c);
          if (refresh) await reload();
        } catch (e) {
          setSync({ status: 'error', error: `${label} didn’t save. ${e instanceof Error ? e.message : ''}`.trim() });
          await reload(); // put the screen back in line with what the server has
        }
      },
      async createWorkspace(input) {
        const id = await remote.createOrganization(input.name, input.sells);
        await remote.updateOrganization(id, { handles: input.handles, channels: input.channels });
        await reload();
      },
    };
  }, [cloudMode, reload]);

  // The getter is only called from event handlers, after render.
  // eslint-disable-next-line react-hooks/refs
  const actions = useMemo(() => makeActions(dispatch, () => stateRef.current, cloud), [cloud]);
  const ready = cloudMode ? session.ready && (!session.userId || loadedFor === session.userId) : localReady;
  const value = useMemo(
    () => ({ state, ready, hasWorkspace, sync, reload, dispatch, actions }),
    [state, ready, hasWorkspace, sync, reload, actions],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

const REALTIME_TABLES = [
  'customers',
  'conversation_events',
  'customer_facts',
  'commitments',
  'extractions',
  'notifications',
  'followup_suggestions',
  'integration_accounts',
  'organization_members',
];

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}

export function useCustomer(id: ID | undefined) {
  const { state } = useStore();
  return state.customers.find((c) => c.id === id);
}

export function useMe() {
  const { state } = useStore();
  return state.members.find((m) => m.id === state.me) ?? state.members[0];
}

export type { Extraction };
