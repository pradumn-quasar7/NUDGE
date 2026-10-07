-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · Voice notes
--
--   * Private Storage bucket "voice-notes". Object names: '{org_id}/{member_id}/{uuid}.m4a'.
--     A member uploads, reads and deletes only their OWN recordings in a workspace
--     they are an active member of. No updates (recordings are never overwritten).
--     A recording linked to a saved note (public.attachments) can no longer be
--     deleted by the client: notes are history, and history is immutable.
--   * ai_stage 'transcription' for the `transcribe` edge function's ai_runs rows.
--   * save_capture(…, audio_path) links the recording to the note it produced
--     (an attachments row on the new event). Callers that don't pass audio_path
--     behave exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

-- New enum value. Not used anywhere in this migration: a value added by
-- ALTER TYPE … ADD VALUE can't be used in the transaction that adds it.
alter type public.ai_stage add value if not exists 'transcription';

-- ───────────── Bucket ─────────────
-- 15 MiB is ~30 minutes of the app's 64 kbps AAC; the app stops at 3 minutes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 15728640, array['audio/*'])
on conflict (id) do nothing;

-- ───────────── Helpers ─────────────

-- True when '{org}/{member}/{file}' is the caller's own folder in a workspace they
-- are an active member of. Shape is strict: exactly two folders, then a file.
create or replace function public.is_own_voice_note_path(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    array_length(storage.foldername(object_name), 1) = 2
    and public.try_uuid((storage.foldername(object_name))[2])
        = public.current_member_id(public.try_uuid((storage.foldername(object_name))[1])),
    false
  );
$$;

-- Whether a voice-notes object is already attached to a saved note. SECURITY DEFINER
-- so the answer doesn't depend on which customers the caller can see; it reveals
-- nothing beyond "linked or not" for a path the policy has already scoped to the caller.
create or replace function public.voice_note_is_linked(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.storage_bucket = 'voice-notes' and a.storage_path = object_name
  );
$$;

revoke execute on function public.is_own_voice_note_path(text) from public, anon;
revoke execute on function public.voice_note_is_linked(text) from public, anon;
grant execute on function public.is_own_voice_note_path(text) to authenticated;
grant execute on function public.voice_note_is_linked(text) to authenticated;

-- ───────────── storage.objects policies ─────────────

drop policy if exists "voice notes: upload own" on storage.objects;
create policy "voice notes: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'voice-notes' and public.is_own_voice_note_path(name));

drop policy if exists "voice notes: read own" on storage.objects;
create policy "voice notes: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'voice-notes' and public.is_own_voice_note_path(name));

drop policy if exists "voice notes: delete own unsaved" on storage.objects;
create policy "voice notes: delete own unsaved" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voice-notes'
    and public.is_own_voice_note_path(name)
    and not public.voice_note_is_linked(name)
  );

-- ───────────── save_capture + audio_path ─────────────
-- Same behaviour and grants as 20261007000005, plus an optional audio_path:
-- the caller's own uploaded recording, attached to the new note event.
-- The old 6-argument version is dropped so PostgREST never sees two candidates.

drop function if exists public.save_capture(uuid, text, text, text, timestamptz, text[]);

create or replace function public.save_capture(
  customer_id    uuid,
  body           text,
  kind           text default 'note',
  promise_title  text default null,
  promise_due_at timestamptz default null,
  facts          text[] default null,
  audio_path     text default null
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
  v_attachment uuid;
  v_fact_ids   uuid[] := '{}';
  v_body       text := btrim(coalesce(save_capture.body, ''));
  v_title      text := nullif(regexp_replace(btrim(coalesce(save_capture.promise_title, '')), '\.$', ''), '');
  v_audio      text := nullif(btrim(coalesce(save_capture.audio_path, '')), '');
  v_parts      text[];
  v_meta       jsonb;
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

  -- The recording must be the caller's own upload in this workspace: '{org}/{me}/{file}'.
  if v_audio is not null then
    v_parts := string_to_array(v_audio, '/');
    if array_length(v_parts, 1) <> 3
       or v_parts[1] <> v_org::text
       or v_parts[2] <> v_member::text
       or v_parts[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
      raise exception 'audio_path must be one of your own recordings in this workspace' using errcode = 'invalid_parameter_value';
    end if;
    -- Read through Storage RLS ("voice notes: read own").
    select o.metadata into v_meta
    from storage.objects o
    where o.bucket_id = 'voice-notes' and o.name = v_audio;
    if not found then
      raise exception 'Recording not found' using errcode = 'no_data_found';
    end if;
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

  if v_audio is not null then
    insert into public.attachments (org_id, customer_id, event_id, storage_bucket, storage_path, file_name,
                                    mime_type, size_bytes, uploaded_by_member_id)
    values (v_org, save_capture.customer_id, v_event, 'voice-notes', v_audio, v_parts[3],
            coalesce(nullif(v_meta ->> 'mimetype', ''), 'audio/mp4'),
            case when (v_meta ->> 'size') ~ '^\d{1,15}$' then (v_meta ->> 'size')::bigint end,
            v_member)
    returning id into v_attachment;
  end if;

  return jsonb_build_object(
    'event_id', v_event,
    'commitment_id', v_commitment,
    'fact_ids', to_jsonb(v_fact_ids),
    'attachment_id', v_attachment
  );
end;
$$;

revoke execute on function public.save_capture(uuid, text, text, text, timestamptz, text[], text) from public, anon;
grant execute on function public.save_capture(uuid, text, text, text, timestamptz, text[], text) to authenticated;
