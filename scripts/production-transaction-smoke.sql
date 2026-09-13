\set ON_ERROR_STOP on

-- SIGO: prueba transaccional real sobre producción con ROLLBACK final.
-- Ejecuta el mismo circuito que un cajero: venta en efectivo -> detalle -> descuento
-- de stock -> ingreso de caja -> reintento idempotente. Ningún dato de prueba queda
-- persistido porque toda la operación se revierte al finalizar.

begin;

do $$
declare
  v_empresa uuid;
  v_user uuid;
  v_product uuid;
  v_stock_before numeric;
  v_stock_after_sale numeric;
  v_stock_after_retry numeric;
  v_price numeric;
  v_sale uuid;
  v_sale_retry uuid;
  v_sale_items integer;
  v_cash_rows integer;
  v_cash_total numeric;
  v_sale_total numeric;
  v_header_total numeric;
  v_key text := 'prod-smoke-sale-' || txid_current()::text;
begin
  -- Preferimos el negocio visible actual; si no existe, tomamos cualquier tenant
  -- propietario con un producto realmente vendible y stock positivo.
  select e.id
    into v_empresa
  from public.empresas e
  join public.empresa_usuarios eu
    on eu.empresa_id = e.id
   and eu.activo = true
   and eu.rol = 'owner'
  where e.activa = true
    and exists (
      select 1
      from public.productos p
      where p.empresa_id = e.id
        and p.activo = true
        and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
        and upper(btrim(coalesce(p.codigo_interno, ''))) not like 'LEGACY-DUP-%'
        and coalesce(p.stock_actual, 0) > 0
        and coalesce(p.precio_venta, 0) > 0
    )
  order by
    case
      when lower(btrim(e.nombre)) = lower('Lápiz y Papel') then 0
      when lower(btrim(e.nombre)) = lower('SIGO Administración') then 1
      else 2
    end,
    e.nombre
  limit 1;

  if v_empresa is null then raise exception 'SIGO_TX_SMOKE_TENANT_NOT_FOUND'; end if;

  select eu.user_id
    into v_user
  from public.empresa_usuarios eu
  where eu.empresa_id = v_empresa
    and eu.activo = true
    and eu.rol = 'owner'
  order by eu.created_at asc nulls last
  limit 1;

  if v_user is null then raise exception 'SIGO_TX_SMOKE_OWNER_NOT_FOUND'; end if;

  -- Simula una sesión authenticated real para que auth.uid() y los permisos funcionen.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text,
    true
  );

  if not public.tiene_permiso_empresa(v_empresa, 'sales.write') then
    raise exception 'SIGO_TX_SMOKE_SALES_PERMISSION_FAILED';
  end if;

  select p.id, p.stock_actual, p.precio_venta
    into v_product, v_stock_before, v_price
  from public.productos p
  where p.empresa_id = v_empresa
    and p.activo = true
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
    and upper(btrim(coalesce(p.codigo_interno, ''))) not like 'LEGACY-DUP-%'
    and coalesce(p.stock_actual, 0) > 0
    and coalesce(p.precio_venta, 0) > 0
  order by p.id
  limit 1;

  if v_product is null then raise exception 'SIGO_TX_SMOKE_PRODUCT_NOT_FOUND'; end if;

  v_sale := public.confirmar_venta_sigo_v2(
    v_empresa,
    jsonb_build_array(jsonb_build_object('producto_id', v_product::text, 'cantidad', 1)),
    'efectivo',
    v_key,
    null
  );

  if v_sale is null then raise exception 'SIGO_TX_SMOKE_SALE_ID_MISSING'; end if;

  select stock_actual
    into v_stock_after_sale
  from public.productos
  where id = v_product and empresa_id = v_empresa;

  if v_stock_after_sale is distinct from v_stock_before - 1 then
    raise exception 'SIGO_TX_SMOKE_STOCK_FAILED before=% after=% expected=%',
      v_stock_before, v_stock_after_sale, v_stock_before - 1;
  end if;

  select count(*), coalesce(sum(subtotal), 0)
    into v_sale_items, v_sale_total
  from public.venta_items_sigo
  where venta_id = v_sale and empresa_id = v_empresa;

  if v_sale_items <> 1 or round(v_sale_total, 2) <> round(v_price, 2) then
    raise exception 'SIGO_TX_SMOKE_DETAIL_FAILED rows=% total=% expected=%',
      v_sale_items, v_sale_total, v_price;
  end if;

  select total
    into v_header_total
  from public.ventas_sigo
  where id = v_sale
    and empresa_id = v_empresa
    and estado = 'confirmada'
    and medio_pago = 'efectivo';

  if v_header_total is null or round(v_header_total, 2) <> round(v_price, 2) then
    raise exception 'SIGO_TX_SMOKE_HEADER_FAILED total=% expected=%', v_header_total, v_price;
  end if;

  select count(*), coalesce(sum(importe), 0)
    into v_cash_rows, v_cash_total
  from public.caja_movimientos_sigo
  where empresa_id = v_empresa
    and venta_id = v_sale
    and tipo = 'ingreso'
    and medio_pago = 'efectivo';

  if v_cash_rows <> 1 or round(v_cash_total, 2) <> round(v_price, 2) then
    raise exception 'SIGO_TX_SMOKE_CASH_FAILED rows=% total=% expected=%',
      v_cash_rows, v_cash_total, v_price;
  end if;

  -- El mismo request no puede descontar stock ni cobrar dos veces.
  v_sale_retry := public.confirmar_venta_sigo_v2(
    v_empresa,
    jsonb_build_array(jsonb_build_object('producto_id', v_product::text, 'cantidad', 1)),
    'efectivo',
    v_key,
    null
  );

  select stock_actual
    into v_stock_after_retry
  from public.productos
  where id = v_product and empresa_id = v_empresa;

  if v_sale_retry is distinct from v_sale then
    raise exception 'SIGO_TX_SMOKE_IDEMPOTENCY_ID_FAILED first=% retry=%', v_sale, v_sale_retry;
  end if;
  if v_stock_after_retry is distinct from v_stock_after_sale then
    raise exception 'SIGO_TX_SMOKE_IDEMPOTENCY_STOCK_FAILED after=% retry=%',
      v_stock_after_sale, v_stock_after_retry;
  end if;

  select count(*), coalesce(sum(importe), 0)
    into v_cash_rows, v_cash_total
  from public.caja_movimientos_sigo
  where empresa_id = v_empresa
    and venta_id = v_sale
    and tipo = 'ingreso'
    and medio_pago = 'efectivo';

  if v_cash_rows <> 1 or round(v_cash_total, 2) <> round(v_price, 2) then
    raise exception 'SIGO_TX_SMOKE_IDEMPOTENCY_CASH_FAILED rows=% total=%', v_cash_rows, v_cash_total;
  end if;

  raise notice 'SIGO_PRODUCTION_TRANSACTION_SMOKE_OK tenant=% product=% stock_before=% stock_after=% sale=% cash=%',
    v_empresa, v_product, v_stock_before, v_stock_after_sale, v_sale, v_cash_total;
end
$$;

rollback;

select 'SIGO_PRODUCTION_TRANSACTION_SMOKE_ROLLED_BACK' as marker;
