-- 0010_invitations_and_org_creation.sql
--
-- Two gaps in the authentication/tenancy model:
--
--   1. Invitations could be CREATED but never ACCEPTED. An admin could invite
--      someone and the row simply sat there — there was no path from
--      "invited" to "member".
--
--   2. create_organization() accepted only name/slug/industry, so the rest of
--      the company profile (legal name, GSTIN, PAN, turnover, OEM status) had
--      to be written by a second client call after the fact. That left a
--      window where an organisation existed with no profile, and it split one
--      logical act across two transactions.
--
-- Tenant naming: this schema uses `organizations` / `organization_members` /
-- `invitations` throughout. It deliberately does NOT introduce a parallel
-- `companies` / `company_members` / `organization_invitations` set — two
-- tenant models in one schema is precisely the duplication that makes RLS
-- unauditable. "Company" remains the user-facing word; `organizations` is the
-- storage name, and the two are the same thing.

-- ─────────────────────────────────────────────────────────────────────────
--  Invitations: lookup and integrity
-- ─────────────────────────────────────────────────────────────────────────

-- Invitations are matched to a signing-in user by email, case-insensitively:
-- a person invited as "Bob@Corp.com" must match when they sign in as
-- "bob@corp.com".
create index if not exists idx_invitations_email_lower
  on public.invitations (lower(email));

-- The 0001 unique (organization_id, email) blocks re-inviting someone whose
-- invitation was revoked or expired. Scope uniqueness to live invitations so
-- a revoked one can be replaced.
alter table public.invitations drop constraint if exists invitations_organization_id_email_key;

drop index if exists idx_invitations_unique_pending;
create unique index idx_invitations_unique_pending
  on public.invitations (organization_id, lower(email))
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
--  What invitations is the CALLER entitled to see?
--
--  A person must be able to discover an invitation addressed to them before
--  they belong to the organisation — so this cannot be gated on membership.
--  It is scoped to the caller's own verified email instead, and returns only
--  what the acceptance screen needs. The token is never exposed.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.my_pending_invitations()
returns table (
  id               uuid,
  organization_id  uuid,
  organization_name text,
  role             org_role,
  invited_by_name  text,
  expires_at       timestamptz,
  created_at       timestamptz
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
    i.role,
    coalesce(p.full_name, p.email),
    i.expires_at,
    i.created_at
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

revoke all on function public.my_pending_invitations() from public;
grant execute on function public.my_pending_invitations() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
--  Accept an invitation.
--
--  SECURITY DEFINER because creating the membership row requires an INSERT
--  that the caller must NOT be able to perform directly — a client-writable
--  organization_members would let anyone grant themselves any role in any
--  organisation.
--
--  Guarantees:
--    * the invitation must be addressed to the caller's own email
--    * it must be pending and unexpired
--    * OWNER is never granted by accepting an invitation, whatever the row
--      says; ownership is conferred only by creating an organisation or by an
--      existing owner explicitly promoting someone
--    * accepting twice is a no-op rather than an error
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.accept_invitation(p_invitation_id uuid)
returns public.organization_members
language plpgsql
security definer
set search_path = public
as $$
declare
  inv        public.invitations;
  caller_email text;
  granted    org_role;
  membership public.organization_members;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller_email = '' then
    raise exception 'The signed-in account has no email address' using errcode = '22023';
  end if;

  select * into inv from public.invitations where id = p_invitation_id;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  -- An invitation for someone else must be indistinguishable from one that
  -- does not exist, or this becomes an oracle for who has been invited where.
  if lower(inv.email) <> caller_email then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  -- Already a member: succeed idempotently rather than erroring, so a double
  -- click or a retried request does not surface a scary failure.
  select * into membership
  from public.organization_members
  where organization_id = inv.organization_id and user_id = auth.uid();

  if found then
    update public.invitations
       set status = 'accepted', accepted_at = coalesce(accepted_at, now())
     where id = inv.id;
    return membership;
  end if;

  if inv.status = 'revoked' then
    raise exception 'This invitation has been revoked' using errcode = 'P0002';
  end if;

  if inv.status = 'accepted' then
    raise exception 'This invitation has already been used' using errcode = 'P0002';
  end if;

  if inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired' using errcode = 'P0002';
  end if;

  -- Ownership is never transferred by invitation.
  granted := case when inv.role = 'owner' then 'admin'::org_role else inv.role end;

  insert into public.organization_members (organization_id, user_id, role, status, invited_at, joined_at)
  values (inv.organization_id, auth.uid(), granted, 'active', inv.created_at, now())
  returning * into membership;

  update public.invitations
     set status = 'accepted', accepted_at = now()
   where id = inv.id;

  return membership;
end $$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
--  Create an organisation, with its full profile, in one transaction.
--
--  Replaces the 0004 three-argument version. The caller becomes OWNER as part
--  of the same statement, which is why this is SECURITY DEFINER: an INSERT
--  policy on organization_members permissive enough for a client to grant
--  itself a role is the escalation hole this exists to avoid.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.create_organization(
  p_name              text,
  p_slug              text default null,
  p_industry          text default null,
  p_legal_name        text default null,
  p_address           text default null,
  p_gstin             text default null,
  p_pan               text default null,
  p_domain            text default null,
  p_annual_turnover_cr numeric default null,
  p_turnover_year     text default null,
  p_oem_status        text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org   public.organizations;
  base_slug text;
  final_slug text;
  suffix    int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Organization name is required' using errcode = '22023';
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

  -- The creator is the owner. This is the ONLY path that mints an owner.
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (new_org.id, auth.uid(), 'owner', 'active', now());

  insert into public.organization_profiles (
    organization_id, legal_name, address, gstin, pan, domain,
    annual_turnover_cr, turnover_year, oem_status
  )
  values (
    new_org.id,
    coalesce(nullif(btrim(coalesce(p_legal_name, '')), ''), btrim(p_name)),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_gstin, '')), ''),
    nullif(btrim(coalesce(p_pan, '')), ''),
    nullif(btrim(coalesce(p_domain, '')), ''),
    p_annual_turnover_cr,
    nullif(btrim(coalesce(p_turnover_year, '')), ''),
    nullif(btrim(coalesce(p_oem_status, '')), '')
  )
  on conflict (organization_id) do nothing;

  insert into public.organization_discovery_settings (organization_id)
  values (new_org.id)
  on conflict (organization_id) do nothing;

  return new_org;
end $$;

revoke all on function public.create_organization(
  text, text, text, text, text, text, text, text, numeric, text, text
) from public;
grant execute on function public.create_organization(
  text, text, text, text, text, text, text, text, numeric, text, text
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
--  Legacy authentication data.
--
--  user_security carried the pre-Supabase identity store: a PIN hash keyed by
--  recovery email, plus plaintext OTP columns. Supabase Auth is the identity
--  store now, so the PIN is demoted to what it should always have been — an
--  optional lock on the compliance vault, keyed by auth user id.
--
--  Plaintext OTP columns are dropped outright: Supabase issues and verifies
--  one-time codes, and an application table holding them in the clear is a
--  liability with no remaining purpose.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.user_security drop column if exists reset_token;
alter table public.user_security drop column if exists reset_token_expiry;
alter table public.user_security drop column if exists recovery_email;

-- Records that the PIN was last changed after an identity re-verification,
-- so a forgotten-PIN reset is auditable.
alter table public.user_security
  add column if not exists pin_updated_at timestamptz,
  add column if not exists locked_until   timestamptz;
