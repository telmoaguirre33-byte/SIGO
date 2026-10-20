-- SIGO: evita ventas a cuenta corriente sin cliente/deuda asociada.
-- Hasta que Clientes/Cuentas Corrientes esté integrado, este medio de pago queda bloqueado
-- en backend para impedir descuentos de stock sin asiento de caja ni saldo de cliente.

create or replace function public.confirmar_venta_sigo(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago text default 'efectivo',
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_item jsonb;
  v_producto record;
  v_cantidad numeric(14,3);
  v_total numeric(14,2) := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','otro') then
    if p_medio_pago = 'cuenta_corriente' then
      raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT';
    end if;
    raise exception 'PAYMENT_METHOD_INVALID';
  end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;

  select id into v_venta_id
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_venta_id is not null then return v_venta_id; end if;

  insert into public.ventas_sigo (empresa_id, total, medio_pago, idempotency_key, created_by)
  values (p_empresa_id, 0, p_medio_pago, v_key, v_user_id)
  returning id into v_venta_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_cantidad := nullif((v_item->>'cantidad')::numeric, 0);
    if v_cantidad is null or v_cantidad <= 0 then raise exception 'SALE_QUANTITY_INVALID'; end if;

    select id, empresa_id, nombre, precio_venta, stock_actual
      into v_producto
      from public.productos
      where id = (v_item->>'producto_id')::uuid
        and empresa_id = p_empresa_id
      for update;

    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_producto.precio_venta is null then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual is null then raise exception 'PRODUCT_STOCK_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual < v_cantidad then raise exception 'INSUFFICIENT_STOCK: %', v_producto.nombre; end if;

    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_producto.precio_venta, round(v_producto.precio_venta * v_cantidad, 2));

    update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = v_producto.id and empresa_id = p_empresa_id;

    v_total := v_total + round(v_producto.precio_venta * v_cantidad, 2);
  end loop;

  update public.ventas_sigo set total = v_total where id = v_venta_id;

  insert into public.caja_movimientos_sigo (empresa_id, venta_id, tipo, medio_pago, importe, concepto, created_by)
  values (p_empresa_id, v_venta_id, 'ingreso', p_medio_pago, v_total, 'Venta SIGO', v_user_id);

  return v_venta_id;
exception
  when unique_violation then
    select id into v_venta_id
    from public.ventas_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_venta_id is not null then return v_venta_id; end if;
    raise;
end;
$$;

revoke all on function public.confirmar_venta_sigo(uuid, jsonb, text, text) from public;
grant execute on function public.confirmar_venta_sigo(uuid, jsonb, text, text) to authenticated;

comment on function public.confirmar_venta_sigo(uuid, jsonb, text, text) is
  'SIGO: venta atomica con stock y caja. Cuenta corriente se bloquea hasta exigir cliente y generar deuda asociada.';
