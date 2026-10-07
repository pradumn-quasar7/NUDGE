-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · automation + app write paths
--
--   1. invoke_edge_function()  pg_net call to an Edge Function with the
--                              service-role key from Vault (no-op when pg_net
--                              or the secrets are missing)
--   2. ai-extract trigger      app-authored conversation_events → ai-extract
--   3. pg_cron                 followup-scheduler every 15 minutes (guarded)
--   4. App write paths         tightened column grants / policies and the RPCs
--                              listed in supabase/README.md "App operations"
--
-- Vault secrets (create once per project, same names as the README):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role key>',        'service_role_key');
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── Extensions (enabled when the server offers them) ─────────────
-- Plain Postgres (CI, dev/local-supabase) has neither; everything below copes.

do $ext$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
exception when others then
  -- e.g. pg_cron not in shared_preload_libraries: schedule manually later.
  raise notice 'nudge: could not enable pg_net / pg_cron (%): %', sqlstate, sqlerrm;
end
$ext$;

-- ───────────── 1. invoke_edge_function ─────────────
-- Fire-and-forget POST to /functions/v1/<fn> authenticated with the service-role
-- key. Returns the pg_net request id, or null when pg_net / Vault / the secrets
-- are unavailable. Never raises: callers are triggers and cron jobs.

