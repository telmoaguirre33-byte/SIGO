-- SIGO: borrado seguro de productos por tenant.
-- No borra datos durante la migración; sólo crea la RPC que valida empresa y permisos.

create or replace function public.eliminar_producto_sigo(
  p_empresa_id uuid,
  p_producto_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_empresa_id is null or p_producto_id is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if not public.tiene_permiso_empresa(p_empresa_id, 'products.write') then
    raise exception 'FORBIDDEN';
  end if;

  delete from public.productos p
   where p.id = p_producto_id
     and p.empresa_id = p_empresa_id
  returning p.id into v_deleted;

  if v_deleted is null then
    raise exception 'PRODUCT_NOT_FOUND_IN_TENANT';
  end if;

  return true;
end;
$$;

revoke all on function public.eliminar_producto_sigo(uuid, uuid) from public;
grant execute on function public.eliminar_producto_sigo(uuid, uuid) to authenticated;

comment on function public.eliminar_producto_sigo(uuid, uuid) is
  'SIGO: elimina un producto sólo dentro de la empresa activa y exige products.write.';
