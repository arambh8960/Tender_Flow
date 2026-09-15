-- 0011_organization_configuration.sql
--
-- Organisation configuration that the agents are supposed to read but had
-- nowhere to read FROM.
--
-- The financial agent takes a CommercialSettings object, but the loader that
-- builds it hardcoded the GST rate, brokerage, EMD and ePBG percentages and
-- the transport buffer. Every tenant therefore priced bids with one company's
-- assumptions no matter what their own business looked like. Discovery had the
-- same gap for tender value floors and haul limits.
--
-- This adds the storage. The loaders are changed to read it in the same
-- commit; nothing here invents a default that overrides a tenant's choice.

-- ─────────────────────────────────────────────────────────────────────────
--  Organisation profile: the rest of a real company identity
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organization_profiles
  add column if not exists description text,
  add column if not exists website     text,
  add column if not exists city        text,
  add column if not exists state       text,
  add column if not exists pincode     text,
  add column if not exists country     text default 'India';

-- ─────────────────────────────────────────────────────────────────────────
--  Discovery preferences the qualification engine can act on
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organization_discovery_settings
  add column if not exists min_tender_value      numeric,
  add column if not exists max_tender_value      numeric,
  add column if not exists preferred_authorities text[] not null default '{}',
  -- Beyond this a haul is treated as infeasible. Null disables the gate,
  -- which is different from zero.
  add column if not exists max_distance_km       integer;

-- ─────────────────────────────────────────────────────────────────────────
--  Financial defaults
--
--  One row per organisation. Every value is a FALLBACK: the tender's own
--  stated figure always wins, and the SKU's own rate wins over the default.
--  These only fill the gap where neither says anything, which is exactly
--  where the code previously substituted a constant.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.organization_financial_settings (
  organization_id          uuid primary key references public.organizations(id) on delete cascade,

  -- Applied when a SKU carries no GST rate of its own.
  default_gst_rate         numeric not null default 18,
  -- Percentage added as brokerage on top of statutory portal fees.
  brokerage_percent        numeric not null default 0,
  -- The margin below which a bid is flagged for review.
  target_margin_percent    numeric not null default 10,
  -- Added to measured freight to cover handling and variance.
  transport_buffer_percent numeric not null default 10,
  -- Used only when the tender states neither an amount nor a percentage.
  default_emd_percent      numeric not null default 2,
  default_epbg_percent     numeric not null default 3,
  -- Freight rate. Mirrors the discovery setting so costing and qualification
  -- cannot drift apart; discovery remains the editing surface.
  rate_per_km              numeric not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint fin_gst_range      check (default_gst_rate between 0 and 100),
  constraint fin_brokerage_range check (brokerage_percent between 0 and 100),
  constraint fin_margin_range   check (target_margin_percent between 0 and 100),
  constraint fin_buffer_range   check (transport_buffer_percent between 0 and 100),
  constraint fin_emd_range      check (default_emd_percent between 0 and 100),
  constraint fin_epbg_range     check (default_epbg_percent between 0 and 100)
);

drop trigger if exists trg_org_financial_updated on public.organization_financial_settings;
create trigger trg_org_financial_updated before update on public.organization_financial_settings
  for each row execute function public.touch_updated_at();

alter table public.organization_financial_settings enable row level security;

drop policy if exists org_financial_select on public.organization_financial_settings;
create policy org_financial_select on public.organization_financial_settings
  for select using (public.is_org_member(organization_id));

-- Commercial defaults change what every bid is priced at, so editing them is
-- an administrative act.
drop policy if exists org_financial_write on public.organization_financial_settings;
create policy org_financial_write on public.organization_financial_settings
  for all using (public.can_admin_org(organization_id))
  with check (public.can_admin_org(organization_id));

grant select, insert, update on public.organization_financial_settings to authenticated;

-- Every existing organisation gets a row, so the loader never has to invent
-- one and "no row" never silently means "use a constant".
insert into public.organization_financial_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
--  Create the financial row alongside the organisation, in one transaction.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.seed_org_financial_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organization_financial_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_org_financial on public.organizations;
create trigger trg_seed_org_financial after insert on public.organizations
  for each row execute function public.seed_org_financial_settings();

-- ─────────────────────────────────────────────────────────────────────────
--  Invitation lookup by token.
--
--  An invite link carries the token, and the recipient must be able to see
--  what they are accepting BEFORE they belong to the organisation — so this
--  cannot be gated on membership. It is gated on the token itself, which is
--  24 random bytes, and it returns only what the acceptance screen shows.
--  The caller's email is NOT required to match here: that check belongs to
--  accept_invitation(), so the screen can explain a mismatch rather than
--  pretending the invitation does not exist.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.invitation_by_token(p_token text)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  email             text,
  role              org_role,
  status            text,
  invited_by_name   text,
  expires_at        timestamptz,
  is_expired        boolean,
  matches_caller    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.organization_id,
    o.name,
    i.email,
    i.role,
    i.status,
    coalesce(p.full_name, p.email),
    i.expires_at,
    i.expires_at <= now(),
    lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = p_token
$$;

revoke all on function public.invitation_by_token(text) from public;
grant execute on function public.invitation_by_token(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
--  Declining an invitation.
--
--  Recorded rather than deleted: an admin should be able to see that the
--  person said no, instead of watching the invitation silently vanish.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.invitations drop constraint if exists invitations_status_valid;
alter table public.invitations
  add constraint invitations_status_valid
  check (status in ('pending','accepted','revoked','expired','declined'));

create or replace function public.decline_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into inv from public.invitations where id = p_invitation_id;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  -- Same rule as acceptance: only the addressee may act on it, and an
  -- invitation for someone else is reported as absent.
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if inv.status <> 'pending' then
    return false;
  end if;

  update public.invitations set status = 'declined' where id = inv.id;
  return true;
end $$;

revoke all on function public.decline_invitation(uuid) from public;
grant execute on function public.decline_invitation(uuid) to authenticated;
