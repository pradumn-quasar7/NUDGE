-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · message drafts + contact preferences (Phase 5)
--
--   1. ai_stage 'draft'          ai_runs rows written by the draft-message Edge Function
--   2. contact_policies          + preferred_method (whatsapp | call | sms | email),
--                                  opted_out_reason, updated_by_member_id; org/customer
--                                  immutable; audited. Read/insert/update RLS already
--                                  exists (20261007000002: any member who can see the customer).
--   3. message_drafts            AI (or on-device) drafts of outbound messages. A draft is
--                                  never sent by Nudge: the person sends it from their own
--                                  WhatsApp / SMS / mail app, then confirms "Sent it?".
--   4. mark_draft_sent()         that confirmation, atomically: immutable outbound event +
--                                  draft marked sent + linked follow-up suggestion resolved.
--                                  Refused (42501) while the customer is opted out.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────── 1. ai_stage 'draft' ─────────────
-- Not used anywhere in this migration: a value added by ALTER TYPE … ADD VALUE can't
-- be used in the transaction that adds it.
alter type public.ai_stage add value if not exists 'draft';

-- ───────────── 2. contact_policies ─────────────
-- preferred_channel (public.channel) stays the column the scheduler reads. The app
-- picks a *method*, which includes SMS (not a channel of its own: it is the phone
-- number), so preferred_method is stored too and preferred_channel is derived from it:
--   whatsapp → whatsapp · call → phone · sms → phone · email → email

alter table public.contact_policies
  add column if not exists preferred_method text
    check (preferred_method is null or preferred_method in ('whatsapp', 'call', 'sms', 'email')),
  add column if not exists opted_out_reason text
    check (opted_out_reason is null or char_length(opted_out_reason) <= 280),
  add column if not exists updated_by_member_id uuid;

