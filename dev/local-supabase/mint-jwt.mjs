#!/usr/bin/env node
// Mint JWTs for the local harness (HS256 with the harness secret; no dependencies).
//
//   node mint-jwt.mjs <auth-user-uuid>            access token (role authenticated, sub = uuid)
//   node mint-jwt.mjs --email alex@brightline.in  same, looked up by email; creates the confirmed
//                                                 auth user if missing (start.sh already created
//                                                 alex/sana/ravi), which links seeded invites
//   node mint-jwt.mjs --role anon                 anon key
//   node mint-jwt.mjs --role service_role         service-role key
//   node mint-jwt.mjs --decode <token>            print the claims (signature checked)
//
// Options: --ttl <seconds> (default 3600), --json (print {token, user}).
import { apiKey, ensureUser, getUserById, signJwt, userToken, verifyJwt } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? '');
};
const has = (name) => args.includes(name);

function usage(code = 1) {
  console.error('usage: mint-jwt.mjs <user-uuid> | --email <email> | --role anon|service_role | --decode <token>  [--ttl s] [--json]');
  process.exit(code);
}

const ttl = Number(flag('--ttl') ?? 3600);

if (has('--help') || has('-h') || args.length === 0) usage(args.length === 0 ? 1 : 0);

if (has('--decode')) {
  const claims = verifyJwt(flag('--decode'));
  if (!claims) {
    console.error('invalid or expired token');
    process.exit(1);
  }
  console.log(JSON.stringify(claims, null, 2));
} else if (has('--role')) {
  const role = flag('--role');
  if (role !== 'anon' && role !== 'service_role') usage();
  console.log(apiKey(role));
} else if (has('--email')) {
  const user = ensureUser({ email: flag('--email') });
  const token = userToken(user, ttl);
  console.log(has('--json') ? JSON.stringify({ token, user }) : token);
} else {
  const sub = args.find((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (!sub) usage();
  // Works without a database; with one, add email/metadata when the user exists.
  let user = { id: sub };
  try {
    user = getUserById(sub) ?? user;
  } catch {
    /* database not running: plain token */
  }
  const token = user.email ? userToken(user, ttl) : signJwt({ aud: 'authenticated', role: 'authenticated', sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl });
  console.log(has('--json') ? JSON.stringify({ token, user }) : token);
}
