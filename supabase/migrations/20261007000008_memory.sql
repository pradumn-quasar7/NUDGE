-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · Customer Memory summaries + Customer Handoff Briefs
--
--   1. ai_stage 'handoff'            ai_runs rows of the handoff-brief Edge Function
--   2. customers summary metadata    which ai_runs row wrote "What matters", from
--                                    which events, and the AI's channel guess.
--                                    Not client-writable (insert or update).
--   3. customer_summary_state        service-only bookkeeping for the queue below
--   4. queue_customer_summary()      debounced pg_net call to summarize-customer
--                                    (internal, never raises)
--      ai_runs triggers              extraction run succeeded → queue that
--                                    customer's summary
--      flush_customer_summaries()    pg_cron sweep (every 5 min) for customers
--                                    whose memory changed inside a debounce window
--      request_customer_summary()    the app's "Refresh" (RLS-checked, rate limited)
--   5. handoff_briefs                stored briefs: readable by members who can
--                                    see the customer, written by the service role
--   6. Realtime                      customers (new summaries reach open screens)
--                                    and handoff_briefs
--
-- Same fail-safe rules as migrations 5 and 7: nothing here ever blocks or fails
-- the write that triggered it; without pg_net / Vault secrets nothing is sent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── 1. ai_stage 'handoff' ─────────────
-- Not used anywhere in this migration: a value added by ALTER TYPE … ADD VALUE
-- can't be used in the transaction that adds it. The Edge Function uses it later.
alter type public.ai_stage add value if not exists 'handoff';

-- ───────────── 2. customers: summary metadata ─────────────
-- summary, summary_message_count, summary_call_count, summary_updated_at and
-- headline already exist (core schema). The AI writes them with the service role.

alter table public.customers
  add column if not exists summary_ai_run_id uuid,
  add column if not exists summary_source_event_ids uuid[] not null default '{}',
  -- The AI's evidence-backed guess. preferred_channel stays what a person chose.
  add column if not exists summary_preferred_channel public.channel;

