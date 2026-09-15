-- 0006_storage_and_lockdown.sql
-- Private document storage, plus removal of privileges the blanket grants in
-- 0005 handed out too widely.

-- ─────────────────────────────────────────────────────────────────────────
--  Migration bookkeeping is platform data, not tenant data.
--  0005's `grant ... on all tables ... to authenticated` swept it in.
-- ─────────────────────────────────────────────────────────────────────────
revoke all on public.schema_migrations from anon, authenticated;
alter table public.schema_migrations enable row level security;
-- RLS enabled with zero policies = deny all. Only the service role and the
-- migration runner (which connects as the database owner) may touch it.

-- ─────────────────────────────────────────────────────────────────────────
--  Private bucket for organisation documents.
--  Object paths are '<organization_id>/<document_id>/<filename>', so the
--  first path segment is the tenant key.
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-documents', 'org-documents', false, 26214400)  -- 25 MB
on conflict (id) do update set public = false;

-- Helper: is the first path segment an organisation the caller belongs to?
create or replace function public.storage_path_is_mine(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  first_segment text;
  org uuid;
begin
  first_segment := split_part(object_name, '/', 1);
  if first_segment is null or first_segment = '' then
    return false;
  end if;

  begin
    org := first_segment::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return public.is_org_member(org);
end $$;

create or replace function public.storage_path_is_writable(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  first_segment text;
  org uuid;
begin
  first_segment := split_part(object_name, '/', 1);
  if first_segment is null or first_segment = '' then
    return false;
  end if;

  begin
    org := first_segment::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return public.can_write_org_data(org);
end $$;

revoke all on function public.storage_path_is_mine(text) from public;
revoke all on function public.storage_path_is_writable(text) from public;
grant execute on function public.storage_path_is_mine(text) to authenticated;
grant execute on function public.storage_path_is_writable(text) to authenticated;

drop policy if exists org_documents_select on storage.objects;
create policy org_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'org-documents' and public.storage_path_is_mine(name));

drop policy if exists org_documents_insert on storage.objects;
create policy org_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-documents' and public.storage_path_is_writable(name));

drop policy if exists org_documents_update on storage.objects;
create policy org_documents_update on storage.objects
  for update to authenticated
  using (bucket_id = 'org-documents' and public.storage_path_is_writable(name))
  with check (bucket_id = 'org-documents' and public.storage_path_is_writable(name));

drop policy if exists org_documents_delete on storage.objects;
create policy org_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-documents' and public.storage_path_is_writable(name));
