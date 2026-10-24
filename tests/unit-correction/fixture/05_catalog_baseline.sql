CREATE OR REPLACE FUNCTION public.listar_productos_sigo(p_empresa_id uuid)
 RETURNS TABLE(id uuid, empresa_id uuid, codigo_interno text, codigo_barras text, nombre text, descripcion text, categoria text, marca text, proveedor text, costo_actual numeric, costo_ultima_compra numeric, precio_venta numeric, margen_ganancia numeric, margen_porcentaje numeric, stock_actual numeric, stock_minimo numeric, stock_maximo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read') then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    p.id,
    p.empresa_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.descripcion,
    p.categoria,
    p.marca,
    p.proveedor,
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'costs.read') then p.costo_ultima_compra else null end,
    case
      when public.tiene_permiso_empresa(p_empresa_id, 'price_lists.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.read')
        or public.tiene_permiso_empresa(p_empresa_id, 'sales.write')
        then p.precio_venta
      else null
    end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_ganancia else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'margins.read') then p.margen_porcentaje else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_actual else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_minimo else null end,
    case when public.tiene_permiso_empresa(p_empresa_id, 'stock.read') then p.stock_maximo else null end
  from public.productos p
  where p.empresa_id = p_empresa_id
    and p.activo = true
    and upper(btrim(coalesce(p.categoria, ''))) <> 'NO_VENDIBLE'
  order by p.nombre asc;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.portal_cliente_catalogo_sigo(p_empresa_id uuid)
 RETURNS TABLE(producto_id uuid, codigo_interno text, codigo_barras text, nombre text, marca text, categoria text, stock_comercial numeric, consumo_diario_estimado numeric, dias_cobertura numeric, semaforo text, sugerencia_compra numeric, actualizado_en timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cliente_id uuid;
  v_vinculos integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  if not exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.rol = 'client'
      and eu.activo = true
  ) then
    raise exception 'PORTAL_FORBIDDEN';
  end if;

  select count(*)::integer
    into v_vinculos
  from public.portal_cliente_usuarios pcu
  join public.clientes_sigo c
    on c.id = pcu.cliente_id
   and c.empresa_id = pcu.empresa_id
   and c.activo = true
  where pcu.user_id = auth.uid()
    and pcu.empresa_id = p_empresa_id
    and pcu.activo = true;

  if coalesce(v_vinculos, 0) = 0 then raise exception 'PORTAL_FORBIDDEN'; end if;
  if v_vinculos <> 1 then raise exception 'PORTAL_LINK_AMBIGUOUS'; end if;

  select pcu.cliente_id
    into v_cliente_id
  from public.portal_cliente_usuarios pcu
  join public.clientes_sigo c
    on c.id = pcu.cliente_id
   and c.empresa_id = pcu.empresa_id
   and c.activo = true
  where pcu.user_id = auth.uid()
    and pcu.empresa_id = p_empresa_id
    and pcu.activo = true
  limit 1;

  return query
  select
    p.id as producto_id,
    p.codigo_interno,
    p.codigo_barras,
    p.nombre,
    p.marca,
    p.categoria,
    s.stock_comercial,
    s.consumo_diario_estimado,
    case
      when coalesce(s.consumo_diario_estimado, 0) > 0
        then round(s.stock_comercial / s.consumo_diario_estimado, 1)
      else null
    end as dias_cobertura,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 'SIN_DATOS'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.dias_objetivo then 'VERDE'
      when (s.stock_comercial / s.consumo_diario_estimado) >= s.umbral_amarillo then 'AMARILLO'
      else 'ROJO'
    end as semaforo,
    case
      when coalesce(s.consumo_diario_estimado, 0) <= 0 then 0::numeric
      else greatest(0::numeric, ceil((s.dias_objetivo * s.consumo_diario_estimado) - s.stock_comercial))
    end as sugerencia_compra,
    s.actualizado_en
  from public.portal_stock_publicado s
  join public.productos p
    on p.id = s.producto_id
   and p.empresa_id = s.empresa_id
   and p.activo = true
  where s.empresa_id = p_empresa_id
    and s.cliente_id = v_cliente_id
    and s.publicado = true
  order by p.nombre asc;
end;
$function$
;
