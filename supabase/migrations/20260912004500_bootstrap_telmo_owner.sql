-- SIGO: bootstrap controlado del propietario de plataforma.
-- Idempotente y no destructivo: no modifica productos, stock, ventas ni históricos.
-- Si el usuario ya existe en Supabase Auth, garantiza superadmin global y al menos
-- una membresía owner activa para poder ingresar al sistema.

do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = lower('telmoaguirre33@gmail.com')
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise notice 'SIGO_BOOTSTRAP: auth user telmoaguirre33@gmail.com not found; no changes applied.';
    return;
  end if;

  insert into public.sigo_superadmins (user_id, activo, created_by)
  values (v_user_id, true, v_user_id)
  on conflict (user_id)
  do update set activo = true;

  -- Si ya tiene cualquier empresa activa, no crear duplicados: elevar una membresía
  -- propia a owner para garantizar acceso administrativo al tenant existente.
  select eu.empresa_id
    into v_empresa_id
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  where eu.user_id = v_user_id
    and eu.activo = true
    and e.activa = true
  order by case when eu.rol = 'owner' then 0 else 1 end, eu.created_at asc
  limit 1;

  if v_empresa_id is null then
    insert into public.empresas (nombre, razon_social, cuit, activa, created_by)
    values ('SIGO Administración', null, null, true, v_user_id)
    returning id into v_empresa_id;

    insert into public.empresa_usuarios (empresa_id, user_id, rol, activo)
    values (v_empresa_id, v_user_id, 'owner', true)
    on conflict (empresa_id, user_id)
    do update set rol = 'owner', activo = true;
  else
    update public.empresa_usuarios
       set rol = 'owner', activo = true, updated_at = now()
     where empresa_id = v_empresa_id
       and user_id = v_user_id;
  end if;

  raise notice 'SIGO_BOOTSTRAP: owner/superadmin ensured for telmoaguirre33@gmail.com, empresa %', v_empresa_id;
end
$$;
