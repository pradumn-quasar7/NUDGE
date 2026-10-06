import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSeed, type SeedData } from './seed';
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
 * Local-first app store. In demo mode it is seeded and persisted to AsyncStorage.
 * The action surface is the contract the Supabase repository implements next (see src/data/remote.ts).
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

type Store = {
  state: AppState;
  ready: boolean;
  dispatch: React.Dispatch<Action>;
  actions: ReturnType<typeof makeActions>;
};

function makeActions(dispatch: React.Dispatch<Action>, get: () => AppState) {
  return {
    onboard: (org: Partial<Organization>, ownerName?: string) => dispatch({ type: 'onboard', org, ownerName }),
    reset: () => dispatch({ type: 'reset' }),
    completeCommitment: (id: ID) => dispatch({ type: 'completeCommitment', id }),
    undoComplete: (id: ID) => dispatch({ type: 'undoComplete', id }),
    snoozeCommitment: (id: ID, until: number) => dispatch({ type: 'snoozeCommitment', id, until }),
    handOff: (id: ID, memberId: ID) => dispatch({ type: 'handOff', id, memberId }),
    confirmExtraction: (id: ID, fields: ExtractionField[], dueAt?: number, title?: string) =>
      dispatch({ type: 'confirmExtraction', id, fields, dueAt, title }),
    ignoreExtraction: (id: ID) => dispatch({ type: 'ignoreExtraction', id }),
    markNotificationsRead: () => dispatch({ type: 'markNotificationsRead' }),
    markNotificationRead: (id: ID) => dispatch({ type: 'markNotificationRead', id }),
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
            channel: get().customers.find((c) => c.id === item.customerId)?.preferredChannel ?? 'whatsapp',
            direction: 'out',
            at: Date.now(),
            title: sent.title,
            body: sent.body,
            authorId: get().me,
          },
        });
      }
    },
    updateSettings: (patch: Partial<Settings>) => dispatch({ type: 'updateSettings', patch }),
    setIntegration: (id: ID, patch: Partial<Integration>) => dispatch({ type: 'setIntegration', id, patch }),
    inviteMember: (email: string) => dispatch({ type: 'inviteMember', email }),
    archiveCustomer: (id: ID) => dispatch({ type: 'archiveCustomer', id }),
    unarchiveCustomer: (id: ID) => dispatch({ type: 'unarchiveCustomer', id }),
    forgetFact: (id: ID) => dispatch({ type: 'forgetFact', id }),
    addCustomer: (input: { name: string; company?: string; phone?: string; email?: string }) => {
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
      return event;
    },
  };
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ ...buildSeed(), onboarded: false }));
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
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
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() })).catch(() => {});
  }, [state, ready]);

  const actions = useMemo(() => makeActions(dispatch, () => stateRef.current), []);
  const value = useMemo(() => ({ state, ready, dispatch, actions }), [state, ready, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

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
  return state.members.find((m) => m.id === state.me)!;
}

export type { Extraction };
