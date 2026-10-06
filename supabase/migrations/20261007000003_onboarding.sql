-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · onboarding: profiles, invite linking, create_organization()
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── Link invited memberships to a confirmed account ─────────────
-- Owners invite by email (organization_members row with user_id null). When a
-- user with that email exists AND the email is confirmed, the row is linked and
-- activated. Unconfirmed emails are never linked (prevents invite hijacking).

create or replace function public.link_member_invites(p_user_id uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_email is null then
    return 0;
  end if;

  update public.organization_members m
     set user_id   = p_user_id,
         status    = 'active',
         joined_at = coalesce(m.joined_at, now())
   where m.user_id is null
     and m.email = lower(p_email)
     -- already a member of that workspace through another row: leave the invite alone
     and not exists (
       select 1 from public.organization_members x
       where x.org_id = m.org_id and x.user_id = p_user_id
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.link_member_invites(uuid, text) from public, anon, authenticated;

-- ───────────── auth.users → profiles ─────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.link_member_invites(new.id, new.email);
  end if;
  return new;
end;
$$;

create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;

  if new.email_confirmed_at is not null
     and (old.email_confirmed_at is null or new.email is distinct from old.email) then
    perform public.link_member_invites(new.id, new.email);
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_updated() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_updated();

-- ───────────── create_organization(name, sells) ─────────────
-- Creates the workspace and the caller's owner membership atomically.
-- Returns the new organization id.

create or replace function public.create_organization(name text, sells text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_email       text;
  v_member_name text;
  v_org         uuid;
  v_owned       integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if create_organization.name is null or char_length(btrim(create_organization.name)) = 0 then
    raise exception 'Workspace name is required' using errcode = 'invalid_parameter_value';
  end if;

  -- Abuse guard: a person rarely runs more than a handful of businesses.
  select count(*) into v_owned
  from public.organization_members m
  where m.user_id = v_uid and m.role = 'owner';
  if v_owned >= 5 then
    raise exception 'Workspace limit reached' using errcode = 'check_violation';
  end if;

  select lower(u.email),
         coalesce(nullif(btrim(p.full_name), ''),
                  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                  split_part(u.email, '@', 1))
    into v_email, v_member_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_uid;

  if v_email is null then
    raise exception 'An email address is required to create a workspace' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.organizations (name, sells, created_by)
  values (btrim(create_organization.name), nullif(btrim(create_organization.sells), ''), v_uid)
  returning id into v_org;

  insert into public.organization_members (org_id, user_id, name, email, role, title, status, joined_at)
  values (v_org, v_uid, v_member_name, v_email, 'owner', 'Owner', 'active', now());

  return v_org;
end;
$$;

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
