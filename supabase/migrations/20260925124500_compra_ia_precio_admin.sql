-- Precio inicial acotado a compra IA autorizada; no concede lectura general.
create or replace function public.guardar_compra_ia_sigo(
  p_empresa_id uuid, p_idempotency_key text, p_compra jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $function$
declare
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_anterior public.compra_ia_confirmaciones%rowtype;
  v_proveedor_id uuid;
  v_ids uuid[];
  v_nombre_proveedor text := nullif(btrim(p_compra->>'proveedor_nombre'), '');
  v_cuit text := nullif(regexp_replace(coalesce(p_compra->>'proveedor_cuit',''), '\D', '', 'g'), '');
  v_nombre text;
  v_codigo text;
  v_barras text;
  v_producto public.productos%rowtype;
  v_producto_id uuid;
  v_item jsonb;
  v_cantidad numeric;
  v_costo numeric;
  v_precio numeric;
  v_margen numeric;
  v_items jsonb := '[]'::jsonb;
  v_resumen jsonb := '[]'::jsonb;
  v_compra_id uuid;
  v_resultado jsonb;
  v_numero text := nullif(btrim(p_compra->>'numero_comprobante'), '');
  v_tipo text := nullif(btrim(p_compra->>'tipo_comprobante'), '');
  v_fecha date;
  v_suma integer;
  v_digito integer;
  v_i integer;
  v_pesos integer[] := array[5,4,3,2,7,6,5,4,3,2];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_empresa_id is null or not coalesce(public.tiene_permiso_empresa(p_empresa_id,'purchases.write'),false) then raise exception 'FORBIDDEN'; end if;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.write'),false) then raise exception 'STOCK_WRITE_REQUIRED'; end if;
  if v_key is null or length(v_key)>197 then raise exception 'IDEMPOTENCY_KEY_INVALID'; end if;
  if p_compra is null or jsonb_typeof(p_compra) is distinct from 'object' or jsonb_typeof(p_compra->'items') is distinct from 'array' then raise exception 'INVALID_ITEM'; end if;
  if jsonb_array_length(p_compra->'items') not between 1 and 300 then raise exception 'INVALID_ITEM'; end if;
  if octet_length(p_compra::text)>1000000 then raise exception 'INVALID_ITEM'; end if;

  -- Serialize only Compra IA saves in the same tenant, including code generation.
  perform pg_advisory_xact_lock(hashtextextended('compra-ia|'||p_empresa_id::text,0));
  select * into v_anterior from public.compra_ia_confirmaciones where empresa_id=p_empresa_id and idempotency_key=v_key;
  if found then
    if v_anterior.solicitud is distinct from p_compra then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    v_resultado:=v_anterior.resultado;
    if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.read'),false) then
      select jsonb_agg(j||jsonb_build_object('stock_antes',null)) into v_resumen from jsonb_array_elements(v_resultado->'items') j;
      v_resultado:=jsonb_set(v_resultado,'{items}',v_resumen);
    end if;
    return v_resultado;
  end if;

  if v_nombre_proveedor is null or length(v_nombre_proveedor)>300 then raise exception 'SUPPLIER_REQUIRED'; end if;
  if v_cuit is not null then
    if length(v_cuit)<>11 then raise exception 'SUPPLIER_CUIT_INVALID'; end if;
    v_suma:=0;
    for v_i in 1..10 loop v_suma:=v_suma+substring(v_cuit,v_i,1)::integer*v_pesos[v_i]; end loop;
    v_digito:=11-(v_suma%11);
    if v_digito=11 then v_digito:=0; elsif v_digito=10 then v_digito:=9; end if;
    if v_digito<>substring(v_cuit,11,1)::integer then raise exception 'SUPPLIER_CUIT_INVALID'; end if;
  end if;
  v_fecha:=coalesce(nullif(p_compra->>'fecha','')::date,current_date);
  if length(coalesce(v_numero,''))>200 or length(coalesce(v_tipo,''))>100 then raise exception 'INVALID_ITEM'; end if;

  select array_agg(id) into v_ids from public.proveedores_sigo
  where empresa_id=p_empresa_id and activo and v_cuit is not null and regexp_replace(coalesce(cuit,''),'\D','','g')=v_cuit;
  if coalesce(cardinality(v_ids),0)=0 then
    select array_agg(id) into v_ids from public.proveedores_sigo where empresa_id=p_empresa_id and activo
      and regexp_replace(translate(lower(razon_social),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')=regexp_replace(translate(lower(v_nombre_proveedor),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')
      and (v_cuit is null or nullif(regexp_replace(coalesce(cuit,''),'\D','','g'),'') is null or regexp_replace(cuit,'\D','','g')=v_cuit);
  end if;
  if coalesce(cardinality(v_ids),0)>1 then raise exception 'SUPPLIER_AMBIGUOUS'; end if;
  v_proveedor_id:=v_ids[1];
  if v_proveedor_id is null then
    if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'suppliers.write'),false) then raise exception 'FORBIDDEN'; end if;
    insert into public.proveedores_sigo(empresa_id,razon_social,cuit) values(p_empresa_id,v_nombre_proveedor,v_cuit) returning id into v_proveedor_id;
  end if;

  -- Number is optional. An actual duplicate must never be forced through.
  if v_numero is not null and exists (
    select 1 from public.compras_sigo c where c.empresa_id=p_empresa_id and c.proveedor_id=v_proveedor_id and c.estado='confirmada'
    and regexp_replace(upper(c.numero_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_numero),'[^A-Z0-9]','','g')
    and (v_tipo is null or nullif(btrim(c.tipo_comprobante),'') is null or regexp_replace(upper(c.tipo_comprobante),'[^A-Z0-9]','','g')=regexp_replace(upper(v_tipo),'[^A-Z0-9]','','g'))
  ) then raise exception 'PURCHASE_DOCUMENT_DUPLICATE'; end if;

  for v_item in select value from jsonb_array_elements(p_compra->'items') loop
    v_nombre:=nullif(btrim(v_item->>'nombre'),'');
    v_codigo:=nullif(btrim(v_item->>'codigo_interno'),'');
    v_barras:=nullif(btrim(v_item->>'codigo_barras'),'');
    v_cantidad:=round((v_item->>'cantidad')::numeric,3);
    v_costo:=round((v_item->>'costo_unitario')::numeric,4);
    if v_nombre is null or length(v_nombre)>500 or length(coalesce(v_codigo,''))>200 or length(coalesce(v_barras,''))>200
      or v_cantidad is null or v_cantidad<=0 or v_cantidad>1000000
      or v_costo is null or v_costo<=0 or v_costo>1000000000 then raise exception 'INVALID_ITEM'; end if;
    v_producto_id:=nullif(v_item->>'producto_id','')::uuid;
    if v_producto_id is not null then
      select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo for update;
      if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    else
      select array_agg(id) into v_ids from public.productos where empresa_id=p_empresa_id and activo and
        ((v_barras is not null and (codigo_barras=v_barras or codigo_interno=v_barras)) or (v_codigo is not null and (codigo_interno=v_codigo or codigo_barras=v_codigo)));
      if coalesce(cardinality(v_ids),0)=0 then
        select array_agg(id) into v_ids from public.productos where empresa_id=p_empresa_id and activo
        and btrim(regexp_replace(translate(lower(nombre),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'))=btrim(regexp_replace(translate(lower(v_nombre),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'));
      end if;
      if coalesce(cardinality(v_ids),0)>1 then raise exception 'PRODUCT_AMBIGUOUS'; end if;
      v_producto_id:=v_ids[1];
      if v_producto_id is not null then
        select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id and activo for update;
        if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
      end if;
    end if;

    if v_producto_id is null then
      v_precio:=round((v_item->>'precio_venta')::numeric,2);
      if v_precio is null or v_precio<v_costo or v_precio>1000000000 then raise exception 'INVALID_ITEM'; end if;
      v_margen:=(v_precio/v_costo-1)*100;
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) then raise exception 'FORBIDDEN'; end if;
      -- Registrar compras y crear productos autoriza el precio inicial de esta compra concreta.
      -- No amplía el acceso de lectura general a costos, márgenes ni listas de precios.
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'sales.write'),false) then raise exception 'PRICE_PERMISSION_REQUIRED'; end if;
      if v_codigo is null then
        loop
          v_codigo:='SIGO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
          exit when not exists(select 1 from public.productos where empresa_id=p_empresa_id and (codigo_interno=v_codigo or codigo_barras=v_codigo));
        end loop;
      end if;
      v_producto_id:=public.guardar_producto_sigo(p_empresa_id=>p_empresa_id,p_nombre=>v_nombre,p_codigo_interno=>v_codigo,p_codigo_barras=>v_barras,
        p_proveedor=>v_nombre_proveedor,p_costo_actual=>v_costo,p_costo_ultima_compra=>v_costo,p_precio_venta=>v_precio,p_margen_ganancia=>v_precio-v_costo,p_margen_porcentaje=>v_margen,p_stock_actual=>0);
      -- guardar_producto_sigo oculta costo/margen a usuarios sin permisos de lectura.
      -- Completar sólo el producto recién creado dentro de esta transacción autorizada.
      update public.productos set costo_actual=v_costo, costo_ultima_compra=v_costo,
        precio_venta=v_precio, margen_ganancia=v_precio-v_costo, margen_porcentaje=v_margen
      where id=v_producto_id and empresa_id=p_empresa_id;
      select * into v_producto from public.productos where id=v_producto_id and empresa_id=p_empresa_id for update;
      if v_producto.precio_venta is distinct from v_precio or v_producto.costo_actual is distinct from v_costo then raise exception 'PRICE_PERMISSION_REQUIRED'; end if;
    end if;

    -- Reuse existing identifiers: do not overwrite them with a supplier's code.
    if upper(coalesce(v_producto.codigo_interno,'')) like 'LEGACY-DUP-%' or upper(coalesce(v_producto.codigo_barras,'')) like 'LEGACY-DUP-%' then raise exception 'PRODUCT_LEGACY_PENDING'; end if;
    if v_producto.stock_actual is null or v_producto.costo_actual is null
      or v_producto.stock_actual::text in ('NaN','Infinity','-Infinity') or v_producto.costo_actual::text in ('NaN','Infinity','-Infinity') then raise exception 'PRODUCT_VALUES_INVALID'; end if;
    if exists(select 1 from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.id<>v_producto_id and
      ((nullif(btrim(v_producto.codigo_interno),'') is not null and regexp_replace(upper(p.codigo_interno),'[^A-Z0-9]','','g')=regexp_replace(upper(v_producto.codigo_interno),'[^A-Z0-9]','','g'))
      or (nullif(btrim(v_producto.codigo_barras),'') is not null and regexp_replace(upper(p.codigo_barras),'[^A-Z0-9]','','g')=regexp_replace(upper(v_producto.codigo_barras),'[^A-Z0-9]','','g')))) then raise exception 'PRODUCT_AMBIGUOUS'; end if;
    if nullif(btrim(v_producto.codigo_interno),'') is null then
      if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'products.write'),false) then raise exception 'FORBIDDEN'; end if;
      loop
        v_codigo:='SIGO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
        exit when not exists(select 1 from public.productos where empresa_id=p_empresa_id and (codigo_interno=v_codigo or codigo_barras=v_codigo));
      end loop;
      update public.productos set codigo_interno=v_codigo where id=v_producto_id and empresa_id=p_empresa_id;
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('producto_id',v_producto_id,'cantidad',v_cantidad,'costo_unitario',v_costo));
    v_resumen:=v_resumen||jsonb_build_array(jsonb_build_object('producto_id',v_producto_id,'cantidad',v_cantidad,'costo_unitario',v_costo,'stock_antes',v_producto.stock_actual));
  end loop;

  -- Duplicate lines for the SAME resolved product are consolidated, not new products.
  select jsonb_agg(jsonb_build_object('producto_id',producto_id,'cantidad',cantidad,'costo_unitario',costo_unitario) order by producto_id),
         jsonb_agg(jsonb_build_object('producto_id',producto_id,'cantidad',cantidad,'costo_unitario',costo_unitario,'stock_antes',stock_antes) order by producto_id)
  into v_items,v_resumen from (
    select j->>'producto_id' producto_id,sum((j->>'cantidad')::numeric) cantidad,
      round(sum((j->>'cantidad')::numeric*(j->>'costo_unitario')::numeric)/sum((j->>'cantidad')::numeric),4) costo_unitario,
      min((j->>'stock_antes')::numeric) stock_antes
    from jsonb_array_elements(v_resumen) j group by j->>'producto_id'
  ) agrupadas;
  if exists(select 1 from jsonb_array_elements(v_items) j where (j->>'cantidad')::numeric>1000000) then raise exception 'INVALID_ITEM'; end if;
  v_compra_id:=public.confirmar_compra_sigo(p_empresa_id,v_proveedor_id,v_items,v_fecha,v_tipo,v_numero,'ia:'||v_key);
  update public.compras_sigo set origen='ia' where id=v_compra_id and empresa_id=p_empresa_id;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id,'stock.read'),false) then
    select jsonb_agg(j||jsonb_build_object('stock_antes',null)) into v_resumen from jsonb_array_elements(v_resumen) j;
  end if;
  v_resultado:=jsonb_build_object('compra_id',v_compra_id,'items',v_resumen);
  insert into public.compra_ia_confirmaciones(empresa_id,idempotency_key,solicitud,compra_id,resultado,created_by)
    values(p_empresa_id,v_key,p_compra,v_compra_id,v_resultado,auth.uid());
  return v_resultado;
end;
$function$;
revoke all on function public.guardar_compra_ia_sigo(uuid,text,jsonb) from public, anon;
grant execute on function public.guardar_compra_ia_sigo(uuid,text,jsonb) to authenticated;
