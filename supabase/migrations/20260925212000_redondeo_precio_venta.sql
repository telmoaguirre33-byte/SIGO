-- Independent sale-price rounding. Does not expose costs or change role permissions.
-- An explicit preview snapshot and row locks prevent stale/partial price updates.
create or replace function public.redondear_precios_venta_sigo(
  p_empresa_id uuid,
  p_redondeo numeric,
  p_precios_esperados jsonb
) returns table(actualizados integer, sin_cambios integer, omitidos_sin_precio integer)
language plpgsql security definer set search_path = public
as $function$
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
  -- Lock in deterministic order. No records outside this company are writable.
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
revoke all on function public.redondear_precios_venta_sigo(uuid,numeric,jsonb) from public, anon;
grant execute on function public.redondear_precios_venta_sigo(uuid,numeric,jsonb) to authenticated;
notify pgrst, 'reload schema';
