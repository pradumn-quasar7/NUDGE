# Nudge backend (Supabase)

Postgres schema + Row Level Security, a demo seed, and four Deno Edge Functions:

| Path | What it is |
|---|---|
| `migrations/20261007000001_core_schema.sql` | Tables, enums, indexes, immutability + housekeeping triggers |
| `migrations/20261007000002_rls.sql` | RLS helpers and policies, privileges, Storage bucket policies, audit trail, Realtime |
| `migrations/20261007000003_onboarding.sql` | `profiles`, invite linking on sign-up, `create_organization()` RPC |
| `migrations/20261007000004_app_rpc.sql` | `confirm_extraction()`, `purge_customer()`, `ingest_event()` and `followup_candidates()` (service-only) |
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

Requires the [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker.

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

### Schedule the follow-up scheduler (pg_cron + pg_net)

Run once in the SQL editor (Dashboard → Integrations can also enable the extensions):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the URL and key out of the job definition.
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');

select cron.schedule(
  'nudge-followup-scheduler',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/followup-scheduler',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Inspect runs with `select * from cron.job_run_details order by start_time desc limit 20;`.

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
- Deleting history needs owner role or `settings.members_can_delete = true`.

**History and AI output**
- `conversation_events` is immutable: no UPDATE/DELETE/TRUNCATE (trigger + revoked privileges).
  Clients can only insert notes as themselves. Right-to-erasure goes through
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

## 5. Not done yet (TODO)

- Wire `app/src/data/remote.ts` into the store (auth screens, workspace switcher, Realtime subscriptions).
- Run `ai-extract` for notes captured in the app (DB webhook / pg_net trigger on `conversation_events` insert).
- Retry job for `webhook_events` with `processed_at is null` (worker killed mid-processing) and for failed `ai_runs`.
- pgvector semantic retrieval (`semanticCandidates()` in `functions/copilot` is the extension point).
- Customer summary regeneration (`ai_stage = 'summary'`), follow-up ranking beyond due dates.
- Push notifications (Expo push tokens), outbound WhatsApp sending after explicit user approval,
  WhatsApp status callbacks, voice-note transcription.
- `purge_customer()` should also delete Storage objects under `{org_id}/{customer_id}/` and scrub
  that customer's rows in `audit_logs`.
- Per-user rate limits on `copilot`; per-recipient read state for broadcast notifications.
- Replace the hand-written row types with `supabase gen types typescript`.
