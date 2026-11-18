-- SIGO: configuración granular de permisos por el propietario de cada empresa.
-- Seguridad:
--   * Sólo una membresía owner activa puede modificar overrides.
--   * El owner principal no es editable por este mecanismo.
--   * companies.manage nunca puede otorgarse a un empleado mediante permisos_extra.
--   * users.manage sólo puede provenir del rol admin; puede revocarse explícitamente.
--   * La denegación sigue prevaleciendo sobre permiso extra y rol base.

create or replace function public.actualizar_permisos_usuario_empresa_sigo(
  p_empresa_id uuid,
  p_membresia_id uuid,
  p_permisos_extra text[] default '{}'::text[],
  p_permisos_denegados text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_rol text;
  v_actor_id uuid;
  v_target record;
  v_extra text[] := coalesce(p_permisos_extra, '{}'::text[]);
  v_denegados text[] := coalesce(p_permisos_denegados, '{}'::text[]);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select eu.rol, eu.user_id
    into v_actor_rol, v_actor_id
    from public.empresa_usuarios eu
   where eu.empresa_id = p_empresa_id
     and eu.user_id = auth.uid()
     and eu.activo = true
   limit 1;

  if v_actor_rol not in ('owner', 'admin') or v_actor_rol is null then
    raise exception 'MANAGER_PERMISSION_REQUIRED';
  end if;
  if v_actor_rol = 'admin' and not coalesce(public.tiene_permiso_empresa(p_empresa_id, 'users.manage'), false) then
    raise exception 'USERS_MANAGE_REQUIRED';
  end if;

  select eu.id, eu.user_id, eu.rol, eu.activo
    into v_target
    from public.empresa_usuarios eu
   where eu.id = p_membresia_id
     and eu.empresa_id = p_empresa_id
   for update;

  if not found then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  if v_target.rol = 'owner' then raise exception 'OWNER_MEMBERSHIP_IMMUTABLE'; end if;
  if v_actor_rol = 'admin' then
    if v_target.rol not in ('seller', 'warehouse') or v_target.user_id = v_actor_id then
      raise exception 'ADMIN_TARGET_FORBIDDEN';
    end if;
    -- No se permite otorgar privilegios que el propio administrador no tiene.
    if exists (
      select 1 from unnest(v_extra) as requested(permission)
      where not coalesce(public.tiene_permiso_empresa(p_empresa_id, requested.permission), false)
    ) then
      raise exception 'ADMIN_PERMISSION_ESCALATION_FORBIDDEN';
    end if;
  end if;

  if not public.permisos_sigo_validos(v_extra)
     or not public.permisos_sigo_validos(v_denegados) then
    raise exception 'PERMISSION_INVALID';
  end if;

  if v_extra && v_denegados then
    raise exception 'PERMISSION_CONFLICT';
  end if;

  -- Privilegios estructurales de la empresa no pueden escalarse por override.
  if 'companies.manage' = any(v_extra) then
    raise exception 'PERMISSION_GRANT_FORBIDDEN';
  end if;

  -- users.manage sólo puede existir por el rol admin (owner ya está protegido).
  -- Se permite denegarlo a un admin, pero nunca otorgarlo a seller/warehouse/client.
  if 'users.manage' = any(v_extra) then
    raise exception 'PERMISSION_GRANT_FORBIDDEN';
  end if;

  -- Un cliente externo debe permanecer limitado al Portal Cliente.
  if v_target.rol = 'client' and cardinality(v_extra) > 0 then
    raise exception 'CLIENT_EXTRA_PERMISSIONS_FORBIDDEN';
  end if;

  update public.empresa_usuarios
     set permisos_extra = v_extra,
         permisos_denegados = v_denegados,
         updated_at = now()
   where id = p_membresia_id
     and empresa_id = p_empresa_id;

  return p_membresia_id;
end;
$$;

revoke all on function public.actualizar_permisos_usuario_empresa_sigo(uuid, uuid, text[], text[]) from public;
grant execute on function public.actualizar_permisos_usuario_empresa_sigo(uuid, uuid, text[], text[]) to authenticated;

comment on function public.actualizar_permisos_usuario_empresa_sigo(uuid, uuid, text[], text[]) is
  'SIGO: owner configura empleados; admin con users.manage configura seller/warehouse sin escalar permisos. DENY prevalece.';
