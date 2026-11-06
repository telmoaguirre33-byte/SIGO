-- CANDIDATO LOCAL. No ejecutar en produccion sin autorizacion y cierre del gate de RLS.
-- No backfill, conversion de unidades ni correccion de documentos historicos.
-- La migracion final debe generarse con CLI y revisarse sobre HEAD antes de publicar.
begin;
alter table public.venta_items_sigo add column if not exists unidad_medida text;
alter table public.devolucion_items_sigo add column if not exists unidad_medida text;
alter table public.devoluciones_sigo add column if not exists request_fingerprint text;

create or replace function public.sigo_precision_unidad(p_unidad text)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case lower(btrim(p_unidad))
    when 'unidad' then 0 when 'g' then 0 when 'ml' then 0
    when 'docena' then 0 when 'caja' then 0 when 'bolsa' then 0
    when 'paquete' then 0 when 'rollo' then 0 when 'bandeja' then 0 when 'atado' then 0
    when 'cm' then 1
    when 'kg' then 3 when 'l' then 3 when 'm' then 3 when 'm2' then 3 when 'm3' then 3
    else null end;
$$;
revoke all on function public.sigo_precision_unidad(text) from public, anon;
grant execute on function public.sigo_precision_unidad(text) to authenticated;

create or replace function public.listar_unidades_producto_sigo(p_empresa_id uuid)
returns table(producto_id uuid, unidad_medida text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null
     or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.read'), false) then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select p.id,
      case when lower(btrim(p.unidad_medida)) in
        ('unidad','kg','g','l','ml','m','cm','m2','m3','docena','caja','bolsa','paquete','rollo','bandeja','atado')
        then lower(btrim(p.unidad_medida))
        else null::text
      end
    from public.productos p
    where p.empresa_id = p_empresa_id and p.activo = true;
end;
$$;
revoke all on function public.listar_unidades_producto_sigo(uuid) from public, anon;
grant execute on function public.listar_unidades_producto_sigo(uuid) to authenticated;

create or replace function public.configurar_unidad_producto_sigo(
  p_empresa_id uuid, p_producto_id uuid, p_unidad text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_unidad text := lower(btrim(p_unidad));
  v_unidad_anterior text;
  v_stock numeric;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null
     or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.write'), false) then
    raise exception 'FORBIDDEN';
  end if;
  if v_unidad is null or v_unidad not in
    ('unidad','kg','g','l','ml','m','cm','m2','m3','docena','caja','bolsa','paquete','rollo','bandeja','atado') then
    raise exception 'UNIDAD_INVALIDA';
  end if;

  select lower(btrim(p.unidad_medida)), p.stock_actual
    into v_unidad_anterior, v_stock
    from public.productos p
    where p.id = p_producto_id and p.empresa_id = p_empresa_id and p.activo = true
    for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  -- UNIDAD -> unidad solo normaliza representacion, no cambia significado.
  -- Una conversion real requiere un flujo distinto, trazable y autorizado.
  if v_unidad_anterior is distinct from v_unidad then
    if v_stock is distinct from 0::numeric then
      raise exception 'UNIT_CHANGE_REQUIRES_ZERO_STOCK';
    end if;
    if exists (select 1 from public.venta_items_sigo vi where vi.producto_id = p_producto_id)
       or exists (select 1 from public.compra_items_sigo ci where ci.producto_id = p_producto_id)
       or exists (select 1 from public.devolucion_items_sigo di where di.producto_id = p_producto_id)
       or exists (select 1 from public.movimientos_stock ms where ms.producto_id = p_producto_id)
       or exists (select 1 from public.detalle_compras dc where dc.producto_id = p_producto_id) then
      raise exception 'UNIT_CHANGE_REQUIRES_HISTORY_REVIEW';
    end if;
  end if;

  update public.productos p
     set unidad_medida = v_unidad
   where p.id = p_producto_id and p.empresa_id = p_empresa_id and p.activo = true;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.configurar_unidad_producto_sigo(uuid,uuid,text) from public, anon;
grant execute on function public.configurar_unidad_producto_sigo(uuid,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.guardar_producto_medida_sigo(p_empresa_id uuid, p_producto_id uuid DEFAULT NULL::uuid, p_codigo_interno text DEFAULT NULL::text, p_codigo_barras text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text, p_descripcion text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_marca text DEFAULT NULL::text, p_proveedor text DEFAULT NULL::text, p_costo_actual numeric DEFAULT NULL::numeric, p_costo_ultima_compra numeric DEFAULT NULL::numeric, p_precio_venta numeric DEFAULT NULL::numeric, p_margen_ganancia numeric DEFAULT NULL::numeric, p_margen_porcentaje numeric DEFAULT NULL::numeric, p_stock_actual numeric DEFAULT NULL::numeric, p_stock_minimo numeric DEFAULT NULL::numeric, p_stock_maximo numeric DEFAULT NULL::numeric, p_unidad_medida text DEFAULT NULL::text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_unidad text;
  v_precision integer;
  v_valor numeric;
  v_stock_anterior numeric[];
  v_stock_indice integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.write'), false) then
    raise exception 'FORBIDDEN';
  end if;
  if p_unidad_medida is not null and public.sigo_precision_unidad(p_unidad_medida) is null then
    raise exception 'UNIDAD_INVALIDA';
  end if;
  if p_producto_id is not null then
    select lower(btrim(p.unidad_medida)), array[p.stock_actual, p.stock_minimo, p.stock_maximo]
      into v_unidad, v_stock_anterior from public.productos p
     where p.id = p_producto_id and p.empresa_id = p_empresa_id and p.activo = true for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    -- Lock and guard BEFORE editing stock: cannot zero stock and relabel in one call.
    if p_unidad_medida is not null then
      perform public.configurar_unidad_producto_sigo(p_empresa_id, p_producto_id, p_unidad_medida);
      v_unidad := lower(btrim(p_unidad_medida));
    end if;
  else
    v_unidad := coalesce(lower(btrim(p_unidad_medida)), 'unidad');
  end if;
  v_precision := public.sigo_precision_unidad(v_unidad);
  -- Preserve an unchanged legacy fractional stock/limit, but do not create new off-unit stock.
  foreach v_valor in array array[p_stock_actual, p_stock_minimo, p_stock_maximo] loop
    v_stock_indice := v_stock_indice + 1;
    if v_valor is not null then
      if v_precision is null then raise exception 'UNIDAD_INVALIDA'; end if;
      if v_valor::text in ('NaN','Infinity','-Infinity') or v_valor < 0
         or v_valor > 99999999999.999 or v_valor <> round(v_valor, 3)
         or (v_valor <> round(v_valor, v_precision)
             and (p_producto_id is null or v_valor is distinct from v_stock_anterior[v_stock_indice])) then
        raise exception 'PRODUCT_STOCK_INVALID';
      end if;
    end if;
  end loop;
  foreach v_valor in array array[p_costo_actual, p_costo_ultima_compra, p_precio_venta, p_margen_ganancia, p_margen_porcentaje] loop
    if v_valor is not null and (v_valor::text in ('NaN','Infinity','-Infinity') or v_valor < 0) then
      raise exception 'PRODUCT_VALUE_INVALID';
    end if;
  end loop;
  v_id := public.guardar_producto_sigo(p_empresa_id, p_producto_id, p_codigo_interno, p_codigo_barras, p_nombre, p_descripcion, p_categoria, p_marca, p_proveedor, p_costo_actual, p_costo_ultima_compra, p_precio_venta, p_margen_ganancia, p_margen_porcentaje, p_stock_actual, p_stock_minimo, p_stock_maximo);
  -- New row is not visible until commit. Set its initial unit without semantic conversion.
  if p_producto_id is null then
    update public.productos set unidad_medida = v_unidad where id = v_id and empresa_id = p_empresa_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.guardar_producto_medida_sigo(uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon;
grant execute on function public.guardar_producto_medida_sigo(uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
CREATE OR REPLACE FUNCTION public.confirmar_venta_sigo_v2(p_empresa_id uuid, p_items jsonb, p_medio_pago text DEFAULT 'efectivo'::text, p_idempotency_key text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_venta_id uuid;
  v_existente_medio text;
  v_existente_cliente uuid;
  v_existente_fingerprint text;
  v_request_fingerprint text;
  v_request_fingerprint_legacy text;
  v_request_payload text;
  v_item jsonb;
  v_producto record;
  v_producto_id uuid;
  v_cliente record;
  v_cantidad numeric;
  v_items jsonb;
  v_unidad text;
  v_precision integer;
  v_total numeric(14,2) := 0;
  v_descuento_oferta numeric(5,2);
  v_precio_unitario numeric(14,2);
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.write'), false) then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if p_medio_pago is null or p_medio_pago not in ('efectivo','debito','credito','transferencia','mercado_pago','cuenta_corriente','otro') then raise exception 'PAYMENT_METHOD_INVALID'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if length(v_key) > 200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if p_descuento_pct is null or p_descuento_pct < 0 or p_descuento_pct >= 100
     or p_descuento_pct::text in ('NaN','Infinity','-Infinity')
     or p_descuento_pct <> round(p_descuento_pct, 2) then
    raise exception 'SALE_DISCOUNT_INVALID';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'SALE_ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'SALE_ITEMS_REQUIRED'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'SALE_TOO_MANY_ITEMS'; end if;

  -- Validacion de forma previa: permite construir una huella canonica sin depender del stock mutable.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'SALE_ITEM_INVALID'; end if;
    begin
      v_producto_id := nullif(trim(v_item->>'producto_id'), '')::uuid;
      v_cantidad := nullif(trim(v_item->>'cantidad'), '')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'SALE_ITEM_INVALID';
    end;
    if v_producto_id is null then raise exception 'SALE_ITEM_INVALID'; end if;
    if v_item ? 'unidad_medida' then
      if jsonb_typeof(v_item->'unidad_medida') is distinct from 'string'
         or public.sigo_precision_unidad(v_item->>'unidad_medida') is null then
        raise exception 'PRODUCT_UNIT_INVALID';
      end if;
    end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity')
       or v_cantidad > 99999999999.999 or v_cantidad <> round(v_cantidad, 3) then
      raise exception 'SALE_QUANTITY_INVALID';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_items) j
    group by (trim(j->>'producto_id'))::uuid
    having count(distinct coalesce(lower(btrim(j->>'unidad_medida')), '__not_supplied__')) > 1
  ) then raise exception 'SALE_UNIT_MISMATCH'; end if;

  -- One canonical group is used for BOTH fingerprint and execution.
  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', n.producto_id::text,
    'cantidad', to_char(n.cantidad, 'FM999999999999990.000')
  ) || case when n.unidad is null then '{}'::jsonb else jsonb_build_object('unidad_medida', n.unidad) end
  order by n.producto_id), '[]'::jsonb) into v_items
  from (
    select (trim(j.value->>'producto_id'))::uuid as producto_id,
           sum((trim(j.value->>'cantidad'))::numeric) as cantidad,
           min(lower(btrim(j.value->>'unidad_medida'))) as unidad
      from jsonb_array_elements(p_items) j(value)
     group by (trim(j.value->>'producto_id'))::uuid
  ) n;
  if exists (select 1 from jsonb_array_elements(v_items) j
             where (j->>'cantidad')::numeric > 99999999999.999) then
    raise exception 'SALE_QUANTITY_INVALID';
  end if;
  v_request_payload := v_items::text || '|' || p_medio_pago || '|' || coalesce(p_cliente_id::text, '');
  v_request_fingerprint_legacy := md5(v_request_payload);
  v_request_fingerprint := md5(v_request_payload || '|discount=' || to_char(p_descuento_pct, 'FM990.00'));

  select id, medio_pago, cliente_id, request_fingerprint
    into v_venta_id, v_existente_medio, v_existente_cliente, v_existente_fingerprint
  from public.ventas_sigo
  where empresa_id = p_empresa_id and idempotency_key = v_key;

  if v_venta_id is not null then
    if v_existente_medio is distinct from p_medio_pago
       or v_existente_cliente is distinct from p_cliente_id
       or not coalesce((
         v_existente_fingerprint = v_request_fingerprint
         or (p_descuento_pct = 0 and v_existente_fingerprint = v_request_fingerprint_legacy)
       ), false) then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_venta_id;
  end if;

  if p_cliente_id is not null then
    if not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'clients.read'), false) then raise exception 'CLIENTS_READ_FORBIDDEN'; end if;
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

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_producto_id := (trim(v_item->>'producto_id'))::uuid;
    v_cantidad := (trim(v_item->>'cantidad'))::numeric;

    select id, empresa_id, nombre, precio_venta, stock_actual, unidad_medida
    into v_producto
    from public.productos
    where id = v_producto_id
      and empresa_id = p_empresa_id
      and activo = true
    for update;

    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_unidad := lower(btrim(v_producto.unidad_medida));
    v_precision := public.sigo_precision_unidad(v_unidad);
    if v_precision is null then raise exception 'PRODUCT_UNIT_INVALID'; end if;
    if v_item ? 'unidad_medida' and (v_item->>'unidad_medida') is distinct from v_unidad then
      raise exception 'SALE_UNIT_MISMATCH';
    end if;
    -- Validate every original input, not just its sum (0.5 + 0.5 is not a unit sale).
    if exists (
      select 1 from jsonb_array_elements(p_items) j
       where (trim(j->>'producto_id'))::uuid = v_producto.id
         and (trim(j->>'cantidad'))::numeric <> round((trim(j->>'cantidad'))::numeric, v_precision)
    ) then raise exception 'SALE_QUANTITY_INVALID'; end if;
    if v_producto.precio_venta is null or v_producto.precio_venta::text in ('NaN','Infinity','-Infinity') then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;
    if v_producto.stock_actual is null or v_producto.stock_actual::text in ('NaN','Infinity','-Infinity') then raise exception 'PRODUCT_STOCK_REQUIRED: %', v_producto.nombre; end if;
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
    v_precio_unitario := round(v_precio_unitario * (1 - p_descuento_pct / 100), 2);
    if v_precio_unitario <= 0 or v_precio_unitario::text in ('NaN','Infinity','-Infinity') then raise exception 'PRODUCT_PRICE_REQUIRED: %', v_producto.nombre; end if;

    insert into public.venta_items_sigo (venta_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, unidad_medida)
    values (v_venta_id, p_empresa_id, v_producto.id, v_cantidad, v_precio_unitario, round(v_precio_unitario * v_cantidad, 2), v_unidad);

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
         or not coalesce((
         v_existente_fingerprint = v_request_fingerprint
         or (p_descuento_pct = 0 and v_existente_fingerprint = v_request_fingerprint_legacy)
       ), false) then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return v_venta_id;
    end if;
    raise;
