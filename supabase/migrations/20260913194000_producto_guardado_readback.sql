-- SIGO: verificación post-guardado del maestro de productos.
-- Objetivo: no dar por exitosa un alta/edición hasta demostrar en la DB real que
-- el producto quedó en el tenant correcto y con costo/stock operativos no nulos.
-- No modifica productos, stock ni históricos.

create or replace function public.verificar_producto_guardado_sigo(
  p_empresa_id uuid,
  p_producto_id uuid
)
returns table (
  id uuid,
  empresa_id uuid,
  nombre text,
  codigo_interno text,
  codigo_barras text,
  costo_actual numeric,
  costo_ultima_compra numeric,
  precio_venta numeric,
  stock_actual numeric,
  activo boolean
)
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
    raise exception 'PRODUCT_VERIFY_INPUT_REQUIRED';
  end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;

  select p.*
    into v_producto
    from public.productos p
   where p.id = p_producto_id
     and p.empresa_id = p_empresa_id
   limit 1;

  if not found then
    raise exception 'PRODUCT_SAVE_NOT_VISIBLE';
  end if;
  if v_producto.activo is not true then
    raise exception 'PRODUCT_SAVE_INACTIVE';
  end if;
  if v_producto.costo_actual is null or v_producto.costo_actual < 0 then
    raise exception 'PRODUCT_SAVE_CURRENT_COST_INVALID';
  end if;
  if v_producto.costo_ultima_compra is null or v_producto.costo_ultima_compra < 0 then
    raise exception 'PRODUCT_SAVE_LAST_COST_INVALID';
  end if;
  if v_producto.stock_actual is null or v_producto.stock_actual < 0 then
    raise exception 'PRODUCT_SAVE_STOCK_INVALID';
  end if;
  if v_producto.precio_venta is null or v_producto.precio_venta < 0 then
    raise exception 'PRODUCT_SAVE_PRICE_INVALID';
  end if;

  return query
  select
    v_producto.id,
    v_producto.empresa_id,
    v_producto.nombre,
    v_producto.codigo_interno,
    v_producto.codigo_barras,
    v_producto.costo_actual,
    v_producto.costo_ultima_compra,
    v_producto.precio_venta,
    v_producto.stock_actual,
    v_producto.activo;
end;
$$;

revoke all on function public.verificar_producto_guardado_sigo(uuid, uuid) from public;
grant execute on function public.verificar_producto_guardado_sigo(uuid, uuid) to authenticated;

comment on function public.verificar_producto_guardado_sigo(uuid, uuid) is
  'SIGO: lectura post-guardado tenant-safe para certificar alta/edición sin costo_actual/stock NULL; no muta datos.';