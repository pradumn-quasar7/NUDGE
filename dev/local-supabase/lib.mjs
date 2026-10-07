// Shared helpers for the local harness (no dependencies).
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA = join(HERE, '.data');

// Same default secret as `supabase start`, so tokens look familiar. Local only.
export const JWT_SECRET = process.env.NUDGE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
export const DB_PORT = Number(process.env.NUDGE_DB_PORT ?? 54322);
export const API_PORT = Number(process.env.NUDGE_API_PORT ?? 54321);
export const PGRST_PORT = Number(process.env.NUDGE_PGRST_PORT ?? 54331);
export const API_URL = `http://127.0.0.1:${API_PORT}`;

const PSQL = process.env.PSQL ?? (existsSync('/opt/homebrew/bin/psql') ? '/opt/homebrew/bin/psql' : 'psql');

/* ───────────── JWT (HS256) ───────────── */

const b64url = (input) => Buffer.from(input).toString('base64url');

export function signJwt(claims, secret = JWT_SECRET) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Returns the claims of a valid, unexpired HS256 token, or null. */
export function verifyJwt(token, secret = JWT_SECRET) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof claims.exp === 'number' && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

/** anon / service_role API keys (long-lived, like the CLI's). */
export function apiKey(role) {
  return signJwt({ iss: 'supabase-demo', role, iat: now(), exp: now() + 10 * 365 * 24 * 3600 });
}

/** A user access token, shaped like GoTrue's. */
export function userToken(user, ttlSeconds = 3600) {
  return signJwt({
    iss: `${API_URL}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    sub: user.id,
    email: user.email ?? undefined,
    app_metadata: user.app_metadata ?? { provider: 'email', providers: ['email'] },
    user_metadata: user.user_metadata ?? {},
    session_id: randomUUID(),
    iat: now(),
    exp: now() + ttlSeconds,
  });
}

/* ───────────── psql ───────────── */

/**
 * Runs SQL as the superuser. Variables are passed with -v and referenced as :'name'
 * in the SQL (psql quotes them), so values are never spliced into the text.
 * Returns stdout (unaligned, tuples only), trimmed.
 */
export function psql(sql, vars = {}) {
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(DB_PORT), '-U', 'postgres', '-d', 'postgres'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v ?? ''}`);
  return execFileSync(PSQL, args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function psqlJson(sql, vars = {}) {
  const out = psql(sql, vars);
  return out ? JSON.parse(out) : null;
}

/* ───────────── auth.users ───────────── */

const USER_JSON = `
  select json_build_object(
    'id', u.id, 'aud', 'authenticated', 'role', 'authenticated', 'email', u.email,
    'email_confirmed_at', u.email_confirmed_at, 'confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'app_metadata', coalesce(u.raw_app_meta_data, '{}'), 'user_metadata', coalesce(u.raw_user_meta_data, '{}'),
    'identities', '[]'::json, 'created_at', u.created_at, 'updated_at', u.updated_at)`;
const USER_SQL = `${USER_JSON} from auth.users u`;

export function getUserById(id) {
  return psqlJson(`${USER_SQL} where u.id = :'id'::uuid;`, { id });
}

export function getUserByEmail(email) {
  return psqlJson(`${USER_SQL} where u.email = lower(:'email');`, { email });
}

/**
 * Creates a confirmed auth user (fires on_auth_user_created → profiles + invite
 * linking, exactly like a sign-up with confirmations off). Returns the user.
 */
export function createUser({ email, password = null, id = null, fullName = null }) {
  return psqlJson(
    `with u as (
       insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values (coalesce(nullif(:'id', '')::uuid, gen_random_uuid()), lower(:'email'),
               case when :'password' = '' then null else crypt(:'password', gen_salt('bf')) end,
               now(),
               case when :'full_name' = '' then '{}'::jsonb else jsonb_build_object('full_name', :'full_name') end)
       returning *
     )
     ${USER_JSON} from u;`,
    { email, password: password ?? '', id: id ?? '', full_name: fullName ?? '' },
  );
}

export function ensureUser(opts) {
  return getUserByEmail(opts.email) ?? createUser(opts);
}

export function checkPassword(email, password) {
  return psqlJson(
    `with u as (
       update auth.users set last_sign_in_at = now()
       where email = lower(:'email') and encrypted_password is not null
         and encrypted_password = crypt(:'password', encrypted_password)
       returning *
     )
     ${USER_JSON} from u;`,
    { email, password },
  );
}
