-- Read-only verified function metadata; no commercial rows. Synthetic fixture only.
CREATE OR REPLACE FUNCTION public.aplicar_margen_masivo_sigo(p_empresa_id uuid, p_margen_porcentaje numeric, p_producto_ids uuid[] DEFAULT NULL::uuid[], p_base_costo text DEFAULT 'actual'::text, p_redondeo numeric DEFAULT 0)
 RETURNS TABLE(actualizados integer, omitidos_sin_costo integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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

  return query select v_actualizados, v_omitidos;
end;
$function$;

CREATE OR REPLACE FUNCTION public.redondear_precios_venta_sigo(p_empresa_id uuid, p_redondeo numeric, p_precios_esperados jsonb)
 RETURNS TABLE(actualizados integer, sin_cambios integer, omitidos_sin_precio integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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
  return query select v_actualizados, v_total - v_actualizados - v_omitidos, v_omitidos;
end;
$function$;
DO $acl$ DECLARE r record; BEGIN FOR r IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('aplicar_margen_masivo_sigo','cambiar_compra_sigo','confirmar_compra_sigo','confirmar_venta_sigo_v2','guardar_producto_medida_sigo','redondear_precios_venta_sigo','registrar_devolucion_sigo') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.oid::regprocedure);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.oid::regprocedure);
 IF r.proname IN ('aplicar_margen_masivo_sigo','confirmar_compra_sigo') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon',r.oid::regprocedure); END IF;
 END LOOP; END $acl$;
