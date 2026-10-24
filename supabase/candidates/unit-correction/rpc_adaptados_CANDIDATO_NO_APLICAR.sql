-- Local candidate only. No production authorization. Exact baseline must be reverified.
BEGIN;
DO $baseline$ DECLARE r record; BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('aplicar_margen_masivo_sigo','cambiar_compra_sigo','confirmar_compra_sigo','confirmar_venta_sigo_v2','guardar_producto_medida_sigo','redondear_precios_venta_sigo','registrar_devolucion_sigo'))<>7 OR (SELECT count(DISTINCT proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('aplicar_margen_masivo_sigo','cambiar_compra_sigo','confirmar_compra_sigo','confirmar_venta_sigo_v2','guardar_producto_medida_sigo','redondear_precios_venta_sigo','registrar_devolucion_sigo'))<>7 THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_MISSING_OR_OVERLOADED';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='aplicar_margen_masivo_sigo') IS DISTINCT FROM '9f3972cf398ab7819c48d29d1d319379' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:aplicar_margen_masivo_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='aplicar_margen_masivo_sigo') IS DISTINCT FROM true OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='aplicar_margen_masivo_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:aplicar_margen_masivo_sigo';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cambiar_compra_sigo') IS DISTINCT FROM '470d2ec837c3fa16a211a949bd17fce9' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:cambiar_compra_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cambiar_compra_sigo') IS DISTINCT FROM false OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cambiar_compra_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:cambiar_compra_sigo';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_compra_sigo') IS DISTINCT FROM 'c1012e7d6c134b057feccb1edbc21e5b' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:confirmar_compra_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_compra_sigo') IS DISTINCT FROM true OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_compra_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:confirmar_compra_sigo';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_venta_sigo_v2') IS DISTINCT FROM 'bbb629aafb39901f63ed33a4e4a9e01c' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:confirmar_venta_sigo_v2';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_venta_sigo_v2') IS DISTINCT FROM false OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='confirmar_venta_sigo_v2') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:confirmar_venta_sigo_v2';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guardar_producto_medida_sigo') IS DISTINCT FROM '3fa1613fc0c15e7d77239d973949b626' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:guardar_producto_medida_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guardar_producto_medida_sigo') IS DISTINCT FROM false OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guardar_producto_medida_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:guardar_producto_medida_sigo';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='redondear_precios_venta_sigo') IS DISTINCT FROM '87a8f7b1e0d735b7ca58454670070b9d' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:redondear_precios_venta_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='redondear_precios_venta_sigo') IS DISTINCT FROM false OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='redondear_precios_venta_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:redondear_precios_venta_sigo';END IF;
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='registrar_devolucion_sigo') IS DISTINCT FROM 'dd3aa9ea414a3ef25ee6965b33369a6a' THEN RAISE EXCEPTION 'UNIT_CORRECTION_BASELINE_DRIFT:registrar_devolucion_sigo';END IF;
 IF (SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='registrar_devolucion_sigo') IS DISTINCT FROM false OR (SELECT has_function_privilege('authenticated',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='registrar_devolucion_sigo') IS DISTINCT FROM true THEN RAISE EXCEPTION 'UNIT_CORRECTION_ACL_DRIFT:registrar_devolucion_sigo';END IF;
END $baseline$;
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
  if p_producto_id is not null then perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,p_producto_id,p_unidad_medida); end if;
  v_id := public.guardar_producto_sigo(p_empresa_id, p_producto_id, p_codigo_interno, p_codigo_barras, p_nombre, p_descripcion, p_categoria, p_marca, p_proveedor, p_costo_actual, p_costo_ultima_compra, p_precio_venta, p_margen_ganancia, p_margen_porcentaje, p_stock_actual, p_stock_minimo, p_stock_maximo);
  -- New row is not visible until commit. Set its initial unit without semantic conversion.
  if p_producto_id is null then
    update public.productos set unidad_medida = v_unidad where id = v_id and empresa_id = p_empresa_id;
  end if;
  perform sigo_correccion_inicial.limpiar_actual();
  return v_id;
