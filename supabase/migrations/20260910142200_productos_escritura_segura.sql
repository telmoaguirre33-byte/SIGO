-- SIGO: escritura segura de productos por tenant.
-- Evita que el frontend escriba productos de otra empresa y evita que roles sin
-- permiso sensible alteren costos, precios, márgenes o stock por parámetros.
-- No modifica ni reasigna datos existentes.

create or replace function public.guardar_producto_sigo(
  p_empresa_id uuid,
  p_producto_id uuid default null,
  p_codigo_interno text default null,
  p_codigo_barras text default null,
  p_nombre text default null,
  p_descripcion text default null,
  p_categoria text default null,
  p_marca text default null,
  p_proveedor text default null,
  p_costo_actual numeric default null,
  p_costo_ultima_compra numeric default null,
  p_precio_venta numeric default null,
  p_margen_ganancia numeric default null,
  p_margen_porcentaje numeric default null,
  p_stock_actual numeric default null,
  p_stock_minimo numeric default null,
  p_stock_maximo numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_empresa_id is null
     or not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;

  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is null then
    raise exception 'PRODUCT_NAME_REQUIRED';
  end if;

  if p_producto_id is null then
    insert into public.productos (
      empresa_id,
      codigo_interno,
      codigo_barras,
      nombre,
      descripcion,
      categoria,
      marca,
      proveedor,
      costo_actual,
      costo_ultima_compra,
      precio_venta,
      margen_ganancia,
      margen_porcentaje,
      stock_actual,
      stock_minimo,
      stock_maximo
    ) values (
      p_empresa_id,
      nullif(btrim(p_codigo_interno), ''),
      nullif(btrim(p_codigo_barras), ''),
      v_nombre,
      nullif(btrim(p_descripcion), ''),
      nullif(btrim(p_categoria), ''),
      nullif(btrim(p_marca), ''),
      nullif(btrim(p_proveedor), ''),
      case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p_costo_actual else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p_costo_ultima_compra else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read') then p_precio_venta else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p_margen_ganancia else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p_margen_porcentaje else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_actual else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_minimo else null end,
      case when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_maximo else null end
    )
    returning id into v_id;
  else
    update public.productos p
       set codigo_interno = nullif(btrim(p_codigo_interno), ''),
           codigo_barras = nullif(btrim(p_codigo_barras), ''),
           nombre = v_nombre,
           descripcion = nullif(btrim(p_descripcion), ''),
           categoria = nullif(btrim(p_categoria), ''),
           marca = nullif(btrim(p_marca), ''),
           proveedor = nullif(btrim(p_proveedor), ''),
           costo_actual = case
             when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p_costo_actual
             else p.costo_actual
           end,
           costo_ultima_compra = case
             when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p_costo_ultima_compra
             else p.costo_ultima_compra
           end,
           precio_venta = case
             when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read') then p_precio_venta
             else p.precio_venta
           end,
           margen_ganancia = case
             when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p_margen_ganancia
             else p.margen_ganancia
           end,
           margen_porcentaje = case
             when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p_margen_porcentaje
             else p.margen_porcentaje
           end,
           stock_actual = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_actual
             else p.stock_actual
           end,
           stock_minimo = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_minimo
             else p.stock_minimo
           end,
           stock_maximo = case
             when public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then p_stock_maximo
             else p.stock_maximo
           end
     where p.id = p_producto_id
       and p.empresa_id = p_empresa_id
     returning p.id into v_id;

    if v_id is null then
      raise exception 'PRODUCT_NOT_FOUND_IN_TENANT';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.guardar_producto_sigo(
  uuid, uuid, text, text, text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) from public;

grant execute on function public.guardar_producto_sigo(
  uuid, uuid, text, text, text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated;

comment on function public.guardar_producto_sigo(
  uuid, uuid, text, text, text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) is
  'SIGO: alta/edición de producto limitada al tenant y con protección de campos sensibles según permisos.';
