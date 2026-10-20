-- SIGO: base segura para facturación electrónica ARCA por empresa.
-- Objetivo: preparar WSAA + WSFEv1, homologación/producción, certificados
-- y puntos de venta separados por tenant SIN almacenar clave fiscal.

create table if not exists public.arca_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ambiente text not null default 'homologacion'
    check (ambiente in ('homologacion','produccion')),
  cuit_emisor text not null,
  razon_social text,
  certificado_ref text,
  certificado_fingerprint text,
  certificado_vence timestamptz,
  wsaa_service text not null default 'wsfe',
  wsfe_version text not null default 'WSFEv1',
  activo boolean not null default false,
  ultima_prueba_at timestamptz,
  ultima_prueba_ok boolean,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arca_config_cuit_formato
    check (cuit_emisor ~ '^[0-9]{11}$'),
  constraint arca_config_no_clave_fiscal
    check (
      coalesce(lower(certificado_ref), '') not like '%clave fiscal%'
      and coalesce(lower(certificado_ref), '') not like '%password%'
      and coalesce(lower(certificado_ref), '') not like '%contrasena%'
      and coalesce(lower(certificado_ref), '') not like '%contraseña%'
    )
);

comment on table public.arca_config is
  'SIGO: configuración ARCA por empresa. certificado_ref debe apuntar a un secreto/certificado gestionado fuera de tablas públicas. Nunca almacenar clave fiscal.';
comment on column public.arca_config.certificado_ref is
  'Referencia opaca a certificado/clave privada en almacenamiento seguro. No guardar PEM privado ni clave fiscal en esta tabla.';

create table if not exists public.arca_puntos_venta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero integer not null check (numero between 1 and 99999),
  nombre text,
  ambiente text not null default 'homologacion'
    check (ambiente in ('homologacion','produccion')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, ambiente, numero)
);

create index if not exists arca_puntos_venta_empresa_idx
  on public.arca_puntos_venta(empresa_id, ambiente, activo);

create table if not exists public.arca_comprobantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  punto_venta integer not null,
  tipo_cbte integer not null,
  numero_cbte bigint not null,
  cae text,
  cae_vencimiento date,
  resultado text,
  observaciones jsonb not null default '[]'::jsonb,
  request_id text,
  emitido_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (empresa_id, punto_venta, tipo_cbte, numero_cbte)
);

create index if not exists arca_comprobantes_empresa_fecha_idx
  on public.arca_comprobantes(empresa_id, emitido_at desc);

-- RLS: siempre aislado por empresa. Configuración solo con permiso explícito.
alter table public.arca_config enable row level security;
alter table public.arca_puntos_venta enable row level security;
alter table public.arca_comprobantes enable row level security;

drop policy if exists arca_config_select on public.arca_config;
create policy arca_config_select on public.arca_config
for select to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'arca.configure'));

drop policy if exists arca_config_insert on public.arca_config;
create policy arca_config_insert on public.arca_config
for insert to authenticated
with check (public.tiene_permiso_empresa(empresa_id, 'arca.configure'));

drop policy if exists arca_config_update on public.arca_config;
create policy arca_config_update on public.arca_config
for update to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'arca.configure'))
with check (public.tiene_permiso_empresa(empresa_id, 'arca.configure'));

drop policy if exists arca_config_delete on public.arca_config;
create policy arca_config_delete on public.arca_config
for delete to authenticated
using (public.es_owner_empresa(empresa_id));

drop policy if exists arca_pv_select on public.arca_puntos_venta;
create policy arca_pv_select on public.arca_puntos_venta
for select to authenticated
using (
  public.tiene_permiso_empresa(empresa_id, 'arca.configure')
  or public.tiene_permiso_empresa(empresa_id, 'invoices.issue')
);

drop policy if exists arca_pv_write on public.arca_puntos_venta;
create policy arca_pv_write on public.arca_puntos_venta
for all to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'arca.configure'))
with check (public.tiene_permiso_empresa(empresa_id, 'arca.configure'));

drop policy if exists arca_cbte_select on public.arca_comprobantes;
create policy arca_cbte_select on public.arca_comprobantes
for select to authenticated
using (
  public.tiene_permiso_empresa(empresa_id, 'invoices.issue')
  or public.tiene_permiso_empresa(empresa_id, 'reports.read')
);

-- La emisión final debe pasar por backend/Edge Function con WSAA+WSFEv1.
-- Se permite insertar metadata solo a usuarios con invoices.issue; nunca se expone
-- ninguna credencial de ARCA al frontend.
drop policy if exists arca_cbte_insert on public.arca_comprobantes;
create policy arca_cbte_insert on public.arca_comprobantes
for insert to authenticated
with check (public.tiene_permiso_empresa(empresa_id, 'invoices.issue'));

drop policy if exists arca_cbte_update on public.arca_comprobantes;
create policy arca_cbte_update on public.arca_comprobantes
for update to authenticated
using (public.tiene_permiso_empresa(empresa_id, 'invoices.issue'))
with check (public.tiene_permiso_empresa(empresa_id, 'invoices.issue'));

-- Borrado de comprobantes fiscales bloqueado desde clientes.
drop policy if exists arca_cbte_delete_bloqueado on public.arca_comprobantes;
create policy arca_cbte_delete_bloqueado on public.arca_comprobantes
for delete to authenticated
using (false);

revoke all on table public.arca_config from anon;
revoke all on table public.arca_puntos_venta from anon;
revoke all on table public.arca_comprobantes from anon;

grant select, insert, update, delete on public.arca_config to authenticated;
grant select, insert, update, delete on public.arca_puntos_venta to authenticated;
grant select, insert, update on public.arca_comprobantes to authenticated;
