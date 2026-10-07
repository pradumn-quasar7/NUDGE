-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · Row Level Security, privileges, audit trail
--
-- Model:
--   * A user sees an organization's data only through an ACTIVE membership.
--   * Owners manage members, integrations and workspace/billing settings.
--   * organizations.settings->>'share_all_customers' = false → members only see
--     customers they own (owners still see everything), and only the events /
--     facts / commitments / extractions of those customers.
--   * Deleting history requires owner role, or settings.members_can_delete = true.
--   * conversation_events: insert + select only (immutable).
--   * webhook_events and ai_runs: service role only.
--   * audit_logs: written by trigger only, readable by owners.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── Helper functions ─────────────
-- SECURITY DEFINER so they can read membership rows without recursing into RLS.
-- They only ever answer questions about the calling user (auth.uid()).

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.org_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function public.org_role(org uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.org_id = org
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.current_member_id(org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.organization_members m
  where m.org_id = org
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;

-- Owner, or any active member when the workspace allows members to delete.
create or replace function public.can_delete_history(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.org_id
    where m.org_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.role = 'owner' or coalesce((o.settings ->> 'members_can_delete')::boolean, false))
  );
$$;

-- Visibility of one customer (and everything hanging off it).
create or replace function public.can_see_customer(customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.customers c
    join public.organizations o on o.id = c.org_id
    join public.organization_members m
      on m.org_id = c.org_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where c.id = customer
      and (
        m.role = 'owner'
        or coalesce((o.settings ->> 'share_all_customers')::boolean, true)
        or c.owner_member_id = m.id
      )
  );
$$;

-- Same rule evaluated on a customers row's own columns. Used by the policies ON
-- customers: can_see_customer(id) re-reads the row, and a row being inserted is
-- not visible to that query yet, so INSERT … RETURNING (supabase-js
-- .insert().select()) would fail the SELECT policy.
create or replace function public.can_see_customer_row(org uuid, owner_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.org_id
    where m.org_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        m.role = 'owner'
        or coalesce((o.settings ->> 'share_all_customers')::boolean, true)
        or owner_member = m.id
      )
  );
$$;

-- Cast helper for storage paths ('{org_id}/…'); returns null instead of raising.
create or replace function public.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- ───────────── Privileges (defence in depth on top of RLS) ─────────────
-- Supabase grants ALL on public tables to anon/authenticated by default.
-- anon never touches tenant data; authenticated loses verbs that no policy allows.

revoke all on all tables in schema public from anon;

revoke update, delete, truncate on public.conversation_events from authenticated;
revoke insert, update, delete, truncate on public.event_annotations from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke all on public.webhook_events from authenticated;
revoke all on public.ai_runs from authenticated;
-- plan is changed by billing (service role), never by a client.
revoke insert, update, delete, truncate on public.organizations from authenticated;
grant update (name, sells, handles, channels, timezone, settings) on public.organizations to authenticated;
-- Notifications: clients may only mark them read.
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
-- Extractions are created by the AI pipeline; clients only decide on them.
revoke insert, update, delete, truncate on public.extractions from authenticated;
grant update (status, title, due_at, fields, commitment_id, decided_by_member_id, decided_at)
  on public.extractions to authenticated;
-- Suggestions are created by the scheduler; clients only resolve them.
revoke insert, update, delete, truncate on public.followup_suggestions from authenticated;
grant update (resolved_at, bucket) on public.followup_suggestions to authenticated;
-- Profiles are created by the auth trigger; users edit their own.
revoke insert, delete, truncate on public.profiles from authenticated;

-- ───────────── Enable RLS everywhere ─────────────

alter table public.profiles              enable row level security;
alter table public.organizations         enable row level security;
alter table public.organization_members  enable row level security;
alter table public.customers             enable row level security;
alter table public.customer_identities   enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_events   enable row level security;
alter table public.event_annotations     enable row level security;
alter table public.customer_facts        enable row level security;
alter table public.extractions           enable row level security;
alter table public.commitments           enable row level security;
alter table public.tasks                 enable row level security;
alter table public.notifications         enable row level security;
alter table public.followup_suggestions  enable row level security;
alter table public.attachments           enable row level security;
alter table public.integration_accounts  enable row level security;
alter table public.webhook_events        enable row level security;
alter table public.ai_runs               enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.contact_policies      enable row level security;

-- ───────────── profiles ─────────────

create policy "profiles: read self and teammates" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.organization_members theirs
      where theirs.user_id = profiles.id
        and public.is_org_member(theirs.org_id)
    )
  );

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ───────────── organizations ─────────────
-- Created via create_organization() RPC; never deleted from the client.

