\set ON_ERROR_STOP on
begin;

do $$
declare
  v_empresa uuid; v_user uuid; v_product uuid; v_supplier uuid; v_created_product uuid; v_supplier_guard uuid;
  v_scanner_product uuid; v_scan_code text; v_created_code text;
  v_stock_before numeric; v_stock_after_purchase numeric; v_stock_after_purchase_retry numeric;
  v_stock_after_duplicate_attempt numeric; v_stock_after_limit_attempt numeric; v_stock_after_sale numeric; v_stock_after_sale_retry numeric;
  v_stock_after_oversell numeric;
  v_cost numeric; v_purchase_cost numeric; v_cost_after_purchase numeric; v_last_cost_after_purchase numeric;
  v_price numeric; v_purchase uuid; v_purchase_retry uuid; v_sale uuid; v_sale_retry uuid;
  v_created_cost numeric; v_created_last_cost numeric; v_created_stock numeric;
  v_created_stock_min numeric; v_created_stock_max numeric; v_created_price numeric;
  v_purchase_items integer; v_sale_items integer; v_cash_rows integer; v_scanner_matches integer;
  v_oversell_sales integer; v_limit_purchases integer; v_supplier_dup_count integer;
  v_cash_total numeric; v_sale_total numeric; v_purchase_total numeric;
  v_tx text := txid_current()::text;