do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_policies_updated_by_fk') then
    alter table public.contact_policies
      add constraint contact_policies_updated_by_fk foreign key (org_id, updated_by_member_id)
        references public.organization_members (org_id, id) on delete set null (updated_by_member_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_policies_notes_length') then
    alter table public.contact_policies
      add constraint contact_policies_notes_length check (notes is null or char_length(notes) <= 500);
  end if;
end
$fk$;

update public.contact_policies
   set preferred_method = case preferred_channel
                            when 'whatsapp' then 'whatsapp'
                            when 'phone' then 'call'
                            when 'email' then 'email'
                          end
 where preferred_method is null and preferred_channel is not null;

create or replace function public.contact_policies_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.org_id is distinct from old.org_id or new.customer_id is distinct from old.customer_id) then
    raise exception 'A contact policy belongs to its customer' using errcode = 'check_violation';
  end if;

  -- Keep the method and the scheduler's channel in step, whichever one was written.
  if tg_op = 'INSERT' and new.preferred_method is not null
     or tg_op = 'UPDATE' and new.preferred_method is distinct from old.preferred_method then
    new.preferred_channel := case new.preferred_method
                               when 'whatsapp' then 'whatsapp'::public.channel
                               when 'call' then 'phone'::public.channel
                               when 'sms' then 'phone'::public.channel
                               when 'email' then 'email'::public.channel
                             end;
  elsif tg_op = 'INSERT' and new.preferred_channel is not null
     or tg_op = 'UPDATE' and new.preferred_channel is distinct from old.preferred_channel then
    new.preferred_method := case new.preferred_channel
                              when 'whatsapp' then 'whatsapp'
                              when 'phone' then 'call'
                              when 'email' then 'email'
                            end;
  end if;

  if not new.opted_out then
    new.opted_out_reason := null;
  else
    new.opted_out_reason := nullif(btrim(new.opted_out_reason), '');
  end if;

  -- Who changed it last: the signed-in member (never client-supplied).
  if auth.uid() is not null then
    new.updated_by_member_id := public.current_member_id(new.org_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.contact_policies_stamp() from public, anon, authenticated;

drop trigger if exists contact_policies_stamp on public.contact_policies;
create trigger contact_policies_stamp
  before insert or update on public.contact_policies
  for each row execute function public.contact_policies_stamp();

-- Opt-outs are consent records: keep who changed what, when.
drop trigger if exists contact_policies_audit on public.contact_policies;
create trigger contact_policies_audit
  after insert or update or delete on public.contact_policies
  for each row execute function public.audit_row_change();

-- Privileges: members read/insert/update (RLS: can_see_customer); anon nothing.
-- org_id / customer_id stay grantable on UPDATE because PostgREST upserts
-- (ON CONFLICT DO UPDATE SET <every payload column>) write them back unchanged;
-- the trigger above refuses an actual change.
revoke all on public.contact_policies from anon;

-- ───────────── 3. message_drafts ─────────────

do $uk$
begin
  if not exists (select 1 from pg_constraint where conname = 'followup_suggestions_org_id_id_key') then
    alter table public.followup_suggestions
      add constraint followup_suggestions_org_id_id_key unique (org_id, id);
  end if;
end
$uk$;

create table public.message_drafts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  customer_id           uuid not null,
  commitment_id         uuid,
  suggestion_id         uuid,
  intent                text not null default 'reply'
                          check (intent in ('reply', 'quote_follow_up', 'payment_reminder', 'check_in', 'custom')),
  channel               text not null check (channel in ('whatsapp', 'sms', 'email')),
  subject               text check (subject is null or char_length(subject) <= 200),
  body                  text not null check (char_length(btrim(body)) between 1 and 4000),
  language              text check (language is null or char_length(language) <= 40),
  status                text not null default 'draft' check (status in ('draft', 'sent', 'discarded')),
  -- 'ai' = draft-message Edge Function (service role); 'device' = written by the app itself.
  source                text not null default 'ai' check (source in ('ai', 'device')),
  -- Events the draft was based on (shown as "Based on Rahul's message on Mon, 6:42 pm").
  evidence_event_ids    uuid[] not null default '{}',
  send_hint             text check (send_hint is null or char_length(send_hint) <= 200),
  created_by_member_id  uuid,
  ai_run_id             uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  sent_at               timestamptz,
  sent_by_member_id     uuid,
  sent_event_id         uuid,
  discarded_at          timestamptz,
  constraint message_drafts_org_id_id_key unique (org_id, id),
  constraint message_drafts_customer_fk foreign key (org_id, customer_id)
    references public.customers (org_id, id) on delete cascade,
  constraint message_drafts_commitment_fk foreign key (org_id, commitment_id)
    references public.commitments (org_id, id) on delete set null (commitment_id),
  constraint message_drafts_suggestion_fk foreign key (org_id, suggestion_id)
    references public.followup_suggestions (org_id, id) on delete set null (suggestion_id),
  constraint message_drafts_created_by_fk foreign key (org_id, created_by_member_id)
    references public.organization_members (org_id, id) on delete set null (created_by_member_id),
  constraint message_drafts_sent_by_fk foreign key (org_id, sent_by_member_id)
    references public.organization_members (org_id, id) on delete set null (sent_by_member_id),
  constraint message_drafts_ai_run_fk foreign key (org_id, ai_run_id)
    references public.ai_runs (org_id, id) on delete set null (ai_run_id),
  constraint message_drafts_sent_event_fk foreign key (org_id, sent_event_id)
    references public.conversation_events (org_id, id) on delete set null (sent_event_id),
  -- Not tied to sent_event_id: a purge may null it before the cascade removes the draft.
  constraint message_drafts_sent_has_sent_at check (status <> 'sent' or sent_at is not null)
);

create index message_drafts_customer_idx on public.message_drafts (org_id, customer_id, created_at desc);
create index message_drafts_creator_recent_idx on public.message_drafts (created_by_member_id, created_at desc);
create unique index message_drafts_sent_event_key on public.message_drafts (sent_event_id) where sent_event_id is not null;

create trigger message_drafts_set_updated_at before update on public.message_drafts
  for each row execute function public.set_updated_at();