create policy "organizations: members read" on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy "organizations: owners update settings" on public.organizations
  for update to authenticated
  using (public.org_role(id) = 'owner')
  with check (public.org_role(id) = 'owner');

-- ───────────── organization_members ─────────────

create policy "members: read teammates" on public.organization_members
  for select to authenticated
  using (public.is_org_member(org_id) or user_id = (select auth.uid()));

create policy "members: owners invite" on public.organization_members
  for insert to authenticated
  with check (public.org_role(org_id) = 'owner');

create policy "members: owners manage" on public.organization_members
  for update to authenticated
  using (public.org_role(org_id) = 'owner')
  with check (public.org_role(org_id) = 'owner');

create policy "members: owners remove" on public.organization_members
  for delete to authenticated
  using (public.org_role(org_id) = 'owner');

-- ───────────── customers ─────────────

create policy "customers: read visible" on public.customers
  for select to authenticated
  using (public.can_see_customer_row(org_id, owner_member_id));

create policy "customers: members create" on public.customers
  for insert to authenticated
  with check (public.is_org_member(org_id));

create policy "customers: update visible" on public.customers
  for update to authenticated
  using (public.can_see_customer_row(org_id, owner_member_id))
  with check (public.is_org_member(org_id));

create policy "customers: delete when allowed" on public.customers
  for delete to authenticated
  using (public.can_see_customer_row(org_id, owner_member_id) and public.can_delete_history(org_id));

-- ───────────── Customer-scoped tables (same shape) ─────────────
-- Composite FKs guarantee row.org_id = customer.org_id, so can_see_customer()
-- implies membership of row.org_id.

-- customer_identities
create policy "identities: read" on public.customer_identities
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "identities: create" on public.customer_identities
  for insert to authenticated with check (public.can_see_customer(customer_id));
create policy "identities: update" on public.customer_identities
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));
create policy "identities: delete" on public.customer_identities
  for delete to authenticated
  using (public.can_see_customer(customer_id) and public.can_delete_history(org_id));

-- conversations
create policy "conversations: read" on public.conversations
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "conversations: create" on public.conversations
  for insert to authenticated with check (public.can_see_customer(customer_id));
create policy "conversations: update" on public.conversations
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));

-- conversation_events: insert + read only. A client may only author as itself.
create policy "events: read" on public.conversation_events
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "events: capture" on public.conversation_events
  for insert to authenticated
  with check (
    public.can_see_customer(customer_id)
    and (author_member_id is null or author_member_id = public.current_member_id(org_id))
  );

-- event_annotations: AI output, written by the service role.
create policy "annotations: read" on public.event_annotations
  for select to authenticated using (public.can_see_customer(customer_id));

-- customer_facts
create policy "facts: read" on public.customer_facts
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "facts: create" on public.customer_facts
  for insert to authenticated with check (public.can_see_customer(customer_id));
create policy "facts: update" on public.customer_facts
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));
create policy "facts: delete" on public.customer_facts
  for delete to authenticated
  using (public.can_see_customer(customer_id) and public.can_delete_history(org_id));

-- extractions: created by the AI pipeline (service role); people confirm / ignore.
create policy "extractions: read" on public.extractions
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "extractions: decide" on public.extractions
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));

-- commitments
create policy "commitments: read" on public.commitments
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "commitments: create" on public.commitments
  for insert to authenticated with check (public.can_see_customer(customer_id));
create policy "commitments: update" on public.commitments
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));
create policy "commitments: delete" on public.commitments
  for delete to authenticated
  using (public.can_see_customer(customer_id) and public.can_delete_history(org_id));

-- contact_policies
create policy "contact policies: read" on public.contact_policies
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "contact policies: create" on public.contact_policies
  for insert to authenticated with check (public.can_see_customer(customer_id));
create policy "contact policies: update" on public.contact_policies
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));
create policy "contact policies: delete" on public.contact_policies
  for delete to authenticated
  using (public.can_see_customer(customer_id) and public.can_delete_history(org_id));

-- followup_suggestions: written by the scheduler; people resolve them.
create policy "suggestions: read" on public.followup_suggestions
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "suggestions: resolve" on public.followup_suggestions
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));

-- ───────────── Optionally customer-scoped tables ─────────────

-- tasks
create policy "tasks: read" on public.tasks
  for select to authenticated
  using (public.is_org_member(org_id) and (customer_id is null or public.can_see_customer(customer_id)));
create policy "tasks: create" on public.tasks
  for insert to authenticated
  with check (public.is_org_member(org_id) and (customer_id is null or public.can_see_customer(customer_id)));