begin
  select e.id into v_empresa from public.empresas e
  where lower(btrim(e.nombre))=lower('SIGO Administración') and e.activa=true limit 1;
  if v_empresa is null then raise exception 'QA_TENANT_NOT_FOUND'; end if;

  select eu.user_id into v_user from public.empresa_usuarios eu
  where eu.empresa_id=v_empresa and eu.activo=true and eu.rol='owner'
  order by eu.created_at asc nulls last limit 1;
  if v_user is null then raise exception 'QA_OWNER_NOT_FOUND'; end if;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user::text,'role','authenticated')::text,true);

  if not public.tiene_permiso_empresa(v_empresa,'purchases.write') then raise exception 'QA_OWNER_PURCHASE_PERMISSION_FAILED'; end if;
  if not public.tiene_permiso_empresa(v_empresa,'stock.write') then raise exception 'QA_OWNER_STOCK_PERMISSION_FAILED'; end if;
  if not public.tiene_permiso_empresa(v_empresa,'sales.write') then raise exception 'QA_OWNER_SALE_PERMISSION_FAILED'; end if;
  if not public.tiene_permiso_empresa(v_empresa,'products.write') then raise exception 'QA_OWNER_PRODUCT_PERMISSION_FAILED'; end if;

  -- Alta real contra la base productiva, dentro de una transacción que se revierte al final.
  -- Valida el requisito crítico: si no se informa costo inicial, nunca queda NULL.
  v_created_code := 'QA-PRODUCT-' || v_tx;
  select public.guardar_producto_sigo(
    p_empresa_id => v_empresa,
    p_codigo_interno => v_created_code,
    p_nombre => 'QA Producto Alta ' || v_tx,
    p_categoria => 'QA_TRANSACCIONAL',
    p_costo_actual => null,
    p_costo_ultima_compra => null,
    p_precio_venta => null,
    p_stock_actual => null,
    p_stock_minimo => null,
    p_stock_maximo => null
  ) into v_created_product;

  select p.costo_actual,p.costo_ultima_compra,p.precio_venta,p.stock_actual,p.stock_minimo,p.stock_maximo
    into v_created_cost,v_created_last_cost,v_created_price,v_created_stock,v_created_stock_min,v_created_stock_max
  from public.productos p
  where p.id=v_created_product and p.empresa_id=v_empresa;

  if v_created_product is null then raise exception 'QA_PRODUCT_CREATE_NO_ID'; end if;
  if v_created_cost is null or v_created_cost<>0 then raise exception 'QA_PRODUCT_CREATE_COST_FAILED value=%',v_created_cost; end if;
  if v_created_last_cost is null or v_created_last_cost<>0 then raise exception 'QA_PRODUCT_CREATE_LAST_COST_FAILED value=%',v_created_last_cost; end if;
  if v_created_price is null or v_created_price<>0 then raise exception 'QA_PRODUCT_CREATE_PRICE_FAILED value=%',v_created_price; end if;
  if v_created_stock is null or v_created_stock<>0 then raise exception 'QA_PRODUCT_CREATE_STOCK_FAILED value=%',v_created_stock; end if;
  if v_created_stock_min is null or v_created_stock_min<>0 then raise exception 'QA_PRODUCT_CREATE_STOCK_MIN_FAILED value=%',v_created_stock_min; end if;
  if v_created_stock_max is null or v_created_stock_max<>0 then raise exception 'QA_PRODUCT_CREATE_STOCK_MAX_FAILED value=%',v_created_stock_max; end if;
  raise notice 'SIGO_QA_PRODUCT_CREATE_OK product=% costo_actual=% stock_actual=%',v_created_product,v_created_cost,v_created_stock;

  -- El candidato de venta debe tener un código real que el mismo RPC usado por
  -- ingreso manual, pistola y cámara resuelva de manera unívoca en este tenant.
  select p.id,p.stock_actual,p.costo_actual,p.precio_venta,
         coalesce(nullif(btrim(p.codigo_barras),''),nullif(btrim(p.codigo_interno),''))
    into v_product,v_stock_before,v_cost,v_price,v_scan_code
  from public.productos p
  where p.empresa_id=v_empresa and p.activo=true
    and upper(btrim(coalesce(p.categoria,'')))<>'NO_VENDIBLE'
    and p.stock_actual is not null and p.costo_actual is not null and p.precio_venta is not null
    and p.stock_actual>0 and p.precio_venta>0 and p.costo_actual>=0
    and upper(coalesce(p.codigo_interno,'')) not like 'LEGACY-DUP-%'
    and coalesce(nullif(btrim(p.codigo_barras),''),nullif(btrim(p.codigo_interno),'')) is not null
    and (
      select count(*)
      from public.buscar_producto_codigo_sigo(
        v_empresa,
        coalesce(nullif(btrim(p.codigo_barras),''),nullif(btrim(p.codigo_interno),''))
      )
    ) = 1
  order by p.id limit 1;
  if v_product is null then raise exception 'QA_PRODUCT_NOT_FOUND'; end if;

  select count(*) into v_scanner_matches
  from public.buscar_producto_codigo_sigo(v_empresa,v_scan_code);
  select b.id into v_scanner_product
  from public.buscar_producto_codigo_sigo(v_empresa,v_scan_code) b
  limit 1;
  if v_scanner_matches<>1 or v_scanner_product is distinct from v_product then
    raise exception 'QA_SCANNER_LOOKUP_FAILED code=% matches=% expected=% actual=%',
      v_scan_code,v_scanner_matches,v_product,v_scanner_product;
  end if;
  raise notice 'SIGO_QA_SCANNER_LOOKUP_OK code=% product=% matches=%',v_scan_code,v_product,v_scanner_matches;

  select s.id into v_supplier from public.proveedores_sigo s
  where s.empresa_id=v_empresa and s.activo=true order by s.created_at asc limit 1;
  if v_supplier is null then
    insert into public.proveedores_sigo(empresa_id,razon_social,nombre_fantasia,activo)
    values(v_empresa,'QA Proveedor Transaccional','QA Proveedor',true) returning id into v_supplier;
  end if;

  -- La base debe rechazar CUIT inválido incluso si un cliente defectuoso evita la validación web.
  begin
    insert into public.proveedores_sigo(empresa_id,razon_social,cuit,activo)
    values(v_empresa,'QA CUIT Invalido '||v_tx,'20-12345678-0',true);
    raise exception 'QA_SUPPLIER_INVALID_CUIT_NOT_BLOCKED';
  exception when others then
    if position('QA_SUPPLIER_INVALID_CUIT_NOT_BLOCKED' in sqlerrm)>0 then raise; end if;
    if position('SUPPLIER_CUIT_INVALID' in sqlerrm)=0 then
      raise exception 'QA_SUPPLIER_INVALID_CUIT_WRONG_ERROR: %',sqlerrm;
    end if;
  end;
  raise notice 'SIGO_QA_SUPPLIER_CUIT_BLOCK_OK';

  -- Razones sociales equivalentes por puntuación/espacios no pueden crear dos proveedores activos.
  insert into public.proveedores_sigo(empresa_id,razon_social,activo)
  values(v_empresa,'QA Proveedor Guard '||v_tx,true) returning id into v_supplier_guard;
  begin
    insert into public.proveedores_sigo(empresa_id,razon_social,activo)
    values(v_empresa,'QA.Proveedor-Guard '||v_tx,true);
    raise exception 'QA_SUPPLIER_NAME_DUPLICATE_NOT_BLOCKED';
  exception when others then
    if position('QA_SUPPLIER_NAME_DUPLICATE_NOT_BLOCKED' in sqlerrm)>0 then raise; end if;
    if position('SUPPLIER_NAME_DUPLICATE' in sqlerrm)=0 then
      raise exception 'QA_SUPPLIER_NAME_DUPLICATE_WRONG_ERROR: %',sqlerrm;
    end if;
  end;
  select count(*) into v_supplier_dup_count
  from public.proveedores_sigo p
  where p.empresa_id=v_empresa and p.activo=true
    and public.sigo_normalizar_identidad_proveedor(p.razon_social)=public.sigo_normalizar_identidad_proveedor('QA Proveedor Guard '||v_tx);
  if v_supplier_dup_count<>1 then raise exception 'QA_SUPPLIER_NAME_DUPLICATE_COUNT_FAILED rows=%',v_supplier_dup_count; end if;
  raise notice 'SIGO_QA_SUPPLIER_IDENTITY_BLOCK_OK supplier=%',v_supplier_guard;

  -- La compra usa un costo deliberadamente distinto para demostrar que no sólo suma stock:
  -- también actualiza costo_actual y costo_ultima_compra de manera exacta.
  v_purchase_cost := round(v_cost + 1.23, 2);
  v_purchase := public.confirmar_compra_sigo(v_empresa,v_supplier,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',2,'costo_unitario',v_purchase_cost)),
    current_date,'QA','QA-'||v_tx,'qa-purchase-'||v_tx);
  select stock_actual,costo_actual,costo_ultima_compra
    into v_stock_after_purchase,v_cost_after_purchase,v_last_cost_after_purchase
  from public.productos where id=v_product and empresa_id=v_empresa;
  if v_stock_after_purchase<>v_stock_before+2 then raise exception 'QA_PURCHASE_STOCK_FAILED before=% after=%',v_stock_before,v_stock_after_purchase; end if;
  if round(v_cost_after_purchase,2)<>v_purchase_cost or round(v_last_cost_after_purchase,2)<>v_purchase_cost then
    raise exception 'QA_PURCHASE_COST_UPDATE_FAILED expected=% costo_actual=% costo_ultima_compra=%',v_purchase_cost,v_cost_after_purchase,v_last_cost_after_purchase;
  end if;
  raise notice 'SIGO_QA_PURCHASE_COST_OK product=% previous_cost=% new_cost=% stock=%',v_product,v_cost,v_cost_after_purchase,v_stock_after_purchase;

  v_purchase_retry := public.confirmar_compra_sigo(v_empresa,v_supplier,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',2,'costo_unitario',v_purchase_cost)),
    current_date,'QA','QA-'||v_tx,'qa-purchase-'||v_tx);
  select stock_actual into v_stock_after_purchase_retry from public.productos where id=v_product and empresa_id=v_empresa;
  if v_purchase_retry<>v_purchase or v_stock_after_purchase_retry<>v_stock_after_purchase then raise exception 'QA_PURCHASE_IDEMPOTENCY_FAILED'; end if;

  select count(*),coalesce(sum(subtotal),0) into v_purchase_items,v_purchase_total
  from public.compra_items_sigo where compra_id=v_purchase and empresa_id=v_empresa;
  if v_purchase_items<>1 or round(v_purchase_total,2)<>round(v_purchase_cost*2,2) then raise exception 'QA_PURCHASE_DETAIL_FAILED rows=% total=%',v_purchase_items,v_purchase_total; end if;

  -- El mismo comprobante con guiones/espacios/puntos distintos también debe bloquearse.
  begin
    perform public.confirmar_compra_sigo(v_empresa,v_supplier,
      jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',2,'costo_unitario',v_purchase_cost)),
      current_date,'Q.A.','Q A - '||v_tx,'qa-purchase-duplicate-'||v_tx);
    raise exception 'QA_PURCHASE_DUPLICATE_NOT_BLOCKED';
  exception when others then
    if position('QA_PURCHASE_DUPLICATE_NOT_BLOCKED' in sqlerrm)>0 then raise; end if;
    if position('PURCHASE_DOCUMENT_DUPLICATE' in sqlerrm)=0 then
      raise exception 'QA_PURCHASE_DUPLICATE_WRONG_ERROR: %',sqlerrm;
    end if;
  end;
  select stock_actual into v_stock_after_duplicate_attempt from public.productos where id=v_product and empresa_id=v_empresa;
  if v_stock_after_duplicate_attempt<>v_stock_after_purchase then raise exception 'QA_PURCHASE_DUPLICATE_CHANGED_STOCK'; end if;
  raise notice 'SIGO_QA_PURCHASE_DUPLICATE_BLOCK_OK document=% stock=%','QA-'||v_tx,v_stock_after_duplicate_attempt;
  raise notice 'SIGO_QA_PURCHASE_CANONICAL_DUPLICATE_BLOCK_OK';

  -- Una cantidad fuera del límite operativo debe fallar antes de dejar compra o stock parcial.
  begin
    perform public.confirmar_compra_sigo(v_empresa,v_supplier,
      jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',1000001,'costo_unitario',v_purchase_cost)),
      current_date,'QA-LIMIT','QA-LIMIT-'||v_tx,'qa-purchase-limit-'||v_tx);
    raise exception 'QA_PURCHASE_LIMIT_NOT_BLOCKED';
  exception when others then
    if position('QA_PURCHASE_LIMIT_NOT_BLOCKED' in sqlerrm)>0 then raise; end if;
    if position('PURCHASE_QUANTITY_LIMIT' in sqlerrm)=0 then
      raise exception 'QA_PURCHASE_LIMIT_WRONG_ERROR: %',sqlerrm;
    end if;
  end;
  select stock_actual into v_stock_after_limit_attempt from public.productos where id=v_product and empresa_id=v_empresa;
  select count(*) into v_limit_purchases from public.compras_sigo
  where empresa_id=v_empresa and idempotency_key='qa-purchase-limit-'||v_tx;
  if v_stock_after_limit_attempt<>v_stock_after_purchase or v_limit_purchases<>0 then
    raise exception 'QA_PURCHASE_LIMIT_SIDE_EFFECT stock_before=% stock_after=% rows=%',v_stock_after_purchase,v_stock_after_limit_attempt,v_limit_purchases;
  end if;
  raise notice 'SIGO_QA_PURCHASE_LIMIT_BLOCK_OK product=% stock=%',v_product,v_stock_after_limit_attempt;

  -- Caso que detectó el bug original: efectivo y sin cliente.
  v_sale := public.confirmar_venta_sigo_v2(v_empresa,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',1)),
    'efectivo','qa-sale-'||v_tx,null);
  select stock_actual into v_stock_after_sale from public.productos where id=v_product and empresa_id=v_empresa;
  if v_stock_after_sale<>v_stock_before+1 then raise exception 'QA_SALE_STOCK_FAILED before=% after=%',v_stock_before,v_stock_after_sale; end if;

  v_sale_retry := public.confirmar_venta_sigo_v2(v_empresa,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',1)),
    'efectivo','qa-sale-'||v_tx,null);
  select stock_actual into v_stock_after_sale_retry from public.productos where id=v_product and empresa_id=v_empresa;
  if v_sale_retry<>v_sale or v_stock_after_sale_retry<>v_stock_after_sale then raise exception 'QA_SALE_IDEMPOTENCY_FAILED'; end if;

  select count(*),coalesce(sum(subtotal),0) into v_sale_items,v_sale_total
  from public.venta_items_sigo where venta_id=v_sale and empresa_id=v_empresa;
  if v_sale_items<>1 or round(v_sale_total,2)<>round(v_price,2) then raise exception 'QA_SALE_DETAIL_FAILED rows=% total=%',v_sale_items,v_sale_total; end if;

  select count(*),coalesce(sum(importe),0) into v_cash_rows,v_cash_total
  from public.caja_movimientos_sigo
  where empresa_id=v_empresa and venta_id=v_sale and tipo='ingreso' and medio_pago='efectivo';
  if v_cash_rows<>1 or round(v_cash_total,2)<>round(v_price,2) then raise exception 'QA_CASH_FAILED rows=% total=% expected=%',v_cash_rows,v_cash_total,v_price; end if;

  -- Una venta mayor al stock disponible debe fallar atómicamente y no crear cabecera de venta.
  begin
    perform public.confirmar_venta_sigo_v2(v_empresa,
      jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',floor(v_stock_after_sale)::bigint+1)),
      'efectivo','qa-oversale-'||v_tx,null);
    raise exception 'QA_OVERSALE_NOT_BLOCKED';
  exception when others then
    if position('QA_OVERSALE_NOT_BLOCKED' in sqlerrm)>0 then raise; end if;
    if position('INSUFFICIENT_STOCK' in sqlerrm)=0 then
      raise exception 'QA_OVERSALE_WRONG_ERROR: %',sqlerrm;
    end if;
  end;
  select stock_actual into v_stock_after_oversell from public.productos where id=v_product and empresa_id=v_empresa;
  select count(*) into v_oversell_sales from public.ventas_sigo
  where empresa_id=v_empresa and idempotency_key='qa-oversale-'||v_tx;
  if v_stock_after_oversell<>v_stock_after_sale or v_oversell_sales<>0 then
    raise exception 'QA_OVERSALE_SIDE_EFFECT stock_before=% stock_after=% rows=%',v_stock_after_sale,v_stock_after_oversell,v_oversell_sales;
  end if;
  raise notice 'SIGO_QA_OVERSALE_BLOCK_OK product=% stock=%',v_product,v_stock_after_oversell;

  raise notice 'SIGO_QA_TRANSACTION_PROBE_OK product=% scan_code=% stock_before=% after_purchase=% after_sale=% purchase=% sale=% cash=%',
    v_product,v_scan_code,v_stock_before,v_stock_after_purchase,v_stock_after_sale,v_purchase,v_sale,v_cash_total;
end $$;

rollback;
select 'SIGO_QA_TRANSACTION_PROBE_ROLLED_BACK' as marker;