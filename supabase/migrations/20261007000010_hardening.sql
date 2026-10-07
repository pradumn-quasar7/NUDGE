-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · security hardening (Phase 5)
--
--   1. Audit trail       audit_logs.summary (human-readable, computed at write time),
--                        organizations audited, 'export' action, column-level read
--                        access (owners never get raw before/after jsonb), view
--                        activity_feed (security_invoker) for the app's Activity screen
--   2. AI rate limits    ai_usage + ai_quota_limits, consume_ai_quota() /
--                        ai_quota_retry_after() — called by edge functions with the
--                        USER's client (auth.uid()); per member per kind + org-wide cap
--   3. Storage purge     storage_purge_queue + storage-purge edge function. Bytes in
--                        Storage can only be removed through the Storage API (a SQL
--                        DELETE on storage.objects orphans the file and is blocked on
--                        hosted projects), so SQL queues paths and hides them at once
--   4. purge_customer()  also queues the customer's voice-notes / attachments objects,
--                        deletes their attachments rows, scrubs the customer's PII from
--                        audit_logs, ai_runs outputs and raw webhook payloads
--   5. export_workspace(org)               owner-only, SECURITY INVOKER (RLS applies)
--   6. delete_workspace(org, confirm_name) owner-only, typed-name confirmation;
--                        deleted_workspaces keeps a minimal service-only record
--   7. Sweep             anon loses EXECUTE on every app function; RLS helpers granted
--                        explicitly; TRUNCATE/REFERENCES/TRIGGER revoked from clients;
--                        voice_note_is_linked() scoped to the caller's workspaces;
--                        attachments inserts can only reference the caller's own
--                        recordings
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════ 1. Audit trail ═════════════

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in ('insert', 'update', 'delete', 'export'));

-- "verb · label", e.g. "completed a promise · Send revised quotation". The app prefixes
-- the actor's name. Clients only ever see this, never before/after.
alter table public.audit_logs add column if not exists summary text;

