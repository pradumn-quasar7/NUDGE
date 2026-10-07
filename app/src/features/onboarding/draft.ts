import { useSyncExternalStore } from 'react';
import type { Channel, Organization } from '@/data/types';

/**
 * Onboarding answers, kept in memory until "Go to Home" hands them to actions.onboard().
 * Module-level so every step (separate routes) shares one draft without a provider.
 */
export type OnboardingDraft = {
  /** Cloud mode only: asked on the "About you" step before the workspace exists. */
  ownerName?: string;
  businessName?: string;
  sells: string;
  handles: string[];
  channels: Channel[];
  /** False until the first step seeds it from the store (org.sells / handles / channels). */
  seeded: boolean;
};

let draft: OnboardingDraft = { sells: '', handles: [], channels: [], seeded: false };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getDraft() {
  return draft;
}

export function setDraft(patch: Partial<OnboardingDraft>) {
  draft = { ...draft, ...patch };
  emit();
}

type OrgAnswers = Pick<Organization, 'sells' | 'handles' | 'channels'>;

/**
 * Seed once from the organisation already in the store, so the answers start prefilled.
 * Silent (no emit) because it runs during render, before anything reads the draft.
 */
function seedDraft(org: OrgAnswers) {
  if (draft.seeded) return;
  draft = { sells: org.sells, handles: [...org.handles], channels: [...org.channels], seeded: true };
}

export function resetDraft() {
  draft = { sells: '', handles: [], channels: [], seeded: false };
  emit();
}

/** Read the draft (seeded from the store on first use) and re-render when it changes. */
export function useDraft(org: OrgAnswers) {
  seedDraft(org);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getDraft,
    getDraft,
  );
}

export function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
