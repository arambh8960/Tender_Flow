-- 0005_rls_policies.sql
-- Tenant isolation is enforced here, in the database. No frontend filter and
-- no server-side WHERE clause is load-bearing for security.
--
-- Shape used for every organisation-owned table:
--   SELECT              -> is_org_member(organization_id)
--   INSERT/UPDATE/DELETE-> can_write_org_data(organization_id)   (manager+)
--
-- The WITH CHECK clause is what stops a member of Org A writing a row
-- stamped organization_id = Org B. A USING-only policy blocks reads but
-- still permits that insert.

-- ─────────────────────────────────────────────────────────────────────────
--  profiles
-- ─────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self_or_covisible on public.profiles;
create policy profiles_select_self_or_covisible on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.organization_members m
      where m.user_id = public.profiles.id
        and m.status = 'active'
        and m.organization_id in (select public.my_org_ids())
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
--  organizations
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organizations enable row level security;

drop policy if exists organizations_select_members on public.organizations;
create policy organizations_select_members on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin on public.organizations
  for update using (public.can_admin_org(id)) with check (public.can_admin_org(id));

drop policy if exists organizations_delete_owner on public.organizations;
create policy organizations_delete_owner on public.organizations
  for delete using (public.has_org_role_at_least(id, 'owner'));

-- No INSERT policy: organisations are created only through
-- public.create_organization(), which also makes the caller the owner.

-- ─────────────────────────────────────────────────────────────────────────
--  organization_members
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organization_members enable row level security;

drop policy if exists org_members_select on public.organization_members;
create policy org_members_select on public.organization_members
  for select using (public.is_org_member(organization_id) or user_id = auth.uid());

drop policy if exists org_members_insert_admin on public.organization_members;
create policy org_members_insert_admin on public.organization_members
  for insert with check (public.can_admin_org(organization_id));

drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin on public.organization_members
  for update using (public.can_admin_org(organization_id))
  with check (public.can_admin_org(organization_id));

drop policy if exists org_members_delete_admin on public.organization_members;
create policy org_members_delete_admin on public.organization_members
  for delete using (
    public.can_admin_org(organization_id)
    or user_id = auth.uid()   -- a member may leave on their own
  );

-- ─────────────────────────────────────────────────────────────────────────
--  organization_modules / invitations
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organization_modules enable row level security;

drop policy if exists org_modules_select on public.organization_modules;
create policy org_modules_select on public.organization_modules
  for select using (public.is_org_member(organization_id));

drop policy if exists org_modules_write_admin on public.organization_modules;
create policy org_modules_write_admin on public.organization_modules
  for all using (public.can_admin_org(organization_id))
  with check (public.can_admin_org(organization_id));

alter table public.invitations enable row level security;

drop policy if exists invitations_admin on public.invitations;
create policy invitations_admin on public.invitations
  for all using (public.can_admin_org(organization_id))
  with check (public.can_admin_org(organization_id));

-- ─────────────────────────────────────────────────────────────────────────
--  user_security — per-user, never per-organisation
-- ─────────────────────────────────────────────────────────────────────────
alter table public.user_security enable row level security;

drop policy if exists user_security_self on public.user_security;
create policy user_security_self on public.user_security
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
--  Organisation-owned business tables — uniform policy shape
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  org_tables text[] := array[
    'organization_profiles',
    'signing_authorities',
    'organization_discovery_settings',
    'warehouses',
    'vehicles',
    'suppliers',
    'inventory_items',
    'compliance_documents',
    'projects',
    'discovery_runs',
    'tenders',
    'tender_qualifications',
    'tender_analyses'
  ];
begin
  foreach t in array org_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_org_member(organization_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.can_write_org_data(organization_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.can_write_org_data(organization_id)) with check (public.can_write_org_data(organization_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.can_write_org_data(organization_id))',
      t || '_delete', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  discovery_run_tenders — inherits its tenant via the parent run
-- ─────────────────────────────────────────────────────────────────────────
alter table public.discovery_run_tenders enable row level security;

drop policy if exists run_tenders_select on public.discovery_run_tenders;
create policy run_tenders_select on public.discovery_run_tenders
  for select using (
    exists (
      select 1 from public.discovery_runs r
      where r.id = discovery_run_tenders.run_id
        and public.is_org_member(r.organization_id)
    )
  );

drop policy if exists run_tenders_write on public.discovery_run_tenders;
create policy run_tenders_write on public.discovery_run_tenders
  for all using (
    exists (
      select 1 from public.discovery_runs r
      where r.id = discovery_run_tenders.run_id
        and public.can_write_org_data(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.discovery_runs r
      where r.id = discovery_run_tenders.run_id
        and public.can_write_org_data(r.organization_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
--  Base grants. RLS narrows these; without them PostgREST sees nothing.
-- ─────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- anon deliberately gets no table privileges: an unauthenticated client must
-- not be able to read any business table even before RLS is consulted.
revoke all on all tables in schema public from anon;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
