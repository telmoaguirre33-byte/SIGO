-- SIGO: idempotencia fuerte por payload y bloqueo explícito de productos inactivos.
-- Migración no destructiva: agrega metadatos de huella, retrocompleta históricos y
-- reemplaza RPCs transaccionales sin borrar ventas, compras, stock ni detalles.

alter table public.ventas_sigo
  add column if not exists request_fingerprint text;

alter table public.compras_sigo
  add column if not exists request_fingerprint text;

-- Retrocompleta la huella de ventas históricas a partir de su cabecera + detalle persistido.
update public.ventas_sigo v
set request_fingerprint = md5(
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'producto_id', x.producto_id::text,
        'cantidad', to_char(x.cantidad, 'FM999999999999990.000')
      ) order by x.producto_id
    )::text
    from (
      select vi.producto_id, sum(vi.cantidad)::numeric(14,3) as cantidad
      from public.venta_items_sigo vi
      where vi.venta_id = v.id
      group by vi.producto_id
    ) x
  ), '[]')
  || '|' || coalesce(v.medio_pago, '')
  || '|' || coalesce(v.cliente_id::text, '')
)
where v.request_fingerprint is null;

-- Retrocompleta la huella de compras históricas a partir de cabecera + detalle persistido.
update public.compras_sigo c
set request_fingerprint = md5(
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'producto_id', ci.producto_id::text,
        'cantidad', to_char(ci.cantidad, 'FM999999999999990.000'),
        'costo_unitario', to_char(ci.costo_unitario, 'FM999999999999990.0000')
      ) order by ci.producto_id
    )::text
    from public.compra_items_sigo ci
    where ci.compra_id = c.id
  ), '[]')
  || '|' || coalesce(c.proveedor_id::text, '')
  || '|' || coalesce(c.fecha_compra::text, '')
  || '|' || coalesce(c.tipo_comprobante, '')
  || '|' || coalesce(c.numero_comprobante, '')
)
where c.request_fingerprint is null;

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
  v_existente_fingerprint text;
  v_request_fingerprint text;
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

  -- Validación de forma previa: permite construir una huella canónica sin depender del stock mutable.
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
  end loop;

  select md5(
    coalesce(jsonb_agg(
      jsonb_build_object(
        'producto_id', n.producto_id::text,
        'cantidad', to_char(n.cantidad, 'FM999999999999990.000')
      ) order by n.producto_id
    )::text, '[]')
    || '|' || coalesce(p_medio_pago, '')
    || '|' || coalesce(p_cliente_id::text, '')
  )
  into v_request_fingerprint
  from (
    select
      (trim(j.value->>'producto_id'))::uuid as producto_id,
      sum((trim(j.value->>'cantidad'))::numeric)::numeric(14,3) as cantidad
    from jsonb_array_elements(p_items) j(value)
    group by (trim(j.value->>'producto_id'))::uuid
  ) n;

  select id, medio_pago, cliente_id, request_fingerprint
    into v_venta_id, v_existente_medio, v_existente_cliente, v_existente_fingerprint
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;

  if v_venta_id is not null then
    if v_existente_medio is distinct from p_medio_pago
       or v_existente_cliente is distinct from p_cliente_id
       or v_existente_fingerprint is distinct from v_request_fingerprint then
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

  insert into public.ventas_sigo (empresa_id, cliente_id, total, medio_pago, idempotency_key, request_fingerprint, created_by)
  values (p_empresa_id, p_cliente_id, 0, p_medio_pago, v_key, v_request_fingerprint, v_user_id)
  returning id into v_venta_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    v_cantidad := (trim(v_item->>'cantidad'))::numeric;

    select id, empresa_id, nombre, precio_venta, stock_actual
    into v_producto
    from public.productos
    where id = v_producto_id
      and empresa_id = p_empresa_id
      and activo = true
    for update;

    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_producto.precio_venta is null then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual is null then raise exception 'PRODUCT_STOCK_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual < v_cantidad then raise exception 'INSUFFICIENT_STOCK: %', v_producto.nombre; end if;

    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_producto.precio_venta, round(v_producto.precio_venta * v_cantidad, 2));

    update public.productos
    set stock_actual = stock_actual - v_cantidad
    where id = v_producto.id and empresa_id = p_empresa_id and activo = true;

    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
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
    select id, medio_pago, cliente_id, request_fingerprint
      into v_venta_id, v_existente_medio, v_existente_cliente, v_existente_fingerprint
    from public.ventas_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;

    if v_venta_id is not null then
      if v_existente_medio is distinct from p_medio_pago
         or v_existente_cliente is distinct from p_cliente_id
         or v_existente_fingerprint is distinct from v_request_fingerprint then
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
  'SIGO: venta atomica tenant-safe; idempotencia ligada al payload exacto normalizado; solo productos activos; stock, caja/cuenta corriente y cliente validados.';

