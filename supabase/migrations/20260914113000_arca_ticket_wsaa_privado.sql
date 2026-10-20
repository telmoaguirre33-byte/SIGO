-- SIGO: cache privado del Ticket de Acceso WSAA por tenant y ambiente.
-- Evita pedir un segundo TA mientras el anterior sigue vigente. Token y Sign
-- nunca se guardan en tablas públicas ni se envían al navegador.

update storage.buckets
set allowed_mime_types = array[
  'text/plain',
  'application/x-pem-file',
  'application/pem-certificate-chain',
  'application/octet-stream',
  'application/json'
]::text[]
where id = 'arca-secrets';

drop policy if exists sigo_arca_secret_insert on storage.objects;
create policy sigo_arca_secret_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'arca.configure')
  and split_part(name, '/', 2) in (
    'certificate.pem',
    'private-key.pem',
    'ticket-wsfe-homologacion.json',
    'ticket-wsfe-produccion.json'
  )
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
  and split_part(name, '/', 2) in (
    'certificate.pem',
    'private-key.pem',
    'ticket-wsfe-homologacion.json',
    'ticket-wsfe-produccion.json'
  )
);

drop policy if exists sigo_arca_ticket_select on storage.objects;
create policy sigo_arca_ticket_select on storage.objects
for select to authenticated
using (
  bucket_id = 'arca-secrets'
  and public.sigo_arca_storage_empresa_id(name) is not null
  and split_part(name, '/', 2) in ('ticket-wsfe-homologacion.json', 'ticket-wsfe-produccion.json')
  and public.tiene_permiso_empresa(public.sigo_arca_storage_empresa_id(name), 'invoices.issue')
);

comment on policy sigo_arca_ticket_select on storage.objects is
  'SIGO: emisores fiscales pueden usar el TA privado vigente; nunca pueden leer certificate.pem ni private-key.pem por este permiso.';