create or replace function public.audit_summary(entity_type text, action text, before jsonb, after jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  b     jsonb := coalesce(audit_summary.before, '{}'::jsonb);
  a     jsonb := coalesce(audit_summary.after, '{}'::jsonb);
  r     jsonb := coalesce(audit_summary.after, audit_summary.before, '{}'::jsonb);
  verb  text;
  label text;
begin
  if (b ->> 'purged') = 'true' or (a ->> 'purged') = 'true' then
    r := '{}'::jsonb;
  end if;

  case audit_summary.entity_type
    when 'commitments' then
      label := r ->> 'title';
      if action = 'insert' then verb := 'added a promise';
      elsif action = 'delete' then verb := 'deleted a promise';
      elsif (b ->> 'status') is distinct from (a ->> 'status') then
        verb := case a ->> 'status'
                  when 'done' then 'completed a promise'
                  when 'dismissed' then 'dismissed a promise'
                  when 'snoozed' then 'snoozed a promise'
                  else 'reopened a promise' end;
      elsif (b ->> 'owner_member_id') is distinct from (a ->> 'owner_member_id') then verb := 'handed off a promise';
      elsif (b ->> 'snoozed_until') is distinct from (a ->> 'snoozed_until') and (a ->> 'snoozed_until') is not null then verb := 'snoozed a promise';
      elsif (b ->> 'due_at') is distinct from (a ->> 'due_at') then verb := 'moved a due date';
      elsif (b ->> 'title') is distinct from (a ->> 'title') then verb := 'renamed a promise';
      else verb := 'updated a promise';
      end if;
    when 'customers' then
      label := r ->> 'name';
      if action = 'insert' then verb := 'added a customer';
      elsif action = 'delete' then verb := 'deleted a customer and their history';
      elsif (b ->> 'archived_at') is null and (a ->> 'archived_at') is not null then verb := 'archived a customer';
      elsif (b ->> 'archived_at') is not null and (a ->> 'archived_at') is null then verb := 'restored a customer';
      elsif (b ->> 'owner_member_id') is distinct from (a ->> 'owner_member_id') then verb := 'reassigned a customer';
      elsif (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(b) as e(k, v) where k not like 'summary%' and k <> 'updated_at')
          = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(a) as e(k, v) where k not like 'summary%' and k <> 'updated_at') then
        verb := 'refreshed a customer summary';
      else verb := 'updated a customer';
      end if;
    when 'customer_facts' then
      label := r ->> 'text';
      if action = 'insert' then verb := 'remembered a fact';
      elsif action = 'delete' then verb := 'deleted a fact';
      elsif (b ->> 'forgotten_at') is null and (a ->> 'forgotten_at') is not null then verb := 'forgot a fact';
      elsif (b ->> 'forgotten_at') is not null and (a ->> 'forgotten_at') is null then verb := 'restored a fact';
      elsif (b ->> 'superseded_by') is null and (a ->> 'superseded_by') is not null then verb := 'replaced a fact';
      else verb := 'updated a fact';
      end if;
    when 'organization_members' then
      label := coalesce(nullif(r ->> 'name', ''), r ->> 'email');
      if action = 'insert' then
        verb := case when r ->> 'status' = 'invited' then 'invited a teammate' else 'added a teammate' end;
      elsif action = 'delete' then
        verb := case when b ->> 'status' = 'invited' then 'cancelled an invite' else 'removed a teammate' end;
      elsif ((b ->> 'status') = 'invited' and (a ->> 'status') = 'active')
            or ((b ->> 'user_id') is null and (a ->> 'user_id') is not null) then verb := 'joined the workspace';
      elsif (b ->> 'role') is distinct from (a ->> 'role') then
        verb := case when a ->> 'role' = 'owner' then 'made a teammate an owner' else 'changed a teammate’s role' end;
      else verb := 'updated a teammate';
      end if;
    when 'integration_accounts' then
      label := r ->> 'name';
      if action = 'insert' then verb := 'added an integration';
      elsif action = 'delete' then verb := 'removed an integration';
      elsif (b ->> 'status') is distinct from (a ->> 'status') then
        verb := case a ->> 'status'
                  when 'connected' then 'connected an integration'
                  when 'paused' then 'paused an integration'
                  else 'disconnected an integration' end;
      else verb := 'changed integrations';
      end if;
    when 'contact_policies' then
      label := null;
      if action = 'insert' then verb := 'set contact preferences';
      elsif action = 'delete' then verb := 'removed contact preferences';
      elsif (b ->> 'opted_out') is distinct from (a ->> 'opted_out') then
        verb := case when a ->> 'opted_out' = 'true' then 'recorded an opt-out' else 'cleared an opt-out' end;
      else verb := 'changed contact preferences';
      end if;
    when 'organizations' then
      label := null;
      if action = 'export' then verb := 'exported the workspace data';
      elsif (b -> 'settings') is distinct from (a -> 'settings') then verb := 'changed workspace settings';
      elsif (b ->> 'plan') is distinct from (a ->> 'plan') then verb := 'changed the plan';
      else verb := 'updated the business profile';
      end if;
    else
      label := null;
      verb := case action
                when 'insert' then 'added'
                when 'update' then 'changed'
                when 'delete' then 'removed'
                else action end
              || ' ' || replace(coalesce(audit_summary.entity_type, 'a record'), '_', ' ');
  end case;

  label := nullif(btrim(regexp_replace(coalesce(label, ''), '\s+', ' ', 'g')), '');
  if label is not null and char_length(label) > 80 then
    label := left(label, 79) || '…';
  end if;
  return verb || coalesce(' · ' || label, '');
end;
$$;

revoke execute on function public.audit_summary(text, text, jsonb, jsonb) from public, anon, authenticated;

-- Same as 20261007000002, plus: organizations rows are their own org, and the summary.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_org     uuid  := coalesce((v_row ->> 'org_id')::uuid,
                              case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end);
  v_uid     uuid  := auth.uid();
  v_role    text  := coalesce(auth.jwt() ->> 'role', '');
  v_member  uuid;
begin
  -- Skip no-op updates (only updated_at changed).
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  if v_uid is not null then
    select m.id into v_member
    from public.organization_members m
    where m.org_id = v_org and m.user_id = v_uid
    limit 1;
  end if;

  insert into public.audit_logs (org_id, actor_user_id, actor_member_id, actor_kind, action, entity_type, entity_id, before, after, summary)
  values (
    v_org,
    v_uid,
    v_member,
    case when v_uid is not null then 'user' when v_role = 'service_role' then 'service' else 'system' end,
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_old,
    v_new,
    public.audit_summary(tg_table_name, lower(tg_op), v_old, v_new)
  );
  return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- Workspace profile / settings / plan changes are security relevant (share_all_customers,
-- members_can_delete). Inserts come from create_organization(); deletes from delete_workspace().
drop trigger if exists organizations_audit on public.organizations;
create trigger organizations_audit
  after update on public.organizations
  for each row execute function public.audit_row_change();