create or replace function public.invoke_edge_function(
  fn         text,
  body       jsonb default '{}'::jsonb,
  timeout_ms integer default 30000
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url  text;
  v_key  text;
  v_id   bigint;
begin
  if fn is null or fn !~ '^[a-z0-9][a-z0-9_-]*$' then
    return null;
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  begin
    select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'project_url' limit 1;
    select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'service_role_key' limit 1;
    if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
      return null;
    end if;

    select net.http_post(
      url                  := rtrim(v_url, '/') || '/functions/v1/' || fn,
      body                 := coalesce(body, '{}'::jsonb),
      params               := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := greatest(1000, least(coalesce(timeout_ms, 30000), 300000))
    ) into v_id;
    return v_id;
  exception when others then
    raise warning 'nudge: invoke_edge_function(%) skipped: %', fn, sqlstate;
    return null;
  end;
end;
$$;

revoke execute on function public.invoke_edge_function(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.invoke_edge_function(text, jsonb, integer) to service_role;

-- ───────────── 2. ai-extract for events created from the app ─────────────
-- Only events with an author (notes, voice notes, outbound replies sent from the
-- app). whatsapp-webhook / ingest_event() rows have no author and are enqueued
-- by the webhook itself. Body contract of ai-extract: POST { "event_id": uuid }.
-- pg_net sends after COMMIT, so the function always sees the row.

create or replace function public.enqueue_event_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_member_id is not null then
    -- ai-extract can wait on Claude for a while; the webhook allows 140 s too.
    perform public.invoke_edge_function('ai-extract', jsonb_build_object('event_id', new.id), 150000);
  end if;
  return null;
exception when others then
  return null; -- never block or fail the insert
end;
$$;

revoke execute on function public.enqueue_event_extraction() from public, anon, authenticated;

drop trigger if exists conversation_events_enqueue_extraction on public.conversation_events;
create trigger conversation_events_enqueue_extraction
  after insert on public.conversation_events
  for each row execute function public.enqueue_event_extraction();

-- ───────────── 3. followup-scheduler every 15 minutes ─────────────

do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'nudge: pg_cron is not installed; followup-scheduler not scheduled';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'nudge-followup-scheduler') then
    perform cron.unschedule('nudge-followup-scheduler');
  end if;

  perform cron.schedule(
    'nudge-followup-scheduler',
    '*/15 * * * *',
    $job$select public.invoke_edge_function('followup-scheduler', '{}'::jsonb, 30000);$job$
  );
end
$cron$;

-- ═════════════ 4. App write paths ═════════════

-- ───────────── conversation_events: clients always author their events ─────────────
-- Before: author_member_id could be null, so a client could insert an event that
-- looks like it came from a channel (e.g. a fake inbound WhatsApp message).

drop policy if exists "events: capture" on public.conversation_events;
create policy "events: capture" on public.conversation_events
  for insert to authenticated
  with check (
    public.can_see_customer(customer_id)
    and author_member_id is not null
    and author_member_id = public.current_member_id(org_id)
  );

-- ───────────── customers: no moving rows between workspaces ─────────────

revoke update on public.customers from authenticated;
grant update (name, company, phone, email, preferred_channel, customer_since, lifetime_value,
              headline, source, owner_member_id, archived_at)
  on public.customers to authenticated;

-- ───────────── organizations: validated settings + merge RPC ─────────────
-- RLS helpers cast settings values to boolean; a malformed value would break
-- every policy for the workspace, so the shape is enforced.

create or replace function public.valid_org_settings(s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(s) = 'object'
     and (not (s ? 'share_all_customers') or jsonb_typeof(s -> 'share_all_customers') = 'boolean')
     and (not (s ? 'hand_off_when_away')  or jsonb_typeof(s -> 'hand_off_when_away')  = 'boolean')
     and (not (s ? 'members_can_delete')  or jsonb_typeof(s -> 'members_can_delete')  = 'boolean')
     and (not (s ? 'notifications')       or (s ->> 'notifications') in ('needs_you', 'all', 'off'));
$$;

alter table public.organizations
  add constraint organizations_settings_valid check (public.valid_org_settings(settings));

-- Merge a partial settings object (owner only, RLS + column grant apply).
create or replace function public.update_workspace_settings(org_id uuid, patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'patch must be an object' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_object_keys(patch) k
    where k not in ('share_all_customers', 'hand_off_when_away', 'members_can_delete', 'notifications')
  ) then
    raise exception 'Unknown setting' using errcode = 'invalid_parameter_value';
  end if;
  if public.org_role(update_workspace_settings.org_id) is distinct from 'owner' then
    raise exception 'Only owners can change workspace settings' using errcode = 'insufficient_privilege';
  end if;

  update public.organizations o
     set settings = o.settings || patch
   where o.id = update_workspace_settings.org_id
  returning o.settings into v_settings;

  if v_settings is null then
    raise exception 'Workspace not found' using errcode = 'no_data_found';
  end if;
  return v_settings;
end;
$$;

revoke execute on function public.update_workspace_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_workspace_settings(uuid, jsonb) to authenticated;

-- ───────────── organization_members: invites only, no forced membership ─────────────
-- Before: owners could insert/update any column, i.e. attach an arbitrary
-- user_id as an ACTIVE member. Now clients create 'invited' rows only; linking
-- happens through link_member_invites() (sign-up trigger / accept_member_invites()).

revoke insert, update on public.organization_members from authenticated;
-- status / invited_at are accepted so a plain insert works too; the policy pins
-- status = 'invited' and user_id stays null (not grantable).
grant insert (org_id, name, email, role, title, status, invited_at) on public.organization_members to authenticated;
grant update (name, role, title) on public.organization_members to authenticated;

drop policy if exists "members: owners invite" on public.organization_members;
create policy "members: owners invite" on public.organization_members
  for insert to authenticated
  with check (public.org_role(org_id) = 'owner' and status = 'invited' and user_id is null);

create or replace function public.organization_members_stamp_invite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'invited' then
    new.invited_at := coalesce(new.invited_at, now());
    new.invited_by := coalesce(new.invited_by, auth.uid());
  end if;
  return new;
end;
$$;

revoke execute on function public.organization_members_stamp_invite() from public, anon, authenticated;

create trigger organization_members_stamp_invite
  before insert on public.organization_members
  for each row execute function public.organization_members_stamp_invite();

-- Owner invites a teammate by email. Returns the new organization_members row.
create or replace function public.invite_member(
  org_id uuid,
  email  text,
  role   public.member_role default 'member',
  name   text default null
)
returns public.organization_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(invite_member.email, '')));
  v_row   public.organization_members;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email address' using errcode = 'invalid_parameter_value';
  end if;
  if public.org_role(invite_member.org_id) is distinct from 'owner' then
    raise exception 'Only owners can invite teammates' using errcode = 'insufficient_privilege';
  end if;

  begin
    insert into public.organization_members (org_id, name, email, role)
    values (
      invite_member.org_id,
      left(coalesce(nullif(btrim(invite_member.name), ''), v_email), 120),
      v_email,
      coalesce(invite_member.role, 'member')
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception 'That email is already in this workspace' using errcode = 'unique_violation';
  end;
  return v_row;
end;
$$;

revoke execute on function public.invite_member(uuid, text, public.member_role, text) from public, anon;
grant execute on function public.invite_member(uuid, text, public.member_role, text) to authenticated;

-- Links pending invites for the caller's CONFIRMED email. Call after sign-in:
-- covers people who already had an account when they were invited (the sign-up
-- trigger only runs once). Returns the number of memberships activated.
create or replace function public.accept_member_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select u.email into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  return public.link_member_invites(v_uid, v_email);
end;
$$;

revoke execute on function public.accept_member_invites() from public, anon;
grant execute on function public.accept_member_invites() to authenticated;

-- ───────────── integration_accounts: status only from the client ─────────────
-- Before: owners could set external_account_id (webhook routing: claim another
-- business's WhatsApp number) and token_secret_id (point at another tenant's
-- Vault secret). Those are written by the service role during OAuth/setup.

revoke insert, update on public.integration_accounts from authenticated;
grant insert (org_id, provider, name, status, detail) on public.integration_accounts to authenticated;
grant update (name, status, detail, last_sync_at) on public.integration_accounts to authenticated;

-- ───────────── commitments: hand-off and capture integrity ─────────────
--   * owner_member_id must be an ACTIVE member (no handing off to an invite)
--   * source_event_id must belong to the same customer
--   * created_by_member_id is the caller for user writes

create or replace function public.commitments_validate_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_member_id is not null
     and (tg_op = 'INSERT' or new.owner_member_id is distinct from old.owner_member_id)
     and not exists (
       select 1 from public.organization_members m
       where m.org_id = new.org_id and m.id = new.owner_member_id and m.status = 'active'
     ) then
    raise exception 'Promises can only be owned by an active teammate' using errcode = 'check_violation';
  end if;

  if new.source_event_id is not null
     and (tg_op = 'INSERT' or new.source_event_id is distinct from old.source_event_id
          or new.customer_id is distinct from old.customer_id)
     and not exists (
       select 1 from public.conversation_events e
       where e.org_id = new.org_id and e.id = new.source_event_id and e.customer_id = new.customer_id
     ) then
    raise exception 'source_event_id belongs to another customer' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by_member_id := public.current_member_id(new.org_id);
  elsif tg_op = 'UPDATE' and new.created_by_member_id is not null then
    -- immutable, except for the FK's ON DELETE SET NULL
    new.created_by_member_id := old.created_by_member_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.commitments_validate_links() from public, anon, authenticated;

create trigger commitments_validate_links
  before insert or update on public.commitments
  for each row execute function public.commitments_validate_links();

-- ───────────── save_capture: note/voice note + optional promise + facts, atomically ─────────────
-- Runs as the caller (RLS applies to every insert). The note event is authored by
-- the caller, so the ai-extract trigger fires for it as well; ai-extract does not
-- propose commitments for an event that already has a person-made commitment.

create or replace function public.save_capture(
  customer_id    uuid,
  body           text,
  kind           text default 'note',
  promise_title  text default null,
  promise_due_at timestamptz default null,
  facts          text[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org        uuid;
  v_member     uuid;
  v_event      uuid;
  v_commitment uuid;
  v_fact_ids   uuid[] := '{}';
  v_body       text := btrim(coalesce(save_capture.body, ''));
  v_title      text := nullif(regexp_replace(btrim(coalesce(save_capture.promise_title, '')), '\.$', ''), '');
begin
  if save_capture.kind not in ('note', 'voice') then
    raise exception 'kind must be note or voice' using errcode = 'invalid_parameter_value';
  end if;
  if v_body = '' then
    raise exception 'Nothing to save' using errcode = 'invalid_parameter_value';
  end if;

  select c.org_id into v_org from public.customers c where c.id = save_capture.customer_id;
  if v_org is null then
    raise exception 'Customer not found' using errcode = 'no_data_found';
  end if;
  v_member := public.current_member_id(v_org);
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  insert into public.conversation_events (org_id, customer_id, kind, channel, direction, title, body, author_member_id)
  values (v_org, save_capture.customer_id, 'note', 'manual', 'internal',
          case when save_capture.kind = 'voice' then 'Voice note' else 'Note' end,
          v_body, v_member)
  returning id into v_event;

  if v_title is not null then
    insert into public.commitments (org_id, customer_id, title, owner_member_id, due_at, status, promisor,
                                    source_event_id, quote, quote_by, confidence, created_by_member_id)
    values (v_org, save_capture.customer_id, left(v_title, 300), v_member,
            coalesce(save_capture.promise_due_at, now() + interval '1 day'), 'open', 'us',
            v_event, left(v_body, 2000), 'You', 0.85, v_member)
    returning id into v_commitment;
  end if;

  with ins as (
    insert into public.customer_facts (org_id, customer_id, kind, text, source_event_id, confidence, created_by_member_id)
    select v_org, save_capture.customer_id, 'temporal', left(btrim(f), 500), v_event, 0.8, v_member
    from unnest(coalesce(save_capture.facts, '{}'::text[])) as f
    where nullif(btrim(f), '') is not null
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_fact_ids from ins;

  return jsonb_build_object('event_id', v_event, 'commitment_id', v_commitment, 'fact_ids', to_jsonb(v_fact_ids));
end;
$$;

revoke execute on function public.save_capture(uuid, text, text, text, timestamptz, text[]) from public, anon;
grant execute on function public.save_capture(uuid, text, text, text, timestamptz, text[]) to authenticated;

-- ───────────── customer_facts: forget = tombstone, not delete ─────────────
-- A forgotten fact disappears from the app, the copilot and the extraction
-- context, but the row stays so a later re-extraction does not bring it back,
-- and the change is in audit_logs (who, when, before/after). Hard delete stays
-- available to owners / members_can_delete via the existing delete policy.

alter table public.customer_facts
  add column forgotten_at timestamptz,
  add column forgotten_by_member_id uuid,
  add constraint customer_facts_forgotten_by_fk foreign key (org_id, forgotten_by_member_id)
    references public.organization_members (org_id, id) on delete set null (forgotten_by_member_id);

drop index if exists public.customer_facts_current_idx;
create index customer_facts_current_idx on public.customer_facts (org_id, customer_id)
  where superseded_by is null and forgotten_at is null;

create or replace function public.forget_fact(fact_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  update public.customer_facts f
     set forgotten_at = coalesce(f.forgotten_at, now()),
         forgotten_by_member_id = coalesce(f.forgotten_by_member_id, public.current_member_id(f.org_id))
   where f.id = forget_fact.fact_id
  returning f.forgotten_at into v_at;
  if v_at is null then
    raise exception 'Fact not found' using errcode = 'no_data_found';
  end if;
  return v_at;
end;
$$;

-- Undo for the "Forgotten" toast.
create or replace function public.unforget_fact(fact_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.customer_facts f
     set forgotten_at = null, forgotten_by_member_id = null
   where f.id = unforget_fact.fact_id;
  if not found then
    raise exception 'Fact not found' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function public.forget_fact(uuid) from public, anon;
revoke execute on function public.unforget_fact(uuid) from public, anon;
grant execute on function public.forget_fact(uuid) to authenticated;
grant execute on function public.unforget_fact(uuid) to authenticated;

-- ───────────── Notifications: per-member read state ─────────────
-- notifications.recipient_member_id = null means "everyone"; a shared read_at
-- meant one person reading it cleared it for the whole team. Read state is now
-- per member in notification_reads. notifications.read_at stays as a
-- server-side "read for everyone" (seed / system), no longer client-writable.

alter table public.notifications
  add constraint notifications_org_id_id_key unique (org_id, id);

create table public.notification_reads (
  org_id           uuid not null references public.organizations (id) on delete cascade,
  notification_id  uuid not null,
  member_id        uuid not null,
  read_at          timestamptz not null default now(),
  primary key (member_id, notification_id),
  constraint notification_reads_notification_fk foreign key (org_id, notification_id)
    references public.notifications (org_id, id) on delete cascade,
  constraint notification_reads_member_fk foreign key (org_id, member_id)
    references public.organization_members (org_id, id) on delete cascade
);

create index notification_reads_notification_idx on public.notification_reads (notification_id);

alter table public.notification_reads enable row level security;

create policy "notification reads: own" on public.notification_reads
  for select to authenticated
  using (member_id = public.current_member_id(org_id));

create policy "notification reads: mark own" on public.notification_reads
  for insert to authenticated
  with check (
    member_id = public.current_member_id(org_id)
    -- RLS on notifications applies inside the policy: only visible ones.
    and exists (select 1 from public.notifications n where n.id = notification_id and n.org_id = notification_reads.org_id)
  );

revoke all on public.notification_reads from anon;
revoke update, delete, truncate on public.notification_reads from authenticated;
grant select, insert on public.notification_reads to authenticated;

drop policy if exists "notifications: mark read" on public.notifications;
revoke update on public.notifications from authenticated;

-- The feed the app reads: notifications visible to the caller + the caller's read state.
create view public.notification_feed
with (security_invoker = true)
as
select
  n.id,
  n.org_id,
  n.recipient_member_id,
  n.kind,
  n.customer_id,
  n.commitment_id,
  n.title,
  n.meta,
  n.actions,
  n.created_at,
  coalesce(r.read_at, n.read_at)              as read_at,
  (coalesce(r.read_at, n.read_at) is not null) as read
from public.notifications n
left join public.notification_reads r
  on r.notification_id = n.id
 and r.member_id = public.current_member_id(n.org_id);

revoke all on public.notification_feed from anon, authenticated;
grant select on public.notification_feed to authenticated;

-- Mark notifications read for the caller. ids = null → every notification the
-- caller can see (optionally only in org_id). Returns how many became read.
create or replace function public.mark_notifications_read(ids uuid[] default null, org_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notification_reads (org_id, notification_id, member_id)
  select n.org_id, n.id, public.current_member_id(n.org_id)
  from public.notifications n
  where (mark_notifications_read.ids is null or n.id = any (mark_notifications_read.ids))
    and (mark_notifications_read.org_id is null or n.org_id = mark_notifications_read.org_id)
    and n.read_at is null -- already read for everyone
    and public.current_member_id(n.org_id) is not null
  on conflict (member_id, notification_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[], uuid) from public, anon;
grant execute on function public.mark_notifications_read(uuid[], uuid) to authenticated;

-- Read state syncs across a member's devices.
alter publication supabase_realtime add table public.notification_reads;
