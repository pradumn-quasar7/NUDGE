-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · core schema
--
-- Maps onto app/src/data/types.ts (snake_case here, camelCase in the app).
-- Principles enforced at the database level:
--   * Every business object belongs to an organization (org_id NOT NULL).
--   * Child rows reference parents through composite (org_id, id) foreign keys,
--     so a row can never point at another tenant's data, even via the service role.
--   * conversation_events are immutable raw history. AI outputs (facts,
--     commitments, extractions, annotations) live in separate tables and always
--     point back to their source event, so they can be reprocessed.
-- RLS lives in 20261007000002_rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── Enums ─────────────

create type public.channel as enum ('whatsapp', 'phone', 'email', 'instagram', 'manual', 'upi');
create type public.member_role as enum ('owner', 'member');
create type public.member_status as enum ('active', 'invited');
create type public.event_kind as enum ('message', 'call', 'email', 'quote', 'payment', 'note', 'task', 'promise', 'followup');
create type public.event_direction as enum ('in', 'out', 'internal');
create type public.fact_kind as enum ('preference', 'temporal', 'note');
create type public.commitment_status as enum ('open', 'done', 'snoozed', 'dismissed');
create type public.promisor as enum ('us', 'customer');
create type public.extraction_status as enum ('pending', 'confirmed', 'ignored');
create type public.notification_kind as enum ('customer', 'promise_due', 'ai_commitments', 'payment', 'task');
create type public.integration_provider as enum ('whatsapp', 'gmail', 'calls', 'calendar', 'instagram', 'payments');
create type public.integration_status as enum ('connected', 'paused', 'available');
create type public.task_status as enum ('open', 'done');
create type public.suggestion_bucket as enum ('needs_reply', 'waiting', 'promises', 'done');
create type public.ai_stage as enum ('extraction', 'copilot', 'summary', 'followup');
create type public.ai_run_status as enum ('running', 'succeeded', 'failed', 'rejected', 'skipped');

-- ───────────── Shared trigger functions ─────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────── profiles (1:1 with auth.users) ─────────────

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────── organizations ─────────────

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  sells       text check (sells is null or char_length(sells) <= 280),
  handles     text[] not null default '{}',
  channels    public.channel[] not null default '{}',
  plan        text not null default 'free' check (plan in ('free', 'pro')),
  timezone    text not null default 'Asia/Kolkata',
  -- Workspace settings (Settings type in the app). Read by RLS helpers:
  --   share_all_customers  false → members only see customers they own
  --   members_can_delete   false → only owners may delete history
  settings    jsonb not null default jsonb_build_object(
                'share_all_customers', true,
                'hand_off_when_away', true,
                'members_can_delete', false,
                'notifications', 'needs_you'
              ) check (jsonb_typeof(settings) = 'object'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- ───────────── organization_members ─────────────
-- A member row exists before the person has an account (status = 'invited',
-- user_id null). It is linked to auth.users when that email signs up and is
-- confirmed (see 20261007000003_onboarding.sql).

create table public.organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  name        text not null,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        public.member_role not null default 'member',
  title       text,
  status      public.member_status not null default 'invited',
  invited_by  uuid references auth.users (id) on delete set null,
  invited_at  timestamptz,
  joined_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint organization_members_org_id_id_key unique (org_id, id)
);

create unique index organization_members_org_user_key on public.organization_members (org_id, user_id) where user_id is not null;
create unique index organization_members_org_email_key on public.organization_members (org_id, email);
create index organization_members_user_id_idx on public.organization_members (user_id) where user_id is not null;

create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- An organization must always keep at least one active owner.
create or replace function public.ensure_org_keeps_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;
  -- Cascaded delete of the whole organization: nothing to protect.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.org_id = old.org_id and m.id <> old.id and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'An organization must keep at least one active owner'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_keep_owner
  before update of role, status or delete on public.organization_members
  for each row execute function public.ensure_org_keeps_owner();

-- ───────────── customers ─────────────

create table public.customers (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  name                    text not null check (char_length(btrim(name)) between 1 and 200),
  company                 text,
  phone                   text,
  email                   text,
  preferred_channel       public.channel not null default 'whatsapp',
  customer_since          timestamptz not null default now(),
  lifetime_value          numeric(14, 2) not null default 0 check (lifetime_value >= 0),
  -- AI briefing ("What matters"). Regenerated from events; never hand-edited.
  summary                 text,
  summary_message_count   integer check (summary_message_count >= 0),
  summary_call_count      integer check (summary_call_count >= 0),
  summary_updated_at      timestamptz,
  headline                text not null default 'New customer',
  source                  text,
  owner_member_id         uuid,
  archived_at             timestamptz,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint customers_org_id_id_key unique (org_id, id),
  constraint customers_owner_fk foreign key (org_id, owner_member_id)
    references public.organization_members (org_id, id) on delete set null (owner_member_id)
);

