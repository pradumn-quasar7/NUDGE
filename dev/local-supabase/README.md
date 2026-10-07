# Local Supabase harness (no Docker)

Runs the Nudge database exactly as `supabase/migrations` + `supabase/seed.sql` define it, on plain
Homebrew Postgres, with PostgREST behind a small gateway that speaks the same URLs as Supabase.
Use it to test RLS, RPCs and triggers, and to point the app at a real backend without Docker.

```bash
brew install postgresql@16 postgrest      # once (node ≥ 20 also needed)
dev/local-supabase/start.sh               # fresh database every time (~3 s)
node dev/local-supabase/smoke.mjs         # end-to-end checks; exits 1 on failure
dev/local-supabase/stop.sh                # stop; `--clean` also deletes .data/
```

`smoke.mjs` changes the seeded data, so run it on a fresh database:
`node dev/local-supabase/smoke.mjs --fresh` runs `start.sh` first.

## What runs

| | Where | Notes |
|---|---|---|
| Postgres 16 | `127.0.0.1:54322`, data in `.data/pg` | trust auth, local only, `postgres` superuser |
| PostgREST | `127.0.0.1:54331` | `db-schemas = public`, `db-anon-role = anon`, JWT secret below |
| Gateway | `http://127.0.0.1:54321` | `/rest/v1/*` → PostgREST · `/auth/v1/*` → minimal GoTrue stub · `/functions/v1/*` → 501 |

Ports can be changed with `NUDGE_DB_PORT`, `NUDGE_API_PORT`, `NUDGE_PGRST_PORT` (stop `supabase start`
first if it is running — same ports). Logs: `.data/postgres.log`, `.data/postgrest.log`,
`.data/gateway.log`, `.data/migrate.log`. Keys and URLs: `.data/env`.

`bootstrap.sql` stands in for what a Supabase project has before migrations run: the `anon`,
`authenticated`, `service_role` and `authenticator` roles with Supabase's default grants;
`auth.users` and `auth.uid()` / `auth.jwt()` / `auth.role()` (read from `request.jwt.claims`, set by
PostgREST); a `storage` schema stub; the `extensions` schema; the `supabase_realtime` publication; a
**plaintext** Vault stub (`vault.secrets`, `vault.decrypted_secrets`, `vault.create_secret()`); and a
`net.http_post()` with pg_net's signature that **records** calls in `net.http_calls` instead of
sending them.

`start.sh` then applies every migration in order, the seed, the two Vault secrets the automation
uses (`project_url` = the gateway, `service_role_key`), and creates confirmed auth users for the
seeded members, which the `on_auth_user_created` trigger links to their memberships.

## Tokens and accounts

JWT secret (local only): `super-secret-jwt-token-with-at-least-32-characters-long`
(override with `NUDGE_JWT_SECRET`).

```bash
node dev/local-supabase/mint-jwt.mjs --email alex@brightline.in   # owner; also sana@ / ravi@ (members)
node dev/local-supabase/mint-jwt.mjs --email new@person.test      # creates a confirmed user if missing
node dev/local-supabase/mint-jwt.mjs a1000000-0000-4000-8000-000000000001   # by auth user id
node dev/local-supabase/mint-jwt.mjs --role anon | --role service_role
node dev/local-supabase/mint-jwt.mjs --decode <token>
```

| Account | auth user id | Member |
|---|---|---|
| alex@brightline.in | `a1000000-0000-4000-8000-000000000001` | owner `b2000000-…-000000000001` |
| sana@brightline.in | `a1000000-0000-4000-8000-000000000002` | member `b2000000-…-000000000002` |
| ravi@brightline.in | `a1000000-0000-4000-8000-000000000003` | member `b2000000-…-000000000003` |

Demo password for all three (local test value): `nudge-local-dev` (override with
`NUDGE_DEMO_PASSWORD` before `start.sh`).

```bash
TOKEN=$(node dev/local-supabase/mint-jwt.mjs --email alex@brightline.in)
curl -s 'http://127.0.0.1:54321/rest/v1/notification_feed?select=id,read' -H "Authorization: Bearer $TOKEN"
```

### Pointing the app at it

`app/.env.local`:

```bash
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<NUDGE_ANON_KEY from dev/local-supabase/.data/env>
```

The `/auth/v1` stub implements `signUp` (auto-confirmed, like local Supabase with confirmations
off), `signInWithPassword`, refresh, `getUser` and `signOut` — enough for `supabase-js` sessions.
Anything else (magic links, OTP, OAuth, password reset, emails) returns 501.

### pg_net calls

```bash
psql -h 127.0.0.1 -p 54322 -U postgres -c 'select id, url, body, created_at from net.http_calls order by id'
```

Every note, voice note or reply inserted from the app (an event with `author_member_id`) appears
here as a POST to `/functions/v1/ai-extract` with `{"event_id": …}` and the service-role bearer.

## What smoke.mjs covers

Using the app's own `@supabase/supabase-js` against the gateway, as Alex (owner), Sana (member),
an outsider who signs up through `/auth/v1` and creates their own workspace, and the anon key:
reads of every table the app uses; complete / reopen / snooze / hand off; `confirm_extraction`
(and idempotency) / ignore; note and reply inserts with the recorded `ai-extract` call;
`save_capture`; direct capture inserts and their integrity checks; per-member
`mark_notifications_read` + `notification_feed`; resolve suggestion; archive / unarchive; add
customer; `forget_fact` / `unforget_fact`; owner-only org, settings, integration and team
operations (and their refusals for members); invite + `accept_member_invites`; private customers
(`share_all_customers = false`); tenant isolation; the trigger doing nothing when Vault secrets
are missing; voice notes — the `voice-notes` bucket and its own-folder policies (exercised as the user
through psql, the way the Storage API runs them, since there is no `/storage/v1` here) and
`save_capture(…, audio_path)` creating the `attachments` row.

## Not covered here

- **Edge Functions** (`ai-extract`, `copilot`, `transcribe`, `whatsapp-webhook`, `followup-scheduler`): need Deno /
  `supabase functions serve` and an Anthropic key. Here pg_net calls are only recorded.
- **pg_cron**: not installed in Homebrew Postgres; the migration skips scheduling with a notice.
- **Realtime**, the **Storage API** (`storage.buckets` / `storage.objects` / `storage.foldername()` and the
  policies exist; uploads from the app need real Supabase), real **Vault** encryption.
- **GoTrue** beyond the stub: confirmation emails, invites by email, rate limits, MFA.

## Run the app against the harness

```bash
node dev/local-supabase/web.mjs        # Expo web in cloud mode on http://localhost:8082
```

The auth stub has no email codes, so the app's "Send code" step shows a connection error here. To sign in as a
seeded account, get a session from `/auth/v1/token?grant_type=password` (demo password above) and store it in the
browser under `localStorage['sb-127-auth-token']`, then reload. New accounts can be created with `/auth/v1/signup`;
they land on the app's "About you" onboarding step and create their own workspace.
