create table if not exists public.configuracion_ticket_sigo (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  nombre_negocio text not null default '',
  direccion text not null default '',
  logo_data_url text,
  updated_at timestamptz not null default now(),
  check (length(nombre_negocio) <= 120 and length(direccion) <= 240 and length(coalesce(logo_data_url,'')) <= 180000)
);
alter table public.configuracion_ticket_sigo enable row level security;
create policy configuracion_ticket_select on public.configuracion_ticket_sigo for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'sales.read'));
create policy configuracion_ticket_insert on public.configuracion_ticket_sigo for insert to authenticated
with check (public.tiene_permiso_empresa(empresa_id, 'sales.write'));
create policy configuracion_ticket_update on public.configuracion_ticket_sigo for update to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'sales.write'))
with check (public.tiene_permiso_empresa(empresa_id, 'sales.write'));
grant select, insert, update on public.configuracion_ticket_sigo to authenticated;