end;
$$;

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
    perform sigo_correccion_inicial.limpiar_actual(); return v_venta_id;
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
    perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_producto_id,v_item->>'unidad_medida');
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

  perform sigo_correccion_inicial.limpiar_actual(); return v_venta_id;
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
      perform sigo_correccion_inicial.limpiar_actual(); return v_venta_id;
    end if;
    raise;
end;
$function$;

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
    perform sigo_correccion_inicial.limpiar_actual(); return v_devolucion_id;
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
    perform sigo_correccion_inicial.limpiar_actual(); return v_devolucion_id;
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

      perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_venta_item.producto_id,v_venta_item.unidad_medida);
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

      perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_venta_item.producto_id,v_venta_item.unidad_medida);
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

  perform sigo_correccion_inicial.limpiar_actual(); return v_devolucion_id;
exception
  when unique_violation then
    select id, request_fingerprint into v_devolucion_id, v_existing_fingerprint
      from public.devoluciones_sigo
     where empresa_id = p_empresa_id and idempotency_key = v_key;
    if v_devolucion_id is not null then
      if v_existing_fingerprint is null then raise exception 'RETURN_LEGACY_RETRY_REQUIRES_REVIEW'; end if;
      if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      perform sigo_correccion_inicial.limpiar_actual(); return v_devolucion_id;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_compra_sigo(p_empresa_id uuid, p_proveedor_id uuid, p_items jsonb, p_fecha date DEFAULT CURRENT_DATE, p_tipo_comprobante text DEFAULT NULL::text, p_numero_comprobante text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_compra_id uuid; v_item jsonb; v_producto public.productos%rowtype; v_producto_id uuid; v_cantidad numeric; v_costo numeric; v_subtotal numeric:=0;
 v_key text:=nullif(trim(coalesce(p_idempotency_key,'')),''); v_seen uuid[]:=array[]::uuid[];
 v_existente_proveedor uuid; v_existente_fecha date; v_existente_tipo text; v_existente_numero text; v_existente_total numeric;
 v_existente_fingerprint text; v_request_fingerprint text; v_fecha date:=coalesce(p_fecha,current_date);
 v_tipo text:=nullif(trim(coalesce(p_tipo_comprobante,'')),''); v_numero text:=nullif(trim(coalesce(p_numero_comprobante,'')),''); v_document_lock text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.tiene_permiso_empresa(p_empresa_id,'purchases.write') then raise exception 'FORBIDDEN'; end if;
 if not public.tiene_permiso_empresa(p_empresa_id,'stock.write') then raise exception 'STOCK_WRITE_REQUIRED'; end if;
 if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
 if length(v_key)>200 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'ITEMS_REQUIRED'; end if;
 if jsonb_array_length(p_items)>500 then raise exception 'TOO_MANY_ITEMS'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  begin v_producto_id:=nullif(trim(v_item->>'producto_id'),'')::uuid; v_cantidad:=nullif(trim(v_item->>'cantidad'),'')::numeric; v_costo:=nullif(trim(v_item->>'costo_unitario'),'')::numeric;
  exception when invalid_text_representation then raise exception 'INVALID_ITEM'; end;
  if v_producto_id is null then raise exception 'INVALID_ITEM'; end if;
  if v_cantidad is null or v_cantidad<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if v_costo is null or v_costo<0 then raise exception 'INVALID_COST'; end if;
  if v_producto_id=any(v_seen) then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
  v_seen:=array_append(v_seen,v_producto_id); v_subtotal:=v_subtotal+round(v_cantidad*v_costo,2);
 end loop; v_subtotal:=round(v_subtotal,2);
 select md5(coalesce(jsonb_agg(jsonb_build_object('producto_id',n.producto_id::text,'cantidad',to_char(n.cantidad,'FM999999999999990.000'),'costo_unitario',to_char(n.costo_unitario,'FM999999999999990.0000')) order by n.producto_id)::text,'[]')||'|'||coalesce(p_proveedor_id::text,'')||'|'||coalesce(v_fecha::text,'')||'|'||coalesce(v_tipo,'')||'|'||coalesce(v_numero,''))
 into v_request_fingerprint from (select (trim(j.value->>'producto_id'))::uuid producto_id,(trim(j.value->>'cantidad'))::numeric(14,3) cantidad,(trim(j.value->>'costo_unitario'))::numeric(14,4) costo_unitario from jsonb_array_elements(p_items) j(value)) n;
 if exists(select 1 from jsonb_array_elements(p_items) j where j ? 'unidad_medida') then
  select md5(v_request_fingerprint||'|expected_units|'||jsonb_agg(jsonb_build_array(j->>'producto_id',j->>'unidad_medida') order by j->>'producto_id')::text) into v_request_fingerprint from jsonb_array_elements(p_items) j;
 end if;
 select id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,total,request_fingerprint into v_compra_id,v_existente_proveedor,v_existente_fecha,v_existente_tipo,v_existente_numero,v_existente_total,v_existente_fingerprint from public.compras_sigo where empresa_id=p_empresa_id and idempotency_key=v_key;
 if v_compra_id is not null then
  if v_existente_proveedor is distinct from p_proveedor_id or v_existente_fecha is distinct from v_fecha or v_existente_tipo is distinct from v_tipo or v_existente_numero is distinct from v_numero or round(v_existente_total,2) is distinct from v_subtotal or v_existente_fingerprint is distinct from v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; perform sigo_correccion_inicial.limpiar_actual(); return v_compra_id;
 end if;
 if not exists(select 1 from public.proveedores_sigo where id=p_proveedor_id and empresa_id=p_empresa_id and activo=true) then raise exception 'SUPPLIER_NOT_FOUND'; end if;
 if v_numero is not null then
  v_document_lock:=p_empresa_id::text||'|'||p_proveedor_id::text||'|'||lower(coalesce(v_tipo,''))||'|'||lower(v_numero); perform pg_advisory_xact_lock(hashtextextended(v_document_lock,0));
  select c.id into v_compra_id from public.compras_sigo c where c.empresa_id=p_empresa_id and c.proveedor_id=p_proveedor_id and lower(coalesce(nullif(trim(c.tipo_comprobante),''),''))=lower(coalesce(v_tipo,'')) and lower(nullif(trim(c.numero_comprobante),''))=lower(v_numero) and c.estado='confirmada' limit 1;
  if v_compra_id is not null then raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%',v_compra_id; end if;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_producto_id:=(trim(v_item->>'producto_id'))::uuid; select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo=true for update; if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_producto_id,v_item->>'unidad_medida');
  perform sigo_correccion_inicial.validar_compra(p_empresa_id,v_producto_id,(v_item->>'cantidad')::numeric,(v_item->>'costo_unitario')::numeric);
 end loop;
 insert into public.compras_sigo(empresa_id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,subtotal,total,estado,origen,idempotency_key,request_fingerprint,created_by)
 values(p_empresa_id,p_proveedor_id,v_fecha,v_tipo,v_numero,v_subtotal,v_subtotal,'confirmada','manual',v_key,v_request_fingerprint,auth.uid()) returning id into v_compra_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_producto_id:=(trim(v_item->>'producto_id'))::uuid; v_cantidad:=(trim(v_item->>'cantidad'))::numeric; v_costo:=(trim(v_item->>'costo_unitario'))::numeric;
  insert into public.compra_items_sigo(compra_id,empresa_id,producto_id,cantidad,costo_unitario,subtotal) values(v_compra_id,p_empresa_id,v_producto_id,v_cantidad,v_costo,round(v_cantidad*v_costo,2));
  update public.productos set
   stock_actual=coalesce(stock_actual,0)+v_cantidad,
   precio_venta=case when v_costo>coalesce(costo_actual,0) and coalesce(precio_venta,0)>0 then round(v_costo*(1+coalesce(margen_porcentaje,case when coalesce(costo_actual,0)>0 then ((precio_venta-costo_actual)/costo_actual)*100 else 0 end)/100),2) else precio_venta end,
   margen_ganancia=case when v_costo>coalesce(costo_actual,0) and coalesce(precio_venta,0)>0 then round(v_costo*(1+coalesce(margen_porcentaje,case when coalesce(costo_actual,0)>0 then ((precio_venta-costo_actual)/costo_actual)*100 else 0 end)/100),2)-v_costo else margen_ganancia end,
   costo_actual=v_costo,costo_ultima_compra=v_costo where id=v_producto_id and empresa_id=p_empresa_id and activo=true;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 end loop; perform sigo_correccion_inicial.limpiar_actual(); return v_compra_id;
exception when unique_violation then
 select id,proveedor_id,fecha_compra,tipo_comprobante,numero_comprobante,total,request_fingerprint into v_compra_id,v_existente_proveedor,v_existente_fecha,v_existente_tipo,v_existente_numero,v_existente_total,v_existente_fingerprint from public.compras_sigo where empresa_id=p_empresa_id and idempotency_key=v_key;
 if v_compra_id is not null then
  if v_existente_proveedor is distinct from p_proveedor_id or v_existente_fecha is distinct from v_fecha or v_existente_tipo is distinct from v_tipo or v_existente_numero is distinct from v_numero or round(v_existente_total,2) is distinct from v_subtotal or v_existente_fingerprint is distinct from v_request_fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; perform sigo_correccion_inicial.limpiar_actual(); return v_compra_id;
 end if; raise;
end; $function$;

CREATE OR REPLACE FUNCTION public.cambiar_compra_sigo(p_empresa_id uuid, p_compra_id uuid, p_accion text, p_proveedor_id uuid DEFAULT NULL::uuid, p_fecha date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_numero text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_compra public.compras_sigo%rowtype;
  v_item jsonb;
  v_producto_id uuid;
  v_cantidad numeric;
  v_costo numeric;
  v_nuevos jsonb := '{}'::jsonb;
  v_previos jsonb := '{}'::jsonb;
  v_ids uuid[];
  v_id uuid;
  v_delta numeric;
  v_total numeric := 0;
  v_nuevo_costo numeric;
  v_ultimo_costo numeric;
  v_precio numeric;
  v_numero text := nullif(btrim(p_numero),'');
  v_tipo text := nullif(btrim(p_tipo),'');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'purchases.write'),false)
    or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.write'),false) then raise exception 'FORBIDDEN'; end if;
  if p_accion not in ('modificar','anular') then raise exception 'INVALID_ACTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('compra-edit|'||p_empresa_id::text,0));
  select * into v_compra from public.compras_sigo where id=p_compra_id and empresa_id=p_empresa_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_compra.estado='anulada' and p_accion='anular' then return jsonb_build_object('compra_id',p_compra_id,'estado','anulada'); end if;
  if v_compra.estado<>'confirmada' then raise exception 'PURCHASE_NOT_ACTIVE'; end if;
  if p_accion='modificar' then
    if p_proveedor_id is null or not exists(select 1 from public.proveedores_sigo where id=p_proveedor_id and empresa_id=p_empresa_id and activo)
      then raise exception 'SUPPLIER_NOT_FOUND'; end if;
    if p_fecha is null or length(coalesce(v_tipo,''))>100 or length(coalesce(v_numero,''))>200 then raise exception 'INVALID_HEADER'; end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 300 then raise exception 'INVALID_ITEM'; end if;
    if v_numero is not null and exists(
      select 1 from public.compras_sigo c where c.empresa_id=p_empresa_id and c.id<>p_compra_id and c.proveedor_id=p_proveedor_id and c.estado='confirmada'
      and regexp_replace(upper(c.numero_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_numero),'[^A-Z0-9]','','g')
      and (v_tipo is null or nullif(btrim(c.tipo_comprobante),'') is null or regexp_replace(upper(c.tipo_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_tipo),'[^A-Z0-9]','','g'))
    ) then raise exception 'PURCHASE_DOCUMENT_DUPLICATE'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'INVALID_ITEM'; end if;
      v_producto_id:=nullif(v_item->>'producto_id','')::uuid;
      v_cantidad:=(v_item->>'cantidad')::numeric;
      v_costo:=(v_item->>'costo_unitario')::numeric;
      if v_producto_id is null or v_cantidad is null or v_cantidad<=0 or v_cantidad>1000000 or v_cantidad::text in ('NaN','Infinity','-Infinity')
        or v_costo is null or v_costo<0 or v_costo>1000000000 or v_costo::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_ITEM'; end if;
      if v_nuevos ? v_producto_id::text then raise exception 'DUPLICATE_PRODUCT_ITEM'; end if;
      v_nuevos:=v_nuevos||jsonb_build_object(v_producto_id::text,jsonb_build_object('cantidad',v_cantidad,'costo_unitario',v_costo,'unidad_medida',v_item->>'unidad_medida'));
      v_total:=v_total+round(v_cantidad*v_costo,2);
    end loop;
  end if;
  select coalesce(jsonb_object_agg(i.producto_id::text,jsonb_build_object('cantidad',i.cantidad,'costo_unitario',i.costo_unitario)),'{}'::jsonb)
    into v_previos from public.compra_items_sigo i where i.empresa_id=p_empresa_id and i.compra_id=p_compra_id;
  select array_agg(k::uuid order by k::uuid) into v_ids from (
    select jsonb_object_keys(v_previos) k union select jsonb_object_keys(v_nuevos) k
  ) ids;
  -- Lock in stable order; refuse to remove units already sold.
  foreach v_id in array v_ids loop
    perform 1 from public.productos where id=v_id and empresa_id=p_empresa_id and activo for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if exists(select 1 from sigo_correccion_inicial.auditoria where empresa_id=p_empresa_id and producto_id=v_id) then
      if v_nuevos ? v_id::text then
        perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_id,v_nuevos->v_id::text->>'unidad_medida');
        perform sigo_correccion_inicial.validar_compra(p_empresa_id,v_id,(v_nuevos->v_id::text->>'cantidad')::numeric,(v_nuevos->v_id::text->>'costo_unitario')::numeric);
      elsif v_previos ? v_id::text then
        -- A corrected product had no earlier purchase history; immutable correction mark
        -- and protected purchase writes guarantee these existing quantities are kg.
        perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_id,'kg');
      else raise exception 'CORRECTED_PRODUCT_PURCHASE_CHANGE_REVIEW_REQUIRED'; end if;
    end if;
  end loop;
  foreach v_id in array v_ids loop
    v_delta:=coalesce((v_nuevos->v_id::text->>'cantidad')::numeric,0)-coalesce((v_previos->v_id::text->>'cantidad')::numeric,0);
    update public.productos set stock_actual=stock_actual+v_delta
    where id=v_id and empresa_id=p_empresa_id and stock_actual+v_delta>=0;
    if not found then raise exception 'STOCK_INSUFFICIENT_TO_REVERSE'; end if;
  end loop;
  insert into public.compra_cambios_sigo(empresa_id,compra_id,accion,datos_anteriores,cambiado_por)
    values(p_empresa_id,p_compra_id,p_accion,jsonb_build_object('cabecera',to_jsonb(v_compra),'items',v_previos),auth.uid());
  if p_accion='anular' then
    update public.compras_sigo set estado='anulada' where id=p_compra_id and empresa_id=p_empresa_id;
  else
    delete from public.compra_items_sigo where compra_id=p_compra_id and empresa_id=p_empresa_id;
    foreach v_id in array v_ids loop
      if v_nuevos ? v_id::text then
        v_cantidad:=(v_nuevos->v_id::text->>'cantidad')::numeric;
        v_costo:=(v_nuevos->v_id::text->>'costo_unitario')::numeric;
        insert into public.compra_items_sigo(compra_id,empresa_id,producto_id,cantidad,costo_unitario,subtotal)
          values(p_compra_id,p_empresa_id,v_id,v_cantidad,v_costo,round(v_cantidad*v_costo,2));
      end if;
    end loop;
    update public.compras_sigo set proveedor_id=p_proveedor_id,fecha_compra=p_fecha,tipo_comprobante=v_tipo,numero_comprobante=v_numero,
      subtotal=round(v_total,2),total=round(v_total,2) where id=p_compra_id and empresa_id=p_empresa_id;
  end if;
  -- Restore the most recent confirmed purchase cost when possible; prices remain customer-set.
  foreach v_id in array v_ids loop
    select i.costo_unitario into v_ultimo_costo from public.compra_items_sigo i join public.compras_sigo c on c.id=i.compra_id
      where i.empresa_id=p_empresa_id and i.producto_id=v_id and c.estado='confirmada'
      order by c.created_at desc, i.created_at desc limit 1;
    if found then
      update public.productos set costo_actual=v_ultimo_costo,costo_ultima_compra=v_ultimo_costo
        where id=v_id and empresa_id=p_empresa_id;
    end if;
  end loop;
  perform sigo_correccion_inicial.limpiar_actual();
  return jsonb_build_object('compra_id',p_compra_id,'estado',case when p_accion='anular' then 'anulada' else 'confirmada' end);
