-- ─────────────────────────────────────────────────────────────────────────────
-- Stand-ins for what a Supabase project provides before our migrations run.
-- Plain Postgres only — no Docker. Just enough surface for supabase/migrations,
-- supabase/seed.sql and PostgREST to behave like the hosted stack:
--   roles (anon, authenticated, service_role, authenticator) + default grants
--   auth   : users, uid(), jwt(), role()       (claims from request.jwt.claims)
--   storage: buckets, objects, foldername()
--   extensions schema, supabase_realtime publication
--   vault  : secrets, decrypted_secrets, create_secret()  (NOT encrypted)
--   net    : http_post() that records calls in net.http_calls (sends nothing)
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ───────────── Roles ─────────────
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;

create extension if not exists pgcrypto;

-- ───────────── Schemas + Supabase's default privileges ─────────────
create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ───────────── auth ─────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  aud                 text default 'authenticated',
  role                text default 'authenticated',
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb default '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  last_sign_in_at     timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
grant all on auth.users to service_role;

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ───────────── storage ─────────────
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id          text primary key,
  name        text not null unique,
  public      boolean default false,
  created_at  timestamptz default now()
);

create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to service_role;
grant select, insert, update, delete on storage.objects to authenticated;

create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ───────────── Realtime publication ─────────────
create publication supabase_realtime;

-- ───────────── vault (stub: plaintext, superuser-only) ─────────────
create schema vault;
revoke all on schema vault from public;

create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
  from vault.secrets;

create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid
language sql
as $$
  insert into vault.secrets (name, description, secret)
  values (new_name, coalesce(new_description, ''), new_secret)
  returning id
$$;

-- ───────────── pg_net (stub: records instead of sending) ─────────────
create schema net;
revoke all on schema net from public;

create table net.http_calls (
  id                    bigserial primary key,
  method                text not null,
  url                   text not null,
  headers               jsonb,
  body                  jsonb,
  params                jsonb,
  timeout_milliseconds  integer,
  created_at            timestamptz not null default clock_timestamp()
);

-- Same signature as pg_net's net.http_post.
create function net.http_post(
  url                   text,
  body                  jsonb   default '{}'::jsonb,
  params                jsonb   default '{}'::jsonb,
  headers               jsonb   default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds  integer default 5000
)
returns bigint
language sql
as $$
  insert into net.http_calls (method, url, headers, body, params, timeout_milliseconds)
  values ('POST', url, headers, body, params, timeout_milliseconds)
  returning id
$$;
