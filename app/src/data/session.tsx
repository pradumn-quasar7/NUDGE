import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
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
  /** Finish sign-in from the emailed link (deep link to /auth-callback). */
  completeFromLink: (params: { code?: string; url?: string | null }) => Promise<void>;
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
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          // The email's link opens the app at /auth-callback (nudge://auth-callback on a phone).
          options: { shouldCreateUser: true, emailRedirectTo: Linking.createURL('auth-callback') },
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },
      async verifyCode(email, code) {
        if (!supabase) return;
        const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
        if (error) throw new Error(friendlyAuthError(error.message));
      },
      async completeFromLink({ code, url }) {
        if (!supabase) return;
        const fromUrl = url ? parseAuthUrl(url) : {};
        const authCode = code ?? fromUrl.code;
        if (fromUrl.error) throw new Error(friendlyAuthError(fromUrl.error));
        if (authCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(authCode);
          if (error) throw new Error(friendlyAuthError(error.message));
          return;
        }
        if (fromUrl.access_token && fromUrl.refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token: fromUrl.access_token, refresh_token: fromUrl.refresh_token });
          if (error) throw new Error(friendlyAuthError(error.message));
          return;
        }
        throw new Error('That sign-in link is incomplete. Request a new one.');
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

/** Reads `code`, tokens or an error from a callback URL's query string and #fragment. */
function parseAuthUrl(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [, rest = ''] = url.split('?');
  for (const part of rest.replace('#', '&').split('&')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  for (const part of hash.split('&')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  if (out.error_description) out.error = out.error_description;
  return out;
}

/** Maps Supabase Auth messages to calm, specific copy. Unknown errors fall back to a connection message. */
function friendlyAuthError(message: string) {
  const m = message.toLowerCase();
  if (m.includes('token has expired') || m.includes('otp') && m.includes('invalid') || m.includes('token') && m.includes('invalid'))
    return 'That code didn’t work. Check the latest email or send a new code.';
  if (m.includes('rate limit') || m.includes('for security purposes')) return 'Too many tries. Wait a minute, then send a new code.';
  if (m.includes('validate email') || m.includes('invalid format') || m.includes('email address') && m.includes('invalid'))
    return 'That email address doesn’t look right.';
  if (m.includes('code verifier') || m.includes('flow state') || m.includes('link is invalid') || m.includes('expired'))
    return 'That sign-in link has expired or was opened on another device. Request a new one on this phone.';
  if (m.includes('signups not allowed')) return 'New sign-ups are closed for this workspace. Ask your owner for an invite.';
  return 'Couldn’t reach Nudge. Check your connection and try again.';
}