end;
$function$;

create or replace function public.redondear_precios_venta_sigo(
  p_empresa_id uuid,
  p_redondeo numeric,
  p_precios_esperados jsonb
) returns table(actualizados integer, sin_cambios integer, omitidos_sin_precio integer)
language plpgsql security definer set search_path = public
as $function$
declare
  v_correction_product record;
  v_total integer;
  v_encontrados integer;
  v_actualizados integer;
  v_omitidos integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null
    or not public.tiene_permiso_empresa(p_empresa_id, 'products.write')
    or not (public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
      or public.tiene_permiso_empresa(p_empresa_id, 'sales.read')
      or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_redondeo is null or p_redondeo not in (1, 10, 50, 100, 500) then
    raise exception 'ROUNDING_INVALID';
  end if;
  if p_precios_esperados is null or jsonb_typeof(p_precios_esperados) <> 'array' then
    raise exception 'PRICE_SELECTION_INVALID';
  end if;
  v_total := jsonb_array_length(p_precios_esperados);
  if v_total < 1 or v_total > 10000 then raise exception 'PRICE_SELECTION_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(p_precios_esperados) e
    where jsonb_typeof(e) <> 'object' or not (e ? 'id' and e ? 'precio')
      or jsonb_typeof(e->'id') <> 'string'
      or jsonb_typeof(e->'precio') not in ('number', 'null')) then
    raise exception 'PRICE_SELECTION_INVALID';
  end if;
  if (select count(distinct s.id) from jsonb_to_recordset(p_precios_esperados) as s(id uuid, precio numeric)) <> v_total then
    raise exception 'PRICE_SELECTION_INVALID';
  end if;
  perform p.id from public.productos p
    join jsonb_to_recordset(p_precios_esperados) as s(id uuid, precio numeric) on s.id = p.id
    where p.empresa_id = p_empresa_id and p.activo = true
      and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
    order by p.id for update of p;
  get diagnostics v_encontrados = row_count;
  if v_encontrados <> v_total then raise exception 'PRODUCT_SCOPE_CHANGED'; end if;
  if exists (select 1 from public.productos p
    join jsonb_to_recordset(p_precios_esperados) as s(id uuid, precio numeric) on s.id = p.id
    where p.empresa_id = p_empresa_id and p.precio_venta is distinct from s.precio) then
    raise exception 'PRICE_CHANGED_REFRESH';
  end if;
  for v_correction_product in select p.id,p.unidad_medida from public.productos p join sigo_correccion_inicial.auditoria a on a.producto_id=p.id and a.empresa_id=p.empresa_id where p.empresa_id=p_empresa_id and p.activo=true and p.id in (select (e->>'id')::uuid from jsonb_array_elements(p_precios_esperados) e) order by p.id for update of p loop
    perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_correction_product.id,lower(btrim(v_correction_product.unidad_medida)));
  end loop;
  select count(*)::integer into v_omitidos
    from jsonb_to_recordset(p_precios_esperados) as s(id uuid, precio numeric)
    where s.precio is null or s.precio <= 0;
  update public.productos p
    set precio_venta = ceil(p.precio_venta / p_redondeo) * p_redondeo
    from jsonb_to_recordset(p_precios_esperados) as s(id uuid, precio numeric)
    where p.id = s.id and p.empresa_id = p_empresa_id and p.activo = true
      and p.precio_venta > 0
      and p.precio_venta is distinct from ceil(p.precio_venta / p_redondeo) * p_redondeo;
  get diagnostics v_actualizados = row_count;
  perform sigo_correccion_inicial.limpiar_actual();
  return query select v_actualizados, v_total - v_actualizados - v_omitidos, v_omitidos;
