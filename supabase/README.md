# Nudge backend (Supabase)

Postgres schema + Row Level Security, a demo seed, and four Deno Edge Functions:

| Path | What it is |
|---|---|
| `migrations/20261007000001_core_schema.sql` | Tables, enums, indexes, immutability + housekeeping triggers |
| `migrations/20261007000002_rls.sql` | RLS helpers and policies, privileges, Storage bucket policies, audit trail, Realtime |
| `migrations/20261007000003_onboarding.sql` | `profiles`, invite linking on sign-up, `create_organization()` RPC |
| `migrations/20261007000004_app_rpc.sql` | `confirm_extraction()`, `purge_customer()`, `ingest_event()` and `followup_candidates()` (service-only) |
| `migrations/20261007000005_automation.sql` | pg_net trigger → `ai-extract` for app-authored events, pg_cron → `followup-scheduler`, per-member notification read state, the app write paths in §5 |
| `seed.sql` | The "Brightline Fixtures" demo workspace from `app/src/data/seed.ts`, with timestamps relative to `now()` |
| `functions/whatsapp-webhook` | WhatsApp Cloud API webhook: verify, dedupe, store raw event, start extraction |
| `functions/ai-extract` | Raw event → Claude extraction → validated facts + **pending** commitment proposals |
| `functions/copilot` | "What did I promise?": answers only from the user's own records, with evidence |
| `functions/followup-scheduler` | Cron job: due promises → contact-policy check → suggestions + notifications (never sends) |
| `functions/_shared` | CORS, Supabase clients, auth checks, Claude client, time zone helpers, row types |

The app's domain types (`app/src/data/types.ts`) map 1:1 onto these tables (camelCase there,
snake_case here). `app/src/data/remote.ts` is the typed repository that does the mapping.

---

## 1. Local setup

**Without Docker:** `dev/local-supabase/start.sh` runs Postgres + PostgREST with Supabase stubs
(auth, Vault, pg_net recorder) on the same ports, and `node dev/local-supabase/smoke.mjs` checks
every app operation in §5 end to end. See `dev/local-supabase/README.md`.

