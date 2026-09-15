-- 0008_fix_auth_trigger_resolution.sql
--
-- Fixes: GoTrue returning 500 "Database error querying schema" on every
-- sign-in and sign-up after 0001 was applied.
--
-- Cause: the trigger created in 0001 was recorded as
--     EXECUTE FUNCTION handle_new_user()
-- with no schema qualifier. GoTrue connects as supabase_auth_admin, whose
-- role-level search_path is `auth` — public is not on it — so the function
-- name could not be resolved when anything touched auth.users. Privileges
-- were never the problem: supabase_auth_admin already had USAGE on public
-- and EXECUTE on the function.
--
-- Fix: recreate the trigger with a fully qualified function reference, and
-- state the grants explicitly so a future privilege sweep cannot silently
-- reintroduce the failure.

grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Also pin the function's own search_path so its body resolves predictably
-- no matter which role fires it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
exception
  -- A profile row must never be the reason a sign-up fails outright.
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
