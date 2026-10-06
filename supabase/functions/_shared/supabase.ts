import { createClient, type SupabaseClient } from "./deps.ts";
import { HttpError } from "./cors.ts";

/** Reads a required environment variable (SUPABASE_* are injected by the Edge Runtime). */
export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "server_misconfigured", `Missing environment variable ${name}`);
  return value;
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

let service: SupabaseClient | undefined;

/**
 * Service-role client: BYPASSES RLS. Use only for system work (webhooks, AI pipeline,
 * scheduler) and always scope queries by org_id explicitly.
 */
export function serviceClient(): SupabaseClient {
  service ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: noSession });
  return service;
}

/**
 * Client that acts as the calling user: every query is subject to RLS, so it can
 * only see what the user could see from the app.
 */
export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new HttpError(401, "missing_authorization");
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: noSession,
    global: { headers: { Authorization: authorization } },
  });
}
