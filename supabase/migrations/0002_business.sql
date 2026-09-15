-- 0002_business.sql
-- Organisation-owned business entities. Every table carries organization_id.
-- Scoped uniqueness replaces the legacy global uniqueness (two organisations
-- must be able to hold the same SKU code or the same certificate name).

-- ─── company profile (was: company_profile, one global row) ──────────────
create table if not exists public.organization_profiles (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  legal_name          text,
  address             text,
  gstin               text,
  pan                 text,
  domain              text,
  annual_turnover_cr  numeric,
  turnover_year       text,
  experience_years    integer,
  oem_status          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_org_profiles_updated on public.organization_profiles;
create trigger trg_org_profiles_updated before update on public.organization_profiles
  for each row execute function public.touch_updated_at();

-- ─── signing authorities (was: signing_authorities, no tenant column) ────
create table if not exists public.signing_authorities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  designation     text,
  din             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_signing_auth_org on public.signing_authorities(organization_id);

drop trigger if exists trg_signing_auth_updated on public.signing_authorities;
create trigger trg_signing_auth_updated before update on public.signing_authorities
  for each row execute function public.touch_updated_at();

-- ─── warehouses (was: 4 denormalised columns on every SKU) ───────────────
create table if not exists public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text,
  address         text,
  city            text,
  state           text,
  pincode         text,
  latitude        double precision,
  longitude       double precision,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists idx_warehouses_org on public.warehouses(organization_id);

drop trigger if exists trg_warehouses_updated on public.warehouses;
create trigger trg_warehouses_updated before update on public.warehouses
  for each row execute function public.touch_updated_at();

-- ─── vehicles (was: TruckType union + unused constants file) ─────────────
create table if not exists public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_type      text not null,
  label           text,
  capacity_tons   numeric,
  cost_per_km     numeric,
  fleet_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, truck_type),
  constraint vehicles_truck_type_valid check (truck_type in
    ('MINI_TRUCK','LCV','MEDIUM_TRUCK','HEAVY_TRUCK'))
);
create index if not exists idx_vehicles_org on public.vehicles(organization_id);

drop trigger if exists trg_vehicles_updated on public.vehicles;
create trigger trg_vehicles_updated before update on public.vehicles
  for each row execute function public.touch_updated_at();

-- ─── suppliers ───────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  contact_email   text,
  contact_phone   text,
  address         text,
  lead_time_days  integer,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists idx_suppliers_org on public.suppliers(organization_id);

drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.touch_updated_at();

-- ─── inventory (full SKU shape, not the narrow legacy subset) ────────────
create table if not exists public.inventory_items (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  sku_id                   text not null,
  product_name             text not null,
  product_category         text,
  product_sub_category     text,
  oem_brand                text,
  specification            jsonb not null default '{}'::jsonb,
  available_quantity       integer not null default 0,
  warehouse_id             uuid references public.warehouses(id) on delete set null,
  supplier_id              uuid references public.suppliers(id) on delete set null,
  truck_type               text,
  lead_time_days           integer,
  cost_price               numeric,
  unit_sales_price         numeric,
  bulk_sales_price         numeric,
  gst_rate                 numeric default 18,
  brokerage                numeric,
  min_margin_percent       numeric,
  is_active                boolean not null default true,
  is_custom_made_possible  boolean not null default false,
  is_compliance_ready      boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, sku_id)
);
create index if not exists idx_inventory_org on public.inventory_items(organization_id);
create index if not exists idx_inventory_org_category
  on public.inventory_items(organization_id, product_category);

drop trigger if exists trg_inventory_updated on public.inventory_items;
create trigger trg_inventory_updated before update on public.inventory_items
  for each row execute function public.touch_updated_at();

-- ─── compliance documents (was: compliance_vault, cert_name globally unique) ──
create table if not exists public.compliance_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cert_name       text not null,
  category        text,
  issued_date     date,
  expiry_date     date,
  is_valid        boolean not null default true,
  storage_path    text,
  legacy_file_path text,
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, cert_name)
);
create index if not exists idx_compliance_org on public.compliance_documents(organization_id);

drop trigger if exists trg_compliance_updated on public.compliance_documents;
create trigger trg_compliance_updated before update on public.compliance_documents
  for each row execute function public.touch_updated_at();

-- ─── projects ────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  status          text,
  owner_id        uuid references auth.users(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_projects_org on public.projects(organization_id);

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.touch_updated_at();

-- ─── discovery preferences (was: configData.discoveryFilters, app-level) ──
create table if not exists public.organization_discovery_settings (
  organization_id      uuid primary key references public.organizations(id) on delete cascade,
  default_portals      text[] not null default array['gem'],
  categories           text[] not null default '{}',
  manual_avg_kms       integer not null default 400,
  manual_rate_per_km   numeric not null default 55,
  allow_emd            boolean not null default true,
  min_match_threshold  integer not null default 20,
  delivery_type        text not null default 'Pan India',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_org_disc_settings_updated on public.organization_discovery_settings;
create trigger trg_org_disc_settings_updated before update on public.organization_discovery_settings
  for each row execute function public.touch_updated_at();

-- ─── per-user vault security (was: vault_access; PER USER, not per org) ──
-- This is user-level data, deliberately NOT organization-scoped: a PIN and
-- TOTP secret belong to the person, not to a tenant.
create table if not exists public.user_security (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  pin_hash          text,
  two_fa_secret     text,
  is_2fa_enabled    boolean not null default false,
  is_setup_complete boolean not null default false,
  is_locked         boolean not null default false,
  failed_attempts   integer not null default 0,
  last_login        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_user_security_updated on public.user_security;
create trigger trg_user_security_updated before update on public.user_security
  for each row execute function public.touch_updated_at();
