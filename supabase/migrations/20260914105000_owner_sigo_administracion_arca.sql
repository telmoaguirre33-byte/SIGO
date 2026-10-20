-- SIGO: reparar acceso del propietario de plataforma al tenant operativo real.
-- No toca productos, stock, ventas, compras ni configuracion fiscal.
-- Garantiza que el propietario/superadmin pueda configurar ARCA e emitir desde
-- "SIGO Administracion", que es el tenant donde viven los 1.400 productos.

do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
  v_productos integer;
begin
  select u.id
    into v_user_id
    from auth.users u
   where lower(u.email) = lower('telmoaguirre33@gmail.com')
   order by u.created_at asc
   limit 1;

  if v_user_id is null then
    raise exception 'SIGO_OWNER_AUTH_USER_NOT_FOUND';
  end if;

  select e.id,
         (select count(*) from public.productos p where p.empresa_id = e.id)
    into v_empresa_id, v_productos
    from public.empresas e
   where lower(btrim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   order by (select count(*) from public.productos p where p.empresa_id = e.id) desc,
            e.created_at asc
   limit 1;

  if v_empresa_id is null then
    raise exception 'SIGO_ADMIN_TENANT_NOT_FOUND';
  end if;

  if coalesce(v_productos, 0) < 1400 then
    raise exception 'SIGO_ADMIN_TENANT_CATALOG_UNEXPECTED count=%', v_productos;
  end if;

  insert into public.sigo_superadmins (user_id, activo, created_by)
  values (v_user_id, true, v_user_id)
  on conflict (user_id)
  do update set activo = true;

  insert into public.empresa_usuarios (
    empresa_id,
    user_id,
    rol,
    activo,
    permisos_extra,
    permisos_denegados
  ) values (
    v_empresa_id,
    v_user_id,
    'owner',
    true,
    '{}'::text[],
    '{}'::text[]
  )
  on conflict (empresa_id, user_id)
  do update set
    rol = 'owner',
    activo = true,
    permisos_denegados = array_remove(
      array_remove(coalesce(public.empresa_usuarios.permisos_denegados, '{}'::text[]), 'arca.configure'),
      'invoices.issue'
    ),
    updated_at = now();

  if not exists (
    select 1
      from public.empresa_usuarios eu
     where eu.empresa_id = v_empresa_id
       and eu.user_id = v_user_id
       and eu.activo = true
       and eu.rol = 'owner'
       and not ('arca.configure' = any(coalesce(eu.permisos_denegados, '{}'::text[])))
       and not ('invoices.issue' = any(coalesce(eu.permisos_denegados, '{}'::text[])))
  ) then
    raise exception 'SIGO_ADMIN_OWNER_PERMISSION_REPAIR_FAILED';
  end if;

  raise notice 'SIGO_ADMIN_OWNER_PERMISSION_OK tenant=% productos=%', v_empresa_id, v_productos;
end
$$;