-- Integrity for every writer:
--   insert: status 'draft'; the promise / suggestion belong to the same customer; client
--           inserts are authored by the caller and marked source 'device'
--   update: draft → sent (needs an outbound event of this customer by the caller) |
--           draft → discarded; sent and discarded drafts don't change any more
create or replace function public.message_drafts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New drafts start as draft' using errcode = 'check_violation';
    end if;
    new.sent_at := null;
    new.sent_by_member_id := null;
    new.sent_event_id := null;
    new.discarded_at := null;
    if auth.uid() is not null then
      new.created_by_member_id := public.current_member_id(new.org_id);
      new.source := 'device';
      new.ai_run_id := null;
    end if;
    if new.commitment_id is not null and not exists (
      select 1 from public.commitments c
      where c.org_id = new.org_id and c.id = new.commitment_id and c.customer_id = new.customer_id
    ) then
      raise exception 'commitment_id belongs to another customer' using errcode = 'check_violation';
    end if;
    if new.suggestion_id is not null and not exists (
      select 1 from public.followup_suggestions s
      where s.org_id = new.org_id and s.id = new.suggestion_id and s.customer_id = new.customer_id
    ) then
      raise exception 'suggestion_id belongs to another customer' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.org_id is distinct from old.org_id or new.customer_id is distinct from old.customer_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A draft belongs to its customer' using errcode = 'check_violation';
  end if;

  if old.status in ('sent', 'discarded') then
    if new.status is distinct from old.status
       or new.body is distinct from old.body
       or new.channel is distinct from old.channel
       or new.subject is distinct from old.subject
       or (new.sent_event_id is not null and new.sent_event_id is distinct from old.sent_event_id) then
      raise exception 'This draft was already %', old.status using errcode = 'check_violation';
    end if;
    return new; -- e.g. ON DELETE SET NULL of a linked row
  end if;

  -- old.status = 'draft'
  if new.status = 'sent' then
    v_member := coalesce(public.current_member_id(new.org_id), new.sent_by_member_id);
    if new.sent_event_id is null or not exists (
      select 1 from public.conversation_events e
      where e.org_id = new.org_id
        and e.id = new.sent_event_id
        and e.customer_id = new.customer_id
        and e.direction = 'out'
        and (auth.uid() is null or e.author_member_id = v_member)
    ) then
      raise exception 'A sent draft needs the outbound message you recorded' using errcode = 'check_violation';
    end if;
    new.sent_at := now();
    new.sent_by_member_id := v_member;
  elsif new.status = 'discarded' then
    if new.sent_event_id is not null then
      raise exception 'A discarded draft has no sent message' using errcode = 'check_violation';
    end if;
    new.discarded_at := now();
  else
    if new.sent_event_id is not null then
      raise exception 'Use mark_draft_sent() to record the message' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.message_drafts_guard() from public, anon, authenticated;

create trigger message_drafts_guard
  before insert or update on public.message_drafts
  for each row execute function public.message_drafts_guard();

alter table public.message_drafts enable row level security;

create policy "drafts: read" on public.message_drafts
  for select to authenticated using (public.can_see_customer(customer_id));
create policy "drafts: create" on public.message_drafts
  for insert to authenticated
  with check (
    public.can_see_customer(customer_id)
    and created_by_member_id is not null
    and created_by_member_id = public.current_member_id(org_id)
  );
create policy "drafts: update" on public.message_drafts
  for update to authenticated
  using (public.can_see_customer(customer_id)) with check (public.can_see_customer(customer_id));
-- No delete policy: a draft row is part of the AI audit trail (purge_customer() cascades).

revoke all on public.message_drafts from anon, authenticated;
grant select on public.message_drafts to authenticated;
grant insert (org_id, customer_id, commitment_id, suggestion_id, intent, channel, subject, body, language, evidence_event_ids, send_hint)
  on public.message_drafts to authenticated;
grant update (channel, subject, body, status, sent_event_id) on public.message_drafts to authenticated;
grant all on public.message_drafts to service_role;

