-- SIGO: defensa final de stock para ventas/compras.
-- No modifica historicos: solo bloquea nuevas inserciones/actualizaciones de detalle
-- cuando el producto no es operativo o conserva identidad LEGACY-DUP pendiente.

create or replace function public.sigo_validar_producto_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto record;
begin
  select id, empresa_id, activo, codigo_interno, stock_actual, costo_actual, precio_venta
    into v_producto
  from public.productos
  where id = new.producto_id
    and empresa_id = new.empresa_id;

  if not found or v_producto.activo is distinct from true then
    raise exception 'PRODUCT_NOT_FOUND';
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

-- La excepcion ocurre dentro de la misma transaccion de la RPC, por lo que cualquier
-- intento invalido revierte cabecera, detalle, caja/cuenta corriente y stock.
drop trigger if exists trg_sigo_guard_venta_producto_operativo on public.venta_items_sigo;
create trigger trg_sigo_guard_venta_producto_operativo
before insert or update of producto_id, empresa_id
on public.venta_items_sigo
for each row execute function public.sigo_validar_producto_movimiento();

drop trigger if exists trg_sigo_guard_compra_producto_operativo on public.compra_items_sigo;
create trigger trg_sigo_guard_compra_producto_operativo
before insert or update of producto_id, empresa_id
on public.compra_items_sigo
for each row execute function public.sigo_validar_producto_movimiento();

comment on function public.sigo_validar_producto_movimiento() is
  'SIGO: ultima barrera DB contra movimientos de stock sobre productos inactivos, con identidad LEGACY-DUP o valores operativos nulos.';
