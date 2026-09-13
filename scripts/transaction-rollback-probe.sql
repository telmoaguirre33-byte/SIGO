\set ON_ERROR_STOP on
begin;

do $$
declare
  v_empresa uuid; v_user uuid; v_product uuid; v_supplier uuid;
  v_stock_before numeric; v_stock_after_purchase numeric; v_stock_after_purchase_retry numeric;
  v_stock_after_sale numeric; v_stock_after_sale_retry numeric;
  v_cost numeric; v_price numeric; v_purchase uuid; v_purchase_retry uuid; v_sale uuid; v_sale_retry uuid;
  v_purchase_items integer; v_sale_items integer; v_cash_rows integer;
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

  select p.id,p.stock_actual,p.costo_actual,p.precio_venta
    into v_product,v_stock_before,v_cost,v_price
  from public.productos p
  where p.empresa_id=v_empresa and p.activo=true
    and upper(btrim(coalesce(p.categoria,'')))<>'NO_VENDIBLE'
    and coalesce(p.stock_actual,0)>0 and coalesce(p.precio_venta,0)>0 and coalesce(p.costo_actual,0)>=0
    and upper(coalesce(p.codigo_interno,'')) not like 'LEGACY-DUP-%'
  order by p.id limit 1;
  if v_product is null then raise exception 'QA_PRODUCT_NOT_FOUND'; end if;

  select s.id into v_supplier from public.proveedores_sigo s
  where s.empresa_id=v_empresa and s.activo=true order by s.created_at asc limit 1;
  if v_supplier is null then
    insert into public.proveedores_sigo(empresa_id,razon_social,nombre_fantasia,activo)
    values(v_empresa,'QA Proveedor Transaccional','QA Proveedor',true) returning id into v_supplier;
  end if;

  v_purchase := public.confirmar_compra_sigo(v_empresa,v_supplier,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',2,'costo_unitario',v_cost)),
    current_date,'QA','QA-'||v_tx,'qa-purchase-'||v_tx);
  select stock_actual into v_stock_after_purchase from public.productos where id=v_product and empresa_id=v_empresa;
  if v_stock_after_purchase<>v_stock_before+2 then raise exception 'QA_PURCHASE_STOCK_FAILED before=% after=%',v_stock_before,v_stock_after_purchase; end if;

  v_purchase_retry := public.confirmar_compra_sigo(v_empresa,v_supplier,
    jsonb_build_array(jsonb_build_object('producto_id',v_product::text,'cantidad',2,'costo_unitario',v_cost)),
    current_date,'QA','QA-'||v_tx,'qa-purchase-'||v_tx);
  select stock_actual into v_stock_after_purchase_retry from public.productos where id=v_product and empresa_id=v_empresa;
  if v_purchase_retry<>v_purchase or v_stock_after_purchase_retry<>v_stock_after_purchase then raise exception 'QA_PURCHASE_IDEMPOTENCY_FAILED'; end if;

  select count(*),coalesce(sum(subtotal),0) into v_purchase_items,v_purchase_total
  from public.compra_items_sigo where compra_id=v_purchase and empresa_id=v_empresa;
  if v_purchase_items<>1 or round(v_purchase_total,2)<>round(v_cost*2,2) then raise exception 'QA_PURCHASE_DETAIL_FAILED rows=% total=%',v_purchase_items,v_purchase_total; end if;

  -- Caso que detectó el bug: efectivo y sin cliente.
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

  raise notice 'SIGO_QA_TRANSACTION_PROBE_OK product=% stock_before=% after_purchase=% after_sale=% purchase=% sale=% cash=%',v_product,v_stock_before,v_stock_after_purchase,v_stock_after_sale,v_purchase,v_sale,v_cash_total;
end $$;

rollback;
select 'SIGO_QA_TRANSACTION_PROBE_ROLLED_BACK' as marker;
