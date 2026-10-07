#!/usr/bin/env node
// Tiny stand-in for Supabase's API gateway on :54321 (no dependencies).
//
//   /rest/v1/*       → PostgREST (127.0.0.1:PGRST_PORT), path prefix stripped
//   /auth/v1/*       → minimal GoTrue stub: signup, token (password / refresh_token),
//                      user, logout, settings. Sign-ups are auto-confirmed, like
//                      `supabase start` with enable_confirmations = false. No emails.
//   /functions/v1/*  → 501 (Edge Functions need the Supabase CLI / Deno)
//   everything else  → 404
import http from 'node:http';
import { API_PORT, PGRST_PORT, checkPassword, createUser, getUserByEmail, getUserById, signJwt, userToken, verifyJwt } from './lib.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version',
  'Access-Control-Expose-Headers': 'content-range, content-location',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(payload);
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });

/* ───────────── /rest/v1 → PostgREST ───────────── */

function proxyRest(req, res, path) {
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` };
  const upstream = http.request(
    { host: '127.0.0.1', port: PGRST_PORT, method: req.method, path: path || '/', headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => send(res, 502, { message: 'PostgREST is not reachable' }));
  req.pipe(upstream);
}

/* ───────────── /auth/v1 (GoTrue subset) ───────────── */

const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });

function session(user) {
  const expiresIn = 3600;
  return {
    access_token: userToken(user, expiresIn),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    // Stateless refresh token (survives gateway restarts). Local only.
    refresh_token: signJwt({ typ: 'refresh', sub: user.id, iat: Math.floor(Date.now() / 1000) }),
    user,
  };
}

function bearerUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  const claims = m && verifyJwt(m[1]);
  if (!claims || claims.role !== 'authenticated' || !claims.sub) return null;
  return getUserById(claims.sub);
}

async function handleAuth(req, res, path, url) {
  if (path === '/settings' && req.method === 'GET') {
    return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false });
  }
  if (path === '/health') return send(res, 200, { name: 'GoTrue (nudge local stub)' });

  if (path === '/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.');
    if (getUserByEmail(email)) return authError(res, 422, 'user_already_exists', 'User already registered');
    const meta = body.data && typeof body.data === 'object' ? body.data : {};
    const user = createUser({ email, password, fullName: typeof meta.full_name === 'string' ? meta.full_name : null });
    return send(res, 200, session(user));
  }

  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const user = checkPassword(String(body.email ?? ''), String(body.password ?? ''));
      if (!user) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      return send(res, 200, session(user));
    }
    if (grant === 'refresh_token') {
      const claims = verifyJwt(body.refresh_token);
      const user = claims?.typ === 'refresh' ? getUserById(claims.sub) : null;
      if (!user) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      return send(res, 200, session(user));
    }
    return authError(res, 400, 'unsupported_grant_type', `grant_type ${grant} is not supported by the local stub`);
  }

  if (path === '/user' && req.method === 'GET') {
    const user = bearerUser(req);
    if (!user) return authError(res, 401, 'bad_jwt', 'invalid JWT');
    return send(res, 200, user);
  }

  if (path === '/logout' && req.method === 'POST') {
    res.writeHead(204, CORS);
    return res.end();
  }

  return authError(res, 501, 'not_implemented', `/auth/v1${path} is not implemented by the local stub (no emails, OTP, OAuth)`);
}

/* ───────────── Server ───────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/rest/v1')) {
      return proxyRest(req, res, (pathname.slice('/rest/v1'.length) || '/') + url.search);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (pathname.startsWith('/auth/v1')) {
      return await handleAuth(req, res, pathname.slice('/auth/v1'.length), url);
    }
    if (pathname.startsWith('/functions/v1')) {
      return send(res, 501, { error: 'edge_functions_unavailable', message: 'Edge Functions are not served by dev/local-supabase. Use `supabase functions serve`.' });
    }
    return send(res, 404, { error: 'not_found', message: `${pathname} is not served by the local gateway` });
  } catch (err) {
    return send(res, err.status ?? 500, { error: 'gateway_error', message: err.message });
  }
});

server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[gateway] http://127.0.0.1:${API_PORT}  (/rest/v1 → :${PGRST_PORT}, /auth/v1 stub, /functions/v1 → 501)`);
});
