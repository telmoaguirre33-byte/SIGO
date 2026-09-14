-- SIGO: listas de precios y actualización masiva de márgenes.
-- El porcentaje se interpreta como recargo sobre costo: precio = costo * (1 + margen/100).
-- No toca stock, identidad del producto ni movimientos históricos.

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
$$;

revoke all on function public.aplicar_margen_masivo_sigo(uuid, numeric, uuid[], text, numeric) from public;
grant execute on function public.aplicar_margen_masivo_sigo(uuid, numeric, uuid[], text, numeric) to authenticated;

comment on function public.aplicar_margen_masivo_sigo(uuid, numeric, uuid[], text, numeric) is
  'SIGO: aplica recargo porcentual sobre costo en forma masiva o selectiva, con redondeo opcional y aislamiento por empresa.';
