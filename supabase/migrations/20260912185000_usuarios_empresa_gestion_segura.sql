-- SIGO: administración segura de usuarios por empresa.
-- Alinea users.manage con un flujo real sin exponer auth.users directamente al cliente.
-- Migración aditiva: no elimina ni reescribe datos operativos.

create or replace function public.listar_usuarios_empresa_sigo(p_empresa_id uuid)
returns table (
  membresia_id uuid,
  user_id uuid,
  email text,
  rol text,
  activo boolean,
  permisos_extra text[],
  permisos_denegados text[],
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'users.manage')
     and not public.es_superadmin_sigo() then
    raise exception 'USERS_MANAGE_FORBIDDEN';
  end if;

  return query
  select
    eu.id,
    eu.user_id,
    lower(coalesce(u.email, ''))::text,
    eu.rol,
    eu.activo,
    coalesce(eu.permisos_extra, '{}'::text[]),
    coalesce(eu.permisos_denegados, '{}'::text[]),
    eu.created_at
  from public.empresa_usuarios eu
  join auth.users u on u.id = eu.user_id
  where eu.empresa_id = p_empresa_id
  order by
    case eu.rol when 'owner' then 0 when 'admin' then 1 when 'seller' then 2 when 'warehouse' then 3 else 4 end,
    lower(coalesce(u.email, ''));
end;
$$;

create or replace function public.agregar_usuario_empresa_sigo(
  p_empresa_id uuid,
  p_email text,
  p_rol text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_rol text;
  v_target_user uuid;
  v_membresia_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'users.manage')
     and not public.es_superadmin_sigo() then
    raise exception 'USERS_MANAGE_FORBIDDEN';
  end if;

  select eu.rol into v_actor_rol
  from public.empresa_usuarios eu
  where eu.empresa_id = p_empresa_id and eu.user_id = auth.uid() and eu.activo = true
  limit 1;

  if not public.es_superadmin_sigo() then
    if v_actor_rol not in ('owner','admin') then raise exception 'USERS_MANAGE_FORBIDDEN'; end if;
    if v_actor_rol = 'admin' and p_rol not in ('seller','warehouse','client') then
      raise exception 'ROLE_NOT_ALLOWED';
    end if;
  end if;

  if p_rol not in ('admin','seller','warehouse','client') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if v_email = '' then raise exception 'USER_EMAIL_REQUIRED'; end if;

  select u.id into v_target_user
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at asc
  limit 1;

  if v_target_user is null then raise exception 'USER_NOT_REGISTERED'; end if;

  select eu.id into v_membresia_id
  from public.empresa_usuarios eu
  where eu.empresa_id = p_empresa_id and eu.user_id = v_target_user
  for update;

  if v_membresia_id is not null then
    if exists (
      select 1 from public.empresa_usuarios eu
      where eu.id = v_membresia_id and eu.rol = 'owner'
    ) then
      raise exception 'OWNER_MEMBERSHIP_IMMUTABLE';
    end if;

    update public.empresa_usuarios
    set rol = p_rol, activo = true, updated_at = now()
    where id = v_membresia_id and empresa_id = p_empresa_id;
    return v_membresia_id;
  end if;

  insert into public.empresa_usuarios (empresa_id, user_id, rol, activo)
  values (p_empresa_id, v_target_user, p_rol, true)
  returning id into v_membresia_id;

  return v_membresia_id;
end;
$$;

create or replace function public.actualizar_usuario_empresa_sigo(
  p_empresa_id uuid,
  p_membresia_id uuid,
  p_rol text,
  p_activo boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_rol text;
  v_target record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.tiene_permiso_empresa(p_empresa_id, 'users.manage')
     and not public.es_superadmin_sigo() then
    raise exception 'USERS_MANAGE_FORBIDDEN';
  end if;

  select eu.rol into v_actor_rol
  from public.empresa_usuarios eu
  where eu.empresa_id = p_empresa_id and eu.user_id = auth.uid() and eu.activo = true
  limit 1;

  select eu.id, eu.user_id, eu.rol into v_target
  from public.empresa_usuarios eu
  where eu.id = p_membresia_id and eu.empresa_id = p_empresa_id
  for update;

  if not found then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  if v_target.rol = 'owner' then raise exception 'OWNER_MEMBERSHIP_IMMUTABLE'; end if;
  if v_target.user_id = auth.uid() and p_activo = false then raise exception 'SELF_DEACTIVATION_FORBIDDEN'; end if;
  if p_rol not in ('admin','seller','warehouse','client') then raise exception 'ROLE_NOT_ALLOWED'; end if;

  if not public.es_superadmin_sigo() then
    if v_actor_rol not in ('owner','admin') then raise exception 'USERS_MANAGE_FORBIDDEN'; end if;
    if v_actor_rol = 'admin' then
      if v_target.rol = 'admin' or p_rol = 'admin' then raise exception 'ROLE_NOT_ALLOWED'; end if;
      if p_rol not in ('seller','warehouse','client') then raise exception 'ROLE_NOT_ALLOWED'; end if;
    end if;
  end if;

  update public.empresa_usuarios
  set rol = p_rol, activo = coalesce(p_activo, true), updated_at = now()
  where id = p_membresia_id and empresa_id = p_empresa_id;

  return p_membresia_id;
end;
$$;

revoke all on function public.listar_usuarios_empresa_sigo(uuid) from public;
grant execute on function public.listar_usuarios_empresa_sigo(uuid) to authenticated;
revoke all on function public.agregar_usuario_empresa_sigo(uuid, text, text) from public;
grant execute on function public.agregar_usuario_empresa_sigo(uuid, text, text) to authenticated;
revoke all on function public.actualizar_usuario_empresa_sigo(uuid, uuid, text, boolean) from public;
grant execute on function public.actualizar_usuario_empresa_sigo(uuid, uuid, text, boolean) to authenticated;

comment on function public.listar_usuarios_empresa_sigo(uuid) is
  'SIGO: lista usuarios de una empresa sólo para users.manage/superadmin; email se expone únicamente por RPC autorizada.';
comment on function public.agregar_usuario_empresa_sigo(uuid, text, text) is
  'SIGO: agrega o reactiva una cuenta ya registrada. Admin sólo gestiona roles operativos; owner puede además gestionar admins.';
comment on function public.actualizar_usuario_empresa_sigo(uuid, uuid, text, boolean) is
  'SIGO: cambia rol/estado sin permitir modificar owner, auto-desactivar al actor ni escalar privilegios desde admin.';