-- Existing rows.
update public.audit_logs a
   set summary = public.audit_summary(a.entity_type, a.action, a.before, a.after)
 where a.summary is null;

-- Owners keep reading their org's trail ("audit: owners read"), but only these columns:
-- before/after hold whole rows (customer PII, message-derived text) and stay server-side.
revoke select on public.audit_logs from authenticated;
grant select (id, org_id, actor_member_id, actor_kind, action, entity_type, entity_id, summary, created_at)
  on public.audit_logs to authenticated;
revoke all on sequence public.audit_logs_id_seq from anon, authenticated;

drop view if exists public.activity_feed;
create view public.activity_feed
with (security_invoker = true)
as
select
  a.id,
  a.org_id,
  a.created_at                                          as at,
  a.action,
  a.entity_type,
  a.entity_id,
  a.actor_kind,
  a.actor_member_id,
  case
    when a.actor_kind = 'user' then coalesce(m.name, 'A former teammate')
    else 'Nudge'
  end                                                   as actor_name,
  coalesce(a.summary, a.action || ' ' || a.entity_type) as summary
from public.audit_logs a
left join public.organization_members m
  on m.org_id = a.org_id
 and m.id = a.actor_member_id;

revoke all on public.activity_feed from anon, authenticated;
grant select on public.activity_feed to authenticated;

-- An export is recorded by export_workspace() (SECURITY INVOKER) through this
-- definer helper. Owner only; the only thing a caller can do with it is add an
-- "exported the workspace data" line for themselves.
create or replace function public.audit_workspace_export(org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.org_role(audit_workspace_export.org_id) is distinct from 'owner' then
    raise exception 'Only owners can export the workspace' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (org_id, actor_user_id, actor_member_id, actor_kind, action, entity_type, entity_id, summary)
  values (
    audit_workspace_export.org_id,
    v_uid,
    public.current_member_id(audit_workspace_export.org_id),
    'user',
    'export',
    'organizations',
    audit_workspace_export.org_id,
    'exported the workspace data'
  );
end;
$$;

revoke execute on function public.audit_workspace_export(uuid) from public, anon;
grant execute on function public.audit_workspace_export(uuid) to authenticated;

-- ═════════════ 2. AI rate limits ═════════════
-- Rolling windows (last 60 min / last 24 h). A call is recorded BEFORE the model is
-- called, so a burst of parallel requests can't slip past the count (ai_runs rows
-- are only written afterwards). Service-only tables; clients never read them.

create table public.ai_quota_limits (
  kind      text primary key check (kind ~ '^(\*|[a-z][a-z_]{1,39})$'),
  per_hour  integer check (per_hour is null or per_hour >= 0),
  per_day   integer check (per_day is null or per_day >= 0),
  note      text
);

-- kind '*' = the whole workspace, all kinds together (protects the model bill).
insert into public.ai_quota_limits (kind, per_hour, per_day, note) values
  ('*',          null, 2000, 'org-wide: all AI calls by all members'),
  ('copilot',      60,  300, 'per member: "What did I promise?" questions'),
  ('transcribe',   30,  120, 'per member: voice note transcriptions'),
  ('summary',      30,  200, 'per member: customer summaries (opt-in for summarize-customer)'),
  ('handoff',      30,  200, 'per member: hand-off briefs (opt-in for handoff-brief)'),
  ('draft',        60,  300, 'per member: message drafts (opt-in for draft-message)')
on conflict (kind) do nothing;

create table public.ai_usage (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  member_id  uuid,
  kind       text not null,
  at         timestamptz not null default now(),
  constraint ai_usage_member_fk foreign key (org_id, member_id)
    references public.organization_members (org_id, id) on delete set null (member_id)
);

create index ai_usage_org_at_idx on public.ai_usage (org_id, at desc);
create index ai_usage_member_kind_at_idx on public.ai_usage (member_id, kind, at desc);

alter table public.ai_quota_limits enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_quota_limits, public.ai_usage from anon, authenticated;
grant all on public.ai_quota_limits, public.ai_usage to service_role;

-- Seconds until one more call fits in a window (0 = fits now). p_member null = whole org,
-- p_kind null = all kinds.
create or replace function public.ai_quota_wait(p_org uuid, p_member uuid, p_kind text, p_window interval, p_limit integer)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count integer;
  v_at    timestamptz;
