-- 0007_fix_owner_guard.sql
--
-- Two defects in protect_last_owner() from 0001:
--
-- 1. It fired while the organisation itself was being deleted. Deleting an
--    organisation cascades to organization_members, the guard saw the last
--    owner disappearing and aborted the whole delete — making organisations
--    undeletable.
-- 2. It referenced NEW.role in a condition reached by DELETE triggers, where
--    NEW is unassigned. PostgreSQL does not guarantee OR short-circuits, so
--    that was liable to raise "record new is not assigned yet".
--
-- Rewritten with explicit per-operation branches and a parent-existence check.

create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  remaining int;
  losing_owner boolean := false;
begin
  if tg_op = 'DELETE' then
    -- The organisation is being removed; its members go with it.
    if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return old;
    end if;
    losing_owner := (old.role = 'owner' and old.status = 'active');
  else
    losing_owner := (old.role = 'owner' and old.status = 'active')
                    and (new.role <> 'owner' or new.status <> 'active');
  end if;

  if not losing_owner then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into remaining
  from public.organization_members m
  where m.organization_id = old.organization_id
    and m.role = 'owner'
    and m.status = 'active'
    and m.id <> old.id;

  if remaining = 0 then
    raise exception 'Cannot remove or demote the last active owner of an organization'
      using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;
