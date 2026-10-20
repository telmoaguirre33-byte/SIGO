-- SIGO: Portal Cliente opcional, aislado por empresa y cliente.
-- No expone costos, márgenes ni información interna sensible.
-- Esta migración es aditiva y no modifica datos operativos existentes.

create table if not exists public.portal_cliente_usuarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cliente_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, cliente_id, user_id)
);

create table if not exists public.portal_stock_publicado (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cliente_id uuid not null,
  producto_id uuid not null,
  publicado boolean not null default true,
  stock_comercial numeric,
  consumo_diario_estimado numeric,
  dias_objetivo numeric not null default 15,
  umbral_amarillo numeric not null default 7,
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, cliente_id, producto_id),
  check (stock_comercial is null or stock_comercial >= 0),
  check (consumo_diario_estimado is null or consumo_diario_estimado >= 0),
  check (dias_objetivo > 0),
  check (umbral_amarillo >= 0 and umbral_amarillo <= dias_objetivo)
);

create index if not exists portal_cliente_usuarios_user_idx
  on public.portal_cliente_usuarios (user_id, empresa_id, cliente_id)
  where activo = true;

create index if not exists portal_stock_publicado_lookup_idx
  on public.portal_stock_publicado (empresa_id, cliente_id, producto_id)
  where publicado = true;

alter table public.portal_cliente_usuarios enable row level security;
alter table public.portal_stock_publicado enable row level security;

-- No concedemos SELECT directo a authenticated. El portal lee únicamente mediante
-- la RPC siguiente, que valida simultáneamente usuario, empresa y cliente.
revoke all on public.portal_cliente_usuarios from anon, authenticated;
revoke all on public.portal_stock_publicado from anon, authenticated;

create or replace function public.portal_cliente_catalogo_sigo(p_empresa_id uuid)
returns table (
  producto_id uuid,
  codigo_interno text,
  codigo_barras text,
  nombre text,
  marca text,
  categoria text,
  stock_comercial numeric,
  consumo_diario_estimado numeric,
  dias_cobertura numeric,
  semaforo text,
  sugerencia_compra numeric,
  actualizado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select u.cliente_id
    into v_cliente_id
  from public.portal_cliente_usuarios u
  where u.user_id = auth.uid()
    and u.empresa_id = p_empresa_id
    and u.activo = true
  order by u.creado_en asc
  limit 1;

  if v_cliente_id is null then
    raise exception 'PORTAL_FORBIDDEN';
  end if;

  return query
  select
    p.id as producto_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.marca,
    p.categoria,
    s.stock_comercial,
    s.consumo_diario_estimado,
    case
      when coalesce(s.consumo_diario_estimado, 0) > 0
        then round(s.stock_comercial / s.consumo_diario_estimado, 1)
      else null
    end as dias_cobertura,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 'SIN_DATOS'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.dias_objetivo then 'VERDE'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.umbral_amarillo then 'AMARILLO'
      else 'ROJO'
    end as semaforo,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 0::numeric
      else greatest(0::numeric, ceil((s.dias_objetivo * s.consumo_diario_estimado) - s.stock_comercial))
    end as sugerencia_compra,
    s.actualizado_en
  from public.portal_stock_publicado s
  join public.productos p
    on p.id = s.producto_id
   and p.empresa_id = s.empresa_id
  where s.empresa_id = p_empresa_id
    and s.cliente_id = v_cliente_id
    and s.publicado = true
  order by p.nombre asc;
end;
$$;

revoke all on function public.portal_cliente_catalogo_sigo(uuid) from public;
grant execute on function public.portal_cliente_catalogo_sigo(uuid) to authenticated;

comment on function public.portal_cliente_catalogo_sigo(uuid) is
  'SIGO Portal Cliente: catálogo publicado del cliente autenticado, aislado por tenant, con cobertura, semáforo y sugerencia de compra; nunca expone costos ni márgenes.';
