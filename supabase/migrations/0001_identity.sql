-- 0001_identity.sql
-- Identity + tenancy core: profiles, organizations, memberships, modules,
-- invitations. Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ─── enums ───────────────────────────────────────────────────────────────
do $$ begin
  create type org_role as enum ('owner','admin','manager','member','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('invited','active','suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type discovery_status as enum
    ('queued','running','completed','partial','failed','cancelled');
exception when duplicate_object then null; end $$;

-- ─── shared updated_at trigger ───────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── profiles (1:1 with auth.users) ──────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row must exist for every auth user. SECURITY DEFINER so the
-- trigger can write regardless of the inserting role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── organizations ───────────────────────────────────────────────────────
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  industry    text,
  logo_url    text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated on public.organizations;
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ─── membership (a user may belong to many organizations) ────────────────
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            org_role not null default 'member',
  status          member_status not null default 'active',
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_org_members_org  on public.organization_members(organization_id);

drop trigger if exists trg_org_members_updated on public.organization_members;
create trigger trg_org_members_updated before update on public.organization_members
  for each row execute function public.touch_updated_at();

-- Every organization keeps at least one owner.
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  remaining int;
  target_org uuid;
begin
  target_org := coalesce(old.organization_id, new.organization_id);

  if tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active' then
    select count(*) into remaining
    from public.organization_members
    where organization_id = target_org
      and role = 'owner'
      and status = 'active'
      and id <> old.id;

    if old.role = 'owner' and old.status = 'active' and remaining = 0 then
      raise exception 'Cannot remove or demote the last active owner of an organization';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_protect_last_owner on public.organization_members;
create trigger trg_protect_last_owner
  before update or delete on public.organization_members
  for each row execute function public.protect_last_owner();

-- ─── per-organization module toggles ─────────────────────────────────────
create table if not exists public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key      text not null,
  enabled         boolean not null default true,
  config          jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, module_key),
  constraint organization_modules_key_valid check (module_key in (
    'tender_discovery','tender_analysis','inventory','procurement',
    'logistics','compliance','projects','analytics'
  ))
);

drop trigger if exists trg_org_modules_updated on public.organization_modules;
create trigger trg_org_modules_updated before update on public.organization_modules
  for each row execute function public.touch_updated_at();

-- ─── invitations ─────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            org_role not null default 'member',
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by      uuid references auth.users(id) on delete set null,
  expires_at      timestamptz not null default (now() + interval '14 days'),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, email)
);

-- ─── default module set for a new organization ───────────────────────────
create or replace function public.seed_default_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organization_modules (organization_id, module_key, enabled)
  select new.id, k, true
  from unnest(array[
    'tender_discovery','tender_analysis','inventory','procurement',
    'logistics','compliance','projects','analytics'
  ]) as k
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_default_modules on public.organizations;
create trigger trg_seed_default_modules after insert on public.organizations
  for each row execute function public.seed_default_modules();
