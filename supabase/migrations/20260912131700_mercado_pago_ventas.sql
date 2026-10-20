-- SIGO: incorpora Mercado Pago como medio de cobro de primera clase.
-- Migracion no destructiva: conserva ventas historicas y amplia la validacion existente.

alter table public.ventas_sigo
  drop constraint if exists ventas_sigo_medio_pago_check;

alter table public.ventas_sigo
  add constraint ventas_sigo_medio_pago_check
  check (medio_pago in ('efectivo','debito','credito','transferencia','mercado_pago','cuenta_corriente','otro'));

create or replace function public.confirmar_venta_sigo_v2(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago text default 'efectivo',
  p_idempotency_key text default null,
  p_cliente_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_existente_medio text;
  v_existente_cliente uuid;
  v_item jsonb;
  v_producto record;
  v_producto_id uuid;
  v_cliente record;
  v_cantidad numeric(14,3);
  v_total numeric(14,2) := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','mercado_pago','cuenta_corriente','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'SALE_TOO_MANY_ITEMS'; end if;

  select id, medio_pago, cliente_id
    into v_venta_id, v_existente_medio, v_existente_cliente
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;

  if v_venta_id is not null then
    if v_existente_medio is distinct from p_medio_pago
       or v_existente_cliente is distinct from p_cliente_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_venta_id;
  end if;

  if p_cliente_id is not null then
    if not public.tiene_permiso_empresa(p_empresa_id, 'clients.read') then raise exception 'CLIENTS_READ_FORBIDDEN'; end if;
    select id, saldo_actual, limite_credito into v_cliente
    from public.clientes_sigo
    where id = p_cliente_id and empresa_id = p_empresa_id and activo = true
    for update;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  elsif p_medio_pago = 'cuenta_corriente' then
    raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT';
  end if;

  insert into public.ventas_sigo (empresa_id, cliente_id, total, medio_pago, idempotency_key, created_by)
  values (p_empresa_id, p_cliente_id, 0, p_medio_pago, v_key, v_user_id)
  returning id into v_venta_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'SALE_ITEM_INVALID'; end if;

    begin
      v_producto_id := nullif(trim(v_item->>'producto_id'), '')::uuid;
      v_cantidad := nullif(trim(v_item->>'cantidad'), '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'SALE_ITEM_INVALID';
    end;

    if v_producto_id is null then raise exception 'SALE_ITEM_INVALID'; end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity') then
      raise exception 'SALE_QUANTITY_INVALID';
    end if;

    select id, empresa_id, nombre, precio_venta, stock_actual
    into v_producto
    from public.productos
    where id = v_producto_id
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

  if p_medio_pago = 'cuenta_corriente' and v_cliente.limite_credito is not null
     and v_cliente.saldo_actual + v_total > v_cliente.limite_credito then
    raise exception 'CREDIT_LIMIT_EXCEEDED';
  end if;

  update public.ventas_sigo
  set total = v_total, cliente_id = p_cliente_id
  where id = v_venta_id and empresa_id = p_empresa_id;

  if p_medio_pago = 'cuenta_corriente' then
    insert into public.cliente_movimientos_sigo (empresa_id, cliente_id, venta_id, tipo, importe, concepto, created_by)
    values (p_empresa_id, p_cliente_id, v_venta_id, 'debe', v_total, 'Venta SIGO', v_user_id);

    update public.clientes_sigo
    set saldo_actual = saldo_actual + v_total, updated_at = now()
    where id = p_cliente_id and empresa_id = p_empresa_id;
  else
    insert into public.caja_movimientos_sigo (empresa_id, venta_id, tipo, medio_pago, importe, concepto, created_by)
    values (p_empresa_id, v_venta_id, 'ingreso', p_medio_pago, v_total, 'Venta SIGO', v_user_id);
  end if;

  return v_venta_id;
exception
  when unique_violation then
    select id, medio_pago, cliente_id
      into v_venta_id, v_existente_medio, v_existente_cliente
    from public.ventas_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;

    if v_venta_id is not null then
      if v_existente_medio is distinct from p_medio_pago
         or v_existente_cliente is distinct from p_cliente_id then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_venta_id;
    end if;
    raise;
end;
$$;

revoke all on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) from public;
grant execute on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) to authenticated;

comment on function public.confirmar_venta_sigo_v2(uuid, jsonb, text, text, uuid) is
  'SIGO: venta atomica tenant-safe con stock, caja/cuenta corriente, Mercado Pago, cliente autorizado e idempotencia consistente ante reintentos.';
