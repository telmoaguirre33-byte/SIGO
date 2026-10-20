-- SIGO - reparación de acceso/tenant (one-shot, idempotente, no destructiva)
-- Objetivo: recuperar login -> empresa -> owner para la cuenta propietaria.
-- No borra ni modifica productos, stock, ventas ni históricos.

create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  cuit text,
  activa boolean not null default true,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.empresa_usuarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null,
  permisos_extra text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, user_id)
);

create index if not exists empresa_usuarios_user_id_idx on public.empresa_usuarios(user_id);
create index if not exists empresa_usuarios_empresa_id_idx on public.empresa_usuarios(empresa_id);

create table if not exists public.sigo_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create or replace function public.es_miembro_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
  );
$$;

create or replace function public.es_owner_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and eu.rol = 'owner'
  );
$$;

create or replace function public.crear_empresa(
  p_nombre text,
  p_razon_social text default null,
  p_cuit text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_empresa_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(p_nombre), '') is null then raise exception 'EMPRESA_NOMBRE_REQUIRED'; end if;

  insert into public.empresas (nombre, razon_social, cuit, activa, created_by)
  values (trim(p_nombre), nullif(trim(p_razon_social), ''), nullif(trim(p_cuit), ''), true, v_user_id)
  returning id into v_empresa_id;

  insert into public.empresa_usuarios (empresa_id, user_id, rol, activo)
  values (v_empresa_id, v_user_id, 'owner', true)
  on conflict (empresa_id, user_id)
  do update set rol='owner', activo=true, updated_at=now();

  return v_empresa_id;
end;
$$;

create or replace function public.mis_empresas_sigo()
returns table (empresa_id uuid, nombre text, razon_social text, rol text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.nombre, e.razon_social, eu.rol
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  where eu.user_id = auth.uid()
    and eu.activo = true
    and e.activa = true
  order by e.nombre asc;
$$;

create or replace function public.sigo_access_healthcheck()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'auth', auth.uid() is not null,
    'empresas_table', to_regclass('public.empresas') is not null,
    'empresa_usuarios_table', to_regclass('public.empresa_usuarios') is not null
  );
$$;

revoke all on function public.crear_empresa(text,text,text) from public;
revoke all on function public.mis_empresas_sigo() from public;
revoke all on function public.sigo_access_healthcheck() from public;
grant execute on function public.crear_empresa(text,text,text) to authenticated;
grant execute on function public.mis_empresas_sigo() to authenticated;
grant execute on function public.sigo_access_healthcheck() to authenticated;
grant execute on function public.es_miembro_empresa(uuid) to authenticated;
grant execute on function public.es_owner_empresa(uuid) to authenticated;

alter table public.empresas enable row level security;
alter table public.empresa_usuarios enable row level security;
alter table public.sigo_superadmins enable row level security;

drop policy if exists empresas_select_miembros on public.empresas;
create policy empresas_select_miembros on public.empresas
for select to authenticated using (public.es_miembro_empresa(id));

drop policy if exists empresa_usuarios_select on public.empresa_usuarios;
create policy empresa_usuarios_select on public.empresa_usuarios
for select to authenticated
using (user_id = auth.uid() or public.es_owner_empresa(empresa_id));

drop policy if exists sigo_superadmins_select_self on public.sigo_superadmins;
create policy sigo_superadmins_select_self on public.sigo_superadmins
for select to authenticated using (user_id = auth.uid() and activo = true);

-- Bootstrap controlado de la cuenta propietaria.
do $$
declare
  v_user_id uuid;
  v_empresa_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower('telmoaguirre33@gmail.com')
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'SIGO_OWNER_AUTH_USER_NOT_FOUND';
  end if;

  insert into public.sigo_superadmins (user_id, activo, created_by)
  values (v_user_id, true, v_user_id)
  on conflict (user_id) do update set activo = true;

  select eu.empresa_id into v_empresa_id
  from public.empresa_usuarios eu
  join public.empresas e on e.id = eu.empresa_id
  where eu.user_id = v_user_id and eu.activo = true and e.activa = true
  order by case when eu.rol='owner' then 0 else 1 end, eu.created_at asc
  limit 1;

  if v_empresa_id is null then
    insert into public.empresas (nombre, activa, created_by)
    values ('SIGO Administración', true, v_user_id)
    returning id into v_empresa_id;

    insert into public.empresa_usuarios (empresa_id,user_id,rol,activo)
    values (v_empresa_id,v_user_id,'owner',true)
    on conflict (empresa_id,user_id)
    do update set rol='owner', activo=true, updated_at=now();
  else
    update public.empresa_usuarios
    set rol='owner', activo=true, updated_at=now()
    where empresa_id=v_empresa_id and user_id=v_user_id;
  end if;
end
$$;

select 'SIGO_ACCESS_REPAIR_OK' as resultado;