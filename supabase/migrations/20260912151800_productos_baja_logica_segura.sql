-- SIGO: baja lógica segura de productos sin borrar históricos ni stock.
-- Conserva referencias de ventas/compras, impide dar de baja con stock distinto de cero
-- y bloquea mutaciones operativas de stock/costos mientras el producto está inactivo.

alter table public.productos
  add column if not exists activo boolean;

update public.productos
set activo = true
where activo is null;

alter table public.productos
  alter column activo set default true,
  alter column activo set not null;

create or replace function public.proteger_producto_inactivo_sigo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.activo = true and new.activo = false and coalesce(old.stock_actual, 0) <> 0 then
    raise exception 'PRODUCT_HAS_STOCK';
  end if;

  if old.activo = false and (
    new.stock_actual is distinct from old.stock_actual
    or new.costo_actual is distinct from old.costo_actual
    or new.costo_ultima_compra is distinct from old.costo_ultima_compra
  ) then
    raise exception 'PRODUCT_INACTIVE';
  end if;

  return new;
end;
$$;

drop trigger if exists productos_inactivos_proteccion_sigo on public.productos;
create trigger productos_inactivos_proteccion_sigo
before update of activo, stock_actual, costo_actual, costo_ultima_compra
on public.productos
for each row
execute function public.proteger_producto_inactivo_sigo();

create or replace function public.eliminar_producto_sigo(
  p_empresa_id uuid,
  p_producto_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto public.productos%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_empresa_id is null or p_producto_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;

  select p.*
    into v_producto
    from public.productos p
   where p.id = p_producto_id
     and p.empresa_id = p_empresa_id;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND_IN_TENANT';
  end if;

  if v_producto.activo = false then
    return true;
  end if;

  if coalesce(v_producto.stock_actual, 0) <> 0 then
    raise exception 'PRODUCT_HAS_STOCK';
  end if;

  update public.productos p
     set activo = false
   where p.id = p_producto_id
     and p.empresa_id = p_empresa_id;

  return true;
end;
$$;

revoke all on function public.eliminar_producto_sigo(uuid, uuid) from public;
grant execute on function public.eliminar_producto_sigo(uuid, uuid) to authenticated;

comment on function public.eliminar_producto_sigo(uuid, uuid) is
  'SIGO: baja lógica tenant-aware. No borra el producto ni históricos y exige stock cero.';

create or replace function public.reactivar_producto_sigo(
  p_empresa_id uuid,
  p_producto_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_empresa_id is null or p_producto_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;

  update public.productos p
     set activo = true
   where p.id = p_producto_id
     and p.empresa_id = p_empresa_id
  returning p.id into v_updated;

  if v_updated is null then
    raise exception 'PRODUCT_NOT_FOUND_IN_TENANT';
  end if;

  return true;
end;
$$;

revoke all on function public.reactivar_producto_sigo(uuid, uuid) from public;
grant execute on function public.reactivar_producto_sigo(uuid, uuid) to authenticated;

comment on function public.reactivar_producto_sigo(uuid, uuid) is
  'SIGO: reactiva un producto previamente dado de baja dentro del mismo tenant.';

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
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_ultima_compra else null end,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')
        then p.precio_venta
      else null
    end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_ganancia else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_porcentaje else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_minimo else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_maximo else null end
  from public.productos p
  where p.empresa_id = p_empresa_id
    and p.activo = true
  order by p.nombre asc;
end;
$$;

revoke all on function public.listar_productos_sigo(uuid) from public;
grant execute on function public.listar_productos_sigo(uuid) to authenticated;

comment on function public.listar_productos_sigo(uuid) is
  'SIGO: catálogo operativo tenant-aware de productos activos; el barcode lookup hereda este filtro.';
