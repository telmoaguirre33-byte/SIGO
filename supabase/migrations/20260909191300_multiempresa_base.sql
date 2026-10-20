-- SIGO: base multiempresa y permisos por membresía.
-- Migración no destructiva: agrega estructuras nuevas sin alterar tablas operativas existentes.

create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  cuit text,
  activa boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.empresa_usuarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('owner','admin','seller','warehouse','client')),
  permisos_extra text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, user_id)
);

create index if not exists empresa_usuarios_user_id_idx
  on public.empresa_usuarios(user_id);

create index if not exists empresa_usuarios_empresa_id_idx
  on public.empresa_usuarios(empresa_id);

-- Devuelve true solo cuando el usuario autenticado pertenece a la empresa.
create or replace function public.es_miembro_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
  );
$$;

-- Devuelve true para propietario de la empresa.
create or replace function public.es_owner_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.empresa_usuarios eu
    where eu.empresa_id = p_empresa_id
      and eu.user_id = auth.uid()
      and eu.activo = true
      and eu.rol = 'owner'
  );
$$;

-- Creación atómica de empresa + membresía owner para evitar empresas huérfanas.
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
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if nullif(trim(p_nombre), '') is null then
    raise exception 'EMPRESA_NOMBRE_REQUIRED';
  end if;

  insert into public.empresas (nombre, razon_social, cuit, created_by)
  values (trim(p_nombre), nullif(trim(p_razon_social), ''), nullif(trim(p_cuit), ''), v_user_id)
  returning id into v_empresa_id;

  insert into public.empresa_usuarios (empresa_id, user_id, rol)
  values (v_empresa_id, v_user_id, 'owner');

  return v_empresa_id;
end;
$$;

revoke all on function public.crear_empresa(text, text, text) from public;
grant execute on function public.crear_empresa(text, text, text) to authenticated;

grant execute on function public.es_miembro_empresa(uuid) to authenticated;
grant execute on function public.es_owner_empresa(uuid) to authenticated;

alter table public.empresas enable row level security;
alter table public.empresa_usuarios enable row level security;

-- Las empresas solo son visibles para miembros activos.
drop policy if exists empresas_select_miembros on public.empresas;
create policy empresas_select_miembros
on public.empresas
for select
to authenticated
using (public.es_miembro_empresa(id));

-- Datos generales de empresa: solo owner puede modificar.
drop policy if exists empresas_update_owner on public.empresas;
create policy empresas_update_owner
on public.empresas
for update
to authenticated
using (public.es_owner_empresa(id))
with check (public.es_owner_empresa(id));

-- La creación directa queda cerrada; se usa crear_empresa() para garantizar owner.
drop policy if exists empresas_insert_directo_bloqueado on public.empresas;
create policy empresas_insert_directo_bloqueado
on public.empresas
for insert
to authenticated
with check (false);

-- No se permite borrar empresas desde cliente por ahora.
drop policy if exists empresas_delete_bloqueado on public.empresas;
create policy empresas_delete_bloqueado
on public.empresas
for delete
to authenticated
using (false);

-- Cada usuario puede ver su propia membresía; owner ve todas las de su empresa.
drop policy if exists empresa_usuarios_select on public.empresa_usuarios;
create policy empresa_usuarios_select
on public.empresa_usuarios
for select
to authenticated
using (
  user_id = auth.uid()
  or public.es_owner_empresa(empresa_id)
);

-- Solo owner administra usuarios de su empresa.
drop policy if exists empresa_usuarios_insert_owner on public.empresa_usuarios;
create policy empresa_usuarios_insert_owner
on public.empresa_usuarios
for insert
to authenticated
with check (
  public.es_owner_empresa(empresa_id)
  and rol <> 'owner'
);

drop policy if exists empresa_usuarios_update_owner on public.empresa_usuarios;
create policy empresa_usuarios_update_owner
on public.empresa_usuarios
for update
to authenticated
using (public.es_owner_empresa(empresa_id))
with check (
  public.es_owner_empresa(empresa_id)
  and rol <> 'owner'
);

drop policy if exists empresa_usuarios_delete_owner on public.empresa_usuarios;
create policy empresa_usuarios_delete_owner
on public.empresa_usuarios
for delete
to authenticated
using (
  public.es_owner_empresa(empresa_id)
  and user_id <> auth.uid()
);

comment on table public.empresas is 'SIGO: tenants/empresas aisladas lógicamente.';
comment on table public.empresa_usuarios is 'SIGO: membresías, roles y permisos extra por empresa.';
comment on column public.empresa_usuarios.permisos_extra is 'Permisos explícitos adicionales. Nunca reemplazan RLS ni deben otorgar acceso sensible por defecto.';
