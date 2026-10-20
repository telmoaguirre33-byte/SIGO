-- SIGO: búsqueda segura de productos por código de barras/código interno.
-- Reutiliza la función tenant-aware listar_productos_sigo para mantener
-- el enmascarado de costos, precios, márgenes y stock según permisos.

create or replace function public.buscar_producto_codigo_sigo(
  p_empresa_id uuid,
  p_codigo text
)
returns table (
  id uuid,
  empresa_id uuid,
  codigo_interno text,
  codigo_barras text,
  nombre text,
  descripcion text,
  categoria text,
  marca text,
  proveedor text,
  costo_actual numeric,
  costo_ultima_compra numeric,
  precio_venta numeric,
  margen_ganancia numeric,
  margen_porcentaje numeric,
  stock_actual numeric,
  stock_minimo numeric,
  stock_maximo numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_codigo := btrim(coalesce(p_codigo, ''));
  if v_codigo = '' then
    raise exception 'CODIGO_REQUIRED';
  end if;

  if length(v_codigo) > 128 then
    raise exception 'CODIGO_INVALIDO';
  end if;

  return query
  select p.*
  from public.listar_productos_sigo(p_empresa_id) p
  where p.codigo_barras = v_codigo
     or p.codigo_interno = v_codigo
  order by
    case when p.codigo_barras = v_codigo then 0 else 1 end,
    p.nombre asc
  limit 10;
end;
$$;

revoke all on function public.buscar_producto_codigo_sigo(uuid, text) from public;
grant execute on function public.buscar_producto_codigo_sigo(uuid, text) to authenticated;

comment on function public.buscar_producto_codigo_sigo(uuid, text) is
  'SIGO: lookup tenant-aware por pistola, cámara o ingreso manual; datos sensibles respetan permisos del usuario.';

-- Índices parciales para acelerar escaneo sin alterar ni deduplicar datos legacy.
create index if not exists idx_productos_empresa_codigo_barras
  on public.productos (empresa_id, codigo_barras)
  where codigo_barras is not null and btrim(codigo_barras) <> '';

create index if not exists idx_productos_empresa_codigo_interno
  on public.productos (empresa_id, codigo_interno)
  where codigo_interno is not null and btrim(codigo_interno) <> '';
