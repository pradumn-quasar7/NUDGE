import { useCallback, useEffect, useRef, useState } from 'react';
import { answer, type CopilotAnswer } from '@/lib/ai';
import { askCopilot } from '@/data/remote';
import { backendMode } from '@/data/session';
import { useStore } from '@/data/store';
import type { ID } from '@/data/types';

/**
 * One way to ask Nudge a question. Cloud mode: the `copilot` edge function answers from the
 * workspace's records (Claude, read-only tools, evidence checked server-side). If that fails, or in
 * demo mode, the on-device engine answers instead — the screen never dead-ends.
 */
export function useAsk() {
  const { state } = useStore();
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  return useCallback(async (question: string, customerId?: ID): Promise<CopilotAnswer> => {
    const s = ref.current;
    if (backendMode === 'cloud' && s.org.id) {
      try {
        return await askCopilot(s.org.id, question, customerId);
      } catch {
        const local = answer(question, s, customerId);
        return { ...local, evidence: `${local.evidence} · answered on this device` };
      }
    }
    return answer(question, s, customerId);
  }, []);
}

/** Answer for a single submitted question (search results). `null` question → no answer. */
export function useAnswer(question: string | null, customerId?: ID) {
  const ask = useAsk();
  const { state } = useStore();
  const [result, setResult] = useState<{ q: string; a: CopilotAnswer } | null>(null);
  // Demo answers are recomputed as data changes; cloud answers are fetched once per question.
  const dep = backendMode === 'cloud' ? null : state;
  useEffect(() => {
    let live = true;
    if (!question) return;
    void ask(question, customerId).then((a) => live && setResult({ q: question, a }));
    return () => {
      live = false;
    };
  }, [question, customerId, ask, dep]);
  return result && result.q === question ? result.a : null;
}
