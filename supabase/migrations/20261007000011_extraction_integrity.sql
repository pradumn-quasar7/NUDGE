-- Nudge · AI suggestion integrity
--
-- The column grant on public.extractions lets clients update status/commitment_id (needed by
-- confirm_extraction(), which runs as the caller). Without a guard a client could mark a
-- suggestion "confirmed" without any promise behind it, or point it at another customer's
-- promise. Rule enforced here, for every writer except the service role:
--   * status 'confirmed' requires commitment_id → a commitment of the SAME org and customer;
--   * once set, commitment_id can't be changed or cleared;
--   * a confirmed suggestion can't be moved back to pending/ignored.

create or replace function public.extractions_guard_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if old.commitment_id is not null and new.commitment_id is distinct from old.commitment_id then
    raise exception 'A confirmed suggestion stays linked to its promise' using errcode = '23514';
  end if;

  if old.status = 'confirmed' and new.status <> 'confirmed' then
    raise exception 'A confirmed suggestion can''t be reopened' using errcode = '23514';
  end if;

  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.commitment_id is null or not exists (
      select 1 from public.commitments c
      where c.id = new.commitment_id
        and c.org_id = new.org_id
        and c.customer_id = new.customer_id
    ) then
      raise exception 'Confirm suggestions with confirm_extraction()' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.extractions_guard_confirmation() from public, anon, authenticated;

drop trigger if exists extractions_guard_confirmation on public.extractions;
create trigger extractions_guard_confirmation
  before update of status, commitment_id on public.extractions
  for each row execute function public.extractions_guard_confirmation();
