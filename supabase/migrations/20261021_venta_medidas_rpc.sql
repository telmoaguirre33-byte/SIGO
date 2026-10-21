-- SIGO Venta por medidas: migración propuesta, NO aplicada.
-- Se aprovecha productos.unidad_medida existente. No se altera stock ni precios.
-- Aplicar únicamente tras validar los valores históricos de unidad_medida.
create or replace function public.listar_unidades_producto_sigo(p_empresa_id uuid)
returns table(producto_id uuid, unidad_medida text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.read')
     or not public.tiene_permiso_empresa(p_empresa_id, 'sales.read') then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.unidad_medida), ''), 'unidad')
    from public.productos p
    where p.empresa_id = p_empresa_id and p.activo = true;
end;
$$;
revoke all on function public.listar_unidades_producto_sigo(uuid) from public;
grant execute on function public.listar_unidades_producto_sigo(uuid) to authenticated;

create or replace function public.configurar_unidad_producto_sigo(
  p_empresa_id uuid, p_producto_id uuid, p_unidad text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_unidad is null or p_unidad not in
    ('unidad','kg','g','l','ml','m','cm','m2','m3','docena','caja','bolsa','paquete','rollo','bandeja','atado') then
    raise exception 'UNIDAD_INVALIDA';
  end if;
  update public.productos
     set unidad_medida = p_unidad
   where id = p_producto_id and empresa_id = p_empresa_id and activo = true;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.configurar_unidad_producto_sigo(uuid,uuid,text) from public;
grant execute on function public.configurar_unidad_producto_sigo(uuid,uuid,text) to authenticated;