-- ───────────── 4. mark_draft_sent ─────────────
-- The person sent the draft from their own app and tapped "Yes, sent". In one
-- transaction, as the caller (RLS applies to every statement):
--   * an immutable outbound conversation_event authored by the caller (the timeline proof),
--     idempotency key 'draft:<id>' so a double tap records it once
--   * the draft → 'sent' with the final channel / text and sent_event_id
--   * the linked follow-up suggestion → resolved
-- Refused with 42501 while the customer's contact policy says opted_out.
-- Returns { event_id, draft_id, suggestion_resolved, already_sent }.

create or replace function public.mark_draft_sent(draft_id uuid, channel text default null, final_body text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  d            public.message_drafts%rowtype;
  v_member     uuid;
  v_name       text;
  v_channel    text;
  v_body       text;
  v_title      text;
  v_event      uuid;
  v_resolved   integer := 0;
begin
  select * into d from public.message_drafts m where m.id = mark_draft_sent.draft_id for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'no_data_found';
  end if;
  if d.status = 'sent' then
    return jsonb_build_object('event_id', d.sent_event_id, 'draft_id', d.id, 'suggestion_resolved', false, 'already_sent', true);
  end if;
  if d.status = 'discarded' then
    raise exception 'This draft was discarded' using errcode = 'check_violation';
  end if;

  v_member := public.current_member_id(d.org_id);
  if v_member is null then
    raise exception 'Not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.contact_policies cp
    where cp.org_id = d.org_id and cp.customer_id = d.customer_id and cp.opted_out
  ) then
    select c.name into v_name from public.customers c where c.id = d.customer_id;
    raise exception '% asked not to be contacted. Turn off “Do not contact” in their contact preferences first.',
      coalesce(split_part(btrim(v_name), ' ', 1), 'This customer')
      using errcode = 'insufficient_privilege';
  end if;

  v_channel := lower(btrim(coalesce(nullif(btrim(mark_draft_sent.channel), ''), d.channel)));
  if v_channel not in ('whatsapp', 'sms', 'email') then
    raise exception 'channel must be whatsapp, sms or email' using errcode = 'invalid_parameter_value';
  end if;
  v_body := btrim(coalesce(mark_draft_sent.final_body, d.body));
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'The message must be 1–4000 characters' using errcode = 'invalid_parameter_value';
  end if;

  v_title := case d.intent
               when 'quote_follow_up'  then 'You sent a quotation follow-up'
               when 'payment_reminder' then 'You sent a payment reminder'
               when 'check_in'         then 'You checked in'
               when 'reply'            then 'You replied'
               else 'You sent a message'
             end;

  insert into public.conversation_events (
    org_id, customer_id, kind, channel, direction, title, body, author_member_id, raw, idempotency_key
  )
  values (
    d.org_id, d.customer_id, 'message',
    case v_channel when 'whatsapp' then 'whatsapp'::public.channel
                   when 'email' then 'email'::public.channel
                   else 'phone'::public.channel end,
    'out', v_title, v_body, v_member,
    jsonb_build_object('source', 'draft', 'draft_id', d.id, 'via', v_channel, 'subject', d.subject, 'draft_source', d.source),
    'draft:' || d.id::text
  )
  returning id into v_event;

  update public.message_drafts m
     set status = 'sent',
         channel = v_channel,
         body = v_body,
         sent_event_id = v_event
   where m.id = d.id;

  if d.suggestion_id is not null then
    update public.followup_suggestions s
       set bucket = 'done', resolved_at = now()
     where s.id = d.suggestion_id and s.resolved_at is null;
    get diagnostics v_resolved = row_count;
  end if;

  return jsonb_build_object('event_id', v_event, 'draft_id', d.id, 'suggestion_resolved', v_resolved > 0, 'already_sent', false);
end;
$$;

revoke execute on function public.mark_draft_sent(uuid, text, text) from public, anon;
grant execute on function public.mark_draft_sent(uuid, text, text) to authenticated;