end;
$function$;

create or replace function public.confirmar_venta_sigo(p_empresa_id uuid, p_items jsonb, p_medio_pago text default 'efectivo', p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return public.confirmar_venta_sigo_v2(p_empresa_id, p_items, p_medio_pago, p_idempotency_key, null, 0);
end;
$$;
CREATE OR REPLACE FUNCTION public.registrar_devolucion_sigo(p_empresa_id uuid, p_venta_id uuid, p_items jsonb, p_motivo text, p_idempotency_key text, p_anular_total boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_venta record;
  v_item jsonb;
  v_venta_item record;
  v_devolucion_id uuid;
  v_cantidad numeric;
  v_item_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_precision integer;
  v_ya_devuelto numeric(14,3);
  v_disponible numeric(14,3);
  v_importe_ya_devuelto numeric;
  v_importe_disponible numeric(14,2);
  v_subtotal_devolucion numeric(14,2);
  v_total numeric(14,2) := 0;
  v_lineas integer := 0;
  v_pendientes integer := 0;
  v_cliente_saldo numeric(14,2);
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'sales.write'), false) then raise exception 'SALES_WRITE_FORBIDDEN'; end if;
  if v_key is null or length(v_key) > 160 then raise exception 'RETURN_IDEMPOTENCY_KEY_INVALID'; end if;
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'RETURN_REASON_REQUIRED'; end if;

  if p_venta_id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if p_anular_total is null then raise exception 'RETURN_MODE_INVALID'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'RETURN_ITEMS_REQUIRED'; end if;
  if p_anular_total then
    if jsonb_array_length(p_items) <> 0 then raise exception 'RETURN_ITEMS_INVALID'; end if;
  else
    if jsonb_array_length(p_items) = 0 then raise exception 'RETURN_ITEMS_REQUIRED'; end if;
    if jsonb_array_length(p_items) > 500 then raise exception 'RETURN_TOO_MANY_ITEMS'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'RETURN_ITEM_INVALID'; end if;
      begin
        v_item_id := nullif(btrim(v_item->>'venta_item_id'), '')::uuid;
        v_cantidad := nullif(btrim(v_item->>'cantidad'), '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'RETURN_ITEM_INVALID';
      end;
      if v_item_id is null then raise exception 'RETURN_ITEM_INVALID'; end if;
      if v_cantidad is null or v_cantidad <= 0 or v_cantidad::text in ('NaN','Infinity','-Infinity')
         or v_cantidad > 99999999999.999 or v_cantidad <> round(v_cantidad, 3) then
        raise exception 'RETURN_QUANTITY_INVALID';
      end if;
    end loop;
    select jsonb_agg(jsonb_build_object('venta_item_id', n.id::text,
      'cantidad', to_char(n.cantidad, 'FM999999999999990.000')) order by n.id)
      into v_items from (
        select (btrim(j->>'venta_item_id'))::uuid as id, sum((j->>'cantidad')::numeric) as cantidad
          from jsonb_array_elements(p_items) j group by (btrim(j->>'venta_item_id'))::uuid
      ) n;
    if exists (select 1 from jsonb_array_elements(v_items) j where (j->>'cantidad')::numeric > 99999999999.999) then
      raise exception 'RETURN_QUANTITY_INVALID';
    end if;
  end if;
  -- Keep original request mode: a partial return that exhausts stock is not an anular_total retry.
  v_fingerprint := md5(jsonb_build_object('empresa_id', p_empresa_id, 'venta_id', p_venta_id,
    'anular_total', p_anular_total, 'motivo', v_motivo, 'items', v_items)::text);
  select id, request_fingerprint into v_devolucion_id, v_existing_fingerprint
    from public.devoluciones_sigo where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_devolucion_id is not null then
    if v_existing_fingerprint is null then raise exception 'RETURN_LEGACY_RETRY_REQUIRES_REVIEW'; end if;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_devolucion_id;
  end if;

  select id, numero, empresa_id, cliente_id, medio_pago, total, estado
    into v_venta
    from public.ventas_sigo
   where id = p_venta_id and empresa_id = p_empresa_id
   for update;

  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  -- Another identical return may have completed while this transaction waited for the sale lock.
  -- Recheck BEFORE the sale status, including full cancellation that made it 'anulada'.
  select id, request_fingerprint into v_devolucion_id, v_existing_fingerprint
    from public.devoluciones_sigo where empresa_id = p_empresa_id and idempotency_key = v_key;
  if v_devolucion_id is not null then
    if v_existing_fingerprint is null then raise exception 'RETURN_LEGACY_RETRY_REQUIRES_REVIEW'; end if;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_devolucion_id;
  end if;
  if v_venta.estado = 'anulada' then raise exception 'SALE_ALREADY_VOIDED'; end if;
  if v_venta.estado <> 'confirmada' then raise exception 'SALE_NOT_RETURNABLE'; end if;

  -- Match the sale lock order: client before products, then products sorted by id.
  if v_venta.medio_pago = 'cuenta_corriente' then
    perform 1 from public.clientes_sigo where id = v_venta.cliente_id and empresa_id = p_empresa_id for update;
    if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  end if;

  insert into public.devoluciones_sigo
    (empresa_id, venta_id, tipo, total, motivo, idempotency_key, created_by, request_fingerprint)
  values
    (p_empresa_id, p_venta_id, 'parcial', 0, v_motivo, v_key, v_user_id, v_fingerprint)
  returning id into v_devolucion_id;

  if p_anular_total then
    for v_venta_item in
      select vi.id, vi.producto_id, vi.cantidad, vi.precio_unitario, vi.subtotal, vi.unidad_medida
        from public.venta_items_sigo vi
       where vi.empresa_id = p_empresa_id and vi.venta_id = p_venta_id
       order by vi.producto_id, vi.id
       for update
    loop
      select coalesce(sum(di.cantidad), 0), coalesce(sum(di.subtotal), 0)
        into v_ya_devuelto, v_importe_ya_devuelto
        from public.devolucion_items_sigo di
        join public.devoluciones_sigo d on d.id = di.devolucion_id
       where d.empresa_id = p_empresa_id
         and d.venta_id = p_venta_id
         and di.venta_item_id = v_venta_item.id
         and d.id <> v_devolucion_id;

      -- No corregir automaticamente historicos inconsistentes ni valores especiales.
      if v_venta_item.cantidad is null or v_venta_item.cantidad <= 0
         or v_venta_item.cantidad::text in ('NaN','Infinity','-Infinity')
         or v_venta_item.subtotal is null or v_venta_item.subtotal < 0
         or v_venta_item.subtotal::text in ('NaN','Infinity','-Infinity')
         or v_ya_devuelto < 0 or v_ya_devuelto > v_venta_item.cantidad
         or v_ya_devuelto::text in ('NaN','Infinity','-Infinity')
         or v_importe_ya_devuelto < 0 or v_importe_ya_devuelto > v_venta_item.subtotal
         or v_importe_ya_devuelto::text in ('NaN','Infinity','-Infinity')
         or (v_ya_devuelto = v_venta_item.cantidad
             and v_importe_ya_devuelto is distinct from v_venta_item.subtotal) then
        raise exception 'RETURN_HISTORY_REQUIRES_MANUAL_REVIEW';
      end if;
      v_importe_disponible := v_venta_item.subtotal - v_importe_ya_devuelto;
      v_disponible := v_venta_item.cantidad - v_ya_devuelto;
      if v_disponible <= 0 then continue; end if;
      -- El ultimo remanente restituye exactamente los centavos pendientes.
      v_subtotal_devolucion := v_importe_disponible;

      insert into public.devolucion_items_sigo
        (devolucion_id, empresa_id, venta_item_id, producto_id, cantidad, precio_unitario, subtotal, unidad_medida)
      values
        (v_devolucion_id, p_empresa_id, v_venta_item.id, v_venta_item.producto_id,
         v_disponible, v_venta_item.precio_unitario, v_subtotal_devolucion, v_venta_item.unidad_medida);

      update public.productos
         set stock_actual = coalesce(stock_actual, 0) + v_disponible
       where id = v_venta_item.producto_id and empresa_id = p_empresa_id;

      v_total := v_total + v_subtotal_devolucion;
      v_lineas := v_lineas + 1;
    end loop;
  else
    for v_item in
      select j.value from jsonb_array_elements(v_items) j(value)
      left join public.venta_items_sigo vi on vi.id = (j.value->>'venta_item_id')::uuid
      order by vi.producto_id, vi.id
    loop
      if nullif(btrim(coalesce(v_item->>'venta_item_id', '')), '') is null then
        raise exception 'RETURN_ITEM_INVALID';
      end if;
      begin
        v_cantidad := (v_item->>'cantidad')::numeric;
      exception when others then
        raise exception 'RETURN_QUANTITY_INVALID';
      end;
      if v_cantidad is null or v_cantidad <= 0 then raise exception 'RETURN_QUANTITY_INVALID'; end if;

      select vi.id, vi.producto_id, vi.cantidad, vi.precio_unitario, vi.subtotal, vi.unidad_medida
        into v_venta_item
        from public.venta_items_sigo vi
       where vi.id = (v_item->>'venta_item_id')::uuid
         and vi.empresa_id = p_empresa_id
         and vi.venta_id = p_venta_id
       for update;
      if not found then raise exception 'RETURN_ITEM_NOT_FOUND'; end if;
      -- Legacy NULL snapshot has no inferred unit and keeps the historical 3-decimal contract.
      v_precision := case when v_venta_item.unidad_medida is null then 3
                     else public.sigo_precision_unidad(v_venta_item.unidad_medida) end;
      if v_precision is null then raise exception 'RETURN_UNIT_INVALID'; end if;
      if exists (select 1 from jsonb_array_elements(p_items) j
        where (j->>'venta_item_id')::uuid = v_venta_item.id
          and (j->>'cantidad')::numeric <> round((j->>'cantidad')::numeric, v_precision)
      ) then raise exception 'RETURN_QUANTITY_INVALID'; end if;


      select coalesce(sum(di.cantidad), 0), coalesce(sum(di.subtotal), 0)
        into v_ya_devuelto, v_importe_ya_devuelto
        from public.devolucion_items_sigo di
        join public.devoluciones_sigo d on d.id = di.devolucion_id
       where d.empresa_id = p_empresa_id
         and d.venta_id = p_venta_id
         and di.venta_item_id = v_venta_item.id
         and d.id <> v_devolucion_id;

      -- No corregir automaticamente historicos inconsistentes ni valores especiales.
      if v_venta_item.cantidad is null or v_venta_item.cantidad <= 0
         or v_venta_item.cantidad::text in ('NaN','Infinity','-Infinity')
         or v_venta_item.subtotal is null or v_venta_item.subtotal < 0
         or v_venta_item.subtotal::text in ('NaN','Infinity','-Infinity')
         or v_ya_devuelto < 0 or v_ya_devuelto > v_venta_item.cantidad
         or v_ya_devuelto::text in ('NaN','Infinity','-Infinity')
         or v_importe_ya_devuelto < 0 or v_importe_ya_devuelto > v_venta_item.subtotal
         or v_importe_ya_devuelto::text in ('NaN','Infinity','-Infinity')
         or (v_ya_devuelto = v_venta_item.cantidad
             and v_importe_ya_devuelto is distinct from v_venta_item.subtotal) then
        raise exception 'RETURN_HISTORY_REQUIRES_MANUAL_REVIEW';
      end if;
      v_importe_disponible := v_venta_item.subtotal - v_importe_ya_devuelto;
      v_disponible := v_venta_item.cantidad - v_ya_devuelto;
      if v_cantidad > v_disponible then raise exception 'RETURN_QUANTITY_EXCEEDS_AVAILABLE'; end if;
      -- Prorrateo acumulado del subtotal historico, incluidos descuentos originales.
      -- Si un redondeo antiguo adelanto un centavo, esta linea puede valer cero;
      -- nunca se cobra al cliente ni se excede el saldo monetario de la linea.
      if v_cantidad = v_disponible then
        v_subtotal_devolucion := v_importe_disponible;
      else
        v_subtotal_devolucion := least(v_importe_disponible, greatest(0::numeric,
          round(v_venta_item.subtotal * (v_ya_devuelto + v_cantidad) / v_venta_item.cantidad, 2)
          - v_importe_ya_devuelto));
      end if;

      insert into public.devolucion_items_sigo
        (devolucion_id, empresa_id, venta_item_id, producto_id, cantidad, precio_unitario, subtotal, unidad_medida)
      values
        (v_devolucion_id, p_empresa_id, v_venta_item.id, v_venta_item.producto_id,
         v_cantidad, v_venta_item.precio_unitario, v_subtotal_devolucion, v_venta_item.unidad_medida);

      update public.productos
         set stock_actual = coalesce(stock_actual, 0) + v_cantidad
       where id = v_venta_item.producto_id and empresa_id = p_empresa_id;

      v_total := v_total + v_subtotal_devolucion;
      v_lineas := v_lineas + 1;
    end loop;
  end if;

  if v_lineas = 0 then raise exception 'NOTHING_TO_RETURN'; end if;

  -- Determinar si, sumando esta devolución, ya no queda cantidad pendiente de devolver.
  select count(*)
    into v_pendientes
    from public.venta_items_sigo vi
   where vi.empresa_id = p_empresa_id
     and vi.venta_id = p_venta_id
     and vi.cantidad > (
       select coalesce(sum(di.cantidad), 0)
         from public.devolucion_items_sigo di
         join public.devoluciones_sigo d on d.id = di.devolucion_id
        where d.empresa_id = p_empresa_id
          and d.venta_id = p_venta_id
          and di.venta_item_id = vi.id
     );

  update public.devoluciones_sigo
     set total = v_total,
         tipo = case when v_pendientes = 0 then 'total' else 'parcial' end
   where id = v_devolucion_id;

  -- Cantidad legitima sin centavos pendientes: queda auditada en devoluciones/items,
  -- pero no genera movimiento de caja/cuenta corriente ni cambia saldo del cliente.
  if v_total > 0 then
    if v_venta.medio_pago = 'cuenta_corriente' then
      if v_venta.cliente_id is null then raise exception 'RETURN_CLIENT_REQUIRED'; end if;
  
      select saldo_actual into v_cliente_saldo
        from public.clientes_sigo
       where id = v_venta.cliente_id and empresa_id = p_empresa_id
       for update;
      if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
      if v_cliente_saldo < v_total then raise exception 'ACCOUNT_RETURN_REQUIRES_MANUAL_REVIEW'; end if;
  
      insert into public.cliente_movimientos_sigo
        (empresa_id, cliente_id, venta_id, devolucion_id, tipo, importe, concepto, created_by)
      values
        (p_empresa_id, v_venta.cliente_id, p_venta_id, v_devolucion_id, 'haber', v_total,
         'Devolución venta SIGO', v_user_id);
  
      update public.clientes_sigo
         set saldo_actual = saldo_actual - v_total, updated_at = now()
       where id = v_venta.cliente_id and empresa_id = p_empresa_id;
    else
      insert into public.caja_movimientos_sigo
        (empresa_id, venta_id, devolucion_id, tipo, medio_pago, importe, concepto, created_by)
      values
        (p_empresa_id, p_venta_id, v_devolucion_id, 'egreso', v_venta.medio_pago, v_total,
         'Devolución venta SIGO', v_user_id);
    end if;
  end if;

  if v_pendientes = 0 then
    update public.ventas_sigo
       set estado = 'anulada', anulada_at = now(), anulada_by = v_user_id, motivo_anulacion = v_motivo
     where id = p_venta_id and empresa_id = p_empresa_id and estado = 'confirmada';
  end if;

  return v_devolucion_id;
exception
  when unique_violation then
    select id, request_fingerprint into v_devolucion_id, v_existing_fingerprint
      from public.devoluciones_sigo
     where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_devolucion_id is not null then
      if v_existing_fingerprint is null then raise exception 'RETURN_LEGACY_RETRY_REQUIRES_REVIEW'; end if;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return v_devolucion_id;
    end if;
    raise;
end;
$function$;


-- Existing grants restricted explicitly for the replaced money entry points.
revoke all on function public.confirmar_venta_sigo_v2(uuid,jsonb,text,text,uuid,numeric) from public, anon;
grant execute on function public.confirmar_venta_sigo_v2(uuid,jsonb,text,text,uuid,numeric) to authenticated;
revoke all on function public.confirmar_venta_sigo(uuid,jsonb,text,text) from public, anon;
grant execute on function public.confirmar_venta_sigo(uuid,jsonb,text,text) to authenticated;
revoke all on function public.registrar_devolucion_sigo(uuid,uuid,jsonb,text,text,boolean) from public, anon;
grant execute on function public.registrar_devolucion_sigo(uuid,uuid,jsonb,text,text,boolean) to authenticated;
commit;