alter table public.customers
  add constraint customers_summary_ai_run_fk foreign key (org_id, summary_ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (summary_ai_run_id);

-- Update was already column-scoped (migration 5) and never included summary*.
-- Insert was still table-wide, so a client could create a customer with a
-- made-up "What matters". Insert is now column-scoped too (everything except
-- the AI-owned summary columns).
revoke insert on public.customers from authenticated;
grant insert (id, org_id, name, company, phone, email, preferred_channel, customer_since, lifetime_value,
              headline, source, owner_member_id, archived_at, created_by, created_at, updated_at)
  on public.customers to authenticated;

-- ───────────── 3. customer_summary_state (service only) ─────────────
-- Kept out of `customers` so queue bookkeeping doesn't write audit_logs rows,
-- bump updated_at or wake every Realtime subscriber on each extraction.

create table public.customer_summary_state (
  customer_id             uuid primary key,
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  -- Last time a summarize-customer call was enqueued (trigger, sweep or Refresh).
  requested_at            timestamptz,
  requested_by_member_id  uuid,
  last_request_id         bigint,
  request_count           integer not null default 0,
  -- Memory changed while a request was debounced; the sweep picks it up.
  dirty_since             timestamptz,
  updated_at              timestamptz not null default now(),
  constraint customer_summary_state_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint customer_summary_state_member_fk foreign key (org_id, requested_by_member_id)
    references public.organization_members (org_id, id) on delete set null (requested_by_member_id)
);

create index customer_summary_state_dirty_idx on public.customer_summary_state (dirty_since)
  where dirty_since is not null;

create trigger customer_summary_state_set_updated_at before update on public.customer_summary_state
  for each row execute function public.set_updated_at();

alter table public.customer_summary_state enable row level security;
-- No policies: service role only.
revoke all on public.customer_summary_state from anon, authenticated;
grant all on public.customer_summary_state to service_role;

-- ───────────── 4. Summary queue ─────────────
-- Body contract of summarize-customer: POST { "customer_id": uuid }.
--
-- Debounce: at most one call per customer per 2 minutes, counted from the last
-- enqueue AND from the last generated summary. A debounced change marks the
-- customer dirty; flush_customer_summaries() enqueues it once the window passes.
--
-- Returns jsonb { status, retry_after? }:
--   queued       a call was enqueued (request_id = pg_net id)
--   pending      a call was enqueued < 2 min ago and no newer summary exists yet
--   fresh        a summary was generated < 2 min ago
--   unavailable  pg_net / Vault secrets missing (nothing sent)
--   not_found / archived

create or replace function public.queue_customer_summary(
  customer_id            uuid,
  requested_by_member_id uuid default null,
  manual                 boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window   constant interval := interval '2 minutes';
  v_org      uuid;
  v_archived timestamptz;
  v_updated  timestamptz;
  v_state    public.customer_summary_state;
  v_since    timestamptz;
  v_request  bigint;
begin
  select c.org_id, c.archived_at, c.summary_updated_at
    into v_org, v_archived, v_updated
  from public.customers c
  where c.id = queue_customer_summary.customer_id;
  if v_org is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_archived is not null and not coalesce(queue_customer_summary.manual, false) then
    return jsonb_build_object('status', 'archived');
  end if;

  insert into public.customer_summary_state (customer_id, org_id)
  values (queue_customer_summary.customer_id, v_org)
  on conflict on constraint customer_summary_state_pkey do nothing;

  -- Serialise concurrent triggers / taps for this customer.
  select * into v_state
  from public.customer_summary_state s
  where s.customer_id = queue_customer_summary.customer_id
  for update;

  v_since := greatest(coalesce(v_state.requested_at, '-infinity'::timestamptz), coalesce(v_updated, '-infinity'::timestamptz));
  if v_since > now() - v_window then
    if not coalesce(queue_customer_summary.manual, false) then
      update public.customer_summary_state s
         set dirty_since = coalesce(s.dirty_since, now())
       where s.customer_id = queue_customer_summary.customer_id;
    end if;
    return jsonb_build_object(
      'status', case when v_updated is not null and v_updated >= coalesce(v_state.requested_at, '-infinity'::timestamptz)
                     then 'fresh' else 'pending' end,
      'retry_after', greatest(1, ceil(extract(epoch from (v_since + v_window - now()))))::integer
    );
  end if;

  v_request := public.invoke_edge_function(
    'summarize-customer',
    jsonb_build_object('customer_id', queue_customer_summary.customer_id),
    120000
  );
  if v_request is null then
    if not coalesce(queue_customer_summary.manual, false) then
      update public.customer_summary_state s
         set dirty_since = coalesce(s.dirty_since, now())
       where s.customer_id = queue_customer_summary.customer_id;
    end if;
    return jsonb_build_object('status', 'unavailable');
  end if;

  update public.customer_summary_state s
     set requested_at = now(),
         requested_by_member_id = queue_customer_summary.requested_by_member_id,
         last_request_id = v_request,
         request_count = s.request_count + 1,
         dirty_since = null
   where s.customer_id = queue_customer_summary.customer_id;
  return jsonb_build_object('status', 'queued', 'request_id', v_request);
end;
$$;

revoke execute on function public.queue_customer_summary(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.queue_customer_summary(uuid, uuid, boolean) to service_role;

-- Extraction run finished → refresh the memory summary of the customer(s) it read.
-- ai-extract inserts its run as 'running' and flips it to 'succeeded' at the end
-- (UPDATE trigger); the INSERT trigger covers tools that insert finished runs.
create or replace function public.enqueue_summary_after_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
begin
  for v_customer in
    select distinct e.customer_id
    from public.conversation_events e
    where e.org_id = new.org_id
      and e.id = any (new.input_event_ids)
  loop
    perform public.queue_customer_summary(v_customer, null, false);
  end loop;
  return null;
exception when others then
  return null; -- never block or fail the ai_runs write
end;
$$;

revoke execute on function public.enqueue_summary_after_extraction() from public, anon, authenticated;

drop trigger if exists ai_runs_enqueue_summary on public.ai_runs;
create trigger ai_runs_enqueue_summary
  after update of status on public.ai_runs
  for each row
  when (new.stage = 'extraction' and new.status = 'succeeded' and old.status is distinct from new.status)
  execute function public.enqueue_summary_after_extraction();

drop trigger if exists ai_runs_enqueue_summary_on_insert on public.ai_runs;
create trigger ai_runs_enqueue_summary_on_insert
  after insert on public.ai_runs
  for each row
  when (new.stage = 'extraction' and new.status = 'succeeded')
  execute function public.enqueue_summary_after_extraction();

-- Sweep: customers marked dirty inside a debounce window. Returns calls enqueued.
create or replace function public.flush_customer_summaries(max_customers integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_count    integer := 0;
begin
  for v_customer in
    select s.customer_id
    from public.customer_summary_state s
    join public.customers c on c.id = s.customer_id
    where s.dirty_since is not null
      and c.archived_at is null
      and coalesce(s.requested_at, '-infinity'::timestamptz) <= now() - interval '2 minutes'
      and coalesce(c.summary_updated_at, '-infinity'::timestamptz) <= now() - interval '2 minutes'
    order by s.dirty_since
    limit greatest(1, least(coalesce(max_customers, 25), 200))
  loop
    if public.queue_customer_summary(v_customer, null, false) ->> 'status' = 'queued' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.flush_customer_summaries(integer) from public, anon, authenticated;
grant execute on function public.flush_customer_summaries(integer) to service_role;

do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'nudge: pg_cron is not installed; summary sweep not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'nudge-summary-sweep') then
    perform cron.unschedule('nudge-summary-sweep');
  end if;
  perform cron.schedule('nudge-summary-sweep', '*/5 * * * *', $job$select public.flush_customer_summaries(25);$job$);
end
$cron$;

-- "Refresh" on the customer profile. Any active member who can see the customer;
-- at most one call per customer per 2 minutes (see queue_customer_summary).
-- Returns { status: 'queued' | 'pending' | 'fresh' | 'unavailable', retry_after? }.
create or replace function public.request_customer_summary(customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if request_customer_summary.customer_id is null
     or not public.can_see_customer(request_customer_summary.customer_id) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select c.org_id into v_org from public.customers c where c.id = request_customer_summary.customer_id;
  v_result := public.queue_customer_summary(request_customer_summary.customer_id, public.current_member_id(v_org), true);
  return v_result - 'request_id';
end;
$$;

revoke execute on function public.request_customer_summary(uuid) from public, anon;
grant execute on function public.request_customer_summary(uuid) to authenticated;

-- ───────────── 5. handoff_briefs ─────────────
-- Stored (not only returned) because:
--   * the teammate it was made for can open it later (Realtime + for_member_id),
--   * it is the cache key for "same memory → same brief" (fingerprint), so
--     reopening a brief costs no model call,
--   * it is part of the audit trail of what the AI told whom.
-- Rows are history: no client insert/update/delete. purge_customer() removes
-- them with the customer (FK cascade).

create table public.handoff_briefs (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  customer_id             uuid not null,
  commitment_id           uuid,
  requested_by_member_id  uuid,
  for_member_id           uuid,
  -- { history, currentState, openCommitments[], sensitiveNotes[], nextAction, evidenceEventIds[], generatedAt, source }
  brief                   jsonb not null check (jsonb_typeof(brief) = 'object'),
  evidence_event_ids      uuid[] not null default '{}',
  -- Hash of the memory the brief was built from (events, facts, promises, target).
  fingerprint             text check (fingerprint is null or char_length(fingerprint) <= 128),
  ai_run_id               uuid,
  created_at              timestamptz not null default now(),
  constraint handoff_briefs_org_id_id_key unique (org_id, id),
  constraint handoff_briefs_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint handoff_briefs_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete set null (commitment_id),
  constraint handoff_briefs_requested_by_fk foreign key (org_id, requested_by_member_id)
    references public.organization_members (org_id, id) on delete set null (requested_by_member_id),
  constraint handoff_briefs_for_member_fk foreign key (org_id, for_member_id)
    references public.organization_members (org_id, id) on delete set null (for_member_id),
  constraint handoff_briefs_ai_run_fk foreign key (org_id, ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (ai_run_id)
);

create index handoff_briefs_customer_idx on public.handoff_briefs (org_id, customer_id, created_at desc);
create index handoff_briefs_for_member_idx on public.handoff_briefs (org_id, for_member_id, created_at desc)
  where for_member_id is not null;

alter table public.handoff_briefs enable row level security;

create policy "handoff briefs: read" on public.handoff_briefs
  for select to authenticated
  using (public.can_see_customer(customer_id));

revoke all on public.handoff_briefs from anon;
revoke insert, update, delete, truncate on public.handoff_briefs from authenticated;
grant select on public.handoff_briefs to authenticated;
grant all on public.handoff_briefs to service_role;

-- ───────────── 6. Realtime ─────────────
-- customers: a new summary / headline written by the AI reaches open profiles
-- (the app already subscribes to it). Guarded so re-adding is harmless.

do $rt$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers') then
    alter publication supabase_realtime add table public.customers;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'handoff_briefs') then
    alter publication supabase_realtime add table public.handoff_briefs;
  end if;
end
$rt$;