create policy "tasks: update" on public.tasks
  for update to authenticated
  using (public.is_org_member(org_id) and (customer_id is null or public.can_see_customer(customer_id)))
  with check (public.is_org_member(org_id) and (customer_id is null or public.can_see_customer(customer_id)));
create policy "tasks: delete" on public.tasks
  for delete to authenticated
  using (public.can_delete_history(org_id) and (customer_id is null or public.can_see_customer(customer_id)));

-- attachments
create policy "attachments: read" on public.attachments
  for select to authenticated
  using (public.is_org_member(org_id) and (customer_id is null or public.can_see_customer(customer_id)));
create policy "attachments: create" on public.attachments
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (customer_id is null or public.can_see_customer(customer_id))
    and (uploaded_by_member_id is null or uploaded_by_member_id = public.current_member_id(org_id))
  );
create policy "attachments: delete" on public.attachments
  for delete to authenticated
  using (public.can_delete_history(org_id) and (customer_id is null or public.can_see_customer(customer_id)));

-- notifications: addressed to me (or to everyone), about customers I can see.
create policy "notifications: read mine" on public.notifications
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and (recipient_member_id is null or recipient_member_id = public.current_member_id(org_id))
    and (customer_id is null or public.can_see_customer(customer_id))
  );
create policy "notifications: mark read" on public.notifications
  for update to authenticated
  using (
    public.is_org_member(org_id)
    and (recipient_member_id is null or recipient_member_id = public.current_member_id(org_id))
  )
  with check (public.is_org_member(org_id));

-- ───────────── Owner-managed tables ─────────────

create policy "integrations: members read" on public.integration_accounts
  for select to authenticated using (public.is_org_member(org_id));
create policy "integrations: owners create" on public.integration_accounts
  for insert to authenticated with check (public.org_role(org_id) = 'owner');
create policy "integrations: owners update" on public.integration_accounts
  for update to authenticated
  using (public.org_role(org_id) = 'owner') with check (public.org_role(org_id) = 'owner');
create policy "integrations: owners delete" on public.integration_accounts
  for delete to authenticated using (public.org_role(org_id) = 'owner');

create policy "audit: owners read" on public.audit_logs
  for select to authenticated using (public.org_role(org_id) = 'owner');

-- webhook_events, ai_runs: RLS on with no policies → service role only.

-- ───────────── Storage: private "attachments" bucket ─────────────
-- Object names are '{org_id}/{customer_id}/{file}'.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments bucket: members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_org_member(public.try_uuid((storage.foldername(name))[1]))
    and (
      public.try_uuid((storage.foldername(name))[2]) is null
      or public.can_see_customer(public.try_uuid((storage.foldername(name))[2]))
    )
  );

create policy "attachments bucket: members upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_org_member(public.try_uuid((storage.foldername(name))[1]))
    and (
      public.try_uuid((storage.foldername(name))[2]) is null
      or public.can_see_customer(public.try_uuid((storage.foldername(name))[2]))
    )
  );

create policy "attachments bucket: delete when allowed" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_delete_history(public.try_uuid((storage.foldername(name))[1]))
  );

-- ───────────── Audit trail ─────────────

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
  v_org     uuid  := (v_row ->> 'org_id')::uuid;
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

  insert into public.audit_logs (org_id, actor_user_id, actor_member_id, actor_kind, action, entity_type, entity_id, before, after)
  values (
    v_org,
    v_uid,
    v_member,
    case when v_uid is not null then 'user' when v_role = 'service_role' then 'service' else 'system' end,
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_old,
    v_new
  );
  return null;
end;
$$;

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function public.audit_row_change();
create trigger commitments_audit
  after insert or update or delete on public.commitments
  for each row execute function public.audit_row_change();
create trigger customer_facts_audit
  after insert or update or delete on public.customer_facts
  for each row execute function public.audit_row_change();
create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function public.audit_row_change();
create trigger integration_accounts_audit
  after insert or update or delete on public.integration_accounts
  for each row execute function public.audit_row_change();

-- Trigger functions are not RPC endpoints.
revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.forbid_event_mutation() from public, anon, authenticated;
revoke execute on function public.ensure_org_keeps_owner() from public, anon, authenticated;
revoke execute on function public.commitments_track_completion() from public, anon, authenticated;
revoke execute on function public.contact_policies_track_opt_out() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ───────────── Realtime (live team updates; RLS applies to subscribers) ─────────────

alter publication supabase_realtime add table
  public.commitments,
  public.extractions,
  public.notifications,
  public.conversation_events,
  public.followup_suggestions;
