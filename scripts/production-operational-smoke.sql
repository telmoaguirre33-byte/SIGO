\set ON_ERROR_STOP on

-- SIGO production smoke: sólo lectura.
-- Certifica datos operativos reales después de aplicar migraciones. No inserta,
-- actualiza ni elimina productos, stock, compras, ventas o históricos.
do $$
declare
  v_empresa_id uuid;
  v_tenant_count integer;
  v_libreria_lotes integer;
  v_computacion_lotes integer;
  v_total_lotes integer;
  v_libreria_source integer;
  v_libreria_verified integer;
  v_computacion_source integer;
  v_computacion_verified integer;
  v_import_tenants integer;
  v_catalogo integer;
  v_cost_null integer;
  v_stock_null integer;
  v_stock_negative integer;
  v_identity_conflicts integer;
  v_legacy_pending integer;
  v_sellable_scanner_safe integer;
  v_confirmed_purchases integer;
  v_purchase_mismatches integer;
  v_confirmed_sales integer;
  v_sale_mismatches integer;
  v_cash_mismatches integer;
begin
  select count(*), min(e.id)
    into v_tenant_count, v_empresa_id
    from public.empresas e
   where lower(btrim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true;

  if v_tenant_count <> 1 or v_empresa_id is null then
    raise exception 'SIGO_PROD_SMOKE_TENANT_FAILED count=%', v_tenant_count;
  end if;

  select
    count(*) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'),
    count(*) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%'),
    count(*) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%' or import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%'),
    coalesce(sum(source_rows) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'), 0),
    coalesce(sum(verified_rows) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%'), 0),
    coalesce(sum(source_rows) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%'), 0),
    coalesce(sum(verified_rows) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%'), 0),
    count(distinct empresa_id) filter (where import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%' or import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%')
  into
    v_libreria_lotes,
    v_computacion_lotes,
    v_total_lotes,
    v_libreria_source,
    v_libreria_verified,
    v_computacion_source,
    v_computacion_verified,
    v_import_tenants
  from public.sigo_importaciones_stock;

  if v_libreria_lotes <> 10 or v_computacion_lotes <> 5 or v_total_lotes <> 15 then
    raise exception 'SIGO_PROD_SMOKE_LOTS_FAILED libreria=% computacion=% total=%', v_libreria_lotes, v_computacion_lotes, v_total_lotes;
  end if;
  if v_libreria_source <> 983 or v_libreria_verified <> 983 then
    raise exception 'SIGO_PROD_SMOKE_LIBRERIA_FAILED source=% verified=%', v_libreria_source, v_libreria_verified;
  end if;
  if v_computacion_source <> 417 or v_computacion_verified <> 417 then
    raise exception 'SIGO_PROD_SMOKE_COMPUTACION_FAILED source=% verified=%', v_computacion_source, v_computacion_verified;
  end if;
  if v_libreria_source + v_computacion_source <> 1400 or v_import_tenants <> 1 then
    raise exception 'SIGO_PROD_SMOKE_IMPORT_FAILED total=% tenants=%', v_libreria_source + v_computacion_source, v_import_tenants;
  end if;
  if exists (
    select 1
      from public.sigo_importaciones_stock i
     where (i.import_key like 'resguardo-stock-sigo-2026-09-09-libreria-%' or i.import_key like 'resguardo-stock-sigo-2026-09-09-sertec-%')
       and i.empresa_id <> v_empresa_id
  ) then
    raise exception 'SIGO_PROD_SMOKE_TENANT_SPLIT';
  end if;

  select
    count(*),
    count(*) filter (where p.costo_actual is null),
    count(*) filter (where p.stock_actual is null),
    count(*) filter (where p.stock_actual < 0),
    count(*) filter (where upper(btrim(coalesce(p.codigo_interno, ''))) like 'LEGACY-DUP-%')
  into v_catalogo, v_cost_null, v_stock_null, v_stock_negative, v_legacy_pending
  from public.productos p
  where p.empresa_id = v_empresa_id;

  if v_catalogo < 1400 then
    raise exception 'SIGO_PROD_SMOKE_CATALOG_FAILED catalog=%', v_catalogo;
  end if;
  if v_cost_null <> 0 or v_stock_null <> 0 or v_stock_negative <> 0 then
    raise exception 'SIGO_PROD_SMOKE_PRODUCT_VALUES_FAILED cost_null=% stock_null=% stock_negative=%', v_cost_null, v_stock_null, v_stock_negative;
  end if;

  with identities as (
    select p.id, btrim(p.codigo_barras) as code
      from public.productos p
     where p.empresa_id = v_empresa_id and p.activo = true and nullif(btrim(p.codigo_barras), '') is not null
    union all
    select p.id, btrim(p.codigo_interno) as code
      from public.productos p
     where p.empresa_id = v_empresa_id
       and p.activo = true
       and nullif(btrim(p.codigo_interno), '') is not null
       and upper(btrim(p.codigo_interno)) not like 'LEGACY-DUP-%'
  ), conflicts as (
    select code
      from identities
     group by code
    having count(distinct id) > 1
  )
  select count(*) into v_identity_conflicts from conflicts;

  if v_identity_conflicts <> 0 then
    raise exception 'SIGO_PROD_SMOKE_SCANNER_AMBIGUITY conflicts=%', v_identity_conflicts;
  end if;

  with identities as (
    select p.id, btrim(p.codigo_barras) as code
      from public.productos p
     where p.empresa_id = v_empresa_id and p.activo = true and nullif(btrim(p.codigo_barras), '') is not null
    union all
    select p.id, btrim(p.codigo_interno) as code
      from public.productos p
     where p.empresa_id = v_empresa_id
       and p.activo = true
       and nullif(btrim(p.codigo_interno), '') is not null
       and upper(btrim(p.codigo_interno)) not like 'LEGACY-DUP-%'
  ), unique_ids as (
    select min(id) as id, code
      from identities
     group by code
    having count(distinct id) = 1
  )
  select count(distinct p.id)
    into v_sellable_scanner_safe
    from public.productos p
    join unique_ids u on u.id = p.id
   where p.empresa_id = v_empresa_id
     and p.activo = true
     and p.stock_actual > 0
     and p.precio_venta > 0
     and upper(btrim(coalesce(p.codigo_interno, ''))) not like 'LEGACY-DUP-%';

  if v_sellable_scanner_safe < 1 then
    raise exception 'SIGO_PROD_SMOKE_NO_SCANNER_SAFE_SELLABLE_PRODUCT';
  end if;

  select count(*) into v_confirmed_purchases
    from public.compras_sigo c
   where c.empresa_id = v_empresa_id and c.estado = 'confirmada';

  with detail as (
    select ci.compra_id, round(sum(ci.subtotal), 2) as total_detalle
      from public.compra_items_sigo ci
     where ci.empresa_id = v_empresa_id
     group by ci.compra_id
  )
  select count(*) into v_purchase_mismatches
    from public.compras_sigo c
    left join detail d on d.compra_id = c.id
   where c.empresa_id = v_empresa_id
     and c.estado = 'confirmada'
     and (d.compra_id is null or abs(c.total - d.total_detalle) > 0.01 or abs(c.subtotal - d.total_detalle) > 0.01);

  if v_purchase_mismatches <> 0 then
    raise exception 'SIGO_PROD_SMOKE_PURCHASE_TOTAL_MISMATCH count=%', v_purchase_mismatches;
  end if;

  select count(*) into v_confirmed_sales
    from public.ventas_sigo v
   where v.empresa_id = v_empresa_id and v.estado = 'confirmada';

  with detail as (
    select vi.venta_id, round(sum(vi.subtotal), 2) as total_detalle
      from public.venta_items_sigo vi
     where vi.empresa_id = v_empresa_id
     group by vi.venta_id
  )
  select count(*) into v_sale_mismatches
    from public.ventas_sigo v
    left join detail d on d.venta_id = v.id
   where v.empresa_id = v_empresa_id
     and v.estado = 'confirmada'
     and (d.venta_id is null or abs(v.total - d.total_detalle) > 0.01);

  if v_sale_mismatches <> 0 then
    raise exception 'SIGO_PROD_SMOKE_SALE_TOTAL_MISMATCH count=%', v_sale_mismatches;
  end if;

  with caja as (
    select cm.venta_id, count(*) as movimientos, round(sum(cm.importe), 2) as importe
      from public.caja_movimientos_sigo cm
     where cm.empresa_id = v_empresa_id and cm.tipo = 'ingreso' and cm.venta_id is not null
     group by cm.venta_id
  )
  select count(*) into v_cash_mismatches
    from public.ventas_sigo v
    left join caja c on c.venta_id = v.id
   where v.empresa_id = v_empresa_id
     and v.estado = 'confirmada'
     and v.medio_pago <> 'cuenta_corriente'
     and (c.venta_id is null or c.movimientos <> 1 or abs(v.total - c.importe) > 0.01);

  if v_cash_mismatches <> 0 then
    raise exception 'SIGO_PROD_SMOKE_CASH_MISMATCH count=%', v_cash_mismatches;
  end if;

  raise notice 'SIGO_PRODUCTION_OPERATIONAL_SMOKE_OK tenant=% catalog=% libreria=983 computacion=417 total=1400 lots=15 legacy_pending=% scanner_safe=% purchases=% sales=% purchase_mismatch=0 sale_mismatch=0 cash_mismatch=0',
    v_empresa_id, v_catalogo, v_legacy_pending, v_sellable_scanner_safe, v_confirmed_purchases, v_confirmed_sales;
end
$$;

-- Evidencia accionable: un producto real apto para la prueba física de scanner/caja.
with empresa as (
  select id
    from public.empresas
   where lower(btrim(nombre)) = lower('SIGO Administración') and activa = true
   limit 1
), identities as (
  select p.id, btrim(p.codigo_barras) as code
    from public.productos p join empresa e on e.id = p.empresa_id
   where p.activo = true and nullif(btrim(p.codigo_barras), '') is not null
  union all
  select p.id, btrim(p.codigo_interno) as code
    from public.productos p join empresa e on e.id = p.empresa_id
   where p.activo = true
     and nullif(btrim(p.codigo_interno), '') is not null
     and upper(btrim(p.codigo_interno)) not like 'LEGACY-DUP-%'
), unique_ids as (
  select min(id) as id, code
    from identities
   group by code
  having count(distinct id) = 1
)
select
  'SIGO_SMOKE_TEST_PRODUCT' as marker,
  p.id as product_id,
  p.nombre,
  u.code as scanner_code,
  p.stock_actual,
  p.precio_venta,
  p.costo_actual
from public.productos p
join unique_ids u on u.id = p.id
join empresa e on e.id = p.empresa_id
where p.activo = true
  and p.stock_actual > 0
  and p.precio_venta > 0
  and upper(btrim(coalesce(p.codigo_interno, ''))) not like 'LEGACY-DUP-%'
order by p.stock_actual desc, p.nombre
limit 1;