-- SIGO: almacenamiento privado para certificado y clave ARCA.
-- Nunca persiste PEM ni clave fiscal en tablas publicas. Los archivos quedan en
-- Storage privado, aislados por empresa y accesibles solo con arca.configure.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arca-secrets',
  'arca-secrets',
  false,
  262144,
  array['text/plain','application/x-pem-file','application/pem-certificate-chain','application/octet-stream']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.sigo_arca_storage_empresa_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_first::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.sigo_arca_storage_empresa_id(text) from public;
grant execute on function public.sigo_arca_storage_empresa_id(text) to authenticated;

-- La ruta obligatoria es: <empresa_uuid>/certificate.pem o <empresa_uuid>/private-key.pem
-- El permiso se valida contra la primera carpeta de la ruta.
drop policy if exists sigo_arca_secret_select on storage.objects;
create policy sigo_arca_secret_select on storage.objects
for select to authenticated
using (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')
);

drop policy if exists sigo_arca_secret_insert on storage.objects;
create policy sigo_arca_secret_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')
  and split_part(name, '/', 2) in ('certificate.pem','private-key.pem')
);

drop policy if exists sigo_arca_secret_update on storage.objects;
create policy sigo_arca_secret_update on storage.objects
for update to authenticated
using (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')
)
with check (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')
  and split_part(name, '/', 2) in ('certificate.pem','private-key.pem')
);

drop policy if exists sigo_arca_secret_delete on storage.objects;
create policy sigo_arca_secret_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.es_owner_empresa(public.sigo_arca_storage_empresa_id(name))
);

comment on function public.sigo_arca_storage_empresa_id(text) is
  'SIGO: extrae de forma segura el tenant de una ruta privada ARCA para aplicar RLS en Storage.';
