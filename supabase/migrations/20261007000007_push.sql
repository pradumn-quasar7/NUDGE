-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · push notifications (Expo push tokens)
--
--   1. push_tokens              one row per device (Expo push token), owned by
--                               the signed-in user, tied to one active membership
--   2. register_push_token()    upsert / re-enable / move a token to the caller
--      unregister_push_token()  forget this device (call before signing out)
--   3. push-dispatch trigger    AFTER INSERT on notifications → pg_net call to the
--                               push-dispatch Edge Function (never blocks or fails
--                               the insert; same fail-safe as migration 5)
--
-- Delivery rules (workspace notification setting, visibility, quiet hours) live
-- in supabase/functions/push-dispatch. Nothing here sends anything by itself.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── 1. push_tokens ─────────────

create table public.push_tokens (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  member_id        uuid not null,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Expo push token: ExponentPushToken[…] (older/newer SDKs also use ExpoPushToken[…]).
  token            text not null unique
                     check (char_length(token) <= 255 and token ~ '^Expo(nent)?PushToken\[[^][:space:]]+\]$'),
  platform         text not null check (platform in ('ios', 'android')),
  device_name      text check (device_name is null or char_length(device_name) <= 120),
  -- The app on this device schedules its own local "due soon" reminders, so
  -- push-dispatch does not push the server's "due soon" promise_due as well.
  local_reminders  boolean not null default false,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  disabled_at      timestamptz,
  disabled_reason  text check (disabled_reason is null or char_length(disabled_reason) <= 120),
  constraint push_tokens_member_fk foreign key (org_id, member_id)
    references public.organization_members (org_id, id) on delete cascade
);

create index push_tokens_member_idx on public.push_tokens (org_id, member_id) where disabled_at is null;
create index push_tokens_user_idx on public.push_tokens (user_id);

-- member_id must be user_id's ACTIVE membership in org_id — for every writer,
-- including SECURITY DEFINER code and the service role. Checked when the row is
-- created or re-pointed; a later status change of the membership does not block
-- push-dispatch from disabling the token.
create or replace function public.push_tokens_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.org_id is distinct from old.org_id
     or new.member_id is distinct from old.member_id
     or new.user_id is distinct from old.user_id then
    if not exists (
      select 1 from public.organization_members m
      where m.org_id = new.org_id
        and m.id = new.member_id
        and m.user_id = new.user_id
        and m.status = 'active'
    ) then
      raise exception 'Push token must belong to your active membership' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.push_tokens_validate() from public, anon, authenticated;

create trigger push_tokens_validate
  before insert or update on public.push_tokens
  for each row execute function public.push_tokens_validate();

alter table public.push_tokens enable row level security;

-- Own rows only, in workspaces where the caller is an active member.
create policy "push tokens: read own" on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "push tokens: add own" on public.push_tokens
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and member_id = public.current_member_id(org_id)
  );

create policy "push tokens: update own" on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id))
  with check (
    user_id = (select auth.uid())
    and member_id = public.current_member_id(org_id)
  );

-- Removing your own device is always allowed (even after leaving a workspace).
create policy "push tokens: delete own" on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
-- user_id is never client-writable: it defaults to auth.uid().
grant insert (org_id, member_id, token, platform, device_name, local_reminders) on public.push_tokens to authenticated;
grant update (platform, device_name, local_reminders, last_seen_at) on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

-- ───────────── 2. register / unregister RPCs ─────────────
-- SECURITY DEFINER because a device that changes hands (sign out, sign in as
-- someone else) must take over a row RLS hides from the new user. Everything is
-- scoped to auth.uid() and the caller's own active membership.

create or replace function public.register_push_token(
  org_id          uuid,
  token           text,
  platform        text,
  device_name     text default null,
  local_reminders boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_member uuid;
  v_token  text := btrim(coalesce(register_push_token.token, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if v_token !~ '^Expo(nent)?PushToken\[[^][:space:]]+\]$' or char_length(v_token) > 255 then
    raise exception 'Not an Expo push token' using errcode = 'invalid_parameter_value';
  end if;
  if register_push_token.platform is null or register_push_token.platform not in ('ios', 'android') then
    raise exception 'platform must be ios or android' using errcode = 'invalid_parameter_value';
  end if;
  v_member := public.current_member_id(register_push_token.org_id);
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_tokens as t (org_id, member_id, user_id, token, platform, device_name, local_reminders)
  values (
    register_push_token.org_id,
    v_member,
    v_uid,
    v_token,
    register_push_token.platform,
    left(nullif(btrim(register_push_token.device_name), ''), 120),
    coalesce(register_push_token.local_reminders, false)
  )
  on conflict on constraint push_tokens_token_key do update
    set org_id          = excluded.org_id,
        member_id       = excluded.member_id,
        user_id         = excluded.user_id,
        platform        = excluded.platform,
        device_name     = excluded.device_name,
        local_reminders = excluded.local_reminders,
        -- a device that changed hands starts a new history
        created_at      = case when t.user_id = excluded.user_id then t.created_at else now() end,
        last_seen_at    = now(),
        disabled_at     = null,
        disabled_reason = null
  returning t.id into v_id;

  return v_id;
end;
$$;

-- Forget this device for the caller. Returns true when a row was removed.
create or replace function public.unregister_push_token(token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  delete from public.push_tokens t
   where t.token = btrim(coalesce(unregister_push_token.token, ''))
     and t.user_id = v_uid;
  return found;
end;
$$;

revoke execute on function public.register_push_token(uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ───────────── 3. notifications → push-dispatch ─────────────
-- Body contract of push-dispatch: POST { "notification_id": uuid }. pg_net sends
-- after COMMIT, so the function always sees the row. Cheap early outs (no
-- request at all): already read for everyone, workspace notifications 'off', or
-- nobody in the workspace has an enabled device. push-dispatch re-checks all of
-- it and applies the remaining rules.

create or replace function public.enqueue_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.read_at is not null then
    return null;
  end if;
  if exists (
    select 1 from public.organizations o
    where o.id = new.org_id and coalesce(o.settings ->> 'notifications', 'needs_you') = 'off'
  ) then
    return null;
  end if;
  if not exists (
    select 1 from public.push_tokens t
    where t.org_id = new.org_id
      and t.disabled_at is null
      and (new.recipient_member_id is null or t.member_id = new.recipient_member_id)
  ) then
    return null;
  end if;
  perform public.invoke_edge_function('push-dispatch', jsonb_build_object('notification_id', new.id), 10000);
  return null;
exception when others then
  return null; -- never block or fail the insert
end;
$$;

revoke execute on function public.enqueue_push_dispatch() from public, anon, authenticated;

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push_dispatch();
