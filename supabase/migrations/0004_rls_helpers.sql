-- 0004_rls_helpers.sql
-- Authorization primitives used by every policy.
--
-- These are SECURITY DEFINER on purpose. A policy ON organization_members
-- that inlines `exists (select 1 from organization_members ...)` re-triggers
-- itself and fails with infinite recursion. Running the lookup as the
-- function owner skips RLS and breaks that cycle.
--
-- They are STABLE so the planner evaluates them once per statement rather
-- than once per row.

-- Rank lets policies express "at least manager" without listing every role.
create or replace function public.org_role_rank(r org_role)
returns int language sql immutable as $$
  select case r
    when 'owner'   then 50
    when 'admin'   then 40
    when 'manager' then 30
    when 'member'  then 20
    when 'viewer'  then 10
    else 0
  end
$$;

-- Is the caller an active member of this organisation?
create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

-- Does the caller hold at least the given role in this organisation?
create or replace function public.has_org_role_at_least(org uuid, minimum org_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.org_role_rank(m.role) >= public.org_role_rank(minimum)
  )
$$;

-- Convenience predicates used throughout the policy set.
create or replace function public.can_write_org_data(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_org_role_at_least(org, 'manager')
$$;

create or replace function public.can_admin_org(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_org_role_at_least(org, 'admin')
$$;

-- Every organisation the caller currently belongs to.
create or replace function public.my_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = auth.uid()
    and m.status = 'active'
$$;

-- Locked down: these must not be callable by anonymous clients in a way that
-- leaks membership of arbitrary organisations beyond a boolean.
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role_at_least(uuid, org_role) from public;
revoke all on function public.can_write_org_data(uuid) from public;
revoke all on function public.can_admin_org(uuid) from public;
revoke all on function public.my_org_ids() from public;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role_at_least(uuid, org_role) to authenticated;
grant execute on function public.can_write_org_data(uuid) to authenticated;
grant execute on function public.can_admin_org(uuid) to authenticated;
grant execute on function public.my_org_ids() to authenticated;
grant execute on function public.org_role_rank(org_role) to authenticated;

-- ─── organisation creation ───────────────────────────────────────────────
-- Creating an organisation and becoming its owner is a single atomic act.
-- Doing it as two client inserts would need an INSERT policy on
-- organization_members that lets a caller grant themselves a role, which is
-- exactly the escalation path we do not want to open.
create or replace function public.create_organization(
  p_name text,
  p_slug text default null,
  p_industry text default null
)
returns public.organizations
language plpgsql security definer set search_path = public as $$
declare
  new_org public.organizations;
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  base_slug := coalesce(nullif(btrim(p_slug), ''), lower(btrim(p_name)));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'org'; end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.organizations (name, slug, industry, created_by)
  values (btrim(p_name), final_slug, p_industry, auth.uid())
  returning * into new_org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (new_org.id, auth.uid(), 'owner', 'active');

  insert into public.organization_profiles (organization_id, legal_name)
  values (new_org.id, btrim(p_name))
  on conflict (organization_id) do nothing;

  insert into public.organization_discovery_settings (organization_id)
  values (new_org.id)
  on conflict (organization_id) do nothing;

  return new_org;
end $$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;