create index customers_org_owner_idx on public.customers (org_id, owner_member_id);
create index customers_org_active_name_idx on public.customers (org_id, lower(name)) where archived_at is null;

create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ───────────── customer_identities (identity resolution) ─────────────
-- external_id is normalised by the writer: phone/whatsapp → E.164 digits without '+',
-- email → lower-case, instagram → IGSID.

create table public.customer_identities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  customer_id   uuid not null,
  channel       public.channel not null,
  external_id   text not null check (char_length(external_id) between 1 and 320),
  display_name  text,
  verified      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint customer_identities_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint customer_identities_external_key unique (org_id, channel, external_id)
);

create index customer_identities_customer_idx on public.customer_identities (org_id, customer_id);

create trigger customer_identities_set_updated_at before update on public.customer_identities
  for each row execute function public.set_updated_at();

-- ───────────── conversations (threads per channel) ─────────────

create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  customer_id         uuid not null,
  channel             public.channel not null,
  external_thread_id  text,
  subject             text,
  last_event_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint conversations_org_id_id_key unique (org_id, id),
  constraint conversations_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint conversations_external_key unique (org_id, channel, external_thread_id)
);

create index conversations_customer_idx on public.conversations (org_id, customer_id, last_event_at desc);

create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ───────────── conversation_events (IMMUTABLE raw history) ─────────────

create table public.conversation_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  customer_id       uuid not null,
  conversation_id   uuid,
  kind              public.event_kind not null,
  channel           public.channel not null,
  direction         public.event_direction not null,
  occurred_at       timestamptz not null default now(),
  title             text not null check (char_length(title) <= 300),
  body              text,
  amount            numeric(14, 2),
  ref               text,
  author_member_id  uuid,
  raw               jsonb,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  constraint conversation_events_org_id_id_key unique (org_id, id),
  constraint conversation_events_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint conversation_events_conversation_fk foreign key (org_id, conversation_id)
    references public.conversations (org_id, id) on delete set null (conversation_id),
  constraint conversation_events_author_fk foreign key (org_id, author_member_id)
    references public.organization_members (org_id, id) on delete set null (author_member_id),
  constraint conversation_events_idempotency_key unique (org_id, idempotency_key)
);

create index conversation_events_customer_timeline_idx
  on public.conversation_events (org_id, customer_id, occurred_at desc);
create index conversation_events_org_recent_idx
  on public.conversation_events (org_id, occurred_at desc);
create index conversation_events_conversation_idx
  on public.conversation_events (conversation_id) where conversation_id is not null;

-- Raw events never change. The only way to remove them is the audited
-- purge_customer() RPC (right-to-erasure), which sets nudge.allow_event_purge
-- for the duration of its own transaction.
create or replace function public.forbid_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('nudge.allow_event_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'conversation_events are immutable: % is not allowed', tg_op
    using errcode = 'insufficient_privilege',
          hint = 'Store AI output in customer_facts / commitments / extractions / event_annotations instead.';
end;
$$;

create trigger conversation_events_immutable
  before update or delete on public.conversation_events
  for each row execute function public.forbid_event_mutation();

create trigger conversation_events_no_truncate
  before truncate on public.conversation_events
  for each statement execute function public.forbid_event_mutation();

-- ───────────── event_annotations (AI output attached to an event) ─────────────
-- e.g. the one-line call takeaway shown in indigo (CustomerEvent.aiNote) or an
-- AI-written short title. Separate from the raw event so it can be regenerated.

create table public.event_annotations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  event_id        uuid not null,
  customer_id     uuid not null,
  kind            text not null check (kind in ('ai_note', 'ai_title')),
  text            text not null check (char_length(text) <= 500),
  ai_run_id       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_annotations_event_fk foreign key (org_id, event_id)
    references public.conversation_events (org_id, id) on delete cascade,
  constraint event_annotations_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint event_annotations_event_kind_key unique (event_id, kind)
);

create index event_annotations_customer_idx on public.event_annotations (org_id, customer_id);

create trigger event_annotations_set_updated_at before update on public.event_annotations
  for each row execute function public.set_updated_at();

-- ───────────── ai_runs (every model call, for audit + reprocessing) ─────────────

