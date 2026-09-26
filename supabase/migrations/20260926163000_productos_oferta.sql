-- Las ofertas se guardan separadas del precio habitual del producto.
create table public.ofertas_productos_sigo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  producto_id uuid not null references public.productos(id),
  fecha_inicio date not null,
  fecha_fin date not null,
  descuento_porcentaje numeric(5,2) not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint oferta_fechas_validas check (fecha_fin >= fecha_inicio),
  constraint oferta_descuento_valido check (descuento_porcentaje > 0 and descuento_porcentaje < 100)
);
create index ofertas_productos_empresa_producto_fecha_idx
  on public.ofertas_productos_sigo(empresa_id, producto_id, fecha_inicio, fecha_fin);
alter table public.ofertas_productos_sigo enable row level security;
revoke all on public.ofertas_productos_sigo from public, anon;
grant select on public.ofertas_productos_sigo to authenticated;
create policy ofertas_productos_sigo_select on public.ofertas_productos_sigo
  for select to authenticated
  using (coalesce(public.tiene_permiso_empresa(empresa_id, 'price_lists.read'), false)
    or coalesce(public.tiene_permiso_empresa(empresa_id, 'sales.write'), false));

-- Guardado atómico: o se reemplaza toda la lista de la empresa, o no cambia nada.
-- El cliente web no tiene INSERT/UPDATE/DELETE directos en esta tabla.
create function public.guardar_ofertas_productos_sigo(p_empresa_id uuid, p_ofertas jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_producto uuid;
  v_inicio date;
  v_fin date;
  v_descuento numeric;
  v_precio numeric;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.write'), false)
     or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read'), false)
  then raise exception 'OFFER_WRITE_FORBIDDEN'; end if;
  if jsonb_typeof(p_ofertas) is distinct from 'array' then raise exception 'OFFERS_INVALID'; end if;

  -- Serializa reemplazos concurrentes del mismo catálogo de ofertas.
  perform 1 from public.empresas where id = p_empresa_id for update;
  delete from public.ofertas_productos_sigo where empresa_id = p_empresa_id;
  for v_item in select value from jsonb_array_elements(p_ofertas)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'OFFER_INVALID'; end if;
    begin
      v_producto := (v_item->>'producto_id')::uuid;
      v_inicio := (v_item->>'fecha_inicio')::date;
      v_fin := (v_item->>'fecha_fin')::date;
      v_descuento := (v_item->>'descuento_porcentaje')::numeric;
    exception when others then
      raise exception 'OFFER_INVALID';
    end;
    if v_producto is null or v_inicio is null or v_fin is null or v_fin < v_inicio
       or v_descuento is null or v_descuento <= 0 or v_descuento >= 100
    then raise exception 'OFFER_INVALID'; end if;
    select precio_venta into v_precio from public.productos
    where id = v_producto and empresa_id = p_empresa_id and activo = true;
    if not found or v_precio is null or v_precio <= 0 or round(v_precio * (1 - v_descuento / 100), 2) <= 0
    then raise exception 'OFFER_PRODUCT_INVALID'; end if;
    if exists (select 1 from public.ofertas_productos_sigo o
      where o.empresa_id = p_empresa_id and o.producto_id = v_producto
        and o.fecha_inicio <= v_fin and o.fecha_fin >= v_inicio)
    then raise exception 'OFFER_DATES_OVERLAP'; end if;
    insert into public.ofertas_productos_sigo
      (empresa_id, producto_id, fecha_inicio, fecha_fin, descuento_porcentaje, created_by)
    values (p_empresa_id, v_producto, v_inicio, v_fin, v_descuento, auth.uid());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.guardar_ofertas_productos_sigo(uuid, jsonb) from public, anon;
grant execute on function public.guardar_ofertas_productos_sigo(uuid, jsonb) to authenticated;

-- Caja cobra el precio promocional vigente al confirmar la venta.
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
  v_descuento_oferta numeric(5,2);
  v_precio_unitario numeric(14,2);
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'sales.write') then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago not in ('efectivo','debito','credito','transferencia','mercado_pago','cuenta_corriente','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'SALE_TOO_MANY_ITEMS'; end if;

  -- Validacion de forma previa: permite construir una huella canonica sin depender del stock mutable.
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

    -- El descuento se determina en el servidor al confirmar, según el día en Argentina.
    -- El precio habitual del catálogo no se modifica.
    select descuento_porcentaje into v_descuento_oferta
    from public.ofertas_productos_sigo
    where empresa_id = p_empresa_id and producto_id = v_producto.id
      and fecha_inicio <= (now() at time zone 'America/Argentina/Cordoba')::date
      and fecha_fin >= (now() at time zone 'America/Argentina/Cordoba')::date
    limit 1 for share;
    v_precio_unitario := case when v_descuento_oferta is null then v_producto.precio_venta
      else round(v_producto.precio_venta * (1 - v_descuento_oferta / 100), 2) end;
    if v_precio_unitario <= 0 then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;

    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_precio_unitario, round(v_precio_unitario * v_cantidad, 2));

    update public.productos
    set stock_actual = stock_actual - v_cantidad
    where id = v_producto.id and empresa_id = p_empresa_id and activo = true;

    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_total := v_total + round(v_precio_unitario * v_cantidad, 2);
  end loop;

  -- IMPORTANTE: no acceder a v_cliente salvo que sea una venta en cuenta corriente.
  -- PostgreSQL no puede resolver campos de un RECORD nunca asignado, aunque aparezcan
  -- a la derecha de un AND cuyo primer termino sea falso.
  if p_medio_pago = 'cuenta_corriente' then
    if v_cliente.limite_credito is not null
       and v_cliente.saldo_actual + v_total > v_cliente.limite_credito then
      raise exception 'CREDIT_LIMIT_EXCEEDED';
    end if;
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
