-- Los administradores con permiso de editar productos también pueden gestionar ofertas.
-- No se otorga acceso a costos o márgenes ni se amplían permisos para vendedores.
alter policy ofertas_productos_sigo_select on public.ofertas_productos_sigo
  using (coalesce(public.tiene_permiso_empresa(empresa_id, 'products.write'), false)
    or coalesce(public.tiene_permiso_empresa(empresa_id, 'sales.write'), false));

create or replace function public.guardar_ofertas_productos_sigo(p_empresa_id uuid, p_ofertas jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_producto uuid;
  v_inicio date;
  v_fin date;
  v_descuento numeric;
  v_precio numeric;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'products.write'), false)
  then raise exception 'OFFER_WRITE_FORBIDDEN'; end if;
  if jsonb_typeof(p_ofertas) is distinct from 'array' then raise exception 'OFFERS_INVALID'; end if;

  -- Serializa reemplazos concurrentes del mismo catálogo de ofertas.
  perform 1 from public.empresas where id = p_empresa_id for update;
  delete from public.ofertas_productos_sigo where empresa_id = p_empresa_id;
  for v_item in select value from jsonb_array_elements(p_ofertas)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'OFFER_INVALID'; end if;
    begin
      v_producto := (v_item->>'producto_id')::uuid;
      v_inicio := (v_item->>'fecha_inicio')::date;
      v_fin := (v_item->>'fecha_fin')::date;
      v_descuento := (v_item->>'descuento_porcentaje')::numeric;
    exception when others then
      raise exception 'OFFER_INVALID';
    end;
    if v_producto is null or v_inicio is null or v_fin is null or v_fin < v_inicio
       or v_descuento is null or v_descuento <= 0 or v_descuento >= 100
    then raise exception 'OFFER_INVALID'; end if;
    select precio_venta into v_precio from public.productos
    where id = v_producto and empresa_id = p_empresa_id and activo = true;
    if not found or v_precio is null or v_precio <= 0 or round(v_precio * (1 - v_descuento / 100), 2) <= 0
    then raise exception 'OFFER_PRODUCT_INVALID'; end if;
    if exists (select 1 from public.ofertas_productos_sigo o
      where o.empresa_id = p_empresa_id and o.producto_id = v_producto
        and o.fecha_inicio <= v_fin and o.fecha_fin >= v_inicio)
    then raise exception 'OFFER_DATES_OVERLAP'; end if;
    insert into public.ofertas_productos_sigo
      (empresa_id, producto_id, fecha_inicio, fecha_fin, descuento_porcentaje, created_by)
    values (p_empresa_id, v_producto, v_inicio, v_fin, v_descuento, auth.uid());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