begin
  if p_limit is null then
    return 0;
  end if;
  select count(*) into v_count
  from public.ai_usage u
  where u.org_id = p_org
    and (p_member is null or u.member_id = p_member)
    and (p_kind is null or u.kind = p_kind)
    and u.at > now() - p_window;
  if v_count < p_limit then
    return 0;
  end if;
  -- The window frees up when the (count - limit + 1)-th oldest call ages out.
  select u.at into v_at
  from public.ai_usage u
  where u.org_id = p_org
    and (p_member is null or u.member_id = p_member)
    and (p_kind is null or u.kind = p_kind)
    and u.at > now() - p_window
  order by u.at
  offset greatest(v_count - p_limit, 0)
  limit 1;
  return greatest(1, ceil(extract(epoch from (coalesce(v_at, now()) + p_window - now())))::integer);
end;
$$;

revoke execute on function public.ai_quota_wait(uuid, uuid, text, interval, integer) from public, anon, authenticated;

-- Records one AI call for the CALLER (auth.uid()'s active membership in org_id) when
-- it fits the caller's per-kind limits and the workspace's daily cap. Returns true
-- when allowed and recorded, false when refused (nothing recorded).
--
-- Called by edge functions with the user-scoped client (supabase/functions/_shared/ratelimit.ts).
-- per_hour / per_day may only TIGHTEN the server limits in ai_quota_limits, never loosen
-- them, so calling this directly from a client can do nothing worse than use up the
-- caller's own quota. Unknown kind → 22023, not a member → 42501.
create or replace function public.consume_ai_quota(kind text, org_id uuid, per_hour integer default null, per_day integer default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text := lower(btrim(coalesce(consume_ai_quota.kind, '')));
  v_member  uuid;
  v_lim     public.ai_quota_limits%rowtype;
  v_org_lim public.ai_quota_limits%rowtype;
  v_hour    integer;
  v_day     integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  v_member := public.current_member_id(consume_ai_quota.org_id);
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  select * into v_lim from public.ai_quota_limits l where l.kind = v_kind and l.kind <> '*';
  if not found then
    raise exception 'Unknown AI kind' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_org_lim from public.ai_quota_limits l where l.kind = '*';

  -- least() ignores nulls: a null server limit means "no limit" unless the caller sets one.
  v_hour := greatest(least(consume_ai_quota.per_hour, v_lim.per_hour), 0);
  v_day  := greatest(least(consume_ai_quota.per_day, v_lim.per_day), 0);

  -- One workspace at a time, so parallel calls can't both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('nudge:ai_quota:' || consume_ai_quota.org_id::text, 0));

  delete from public.ai_usage u
   where u.org_id = consume_ai_quota.org_id and u.at < now() - interval '2 days';

  if public.ai_quota_wait(consume_ai_quota.org_id, v_member, v_kind, interval '1 hour', v_hour) > 0
     or public.ai_quota_wait(consume_ai_quota.org_id, v_member, v_kind, interval '1 day', v_day) > 0
     or public.ai_quota_wait(consume_ai_quota.org_id, null, null, interval '1 hour', v_org_lim.per_hour) > 0
     or public.ai_quota_wait(consume_ai_quota.org_id, null, null, interval '1 day', v_org_lim.per_day) > 0 then
    return false;
  end if;

  insert into public.ai_usage (org_id, member_id, kind) values (consume_ai_quota.org_id, v_member, v_kind);
  return true;
end;
$$;

-- For the Retry-After header after a refusal: seconds until the caller's next call
-- of this kind would be allowed (0 = now). Same arguments as consume_ai_quota.
create or replace function public.ai_quota_retry_after(kind text, org_id uuid, per_hour integer default null, per_day integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind    text := lower(btrim(coalesce(ai_quota_retry_after.kind, '')));
  v_member  uuid := public.current_member_id(ai_quota_retry_after.org_id);
  v_lim     public.ai_quota_limits%rowtype;
  v_org_lim public.ai_quota_limits%rowtype;
begin
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  select * into v_lim from public.ai_quota_limits l where l.kind = v_kind and l.kind <> '*';
  if not found then
    raise exception 'Unknown AI kind' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_org_lim from public.ai_quota_limits l where l.kind = '*';
  return greatest(
    public.ai_quota_wait(ai_quota_retry_after.org_id, v_member, v_kind, interval '1 hour',
                         greatest(least(ai_quota_retry_after.per_hour, v_lim.per_hour), 0)),
    public.ai_quota_wait(ai_quota_retry_after.org_id, v_member, v_kind, interval '1 day',
                         greatest(least(ai_quota_retry_after.per_day, v_lim.per_day), 0)),
    public.ai_quota_wait(ai_quota_retry_after.org_id, null, null, interval '1 hour', v_org_lim.per_hour),
    public.ai_quota_wait(ai_quota_retry_after.org_id, null, null, interval '1 day', v_org_lim.per_day)
  );
end;
$$;

revoke execute on function public.consume_ai_quota(text, uuid, integer, integer) from public, anon;
revoke execute on function public.ai_quota_retry_after(text, uuid, integer, integer) from public, anon;
grant execute on function public.consume_ai_quota(text, uuid, integer, integer) to authenticated;
grant execute on function public.ai_quota_retry_after(text, uuid, integer, integer) to authenticated;

-- ═════════════ 3. Storage purge queue ═════════════
-- Drained by the storage-purge edge function (service role, Storage API), which
-- purge_customer() / delete_workspace() start through pg_net, plus an hourly retry.

create table public.storage_purge_queue (
  id            bigint generated always as identity primary key,
  bucket_id     text not null,
  object_name   text not null,
  -- no FK: the workspace may be gone by the time the bytes are removed
  org_id        uuid,
  reason        text not null check (reason in ('purge_customer', 'delete_workspace')),
  requested_at  timestamptz not null default now(),
  attempts      integer not null default 0,
  last_error    text,
  done_at       timestamptz,
  constraint storage_purge_queue_object_key unique (bucket_id, object_name)
);

create index storage_purge_queue_pending_idx on public.storage_purge_queue (id) where done_at is null;

alter table public.storage_purge_queue enable row level security;
revoke all on public.storage_purge_queue from anon, authenticated;
grant all on public.storage_purge_queue to service_role;

-- Whether an object is queued for removal (hidden from its uploader right away).
-- Scoped like voice_note_is_linked: only answers for the caller's own workspaces.
create or replace function public.storage_object_purged(bucket text, object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.storage_purge_queue q
    where q.bucket_id = storage_object_purged.bucket
      and q.object_name = storage_object_purged.object_name
      and public.is_org_member(public.try_uuid(split_part(storage_object_purged.object_name, '/', 1)))
  );
$$;

revoke execute on function public.storage_object_purged(text, text) from public, anon;
grant execute on function public.storage_object_purged(text, text) to authenticated, service_role;

drop policy if exists "voice notes: read own" on storage.objects;
create policy "voice notes: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-notes'
    and public.is_own_voice_note_path(name)
    and not public.storage_object_purged(bucket_id, name)
  );

-- ═════════════ 4. purge_customer ═════════════
-- Same signature, auth rules and audited customer deletion as 20261007000004, plus:
--   * voice-notes / attachments objects of the customer → storage_purge_queue
--     (hidden immediately, bytes removed by storage-purge); their attachments rows deleted
--   * ai_runs outputs that used the customer's events → {"purged": true}
--   * raw webhook payloads that mention the customer's message ids / numbers → {"purged": true}
--   * audit_logs rows about the customer and its promises / facts / policies keep who,
--     when, action and entity, but before/after become {"purged": true} and the summary
--     loses its label ("completed a promise").

create or replace function public.purge_customer(customer uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_cust     text := purge_customer.customer::text;
  v_events   uuid[];
  v_patterns text[];
  v_queued   integer := 0;
begin
  select c.org_id into v_org from public.customers c where c.id = purge_customer.customer for update;

  if v_org is null
     or not public.can_see_customer(purge_customer.customer)
     or not public.can_delete_history(v_org) then
    raise exception 'Not allowed to delete this customer' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_events
  from public.conversation_events e
  where e.org_id = v_org and e.customer_id = purge_customer.customer;

  -- 1. Files: queue the bytes, drop the links.
  with q as (
    insert into public.storage_purge_queue as sq (bucket_id, object_name, org_id, reason)
    select a.storage_bucket, a.storage_path, v_org, 'purge_customer'
    from public.attachments a
    where a.org_id = v_org and (a.customer_id = purge_customer.customer or a.event_id = any (v_events))
    union
    select o.bucket_id, o.name, v_org, 'purge_customer'
    from storage.objects o
    where o.bucket_id = 'attachments' and o.name like v_org::text || '/' || v_cust || '/%'
    on conflict on constraint storage_purge_queue_object_key
      do update set done_at = null, attempts = 0, last_error = null, requested_at = now()
    returning 1
  )
  select count(*) into v_queued from q;

  delete from public.attachments a
   where a.org_id = v_org and (a.customer_id = purge_customer.customer or a.event_id = any (v_events));

  -- 2. Model inputs/outputs kept for audit that quoted this customer's records.
  update public.ai_runs r
     set output = jsonb_build_object('purged', true)
   where r.org_id = v_org
     and r.input_event_ids && v_events
     and r.output is distinct from jsonb_build_object('purged', true);

  -- 3. Raw webhook deliveries: message ids (whatsapp:<wamid>) and the customer's numbers / ids.
  select coalesce(array_agg(distinct p), '{}') into v_patterns
  from (
    select substr(e.idempotency_key, strpos(e.idempotency_key, ':') + 1) as p
    from public.conversation_events e
    where e.org_id = v_org and e.customer_id = purge_customer.customer and e.idempotency_key like '%:%'
    union
    select i.external_id
    from public.customer_identities i
    where i.org_id = v_org and i.customer_id = purge_customer.customer
  ) s
  where char_length(p) >= 6;

  if array_length(v_patterns, 1) > 0 then
    update public.webhook_events w
       set payload = jsonb_build_object('purged', true)
     where w.org_id = v_org
       and w.payload is not null
       and exists (select 1 from unnest(v_patterns) p where strpos(w.payload::text, p) > 0);
  end if;

  -- 4. The customer and everything hanging off it (immutable events included).
  perform set_config('nudge.allow_event_purge', 'on', true);
  delete from public.customers c where c.id = purge_customer.customer;
  perform set_config('nudge.allow_event_purge', 'off', true);

  -- 5. Audit trail: keep that it happened, drop what it was about. Runs after the
  -- delete so the rows the cascade just wrote are scrubbed too.
  update public.audit_logs a
     set before  = case when a.before is null then null else jsonb_build_object('purged', true) end,
         after   = case when a.after  is null then null else jsonb_build_object('purged', true) end,
         summary = nullif(split_part(coalesce(a.summary, ''), ' · ', 1), '')
   where a.org_id = v_org
     and (
       (a.entity_type = 'customers' and a.entity_id = purge_customer.customer)
       or (a.entity_type <> 'customers'
           and (a.before ->> 'customer_id' = v_cust or a.after ->> 'customer_id' = v_cust))
     );

  if v_queued > 0 then
    perform public.invoke_edge_function('storage-purge', jsonb_build_object('reason', 'purge_customer'), 60000);
  end if;
  return true;
end;
$$;

revoke execute on function public.purge_customer(uuid) from public, anon;
grant execute on function public.purge_customer(uuid) to authenticated;

-- ═════════════ 5. export_workspace ═════════════

-- One section of an export: rows of a whitelisted table in org, newest first, capped.
-- SECURITY INVOKER: RLS and the caller's privileges apply to the dynamic query.
create or replace function public.export_section(tbl text, org_id uuid, order_col text, max_rows integer, drop_keys text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_n    integer;
begin
  if tbl not in ('customers', 'customer_identities', 'conversation_events', 'customer_facts', 'commitments',
                 'extractions', 'contact_policies', 'attachments', 'tasks')
     or order_col not in ('created_at', 'occurred_at') then
    raise exception 'Not exportable' using errcode = 'invalid_parameter_value';
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - $3 order by t.%1$I desc), ''[]''::jsonb), count(*)::integer
       from (select * from public.%2$I x where x.org_id = $1 order by x.%1$I desc limit $2) t',
    order_col, tbl)
    into v_rows, v_n
    using export_section.org_id, export_section.max_rows + 1, coalesce(drop_keys, '{}');
  if v_n > max_rows then
    -- drop the sentinel (oldest) row
    v_rows := v_rows - (jsonb_array_length(v_rows) - 1);
  end if;
  return jsonb_build_object('rows', v_rows, 'truncated', v_n > max_rows);
end;
$$;

revoke execute on function public.export_section(text, uuid, text, integer, text[]) from public, anon;
grant execute on function public.export_section(text, uuid, text, integer, text[]) to authenticated;

-- Everything the owner can see in the workspace, as one JSON document. Owner only (42501).
-- Events: the most recent 5000; other sections: the most recent 20000 rows. Recording
-- files are listed by path only (download them from Storage). Member user ids, raw
-- provider payloads and internal keys are left out. Audited ("exported the workspace data").
create or replace function public.export_workspace(org_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_events   constant integer := 5000;
  c_rows     constant integer := 20000;
  v_org      jsonb;
  v_members  jsonb;
  v_out      jsonb := '{}'::jsonb;
  v_section  jsonb;
  v_trunc    text[] := '{}';
  v_counts   jsonb := '{}'::jsonb;
  s          record;
begin
  if public.org_role(export_workspace.org_id) is distinct from 'owner' then
    raise exception 'Only owners can export the workspace' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
           'id', o.id, 'name', o.name, 'sells', o.sells, 'handles', to_jsonb(o.handles),
           'channels', to_jsonb(o.channels), 'plan', o.plan, 'timezone', o.timezone,
           'settings', o.settings, 'created_at', o.created_at)
    into v_org
  from public.organizations o
  where o.id = export_workspace.org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'name', m.name, 'email', m.email, 'role', m.role, 'title', m.title,
           'status', m.status, 'invited_at', m.invited_at, 'joined_at', m.joined_at) order by m.created_at), '[]'::jsonb)
    into v_members
  from public.organization_members m
  where m.org_id = export_workspace.org_id;

  for s in
    select * from (values
      ('customers',           'customers',           'created_at',  c_rows,   array['org_id', 'created_by']),
      ('customer_identities', 'customer_identities', 'created_at',  c_rows,   array['org_id']),
      ('events',              'conversation_events', 'occurred_at', c_events, array['org_id', 'raw', 'idempotency_key']),
      ('facts',               'customer_facts',      'created_at',  c_rows,   array['org_id', 'created_by_ai_run_id']),
      ('commitments',         'commitments',         'created_at',  c_rows,   array['org_id']),
      ('extractions',         'extractions',         'created_at',  c_rows,   array['org_id', 'ai_run_id', 'dedupe_key']),
      ('contact_policies',    'contact_policies',    'created_at',  c_rows,   array['org_id']),
      ('attachments',         'attachments',         'created_at',  c_rows,   array['org_id']),
      ('tasks',               'tasks',               'created_at',  c_rows,   array['org_id'])
    ) as t(key, tbl, order_col, max_rows, drop_keys)
  loop
    v_section := public.export_section(s.tbl, export_workspace.org_id, s.order_col, s.max_rows, s.drop_keys);
    v_out := v_out || jsonb_build_object(s.key, v_section -> 'rows');
    v_counts := v_counts || jsonb_build_object(s.key, jsonb_array_length(v_section -> 'rows'));
    if (v_section ->> 'truncated')::boolean then
      v_trunc := v_trunc || s.key::text;
    end if;
  end loop;

  perform public.audit_workspace_export(export_workspace.org_id);

  return jsonb_build_object(
    'format', 'nudge.workspace-export',
    'version', 1,
    'exported_at', now(),
    'organization', v_org,
    'members', v_members
  ) || v_out || jsonb_build_object(
    'counts', v_counts,
    'limits', jsonb_build_object('events', c_events, 'other', c_rows),
    'truncated', cardinality(v_trunc) > 0,
    'truncated_sections', to_jsonb(v_trunc)
  );