end;
$function$;

create or replace function public.aplicar_margen_masivo_sigo(
  p_empresa_id uuid,
  p_margen_porcentaje numeric,
  p_producto_ids uuid[] default null,
  p_base_costo text default 'actual',
  p_redondeo numeric default 0
)
returns table(actualizados integer, omitidos_sin_costo integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correction_product record;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_empresa_id is null
     or not public.tiene_permiso_empresa(p_empresa_id, 'products.write')
     or not public.tiene_permiso_empresa(p_empresa_id, 'costs.read')
     or not public.tiene_permiso_empresa(p_empresa_id, 'margins.read')
     or not (
       public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
       or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')
     ) then
    raise exception 'FORBIDDEN';
  end if;

  if p_margen_porcentaje is null or p_margen_porcentaje < 0 or p_margen_porcentaje > 10000 then
    raise exception 'MARGIN_INVALID';
  end if;

  if p_base_costo not in ('actual', 'ultima_compra') then
    raise exception 'COST_BASE_INVALID';
  end if;

  if p_redondeo is null or p_redondeo < 0 or p_redondeo > 1000000 then
    raise exception 'ROUNDING_INVALID';
  end if;

  if p_producto_ids is not null and cardinality(p_producto_ids) = 0 then
    return query select 0, 0;
    return;
  end if;

  for v_correction_product in select p.id,p.unidad_medida from public.productos p join sigo_correccion_inicial.auditoria a on a.producto_id=p.id and a.empresa_id=p.empresa_id where p.empresa_id=p_empresa_id and p.activo=true and (p_producto_ids is null or p.id=any(p_producto_ids)) order by p.id for update of p loop
    perform sigo_correccion_inicial.autorizar_operacion(p_empresa_id,v_correction_product.id,lower(btrim(v_correction_product.unidad_medida)));
  end loop;
  with objetivos as (
    select
      p.id,
      case
        when p_base_costo = 'ultima_compra' then
          case
            when coalesce(p.costo_ultima_compra, 0) > 0 then p.costo_ultima_compra
            when coalesce(p.costo_actual, 0) > 0 then p.costo_actual
            else 0
          end
        else
          case
            when coalesce(p.costo_actual, 0) > 0 then p.costo_actual
            when coalesce(p.costo_ultima_compra, 0) > 0 then p.costo_ultima_compra
            else 0
          end
      end::numeric as costo_base
    from public.productos p
    where p.empresa_id = p_empresa_id
      and coalesce(p.activo, true) = true
      and (p_producto_ids is null or p.id = any(p_producto_ids))
  ),
  calculados as (
    select
      o.id,
      o.costo_base,
      case
        when p_redondeo > 0 then
          ceil((o.costo_base * (1 + p_margen_porcentaje / 100.0)) / p_redondeo) * p_redondeo
        else
          round(o.costo_base * (1 + p_margen_porcentaje / 100.0), 2)
      end::numeric as precio_nuevo
    from objetivos o
    where o.costo_base > 0
  ),
  cambios as (
    update public.productos p
       set precio_venta = c.precio_nuevo,
           margen_porcentaje = p_margen_porcentaje,
           margen_ganancia = greatest(c.precio_nuevo - c.costo_base, 0)
      from calculados c
     where p.id = c.id
       and p.empresa_id = p_empresa_id
    returning p.id
  )
  select
    (select count(*)::integer from cambios),
    (select count(*)::integer from objetivos where costo_base <= 0)
  into v_actualizados, v_omitidos;

  perform sigo_correccion_inicial.limpiar_actual();
  return query select v_actualizados, v_omitidos;
end;
$$;

COMMIT;