create or replace function public.confirmar_compra_sigo(
  p_empresa_id uuid,
  p_proveedor_id uuid,
  p_items jsonb,
  p_fecha date default current_date,
  p_tipo_comprobante text default null,
  p_numero_comprobante text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra_id uuid;
  v_item jsonb;
  v_producto public.productos%rowtype;
  v_producto_id uuid;
  v_cantidad numeric;
  v_costo numeric;
  v_subtotal numeric := 0;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_seen uuid[] := array[]::uuid[];
  v_existente_proveedor uuid;
  v_existente_fecha date;
  v_existente_tipo text;
  v_existente_numero text;
  v_existente_total numeric;
  v_existente_fingerprint text;
  v_request_fingerprint text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo text := nullif(trim(coalesce(p_tipo_comprobante, '')), '');
  v_numero text := nullif(trim(coalesce(p_numero_comprobante, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'purchases.write') then raise exception 'FORBIDDEN'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'stock.write') then raise exception 'STOCK_WRITE_REQUIRED'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'TOO_MANY_ITEMS'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID_ITEM'; end if;
    begin
      v_producto_id := nullif(trim(v_item->>'producto_id'), '')::uuid;
      v_cantidad := nullif(trim(v_item->>'cantidad'), '')::numeric;
      v_costo := nullif(trim(v_item->>'costo_unitario'), '')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'INVALID_ITEM';
    end;
    if v_producto_id is null then raise exception 'INVALID_ITEM'; end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY'; end if;
    if v_costo is null or v_costo < 0 or v_costo::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_COST'; end if;
    if v_producto_id = any(v_seen) then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
    v_seen := array_append(v_seen, v_producto_id);
    v_subtotal := v_subtotal + round(v_cantidad * v_costo, 2);
  end loop;
  v_subtotal := round(v_subtotal, 2);

  select md5(
    coalesce(jsonb_agg(
      jsonb_build_object(
        'producto_id', n.producto_id::text,
        'cantidad', to_char(n.cantidad, 'FM999999999999990.000'),
        'costo_unitario', to_char(n.costo_unitario, 'FM999999999999990.0000')
      ) order by n.producto_id
    )::text, '[]')
    || '|' || coalesce(p_proveedor_id::text, '')
    || '|' || coalesce(v_fecha::text, '')
    || '|' || coalesce(v_tipo, '')
    || '|' || coalesce(v_numero, '')
  )
  into v_request_fingerprint
  from (
    select
      (trim(j.value->>'producto_id'))::uuid as producto_id,
      (trim(j.value->>'cantidad'))::numeric(14,3) as cantidad,
      (trim(j.value->>'costo_unitario'))::numeric(14,4) as costo_unitario
    from jsonb_array_elements(p_items) j(value)
  ) n;

  select id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante, total, request_fingerprint
    into v_compra_id, v_existente_proveedor, v_existente_fecha, v_existente_tipo, v_existente_numero, v_existente_total, v_existente_fingerprint
  from public.compras_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;

  if v_compra_id is not null then
    if v_existente_proveedor is distinct from p_proveedor_id
       or v_existente_fecha is distinct from v_fecha
       or v_existente_tipo is distinct from v_tipo
       or v_existente_numero is distinct from v_numero
       or round(v_existente_total, 2) is distinct from v_subtotal
       or v_existente_fingerprint is distinct from v_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_compra_id;
  end if;

  if not exists (
    select 1 from public.proveedores_sigo
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true
  ) then raise exception 'SUPPLIER_NOT_FOUND'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    select * into v_producto from public.productos
      where id = v_producto_id and empresa_id = p_empresa_id and activo = true
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end loop;

  insert into public.compras_sigo(
    empresa_id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante,
    subtotal, total, estado, origen, idempotency_key, request_fingerprint, created_by
  ) values (
    p_empresa_id, p_proveedor_id, v_fecha, v_tipo, v_numero,
    v_subtotal, v_subtotal, 'confirmada', 'manual', v_key, v_request_fingerprint, auth.uid()
  ) returning id into v_compra_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    v_cantidad := (trim(v_item->>'cantidad'))::numeric;
    v_costo := (trim(v_item->>'costo_unitario'))::numeric;

    insert into public.compra_items_sigo(compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal)
    values (v_compra_id, p_empresa_id, v_producto_id, v_cantidad, v_costo, round(v_cantidad * v_costo, 2));

    update public.productos
      set stock_actual = coalesce(stock_actual, 0) + v_cantidad,
          costo_actual = v_costo,
          costo_ultima_compra = v_costo
      where id = v_producto_id and empresa_id = p_empresa_id and activo = true;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end loop;

  return v_compra_id;
exception
  when unique_violation then
    select id, proveedor_id, fecha_compra, tipo_comprobante, numero_comprobante, total, request_fingerprint
      into v_compra_id, v_existente_proveedor, v_existente_fecha, v_existente_tipo, v_existente_numero, v_existente_total, v_existente_fingerprint
    from public.compras_sigo
    where empresa_id = p_empresa_id and idempotency_key = v_key;

    if v_compra_id is not null then
      if v_existente_proveedor is distinct from p_proveedor_id
         or v_existente_fecha is distinct from v_fecha
         or v_existente_tipo is distinct from v_tipo
         or v_existente_numero is distinct from v_numero
         or round(v_existente_total, 2) is distinct from v_subtotal
         or v_existente_fingerprint is distinct from v_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_compra_id;
    end if;
    raise;
end;
$$;

revoke all on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) from public;
grant execute on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) to authenticated;

comment on function public.confirmar_compra_sigo(uuid,uuid,jsonb,date,text,text,text) is
  'SIGO: compra atomica tenant-safe; idempotencia ligada al payload exacto normalizado; solo proveedor y productos activos; stock/costos consistentes.';