create table public.ai_runs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  stage               public.ai_stage not null,
  model               text not null,
  prompt_version      text not null,
  input_event_ids     uuid[] not null default '{}',
  output              jsonb,
  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,
  latency_ms          integer,
  status              public.ai_run_status not null default 'running',
  error               text,
  created_at          timestamptz not null default now(),
  finished_at         timestamptz,
  constraint ai_runs_org_id_id_key unique (org_id, id)
);

create index ai_runs_org_created_idx on public.ai_runs (org_id, created_at desc);
create index ai_runs_input_events_idx on public.ai_runs using gin (input_event_ids);

alter table public.event_annotations
  add constraint event_annotations_ai_run_fk foreign key (org_id, ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (ai_run_id);

-- ───────────── customer_facts (Customer Memory) ─────────────

create table public.customer_facts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  customer_id           uuid not null,
  kind                  public.fact_kind not null,
  text                  text not null check (char_length(btrim(text)) between 1 and 500),
  valid_until           timestamptz,
  source_event_id       uuid,
  confidence            numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  superseded_by         uuid,
  created_by_ai_run_id  uuid,
  created_by_member_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint customer_facts_org_id_id_key unique (org_id, id),
  constraint customer_facts_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint customer_facts_source_event_fk foreign key (org_id, source_event_id)
    references public.conversation_events (org_id, id) on delete set null (source_event_id),
  constraint customer_facts_superseded_by_fk foreign key (org_id, superseded_by)
    references public.customer_facts (org_id, id) on delete set null (superseded_by),
  constraint customer_facts_ai_run_fk foreign key (org_id, created_by_ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (created_by_ai_run_id),
  constraint customer_facts_member_fk foreign key (org_id, created_by_member_id)
    references public.organization_members (org_id, id) on delete set null (created_by_member_id),
  constraint customer_facts_not_self_superseded check (superseded_by is null or superseded_by <> id)
);

create index customer_facts_current_idx on public.customer_facts (org_id, customer_id) where superseded_by is null;
create index customer_facts_source_event_idx on public.customer_facts (source_event_id) where source_event_id is not null;

create trigger customer_facts_set_updated_at before update on public.customer_facts
  for each row execute function public.set_updated_at();

-- ───────────── extractions (AI proposals awaiting human confirmation) ─────────────
-- Product principle: nothing becomes a commitment until a person confirms it.

create table public.extractions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  customer_id         uuid not null,
  source_event_id     uuid,
  source_label        text not null default '',
  title               text not null check (char_length(btrim(title)) between 1 and 300),
  due_at              timestamptz,
  -- ExtractionField[]: [{ key, label, value, checked }]
  fields              jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  promisor            public.promisor not null default 'us',
  quote               text,
  quote_by            text,
  confidence          numeric(4, 3) not null default 0.5 check (confidence between 0 and 1),
  status              public.extraction_status not null default 'pending',
  ai_run_id           uuid,
  dedupe_key          text,
  commitment_id       uuid,
  decided_by_member_id uuid,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint extractions_org_id_id_key unique (org_id, id),
  constraint extractions_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint extractions_source_event_fk foreign key (org_id, source_event_id)
    references public.conversation_events (org_id, id) on delete set null (source_event_id),
  constraint extractions_ai_run_fk foreign key (org_id, ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (ai_run_id),
  constraint extractions_decided_by_fk foreign key (org_id, decided_by_member_id)
    references public.organization_members (org_id, id) on delete set null (decided_by_member_id),
  constraint extractions_dedupe_key unique (org_id, dedupe_key)
);

create index extractions_org_status_idx on public.extractions (org_id, status, created_at desc);
create index extractions_customer_idx on public.extractions (org_id, customer_id);

create trigger extractions_set_updated_at before update on public.extractions
  for each row execute function public.set_updated_at();

-- ───────────── commitments (Promise Radar) ─────────────

create table public.commitments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  customer_id           uuid not null,
  title                 text not null check (char_length(btrim(title)) between 1 and 300),
  owner_member_id       uuid,
  due_at                timestamptz not null,
  status                public.commitment_status not null default 'open',
  promisor              public.promisor not null default 'us',
  source_event_id       uuid,
  -- Exact words, kept as proof.
  quote                 text,
  quote_by              text,
  confidence            numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  completed_at          timestamptz,
  snoozed_until         timestamptz,
  draft_hint            text,
  extraction_id         uuid,
  created_by_member_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint commitments_org_id_id_key unique (org_id, id),
  constraint commitments_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint commitments_owner_fk foreign key (org_id, owner_member_id)
    references public.organization_members (org_id, id) on delete set null (owner_member_id),
  constraint commitments_source_event_fk foreign key (org_id, source_event_id)
    references public.conversation_events (org_id, id) on delete set null (source_event_id),
  constraint commitments_extraction_fk foreign key (org_id, extraction_id)
    references public.extractions (org_id, id) on delete set null (extraction_id),
  constraint commitments_created_by_fk foreign key (org_id, created_by_member_id)
    references public.organization_members (org_id, id) on delete set null (created_by_member_id),
  constraint commitments_done_has_completed_at check (status <> 'done' or completed_at is not null)
);

