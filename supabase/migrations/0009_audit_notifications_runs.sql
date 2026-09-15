-- 0009_audit_notifications_runs.sql
-- Three gaps left by 0001-0008:
--   1. audit_logs      — user-facing history; console.log is not an audit trail.
--   2. notifications   — per-user, per-organisation messages.
--   3. analysis_runs   — RFP processing as a persisted run, so a browser
--                        refresh cannot lose processing state.
-- Plus document metadata (mime/size/checksum) that the Supabase Storage move
-- needs in order to validate uploads and detect duplicates.

-- ─────────────────────────────────────────────────────────────────────────
--  audit_logs
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete set null,
  action          text not null,
  entity_type     text,
  entity_id       text,
  metadata        jsonb not null default '{}'::jsonb,
  ip_address      text,
  user_agent      text,
  request_id      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_audit_org_created
  on public.audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_org_entity
  on public.audit_logs(organization_id, entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Reading the audit trail is an administrative act. Members below admin see
-- nothing, and nobody may write through the client: entries are inserted by
-- the server with the service role so they cannot be forged or back-dated.
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select using (public.can_admin_org(organization_id));

-- ─────────────────────────────────────────────────────────────────────────
--  notifications
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null,
  title           text not null,
  message         text,
  metadata        jsonb not null default '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_notifications_user
  on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- A notification is addressed to one person in one organisation; both must
-- match, so a removed member stops seeing theirs.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid() and public.is_org_member(organization_id));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
--  analysis_runs  (RFP processing runs)
-- ─────────────────────────────────────────────────────────────────────────
-- tender_analyses holds the OUTPUT. This holds the EXECUTION: one row per
-- attempt, with the status machine, timing and failure reason. Re-running a
-- failed analysis appends a run rather than overwriting the history.
create table if not exists public.analysis_runs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  analysis_id        uuid not null references public.tender_analyses(id) on delete cascade,
  request_id         text,
  status             text not null default 'Pending',
  stage              text,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  duration_ms        integer,
  error_code         text,
  error_message      text,
  metadata           jsonb not null default '{}'::jsonb,
  triggered_by       uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint analysis_runs_status_valid check (status in
    ('Pending','Extracting','Parsing','Processing','Complete','Error'))
);
create index if not exists idx_analysis_runs_org
  on public.analysis_runs(organization_id, created_at desc);
create index if not exists idx_analysis_runs_analysis
  on public.analysis_runs(analysis_id, created_at desc);

drop trigger if exists trg_analysis_runs_updated on public.analysis_runs;
create trigger trg_analysis_runs_updated before update on public.analysis_runs
  for each row execute function public.touch_updated_at();

alter table public.analysis_runs enable row level security;

drop policy if exists analysis_runs_select on public.analysis_runs;
create policy analysis_runs_select on public.analysis_runs
  for select using (public.is_org_member(organization_id));

drop policy if exists analysis_runs_write on public.analysis_runs;
create policy analysis_runs_write on public.analysis_runs
  for all using (public.can_write_org_data(organization_id))
  with check (public.can_write_org_data(organization_id));

-- ─────────────────────────────────────────────────────────────────────────
--  tender_analyses: the identifying fields the RFP list screen renders.
--  Previously these lived only in React state, so a refresh lost them.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.tender_analyses
  add column if not exists title            text,
  add column if not exists bid_number       text,
  add column if not exists buyer            text,
  add column if not exists bid_type         text,
  add column if not exists closing_at       timestamptz,
  add column if not exists source_url       text,
  add column if not exists file_name        text,
  add column if not exists raw_content      text,
  add column if not exists raw_storage_path text,
  add column if not exists current_run_id   uuid references public.analysis_runs(id) on delete set null,
  add column if not exists error_message    text;

alter table public.tender_analyses
  drop constraint if exists tender_analyses_status_valid;
alter table public.tender_analyses
  add constraint tender_analyses_status_valid check (status in
    ('Pending','Extracting','Parsing','Processing','Complete','Error'));

create index if not exists idx_analyses_org_status
  on public.tender_analyses(organization_id, status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
--  compliance_documents: storage metadata for the Supabase Storage move.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.compliance_documents
  add column if not exists mime_type   text,
  add column if not exists file_size   bigint,
  add column if not exists checksum    text,
  add column if not exists file_name   text,
  add column if not exists archived_at timestamptz;

create index if not exists idx_compliance_org_expiry
  on public.compliance_documents(organization_id, expiry_date);

-- ─────────────────────────────────────────────────────────────────────────
--  Grants. 0005 granted table privileges broadly to authenticated; the new
--  tables need the same treatment, minus write access where RLS has no
--  corresponding policy (audit_logs is server-written only).
-- ─────────────────────────────────────────────────────────────────────────
grant select on public.audit_logs to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.analysis_runs to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
--  profiles.email
--  The member list shows who someone is. Without an email on the profile,
--  an admin would need a privileged read of auth.users to render it.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists email text;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id and p.email is distinct from u.email;

-- Keep it in step with auth.users on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  invitations lifecycle
--  accepted_at alone cannot express "revoked" or "expired", which the admin
--  screen needs in order to show an invitation's real state.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.invitations
  add column if not exists status     text not null default 'pending',
  add column if not exists revoked_at timestamptz;

alter table public.invitations drop constraint if exists invitations_status_valid;
alter table public.invitations
  add constraint invitations_status_valid check (status in ('pending','accepted','revoked','expired'));

update public.invitations set status = 'accepted' where accepted_at is not null and status = 'pending';

create index if not exists idx_invitations_org_status
  on public.invitations(organization_id, status);
