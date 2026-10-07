import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Authentication. In demo mode (no Supabase env vars) there is no account: `mode` is 'demo' and
 * `ready` is immediately true. In cloud mode people sign in with a 6-digit code sent to their
 * email — no passwords to remember or leak.
 */

export type BackendMode = 'demo' | 'cloud';
export const backendMode: BackendMode = isSupabaseConfigured ? 'cloud' : 'demo';

type SessionValue = {
  mode: BackendMode;
  ready: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  saveName: (fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      mode: backendMode,
      ready,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      async sendCode(email) {
        if (!supabase) return;
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
        if (error) throw new Error(friendlyAuthError(error.message));
      },
      async verifyCode(email, code) {
        if (!supabase) return;
        const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
        if (error) throw new Error(friendlyAuthError(error.message));
      },
      async saveName(fullName) {
        if (!supabase || !session) return;
        const name = fullName.trim();
        // The profile row is what create_organization() uses for the owner's member name.
        await supabase.auth.updateUser({ data: { full_name: name } });
        await supabase.from('profiles').update({ full_name: name }).eq('id', session.user.id);
      },
      async signOut() {
        await supabase?.auth.signOut();
      },
    }),
    [ready, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

/** Maps Supabase Auth messages to calm, specific copy. Unknown errors fall back to a connection message. */
function friendlyAuthError(message: string) {
  const m = message.toLowerCase();
  if (m.includes('token has expired') || m.includes('otp') && m.includes('invalid') || m.includes('token') && m.includes('invalid'))
    return 'That code didn’t work. Check the latest email or send a new code.';
  if (m.includes('rate limit') || m.includes('for security purposes')) return 'Too many tries. Wait a minute, then send a new code.';
  if (m.includes('validate email') || m.includes('invalid format') || m.includes('email address') && m.includes('invalid'))
    return 'That email address doesn’t look right.';
  if (m.includes('signups not allowed')) return 'New sign-ups are closed for this workspace. Ask your owner for an invite.';
  return 'Couldn’t reach Nudge. Check your connection and try again.';
}