create index commitments_org_status_due_idx on public.commitments (org_id, status, due_at);
create index commitments_customer_idx on public.commitments (org_id, customer_id);
create index commitments_owner_idx on public.commitments (org_id, owner_member_id, status);
create unique index commitments_extraction_key on public.commitments (extraction_id) where extraction_id is not null;

alter table public.extractions
  add constraint extractions_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete set null (commitment_id);

create trigger commitments_set_updated_at before update on public.commitments
  for each row execute function public.set_updated_at();

-- Keep completed_at consistent with status (so clients only need to flip status).
create or replace function public.commitments_track_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger commitments_track_completion
  before insert or update of status, completed_at on public.commitments
  for each row execute function public.commitments_track_completion();

-- ───────────── tasks ─────────────

create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  customer_id           uuid,
  commitment_id         uuid,
  title                 text not null check (char_length(btrim(title)) between 1 and 300),
  notes                 text,
  assignee_member_id    uuid,
  due_at                timestamptz,
  status                public.task_status not null default 'open',
  completed_at          timestamptz,
  created_by_member_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tasks_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint tasks_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete set null (commitment_id),
  constraint tasks_assignee_fk foreign key (org_id, assignee_member_id)
    references public.organization_members (org_id, id) on delete set null (assignee_member_id),
  constraint tasks_created_by_fk foreign key (org_id, created_by_member_id)
    references public.organization_members (org_id, id) on delete set null (created_by_member_id)
);

create index tasks_org_status_due_idx on public.tasks (org_id, status, due_at);
create index tasks_customer_idx on public.tasks (org_id, customer_id) where customer_id is not null;

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ───────────── notifications ─────────────

create table public.notifications (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  -- null = everyone in the workspace
  recipient_member_id   uuid,
  kind                  public.notification_kind not null,
  customer_id           uuid,
  commitment_id         uuid,
  -- Rich title: [{ t: string, b?: boolean }]
  title                 jsonb not null check (jsonb_typeof(title) = 'array'),
  meta                  text not null default '',
  -- [{ label, primary?, route? }]
  actions               jsonb check (actions is null or jsonb_typeof(actions) = 'array'),
  dedupe_key            text,
  read_at               timestamptz,
  created_at            timestamptz not null default now(),
  constraint notifications_recipient_fk foreign key (org_id, recipient_member_id)
    references public.organization_members (org_id, id) on delete cascade,
  constraint notifications_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint notifications_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete cascade,
  constraint notifications_dedupe_key unique (org_id, dedupe_key)
);

create index notifications_feed_idx on public.notifications (org_id, recipient_member_id, created_at desc);

-- ───────────── followup_suggestions (Follow-up inbox, InboxItem) ─────────────
-- Created by the followup-scheduler / AI. Suggestions only: nothing is ever sent
-- to a customer without an explicit user action.

create table public.followup_suggestions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  customer_id           uuid not null,
  commitment_id         uuid,
  bucket                public.suggestion_bucket not null,
  what                  text not null,
  why                   text not null,
  why_tone              text not null default 'neutral' check (why_tone in ('warn', 'acc', 'neutral')),
  why_ai                boolean not null default false,
  amount                numeric(14, 2),
  action_label          text not null,
  action_variant        text not null default 'secondary' check (action_variant in ('primary', 'tonal', 'secondary')),
  -- Earliest moment the contact policy allows reaching out (quiet hours etc.).
  suggested_send_at     timestamptz,
  policy_flags          text[] not null default '{}',
  at                    timestamptz not null default now(),
  dedupe_key            text,
  resolved_at           timestamptz,
  created_by_ai_run_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint followup_suggestions_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint followup_suggestions_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete cascade,
  constraint followup_suggestions_ai_run_fk foreign key (org_id, created_by_ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (created_by_ai_run_id),
  constraint followup_suggestions_dedupe_key unique (org_id, dedupe_key)
);