**Full stack** requires the [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker.

```bash
# from the repo root (config.toml already exists, so `supabase init` is not needed)
supabase start                 # Postgres, Auth, Storage, Realtime, Studio, Edge Runtime
supabase db reset              # applies migrations/ and then seed.sql
supabase status                # prints API URL, anon key, service_role key
```

Sign in to the demo workspace: sign up in the app (or Studio → Authentication → Add user) as
`alex@brightline.in` (owner), `sana@brightline.in` or `ravi@brightline.in`. The seeded memberships
have no auth account; the `on_auth_user_created` trigger links them when that email signs up with a
confirmed address (confirmations are off locally). New users start with no workspace and create one
with `create_organization(name, sells)`.

### Edge Functions locally

Create `supabase/functions/.env` (gitignored by the root `.gitignore`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_VERIFY_TOKEN=<any long random string, also entered in the Meta dashboard>
```

```bash
supabase functions serve --env-file supabase/functions/.env
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Try the webhook with a correctly signed fake delivery (the seed routes phone_number_id
`100000000000001` to Brightline; `919820011234` is Rahul's WhatsApp number):

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"100000000000001"},"contacts":[{"wa_id":"919820011234","profile":{"name":"Rahul"}}],"messages":[{"id":"wamid.TEST1","from":"919820011234","timestamp":"'$(date +%s)'","type":"text","text":{"body":"Can you send the revised quote by Friday? I will confirm the order Monday."}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | sed 's/^.* //')
curl -i http://127.0.0.1:54321/functions/v1/whatsapp-webhook \
  -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=$SIG" --data "$BODY"
```

Then look at `conversation_events`, `customer_facts`, `extractions` (status `pending`), `ai_runs`
and `notifications` in Studio (http://127.0.0.1:54323). Sending the same body again is a no-op.

---

## 2. Hosted project

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                           # migrations only — do NOT run seed.sql in production

supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  WHATSAPP_APP_SECRET=<Meta app secret> \
  WHATSAPP_VERIFY_TOKEN=<random string>

supabase functions deploy whatsapp-webhook
supabase functions deploy ai-extract
supabase functions deploy copilot
supabase functions deploy followup-scheduler
```

`verify_jwt` per function comes from `config.toml`: off for `whatsapp-webhook` (HMAC-signed by
Meta), `ai-extract` and `followup-scheduler` (they require the service-role key, checked in code),
on for `copilot` (user JWT, also re-verified in code).

**Auth settings for production:** turn **email confirmations on**. Invitations are linked to
accounts by confirmed email address only.

### Automation: ai-extract trigger + follow-up scheduler (pg_net, pg_cron, Vault)

Migration `20261007000005` enables `pg_net` and `pg_cron` when the server offers them, adds an
`AFTER INSERT` trigger on `conversation_events` that POSTs `{ "event_id": … }` to `ai-extract` for
events **with an author** (notes, voice notes, replies sent from the app — WhatsApp events have no
author and are enqueued by the webhook), and schedules `nudge-followup-scheduler` every 15 minutes.
Both read the URL and key from Vault and do nothing until these exist — run once in the SQL editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
```

If pg_cron was not available when the migration ran, enable it (Dashboard → Integrations) and run:

```sql
select cron.schedule('nudge-followup-scheduler', '*/15 * * * *',
  $$select public.invoke_edge_function('followup-scheduler', '{}'::jsonb, 30000);$$);
```

Inspect with `select * from cron.job_run_details order by start_time desc limit 20;` and
`select * from net._http_response order by created desc limit 20;`. The trigger never blocks or fails
an insert: missing pg_net, Vault or secrets → no request.

### Connect WhatsApp (Cloud API)

1. Meta developer dashboard → WhatsApp → Configuration → Webhook:
   callback URL `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`, verify token =
   `WHATSAPP_VERIFY_TOKEN`; subscribe to the **messages** field.
2. Route the business number to a workspace (as service role / SQL editor):

   ```sql
   insert into integration_accounts (org_id, provider, name, status, detail, external_account_id)
   values ('<org uuid>', 'whatsapp', 'WhatsApp Business', 'connected', 'Connected', '<phone_number_id>')
   on conflict (org_id, provider) do update
     set status = 'connected', external_account_id = excluded.external_account_id;
   ```
3. The access token (needed later for outbound sending) goes into Vault, never into a table:
   `select vault.create_secret('<token>', 'whatsapp_token:<org uuid>');` and store the returned id
   in `integration_accounts.token_secret_id`.

---

## 3. App environment

Copy `app/.env.example` to `app/.env.local` and fill in the values from `supabase status`
(local) or Project Settings → API (hosted):

```bash
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

With these unset the app runs in demo mode (`isSupabaseConfigured === false` in
`app/src/lib/supabase.ts`). On a physical device use your machine's LAN IP instead of 127.0.0.1.
Never put the service-role key or `ANTHROPIC_API_KEY` in the app.

---

## 4. Security model

**Tenancy**
- Every business row has `org_id`. Child rows reference parents with composite
  `(org_id, id)` foreign keys, so a fact, promise or event can never point at another
  workspace's customer — even when written with the service role.
- RLS is enabled on every table. Access requires an **active** `organization_members` row for
  `auth.uid()`; checks go through `SECURITY DEFINER STABLE` helpers with a fixed `search_path`:
  `is_org_member(org)`, `org_role(org)`, `current_member_id(org)`, `can_see_customer(customer)`,
  `can_delete_history(org)`.
- `settings.share_all_customers = false` → members only see customers they own and those
  customers' events, facts, promises, proposals, suggestions and notifications. Owners see all.
- Owners alone manage members, integrations and workspace settings. `plan` is not client-writable.
  A workspace always keeps at least one active owner (trigger).
- Column grants close what RLS alone cannot: clients can't move a customer to another workspace
  (`customers.org_id`), attach an arbitrary account as an active member (`organization_members`
  insert is `status = 'invited'`, `user_id` is never client-writable), or re-route a WhatsApp
  number / point at another tenant's Vault secret (`integration_accounts.external_account_id`,
  `token_secret_id`). `organizations.settings` has a shape check (the RLS helpers cast it).
- Deleting history needs owner role or `settings.members_can_delete = true`.

**History and AI output**
- `conversation_events` is immutable: no UPDATE/DELETE/TRUNCATE (trigger + revoked privileges).
  Clients can only insert events **authored by themselves** (`author_member_id` = own member id,
  never null — so a client cannot fake an inbound channel message). Right-to-erasure goes through
  `purge_customer(customer)` (owner / members_can_delete), which is audited.
- AI output lives in separate tables (`customer_facts`, `extractions`, `event_annotations`,
  `followup_suggestions`), each linked to its source event and `ai_runs` row, so history can be
  reprocessed when the prompt (`prompt_version`) or model changes.
- **Nothing becomes a commitment without a person confirming it**: `ai-extract` only creates
  `extractions` (status `pending`); `confirm_extraction()` runs as the user under RLS.
- The copilot retrieves records with the caller's RLS-scoped client, gives Claude only two
  read-only typed tools (also run as the caller), and maps the answer's references back through a
  whitelist; its "actions" are navigation routes from a fixed table. No model output is executed.
- The scheduler only creates suggestions and notifications. Contact policies (opt-out,
  preferred hours, weekly cap) are applied before anything is suggested; nothing is sent.

**Service-only surfaces**
- `webhook_events` and `ai_runs`: RLS on, no policies, privileges revoked → service role only.
- `ingest_event()` and `followup_candidates()`: EXECUTE granted to `service_role` only.
- Internal functions compare the bearer token to `SUPABASE_SERVICE_ROLE_KEY` in constant time.

**Webhooks**
- WhatsApp deliveries are authenticated with HMAC-SHA256 (`X-Hub-Signature-256`, app secret,
  constant-time compare) over the raw body. Invalid signatures get 401 and are recorded without
  their payload.
- Idempotency at two levels: `webhook_events (provider, external_id)` (sha256 of the signed body,
  since Meta has no delivery id) and `conversation_events (org_id, idempotency_key)` =
  `whatsapp:<message id>`. Identity resolution is serialised per sender with an advisory lock.

**Audit + secrets**
- `audit_logs` gets a row (actor, action, before/after) for every insert/update/delete on
  customers, commitments, customer_facts, organization_members and integration_accounts. Readable
  by owners, writable only by the trigger.
- Integration tokens are Vault references (`token_secret_id`), never plaintext.
- Functions log ids, counts and error codes only — never message bodies or model output.

---

## 5. App operations → how they're authorised

Every call runs as the signed-in user (`authenticated` role, RLS on). Two PostgREST behaviours to
handle in `remote.ts`:

- An UPDATE/DELETE that RLS filters out is **not an error** — it affects 0 rows. Chain
  `.select('id')` and treat an empty result as "not allowed / not found" (or use `.single()`,
  which fails with `PGRST116`).
- Writing a column the role has no grant for fails with `42501` (permission denied).

Error codes raised by the RPCs: `42501` not allowed, `23514` check failed, `23505` duplicate,
`22023` invalid argument, `P0002` not found.

| App operation | How | Exact call | Authorised by |
|---|---|---|---|
| After sign-in: join workspaces I was invited to | RPC | `accept_member_invites()` → `integer` (memberships activated) | SECURITY DEFINER; links `organization_members` rows whose `email` = caller's **confirmed** email (`link_member_invites`). New sign-ups are linked by the `on_auth_user_created` trigger; call this anyway — it is a no-op then |
| Create workspace (onboarding) | RPC | `create_organization(name text, sells text default null)` → `uuid` | SECURITY DEFINER; caller becomes active owner |
| Read notifications | view | `select` from **`notification_feed`**: `id, org_id, recipient_member_id, kind, customer_id, commitment_id, title jsonb, meta, actions jsonb, created_at, read_at timestamptz, read boolean` | `security_invoker` view → policy "notifications: read mine" on `notifications`; `read`/`read_at` are the caller's own (`notification_reads`) or a server-side read-for-everyone `notifications.read_at` |
| Mark notification(s) read | RPC | `mark_notifications_read(ids uuid[] default null, org_id uuid default null)` → `integer` (newly read). `ids` null = all visible (in `org_id` if given) | SECURITY INVOKER: inserts own rows into `notification_reads` (policy "notification reads: mark own"). Per member: Alex reading a broadcast does not clear it for Sana. Direct `update notifications set read_at` is no longer allowed (`42501`) |
| Complete / reopen promise | direct | `update commitments set status = 'done' \| 'open'` (`completed_at` maintained by trigger) | policy "commitments: update" (`can_see_customer`) |
| Snooze promise | direct | `update commitments set status = 'open', snoozed_until, due_at` | "commitments: update" |
| Hand off promise | direct | `update commitments set owner_member_id = <member uuid>` | "commitments: update" + trigger `commitments_validate_links`: new owner must be an **active** member of the org (`23514` otherwise) |
| Confirm AI suggestion | RPC | `confirm_extraction(extraction_id uuid, fields jsonb default null, due_at timestamptz default null, title text default null)` → `uuid` (commitment id; idempotent) | SECURITY INVOKER (RLS); commitment owned by caller |
| Ignore AI suggestion | direct | `update extractions set status = 'ignored'` (`decided_at` / `decided_by_member_id` set by trigger) | "extractions: decide"; column grant `status, title, due_at, fields, commitment_id, decided_by_member_id, decided_at` |
| Resolve follow-up suggestion | direct | `update followup_suggestions set bucket = 'done', resolved_at = now()` | "suggestions: resolve"; only `bucket`, `resolved_at` are writable |
| Archive / unarchive customer | direct | `update customers set archived_at = <timestamptz> \| null` | "customers: update visible"; writable columns: `name, company, phone, email, preferred_channel, customer_since, lifetime_value, headline, source, owner_member_id, archived_at` (not `org_id`, not `summary*`) |
| Add customer | direct | `insert into customers (org_id, name, company, phone, email, preferred_channel, headline, owner_member_id)` | "customers: members create" |
| Add note | direct | `insert into conversation_events (org_id, customer_id, kind 'note', channel 'manual', direction 'internal', title 'Note', body, author_member_id)` | "events: capture": `author_member_id` **must** be the caller's member id (null → `42501`). Trigger enqueues `ai-extract` |
| Record a reply sent from the app | direct | `insert into conversation_events (org_id, customer_id, kind 'message', channel, direction 'out', title, body, author_member_id)` | "events: capture" (same rule). Enqueues `ai-extract` |
| Save a voice/note capture (+ promise + facts) | RPC (preferred) | `save_capture(customer_id uuid, body text, kind text default 'note', promise_title text default null, promise_due_at timestamptz default null, facts text[] default null)` → `jsonb` `{ "event_id": uuid, "commitment_id": uuid \| null, "fact_ids": uuid[] }`. `kind` ∈ `note`, `voice` (event title "Note" / "Voice note"); promise owned by caller, `source_event_id` = the new event, due defaults to +1 day; trailing "." stripped from the title | SECURITY INVOKER, one transaction; each insert passes the same RLS as the direct path. `ai-extract` sees the promise and does not propose a duplicate |
| …same, as separate writes | direct | 1) note insert as above → `id`; 2) `insert into commitments (org_id, customer_id, title, owner_member_id, due_at, promisor, source_event_id, quote, quote_by, confidence)`; 3) `insert into customer_facts (org_id, customer_id, kind, text, source_event_id, confidence)` | "commitments: create" / "facts: create"; trigger checks `source_event_id` is the **same customer's** event and owner is active (`23514`); `created_by_member_id` is forced to the caller. Not atomic, and `ai-extract` may race step 2 |
| Forget a fact | RPC | `forget_fact(fact_id uuid)` → `timestamptz` (forgotten_at). Undo: `unforget_fact(fact_id uuid)` → `void` | SECURITY INVOKER, "facts: update" (any member who can see the customer). Tombstone: sets `forgotten_at`, `forgotten_by_member_id`; audited. **Readers must filter `.is('forgotten_at', null)`** next to `.is('superseded_by', null)` (copilot and ai-extract do; ai-extract also never re-learns a forgotten fact) |
| Delete a fact for good | direct | `delete from customer_facts where id = …` | "facts: delete": owner or `settings.members_can_delete` (0 rows otherwise) |
| Edit business profile (owner) | direct | `update organizations set name, sells, handles text[], channels channel[], timezone` | "organizations: owners update settings"; column grant `name, sells, handles, channels, timezone, settings`. Non-owner → 0 rows |
| Change workspace settings (owner) | RPC (preferred) | `update_workspace_settings(org_id uuid, patch jsonb)` → `jsonb` (merged settings). Keys: `share_all_customers` bool, `hand_off_when_away` bool, `members_can_delete` bool, `notifications` `'needs_you'\|'all'\|'off'` | SECURITY INVOKER; owner only (`42501`), unknown key `22023`, bad value `23514` (constraint `organizations_settings_valid`). A direct `update organizations set settings = <whole object>` also works for owners |
| Invite teammate (owner) | RPC (preferred) | `invite_member(org_id uuid, email text, role member_role default 'member', name text default null)` → `organization_members` row (`status 'invited'`, `user_id null`, `invited_at`, `invited_by` set) | SECURITY INVOKER; owner only (`42501`), bad email `22023`, already in workspace `23505`. Email is trimmed + lower-cased; name defaults to the email |
| …same, direct | direct | `insert into organization_members (org_id, email, name, role, title?, status 'invited', invited_at?)` — `email` must already be lower-case | "members: owners invite": owner and `status = 'invited'` and `user_id is null`; column grant `org_id, name, email, role, title, status, invited_at` |
| Change teammate role / title / name (owner) | direct | `update organization_members set role, title, name` | "members: owners manage"; only these columns. Last active owner can't be demoted/removed (trigger, `23514`) |
| Remove teammate / cancel invite (owner) | direct | `delete from organization_members where id = …` | "members: owners remove" |
| Connect / pause integration (owner) | direct | `update integration_accounts set status = 'connected' \| 'paused' \| 'available', detail, last_sync_at` | "integrations: owners update"; column grant `name, status, detail, last_sync_at`. `external_account_id`, `token_secret_id`, `metadata` are service-role only |
| Delete customer and all history | RPC | `purge_customer(customer uuid)` → `boolean` | SECURITY DEFINER; owner or `members_can_delete` |
| "What did I promise?" | Edge Function | `functions.invoke('copilot', { body: { org_id, question, customer_id } })` | user JWT, RLS-scoped reads |

Realtime: `commitments`, `extractions`, `notifications`, `notification_reads`, `conversation_events`
and `followup_suggestions` are in `supabase_realtime` (RLS applies to subscribers). Views are not
streamed — on a `notifications` / `notification_reads` change, re-select from `notification_feed`.

---

## 6. Not done yet (TODO)

- Wire `app/src/data/remote.ts` into the store (auth screens, workspace switcher, Realtime subscriptions).
- Retry job for `webhook_events` with `processed_at is null` (worker killed mid-processing) and for failed `ai_runs`.
- pgvector semantic retrieval (`semanticCandidates()` in `functions/copilot` is the extension point).
- Customer summary regeneration (`ai_stage = 'summary'`), follow-up ranking beyond due dates.
- Push notifications (Expo push tokens), outbound WhatsApp sending after explicit user approval,
  WhatsApp status callbacks, voice-note transcription.
- `purge_customer()` should also delete Storage objects under `{org_id}/{customer_id}/` and scrub
  that customer's rows in `audit_logs`.
- Per-user rate limits on `copilot`.
- Retry for `ai-extract` calls that pg_net could not deliver (see `net._http_response`).
- Replace the hand-written row types with `supabase gen types typescript`.
