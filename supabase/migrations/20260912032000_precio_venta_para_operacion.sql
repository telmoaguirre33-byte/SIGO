-- SIGO: precio de venta operativo sin exponer costos, márgenes ni listas sensibles.
-- Corrige un bloqueo funcional: seller/admin tienen sales.read/sales.write pero no
-- price_lists.read por defecto. Necesitan ver el precio unitario para poder vender.
-- La lista comercial sensible sigue protegida; sólo se habilita el precio de venta
-- dentro del catálogo/lookup operativo cuando el usuario puede leer o escribir ventas.

create or replace function public.listar_productos_sigo(p_empresa_id uuid)
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
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read') then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    p.id,
    p.empresa_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.descripcion,
    p.categoria,
    p.marca,
    p.proveedor,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_actual
      else null
    end as costo_actual,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_ultima_compra
      else null
    end as costo_ultima_compra,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')
        then p.precio_venta
      else null
    end as precio_venta,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_ganancia
      else null
    end as margen_ganancia,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_porcentaje
      else null
    end as margen_porcentaje,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_actual
      else null
    end as stock_actual,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_minimo
      else null
    end as stock_minimo,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_maximo
      else null
    end as stock_maximo
  from public.productos p
  where p.empresa_id = p_empresa_id
  order by p.nombre asc;
end;
$$;

revoke all on function public.listar_productos_sigo(uuid) from public;
grant execute on function public.listar_productos_sigo(uuid) to authenticated;

comment on function public.listar_productos_sigo(uuid) is
  'SIGO: catálogo tenant-aware; precio de venta visible para operación de ventas, costos/márgenes/listas sensibles sólo con permiso explícito.';