end;
$$;

revoke execute on function public.export_workspace(uuid) from public, anon;
grant execute on function public.export_workspace(uuid) to authenticated;

-- ═════════════ 6. delete_workspace ═════════════

-- Minimal trail of deleted workspaces (the audit trail goes with the workspace).
-- Service role only. name_sha256 = sha256(lower(trim(name))): enough to answer
-- "was a workspace called X deleted?" without keeping the name.
create table public.deleted_workspaces (
  org_id          uuid primary key,
  name_sha256     text not null,
  deleted_by      uuid,
  deleted_at      timestamptz not null default now(),
  member_count    integer not null default 0,
  customer_count  integer not null default 0
);

alter table public.deleted_workspaces enable row level security;
revoke all on public.deleted_workspaces from anon, authenticated;
grant all on public.deleted_workspaces to service_role;

-- Deletes the workspace and everything in it. Owner only (42501 — also for unknown
-- ids, so existence isn't revealed); confirm_name must equal the workspace name,
-- case-insensitive and trimmed (22023). Files in Storage are queued for removal.
-- Members keep their accounts; they simply have no workspace any more.
create or replace function public.delete_workspace(org_id uuid, confirm_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text;
  v_members   integer;
  v_customers integer;
  v_queued    integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select o.name into v_name from public.organizations o where o.id = delete_workspace.org_id for update;
  if v_name is null or public.org_role(delete_workspace.org_id) is distinct from 'owner' then
    raise exception 'Only the owner can delete this workspace' using errcode = 'insufficient_privilege';
  end if;
  if lower(btrim(coalesce(delete_workspace.confirm_name, ''))) <> lower(btrim(v_name)) then
    raise exception 'Type the business name exactly to confirm' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_members from public.organization_members m where m.org_id = delete_workspace.org_id;
  select count(*) into v_customers from public.customers c where c.org_id = delete_workspace.org_id;

  with q as (
    insert into public.storage_purge_queue as sq (bucket_id, object_name, org_id, reason)
    select o.bucket_id, o.name, delete_workspace.org_id, 'delete_workspace'
    from storage.objects o
    where o.bucket_id in ('voice-notes', 'attachments')
      and o.name like delete_workspace.org_id::text || '/%'
    on conflict on constraint storage_purge_queue_object_key
      do update set done_at = null, attempts = 0, last_error = null, requested_at = now(), reason = 'delete_workspace'
    returning 1
  )
  select count(*) into v_queued from q;

  -- webhook_events.org_id is ON DELETE SET NULL: the raw payloads would outlive the workspace.
  delete from public.webhook_events w where w.org_id = delete_workspace.org_id;

  perform set_config('nudge.allow_event_purge', 'on', true);
  delete from public.organizations o where o.id = delete_workspace.org_id;
  perform set_config('nudge.allow_event_purge', 'off', true);

  -- The trail (including the rows the cascade just wrote) goes with the workspace.
  delete from public.audit_logs a where a.org_id = delete_workspace.org_id;

  insert into public.deleted_workspaces (org_id, name_sha256, deleted_by, member_count, customer_count)
  values (
    delete_workspace.org_id,
    encode(sha256(convert_to(lower(btrim(v_name)), 'UTF8')), 'hex'),
    v_uid,
    v_members,
    v_customers
  )
  on conflict on constraint deleted_workspaces_pkey do nothing;

  if v_queued > 0 then
    perform public.invoke_edge_function('storage-purge', jsonb_build_object('reason', 'delete_workspace'), 60000);
  end if;
  return true;
end;
$$;

revoke execute on function public.delete_workspace(uuid, text) from public, anon;
grant execute on function public.delete_workspace(uuid, text) to authenticated;

-- Hourly retry for anything the immediate storage-purge call didn't finish.
do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'nudge: pg_cron is not installed; storage-purge retry not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'nudge-storage-purge') then
    perform cron.unschedule('nudge-storage-purge');
  end if;
  perform cron.schedule(
    'nudge-storage-purge',
    '17 * * * *',
    $job$select public.invoke_edge_function('storage-purge', '{}'::jsonb, 60000)
         where exists (select 1 from public.storage_purge_queue q where q.done_at is null and q.attempts < 10);$job$
  );
end
$cron$;

-- ═════════════ 7. Sweep ═════════════

-- 7a. voice_note_is_linked() answered for ANY path, i.e. "does this recording exist
-- in some other workspace". Now only for workspaces the caller is an active member of
-- (the storage policies that use it are already scoped to the caller's own folder).
create or replace function public.voice_note_is_linked(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.storage_bucket = 'voice-notes'
      and a.storage_path = voice_note_is_linked.object_name
      and public.is_org_member(a.org_id)
  );
$$;

-- 7b. A client could insert an attachments row pointing at a teammate's recording
-- (which then can't be discarded, and goes with that customer on purge) or with no
-- uploader at all. Inserts must now be the caller's own: own uploader id, and for
-- voice-notes the caller's own '{org}/{me}/{file}' path. save_capture() is unaffected.
drop policy if exists "attachments: create" on public.attachments;
create policy "attachments: create" on public.attachments
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (customer_id is null or public.can_see_customer(customer_id))
    and uploaded_by_member_id is not null
    and uploaded_by_member_id = public.current_member_id(org_id)
    and (
      storage_bucket = 'attachments'
      or (storage_bucket = 'voice-notes' and public.is_own_voice_note_path(storage_path))
    )
  );

-- 7c. TRUNCATE bypasses RLS; REFERENCES / TRIGGER are never needed by clients.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon;

-- 7d. Functions: nobody signed out may call anything. Keep exactly the access
-- `authenticated` and `service_role` have today (made explicit), then drop PUBLIC and anon.
-- Extension functions (e.g. pgcrypto on a plain-Postgres harness) are left alone.
do $sweep$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
           has_function_privilege('service_role', p.oid, 'execute') as svc_x
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if r.auth_x then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if r.svc_x then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end
$sweep$;

-- Internal helpers that were callable as RPCs but are only used inside SQL.
revoke execute on function public.ai_quota_wait(uuid, uuid, text, interval, integer) from authenticated;
revoke execute on function public.audit_summary(text, text, jsonb, jsonb) from authenticated;

-- 7e. Objects created by later migrations: no automatic grants to anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
