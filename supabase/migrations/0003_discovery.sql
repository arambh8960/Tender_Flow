-- 0003_discovery.sql
-- Discovery runs, tenders, deduplication identity, qualification results
-- and analysis output. All organisation-owned.

-- ─── discovery runs ──────────────────────────────────────────────────────
create table if not exists public.discovery_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  portal            text not null,
  criteria          jsonb not null default '{}'::jsonb,
  status            discovery_status not null default 'queued',
  started_at        timestamptz,
  completed_at      timestamptz,
  total_found       integer not null default 0,
  total_normalized  integer not null default 0,
  total_duplicates  integer not null default 0,
  total_expired     integer not null default 0,
  total_candidates  integer not null default 0,
  total_qualified   integer not null default 0,
  error_message     text,
  errors            jsonb not null default '[]'::jsonb,
  triggered_by      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_discovery_runs_org
  on public.discovery_runs(organization_id, created_at desc);

drop trigger if exists trg_discovery_runs_updated on public.discovery_runs;
create trigger trg_discovery_runs_updated before update on public.discovery_runs
  for each row execute function public.touch_updated_at();

-- ─── tenders ─────────────────────────────────────────────────────────────
-- Deduplication identity is (organization_id, portal, external_id): the same
-- tender surfacing from two different searches must not create two rows.
create table if not exists public.tenders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  portal           text not null,
  external_id      text not null,
  title            text not null,
  description      text,
  buyer            text,
  category         text,
  subcategory      text,
  location         text,
  latitude         double precision,
  longitude        double precision,
  tender_url       text,
  published_at     timestamptz,
  closing_at       timestamptz,
  estimated_value  numeric,
  emd_amount       numeric,
  emd_required     boolean,
  raw_payload      jsonb not null default '{}'::jsonb,
  parse_warnings   text[] not null default '{}',
  first_seen_run   uuid references public.discovery_runs(id) on delete set null,
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, portal, external_id)
);
create index if not exists idx_tenders_org_closing
  on public.tenders(organization_id, closing_at);
create index if not exists idx_tenders_org_portal
  on public.tenders(organization_id, portal);

drop trigger if exists trg_tenders_updated on public.tenders;
create trigger trg_tenders_updated before update on public.tenders
  for each row execute function public.touch_updated_at();

-- ─── run <-> tender join (which run saw which tender) ────────────────────
create table if not exists public.discovery_run_tenders (
  run_id     uuid not null references public.discovery_runs(id) on delete cascade,
  tender_id  uuid not null references public.tenders(id) on delete cascade,
  is_new     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (run_id, tender_id)
);
create index if not exists idx_run_tenders_tender on public.discovery_run_tenders(tender_id);

-- ─── qualification results (independent score components) ────────────────
create table if not exists public.tender_qualifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  tender_id        uuid not null references public.tenders(id) on delete cascade,
  run_id           uuid references public.discovery_runs(id) on delete set null,
  inventory_score  numeric,
  technical_score  numeric,
  quantity_score   numeric,
  compliance_score numeric,
  logistics_score  numeric,
  commercial_score numeric,
  overall_score    numeric,
  status           text not null default 'pending',
  is_qualified     boolean not null default false,
  reason           text,
  breakdown        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tender_id, run_id)
);
create index if not exists idx_qualifications_org
  on public.tender_qualifications(organization_id, overall_score desc);

drop trigger if exists trg_qualifications_updated on public.tender_qualifications;
create trigger trg_qualifications_updated before update on public.tender_qualifications
  for each row execute function public.touch_updated_at();

-- ─── deep analysis output (was: Rfp.agentOutputs in React state) ─────────
create table if not exists public.tender_analyses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  tender_id          uuid references public.tenders(id) on delete set null,
  source             text,
  source_ref         text,
  status             text not null default 'Pending',
  parsed_data        jsonb,
  technical_analysis jsonb,
  pricing            jsonb,
  risk_analysis      jsonb,
  processing_seconds integer,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_analyses_org on public.tender_analyses(organization_id, created_at desc);

drop trigger if exists trg_analyses_updated on public.tender_analyses;
create trigger trg_analyses_updated before update on public.tender_analyses
  for each row execute function public.touch_updated_at();
