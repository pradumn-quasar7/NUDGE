import type { SupabaseClient, User } from "./deps.ts";
import { HttpError } from "./cors.ts";
import { env, userClient } from "./supabase.ts";
import type { MemberRow } from "./types.ts";

const encoder = new TextEncoder();

/** Constant-time comparison of two byte arrays (runtime depends only on the longer length). */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

function bearer(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * Internal endpoints (ai-extract, followup-scheduler) are called by other functions
 * and pg_cron with the service-role key. verify_jwt is off for them in config.toml,
 * so this check is the gate.
 */
/**
 * Internal endpoints (pg_net trigger, pg_cron): only the project's service key may call them.
 *
 * Hosted projects can expose the service key in two forms — the legacy service_role JWT and the
 * newer `sb_secret_…` keys — and the one stored in Vault need not be the one injected here. Accept:
 *   1. an exact match with SUPABASE_SERVICE_ROLE_KEY or any SUPABASE_SECRET_KEYS value, or
 *   2. a JWT whose payload says role = service_role AND that PostgREST accepts (it verifies the
 *      signature), so a forged or user token can never pass.
 */
export async function requireServiceRole(req: Request): Promise<void> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthorized");
  if (knownServiceKeys().some((k) => timingSafeEqual(token, k))) return;
  if (jwtRole(token) === "service_role") {
    const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/ai_runs?select=id&limit=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    }).catch(() => null);
    await res?.body?.cancel().catch(() => {});
    if (res?.ok) return;
  }
  throw new HttpError(401, "unauthorized");
}

function knownServiceKeys(): string[] {
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed ? Object.values(parsed) : [];
      for (const v of values) if (typeof v === "string") keys.push(v);
    } catch {
      keys.push(raw);
    }
  }
  return keys.filter((k) => k.length > 0);
}

/** Reads the `role` claim of a JWT without trusting it (callers must still verify the signature). */
function jwtRole(token: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

export type AuthedUser = { user: User; db: SupabaseClient };

/** Verifies the caller's JWT with Supabase Auth and returns an RLS-scoped client. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "missing_authorization");
  const db = userClient(req);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_token");
  return { user: data.user, db };
}

/** The caller's ACTIVE membership in `orgId`, or 403. Read through RLS (own rows are visible). */
export async function requireMembership(db: SupabaseClient, userId: string, orgId: string): Promise<MemberRow> {
  const { data, error } = await db
    .from("organization_members")
    .select("id, org_id, user_id, name, email, role, title, status")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<MemberRow>();
  if (error) throw new HttpError(500, "membership_lookup_failed");
  if (!data) throw new HttpError(403, "not_a_member");
  return data;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