create index followup_suggestions_inbox_idx on public.followup_suggestions (org_id, bucket, at desc);
create index followup_suggestions_customer_idx on public.followup_suggestions (org_id, customer_id);

create trigger followup_suggestions_set_updated_at before update on public.followup_suggestions
  for each row execute function public.set_updated_at();

-- ───────────── attachments (files in Storage bucket "attachments") ─────────────
-- storage_path convention: '{org_id}/{customer_id}/{uuid}-{filename}'

create table public.attachments (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  customer_id             uuid,
  event_id                uuid,
  storage_bucket          text not null default 'attachments',
  storage_path            text not null,
  file_name               text,
  mime_type               text,
  size_bytes              bigint check (size_bytes >= 0),
  uploaded_by_member_id   uuid,
  created_at              timestamptz not null default now(),
  constraint attachments_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint attachments_event_fk foreign key (org_id, event_id)
    references public.conversation_events (org_id, id) on delete set null (event_id),
  constraint attachments_uploader_fk foreign key (org_id, uploaded_by_member_id)
    references public.organization_members (org_id, id) on delete set null (uploaded_by_member_id),
  constraint attachments_path_in_org check (split_part(storage_path, '/', 1) = org_id::text),
  constraint attachments_storage_key unique (storage_bucket, storage_path)
);

create index attachments_customer_idx on public.attachments (org_id, customer_id);
create index attachments_event_idx on public.attachments (event_id) where event_id is not null;

-- ───────────── integration_accounts ─────────────
-- Never stores secrets. token_secret_id points at a Supabase Vault secret
-- (vault.secrets.id), readable only by the service role.

create table public.integration_accounts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  provider              public.integration_provider not null,
  name                  text not null,
  status                public.integration_status not null default 'available',
  detail                text not null default '',
  -- Provider-side account id used to route webhooks (WhatsApp: phone_number_id).
  external_account_id   text,
  token_secret_id       uuid,
  metadata              jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  last_sync_at          timestamptz,
  connected_by          uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint integration_accounts_org_provider_key unique (org_id, provider),
  -- One provider account routes to exactly one workspace.
  constraint integration_accounts_external_key unique (provider, external_account_id)
);

create trigger integration_accounts_set_updated_at before update on public.integration_accounts
  for each row execute function public.set_updated_at();

-- ───────────── webhook_events (raw inbound deliveries; service role only) ─────────────

create table public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  -- Delivery id (provider's id, or sha256 of the signed body when none exists).
  external_id       text not null,
  org_id            uuid references public.organizations (id) on delete set null,
  signature_valid   boolean not null,
  payload           jsonb,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  error             text,
  constraint webhook_events_idempotency_key unique (provider, external_id)
);

create index webhook_events_unprocessed_idx on public.webhook_events (received_at) where processed_at is null;

-- ───────────── audit_logs (append-only) ─────────────
-- No FK to organizations: the trail outlives the rows it describes.

create table public.audit_logs (
  id                bigint generated always as identity primary key,
  org_id            uuid,
  actor_user_id     uuid,
  actor_member_id   uuid,
  actor_kind        text not null check (actor_kind in ('user', 'service', 'system')),
  action            text not null check (action in ('insert', 'update', 'delete')),
  entity_type       text not null,
  entity_id         uuid,
  before            jsonb,
  after             jsonb,
  created_at        timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ───────────── contact_policies (Quiet Hours / Contact Policy) ─────────────

create table public.contact_policies (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  customer_id             uuid not null,
  preferred_channel       public.channel,
  -- Window in the customer's local time; null = any time. May wrap midnight.
  preferred_hours_start   time,
  preferred_hours_end     time,
  timezone                text,
  max_messages_per_week   integer check (max_messages_per_week is null or max_messages_per_week >= 0),
  opted_out               boolean not null default false,
  opted_out_at            timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint contact_policies_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint contact_policies_customer_key unique (org_id, customer_id),
  constraint contact_policies_hours_pair check ((preferred_hours_start is null) = (preferred_hours_end is null))
);

create trigger contact_policies_set_updated_at before update on public.contact_policies
  for each row execute function public.set_updated_at();

create or replace function public.contact_policies_track_opt_out()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.opted_out and new.opted_out_at is null then
    new.opted_out_at := now();
  elsif not new.opted_out then
    new.opted_out_at := null;
  end if;
  return new;
end;
$$;

create trigger contact_policies_track_opt_out
  before insert or update of opted_out on public.contact_policies
  for each row execute function public.contact_policies_track_opt_out();
