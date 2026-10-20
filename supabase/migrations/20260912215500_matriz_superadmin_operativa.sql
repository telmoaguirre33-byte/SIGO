-- SIGO: Matriz / Superadmin operativa y auditable.
-- Permite administrar tenants y abrir soporte temporal sin pedir contraseñas de clientes.
-- No concede acceso operativo permanente: el modo soporte restaura la membresía previa al cerrarse.

create table if not exists public.sigo_soporte_sesiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  superadmin_user_id uuid not null references auth.users(id) on delete cascade,
  iniciado_at timestamptz not null default now(),
  finalizado_at timestamptz,
  membresia_existia boolean not null default false,
  rol_previo text,
  activo_previo boolean,
  constraint sigo_soporte_rol_previo_valido check (
    rol_previo is null or rol_previo in ('owner','admin','seller','warehouse','client')
  )
);

create unique index if not exists sigo_soporte_sesion_activa_uidx
  on public.sigo_soporte_sesiones (empresa_id, superadmin_user_id)
  where finalizado_at is null;

alter table public.sigo_soporte_sesiones enable row level security;
-- Sin políticas directas para authenticated: todo acceso pasa por RPC SECURITY DEFINER.

create or replace function public.matriz_resumen_sigo()
returns table (
  empresas_total bigint,
  empresas_activas bigint,
  empresas_suspendidas bigint,
  usuarios_activos bigint,
  clientes_portal bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    (select count(*) from public.empresas),
    (select count(*) from public.empresas e where e.activa = true),
    (select count(*) from public.empresas e where e.activa = false),
    (select count(*) from public.empresa_usuarios eu where eu.activo = true),
    (select count(*) from public.empresa_usuarios eu where eu.activo = true and eu.rol = 'client');
end;
$$;

create or replace function public.matriz_listar_empresas_sigo()
returns table (
  empresa_id uuid,
  nombre text,
  razon_social text,
  cuit text,
  activa boolean,
  created_at timestamptz,
  owner_email text,
  usuarios_activos bigint,
  administradores bigint,
  vendedores bigint,
  depositos bigint,
  clientes_portal bigint,
  soporte_activo boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    e.id,
    e.nombre,
    e.razon_social,
    e.cuit,
    e.activa,
    e.created_at,
    (
      select u.email::text
      from public.empresa_usuarios euo
      join auth.users u on u.id = euo.user_id
      where euo.empresa_id = e.id
        and euo.rol = 'owner'
        and euo.activo = true
      order by euo.created_at asc
      limit 1
    ) as owner_email,
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id = e.id and eu.activo = true),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id = e.id and eu.activo = true and eu.rol in ('owner','admin')),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id = e.id and eu.activo = true and eu.rol = 'seller'),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id = e.id and eu.activo = true and eu.rol = 'warehouse'),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id = e.id and eu.activo = true and eu.rol = 'client'),
    exists (
      select 1
      from public.sigo_soporte_sesiones ss
      where ss.empresa_id = e.id
        and ss.superadmin_user_id = auth.uid()
        and ss.finalizado_at is null
    )
  from public.empresas e
  order by e.activa desc, lower(e.nombre), e.created_at;
end;
$$;

create or replace function public.matriz_actualizar_estado_empresa_sigo(
  p_empresa_id uuid,
  p_activa boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;
  if p_empresa_id is null or p_activa is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if not exists (select 1 from public.empresas e where e.id = p_empresa_id) then
    raise exception 'EMPRESA_NOT_FOUND';
  end if;

  update public.empresas
     set activa = p_activa,
         updated_at = now()
   where id = p_empresa_id;

  return true;
end;
$$;

create or replace function public.matriz_iniciar_soporte_sigo(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_membership public.empresa_usuarios%rowtype;
  v_exists boolean := false;
begin
  if v_user_id is null or not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.empresas e where e.id = p_empresa_id and e.activa = true) then
    raise exception 'EMPRESA_NOT_ACTIVE';
  end if;

  select ss.id into v_session_id
  from public.sigo_soporte_sesiones ss
  where ss.empresa_id = p_empresa_id
    and ss.superadmin_user_id = v_user_id
    and ss.finalizado_at is null
  limit 1;
  if v_session_id is not null then
    return v_session_id;
  end if;

  select eu.* into v_membership
  from public.empresa_usuarios eu
  where eu.empresa_id = p_empresa_id
    and eu.user_id = v_user_id
  limit 1;
  v_exists := found;

  insert into public.sigo_soporte_sesiones (
    empresa_id,
    superadmin_user_id,
    membresia_existia,
    rol_previo,
    activo_previo
  ) values (
    p_empresa_id,
    v_user_id,
    v_exists,
    case when v_exists then v_membership.rol else null end,
    case when v_exists then v_membership.activo else null end
  ) returning id into v_session_id;

  insert into public.empresa_usuarios (empresa_id, user_id, rol, activo)
  values (p_empresa_id, v_user_id, 'admin', true)
  on conflict (empresa_id, user_id)
  do update set
    rol = case when public.empresa_usuarios.rol = 'owner' then 'owner' else 'admin' end,
    activo = true,
    updated_at = now();

  return v_session_id;
end;
$$;

create or replace function public.matriz_finalizar_soporte_sigo(p_empresa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.sigo_soporte_sesiones%rowtype;
begin
  if v_user_id is null or not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;

  select ss.* into v_session
  from public.sigo_soporte_sesiones ss
  where ss.empresa_id = p_empresa_id
    and ss.superadmin_user_id = v_user_id
    and ss.finalizado_at is null
  order by ss.iniciado_at desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  if v_session.membresia_existia then
    update public.empresa_usuarios
       set rol = v_session.rol_previo,
           activo = coalesce(v_session.activo_previo, false),
           updated_at = now()
     where empresa_id = p_empresa_id
       and user_id = v_user_id;
  else
    delete from public.empresa_usuarios
     where empresa_id = p_empresa_id
       and user_id = v_user_id;
  end if;

  update public.sigo_soporte_sesiones
     set finalizado_at = now()
   where id = v_session.id;

  return true;
end;
$$;

revoke all on function public.matriz_resumen_sigo() from public;
revoke all on function public.matriz_listar_empresas_sigo() from public;
revoke all on function public.matriz_actualizar_estado_empresa_sigo(uuid, boolean) from public;
revoke all on function public.matriz_iniciar_soporte_sigo(uuid) from public;
revoke all on function public.matriz_finalizar_soporte_sigo(uuid) from public;

grant execute on function public.matriz_resumen_sigo() to authenticated;
grant execute on function public.matriz_listar_empresas_sigo() to authenticated;
grant execute on function public.matriz_actualizar_estado_empresa_sigo(uuid, boolean) to authenticated;
grant execute on function public.matriz_iniciar_soporte_sigo(uuid) to authenticated;
grant execute on function public.matriz_finalizar_soporte_sigo(uuid) to authenticated;

comment on table public.sigo_soporte_sesiones is
  'SIGO: auditoría de accesos temporales de soporte del superadmin a tenants.';
comment on function public.matriz_iniciar_soporte_sigo(uuid) is
  'SIGO: abre acceso temporal y auditable de soporte para un superadmin, preservando la membresía previa.';
comment on function public.matriz_finalizar_soporte_sigo(uuid) is
  'SIGO: cierra soporte y restaura o elimina la membresía temporal creada para la sesión.';
