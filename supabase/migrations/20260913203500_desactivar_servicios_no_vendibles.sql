-- SIGO: preservar stock e histórico pero sacar del circuito operativo los servicios
-- que el negocio indicó expresamente que no son mercadería: fotocopias y Film impresora.
-- Se usa una categoría técnica en vez de baja lógica porque la baja segura prohíbe
-- inactivar productos con stock distinto de cero. No borra ni pone stock en cero.
do $$
declare
  v_empresa_id uuid;
  v_changed integer := 0;
begin
  select e.id
    into v_empresa_id
    from public.empresas e
   where lower(btrim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   limit 1;

  if v_empresa_id is null then
    raise exception 'SIGO_NONSELLABLE_CLEANUP_TENANT_NOT_FOUND';
  end if;

  update public.productos p
     set categoria = 'NO_VENDIBLE'
   where p.empresa_id = v_empresa_id
     and (
       lower(btrim(p.nombre)) like 'fotocopia%'
       or lower(btrim(p.nombre)) = 'film impresora'
     )
     and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE';

  get diagnostics v_changed = row_count;
  raise notice 'SIGO_NONSELLABLE_SERVICES_CLASSIFIED changed=%', v_changed;
end
$$;

-- El catálogo operativo conserva los productos para trazabilidad, pero no los ofrece
-- para venta/compra/escaneo cuando están clasificados como NO_VENDIBLE.
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
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
  order by p.nombre asc;
end;
$$;

revoke all on function public.listar_productos_sigo(uuid) from public;
grant execute on function public.listar_productos_sigo(uuid) to authenticated;

comment on function public.listar_productos_sigo(uuid) is
  'SIGO: catálogo operativo tenant-aware de productos activos y vendibles; conserva fuera del circuito servicios NO_VENDIBLE.';

-- Defensa final DB: aunque alguien intente forzar el ID fuera de la UI, una compra o
-- venta no puede mover stock de un servicio marcado NO_VENDIBLE.
create or replace function public.sigo_validar_producto_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto record;
begin
  select id, empresa_id, activo, codigo_interno, categoria, stock_actual, costo_actual, precio_venta
    into v_producto
  from public.productos
  where id = new.producto_id
    and empresa_id = new.empresa_id;

  if not found or v_producto.activo is distinct from true then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  if upper(trim(coalesce(v_producto.categoria, ''))) = 'NO_VENDIBLE' then
    raise exception 'PRODUCT_NOT_SELLABLE';
  end if;

  if upper(trim(coalesce(v_producto.codigo_interno, ''))) like 'LEGACY-DUP-%' then
    raise exception 'PRODUCT_IDENTITY_REVIEW_REQUIRED';
  end if;

  if v_producto.stock_actual is null then
    raise exception 'PRODUCT_STOCK_REQUIRED';
  end if;

  if v_producto.costo_actual is null then
    raise exception 'PRODUCT_COST_REQUIRED';
  end if;

  if tg_table_name = 'venta_items_sigo'
     and (v_producto.precio_venta is null or v_producto.precio_venta <= 0) then
    raise exception 'PRODUCT_PRICE_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.sigo_validar_producto_movimiento() from public;

comment on function public.sigo_validar_producto_movimiento() is
  'SIGO: barrera DB contra movimientos sobre productos inactivos, NO_VENDIBLE, LEGACY-DUP o con valores operativos nulos.';
