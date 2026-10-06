-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · application RPCs
--   confirm_extraction()   user, SECURITY INVOKER (RLS applies)
--   purge_customer()       user, owner / members_can_delete only, audited
--   ingest_event()         service role only (webhooks)
--   followup_candidates()  service role only (followup-scheduler)
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── Extraction decisions ─────────────
-- pending → confirmed | ignored, exactly once. Records who decided and when.

alter table public.extractions
  add constraint extractions_confirmed_has_commitment
  check (status <> 'confirmed' or commitment_id is not null);

create or replace function public.extractions_track_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'Extraction already %', old.status using errcode = 'check_violation';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
    new.decided_by_member_id := coalesce(new.decided_by_member_id, public.current_member_id(new.org_id));
  end if;
  return new;
end;
$$;

revoke execute on function public.extractions_track_decision() from public, anon, authenticated;

create trigger extractions_track_decision
  before update of status on public.extractions
  for each row execute function public.extractions_track_decision();

-- Confirm an AI-proposed commitment: creates the commitment (owned by the caller)
-- and a fact for every checked field, all linked to the source event.
-- Idempotent: confirming twice returns the same commitment id.
create or replace function public.confirm_extraction(
  extraction_id uuid,
  fields jsonb default null,
  due_at timestamptz default null,
  title text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  x             public.extractions%rowtype;
  v_member      uuid;
  v_fields      jsonb;
  v_title       text;
  v_due         timestamptz;
  v_commitment  uuid;
begin
  select e.* into x
  from public.extractions e
  where e.id = confirm_extraction.extraction_id
  for update;

  if not found then
    raise exception 'Extraction not found' using errcode = 'no_data_found';
  end if;
  if x.status = 'confirmed' then
    return x.commitment_id;
  end if;
  if x.status = 'ignored' then
    raise exception 'Extraction was ignored' using errcode = 'check_violation';
  end if;

  v_member := public.current_member_id(x.org_id);
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  v_fields := coalesce(confirm_extraction.fields, x.fields);
  if jsonb_typeof(v_fields) <> 'array' then
    raise exception 'fields must be an array' using errcode = 'invalid_parameter_value';
  end if;

  v_title := regexp_replace(btrim(coalesce(nullif(btrim(confirm_extraction.title), ''), x.title)), '\.$', '');
  v_due   := coalesce(confirm_extraction.due_at, x.due_at, now() + interval '1 day');

  insert into public.commitments (
    org_id, customer_id, title, owner_member_id, due_at, status, promisor,
    source_event_id, quote, quote_by, confidence, extraction_id, created_by_member_id
  )
  values (
    x.org_id, x.customer_id, v_title, v_member, v_due, 'open', x.promisor,
    x.source_event_id, x.quote, x.quote_by, x.confidence, x.id, v_member
  )
  returning id into v_commitment;

  insert into public.customer_facts (org_id, customer_id, kind, text, source_event_id, confidence, created_by_member_id)
  select
    x.org_id,
    x.customer_id,
    case when f ->> 'key' in ('requirement', 'deadline', 'budget', 'quantity')
         then 'temporal'::public.fact_kind
         else 'note'::public.fact_kind end,
    left(btrim(coalesce(f ->> 'label', 'Note')) || ': ' || btrim(f ->> 'value'), 500),
    x.source_event_id,
    0.85,
    v_member
  from jsonb_array_elements(v_fields) as f
  where jsonb_typeof(f) = 'object'
    and coalesce((f ->> 'checked')::boolean, false)
    and nullif(btrim(coalesce(f ->> 'value', '')), '') is not null;

  update public.extractions e
     set status               = 'confirmed',
         fields               = v_fields,
         title                = v_title,
         due_at               = v_due,
         commitment_id        = v_commitment,
         decided_by_member_id = v_member,
         decided_at           = now()
   where e.id = x.id;

  return v_commitment;
end;
$$;

revoke execute on function public.confirm_extraction(uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.confirm_extraction(uuid, jsonb, timestamptz, text) to authenticated;

-- ───────────── Right to erasure ─────────────
-- Deletes a customer and ALL of their history, including immutable raw events.
-- Owner only (or members when settings.members_can_delete). The customer row's
-- deletion is captured in audit_logs.
-- TODO: also remove Storage objects under '{org_id}/{customer_id}/' (needs the
-- Storage API; do it from an edge function after this RPC succeeds).
create or replace function public.purge_customer(customer uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org from public.customers c where c.id = purge_customer.customer;

  if v_org is null
     or not public.can_see_customer(purge_customer.customer)
     or not public.can_delete_history(v_org) then
    raise exception 'Not allowed to delete this customer' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('nudge.allow_event_purge', 'on', true);
  delete from public.customers c where c.id = purge_customer.customer;
  perform set_config('nudge.allow_event_purge', 'off', true);
  return true;
end;
$$;

revoke execute on function public.purge_customer(uuid) from public, anon;
grant execute on function public.purge_customer(uuid) to authenticated;

-- ───────────── ingest_event (service role) ─────────────
-- Atomic identity resolution + raw event write for inbound channel messages:
--   1. idempotency: same (org, idempotency_key) → returns the existing event
--   2. resolve customer via customer_identities, then by phone digits
--   3. create customer + identity when unknown
--   4. upsert conversation thread, insert the immutable event
-- Serialised per sender with an advisory lock so concurrent deliveries from a
-- new number never create duplicate customers.
create or replace function public.ingest_event(
  p_org_id          uuid,
  p_channel         public.channel,
  p_external_id     text,
  p_display_name    text,
  p_kind            public.event_kind,
  p_direction       public.event_direction,
  p_occurred_at     timestamptz,
  p_title           text,
  p_body            text,
  p_raw             jsonb,
  p_idempotency_key text,
  p_thread_id       text default null
)
returns table (event_id uuid, customer_id uuid, created boolean, customer_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_external      text := btrim(p_external_id);
  v_digits        text;
  v_customer      uuid;
  v_event         uuid;
  v_conversation  uuid;
  v_owner         uuid;
  v_new_customer  boolean := false;
begin
  if p_org_id is null or v_external is null or v_external = '' or p_idempotency_key is null then
    raise exception 'ingest_event: org, external id and idempotency key are required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_channel in ('whatsapp', 'phone') then
    v_digits := regexp_replace(v_external, '\D', '', 'g');
    v_external := v_digits;
  elsif p_channel = 'email' then
    v_external := lower(v_external);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_channel::text || ':' || v_external, 0));

  -- 1. idempotency
  select e.id, e.customer_id into v_event, v_customer
  from public.conversation_events e
  where e.org_id = p_org_id and e.idempotency_key = p_idempotency_key;
  if found then
    return query select v_event, v_customer, false, false;
    return;
  end if;

  -- 2. identity resolution
  select i.customer_id into v_customer
  from public.customer_identities i
  where i.org_id = p_org_id and i.channel = p_channel and i.external_id = v_external;

  if v_customer is null and v_digits is not null and v_digits <> '' then
    select c.id into v_customer
    from public.customers c
    where c.org_id = p_org_id
      and c.archived_at is null
      and c.phone is not null
      and regexp_replace(c.phone, '\D', '', 'g') = v_digits
    order by c.created_at
    limit 1;
  end if;

  -- 3. unknown sender → new customer, owned by the first owner of the workspace
  if v_customer is null then
    select m.id into v_owner
    from public.organization_members m
    where m.org_id = p_org_id and m.role = 'owner' and m.status = 'active'
    order by m.created_at
    limit 1;

    insert into public.customers (org_id, name, phone, email, preferred_channel, headline, source, owner_member_id)
    values (
      p_org_id,
      left(coalesce(nullif(btrim(p_display_name), ''),
                    case when v_digits is not null then '+' || v_digits else v_external end), 200),
      case when v_digits is not null then '+' || v_digits end,
      case when p_channel = 'email' then v_external end,
      p_channel,
      'New · ' || initcap(p_channel::text),
      initcap(p_channel::text),
      v_owner
    )
    returning id into v_customer;
    v_new_customer := true;
  end if;

  insert into public.customer_identities (org_id, customer_id, channel, external_id, display_name, verified)
  values (p_org_id, v_customer, p_channel, v_external, nullif(btrim(p_display_name), ''), true)
  on conflict (org_id, channel, external_id) do nothing;

  -- 4. thread + event
  if p_thread_id is not null then
    insert into public.conversations (org_id, customer_id, channel, external_thread_id, last_event_at)
    values (p_org_id, v_customer, p_channel, p_thread_id, p_occurred_at)
    on conflict (org_id, channel, external_thread_id)
      do update set last_event_at = greatest(public.conversations.last_event_at, excluded.last_event_at)
    returning id into v_conversation;
  end if;

  insert into public.conversation_events (
    org_id, customer_id, conversation_id, kind, channel, direction, occurred_at,
    title, body, raw, idempotency_key
  )
  values (
    p_org_id, v_customer, v_conversation, p_kind, p_channel, p_direction, coalesce(p_occurred_at, now()),
    left(coalesce(nullif(btrim(p_title), ''), 'Message'), 300), p_body, p_raw, p_idempotency_key
  )
  returning id into v_event;

  return query select v_event, v_customer, true, v_new_customer;
end;
$$;

revoke execute on function public.ingest_event(uuid, public.channel, text, text, public.event_kind, public.event_direction, timestamptz, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_event(uuid, public.channel, text, text, public.event_kind, public.event_direction, timestamptz, text, text, jsonb, text, text)
  to service_role;

-- ───────────── followup_candidates (service role) ─────────────
-- Open commitments that are due within p_horizon (or overdue), with everything
-- the scheduler needs to apply the customer's contact policy.
create or replace function public.followup_candidates(p_horizon interval default interval '2 hours', p_limit integer default 500)
returns table (
  commitment_id         uuid,
  org_id                uuid,
  customer_id           uuid,
  customer_name         text,
  title                 text,
  due_at                timestamptz,
  owner_member_id       uuid,
  promisor              public.promisor,
  quote                 text,
  org_timezone          text,
  policy_timezone       text,
  preferred_channel     public.channel,
  preferred_hours_start time,
  preferred_hours_end   time,
  max_messages_per_week integer,
  opted_out             boolean,
  outbound_last_7d      bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, c.org_id, c.customer_id, cu.name, c.title, c.due_at, c.owner_member_id, c.promisor, c.quote,
    o.timezone, cp.timezone, coalesce(cp.preferred_channel, cu.preferred_channel),
    cp.preferred_hours_start, cp.preferred_hours_end, cp.max_messages_per_week,
    coalesce(cp.opted_out, false),
    (
      select count(*)
      from public.conversation_events e
      where e.org_id = c.org_id
        and e.customer_id = c.customer_id
        and e.direction = 'out'
        and e.occurred_at > now() - interval '7 days'
    )
  from public.commitments c
  join public.customers cu on cu.org_id = c.org_id and cu.id = c.customer_id
  join public.organizations o on o.id = c.org_id
  left join public.contact_policies cp on cp.org_id = c.org_id and cp.customer_id = c.customer_id
  where c.status = 'open'
    and (c.snoozed_until is null or c.snoozed_until <= now())
    and c.due_at <= now() + p_horizon
    and cu.archived_at is null
  order by c.due_at
  limit greatest(1, least(p_limit, 5000));
$$;

revoke execute on function public.followup_candidates(interval, integer) from public, anon, authenticated;
grant execute on function public.followup_candidates(interval, integer) to service_role;
