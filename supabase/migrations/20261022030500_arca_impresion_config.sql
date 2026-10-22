-- PREPARED ONLY: separate approval required before applying to shared DBs.
-- Print metadata only. Does not alter the authorized arca_config or credentials.
begin;
create table if not exists public.arca_impresion_config (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  punto_venta integer not null check (punto_venta between 1 and 99998),
  primary key (empresa_id, punto_venta),
  cuit_emisor text not null check (cuit_emisor ~ '^[0-9]{11}$'),
  domicilio text not null check (length(domicilio) between 4 and 240),
  condicion_iva text not null check (condicion_iva in ('IVA RESPONSABLE INSCRITO','IVA EXENTO','NO RESPONSABLE IVA','RESPONSABLE MONOTRIBUTO','MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO','MONOTRIBUTISTA SOCIAL')),
  ingresos_brutos text not null check (length(ingresos_brutos) between 2 and 80),
  inicio_actividades date,
  excepcion_inicio text check (excepcion_inicio in ('profesional_universitario_honorarios','servicios_sin_local_atencion')),
  updated_at timestamptz not null default now(),
  check ((inicio_actividades is not null and excepcion_inicio is null) or (inicio_actividades is null and excepcion_inicio is not null))
);
alter table public.arca_impresion_config enable row level security;
create policy arca_impresion_read on public.arca_impresion_config for select to authenticated
  using (public.tiene_permiso_empresa(empresa_id, 'invoices.issue'));
create policy arca_impresion_insert on public.arca_impresion_config for insert to authenticated
  with check (public.tiene_permiso_empresa(empresa_id, 'arca.configure') and exists (
    select 1 from public.arca_config c where c.empresa_id = arca_impresion_config.empresa_id and c.cuit_emisor = arca_impresion_config.cuit_emisor
    and exists (select 1 from public.arca_puntos_venta p where p.empresa_id = c.empresa_id and p.ambiente = c.ambiente and p.numero = arca_impresion_config.punto_venta and p.activo)
  ));
create policy arca_impresion_update on public.arca_impresion_config for update to authenticated
  using (public.tiene_permiso_empresa(empresa_id, 'arca.configure'))
  with check (public.tiene_permiso_empresa(empresa_id, 'arca.configure') and exists (
    select 1 from public.arca_config c where c.empresa_id = arca_impresion_config.empresa_id and c.cuit_emisor = arca_impresion_config.cuit_emisor
    and exists (select 1 from public.arca_puntos_venta p where p.empresa_id = c.empresa_id and p.ambiente = c.ambiente and p.numero = arca_impresion_config.punto_venta and p.activo)
  ));
grant select, insert, update on public.arca_impresion_config to authenticated;
commit;
