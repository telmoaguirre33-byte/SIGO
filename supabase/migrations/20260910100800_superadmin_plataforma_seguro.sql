-- SIGO: superadmin de plataforma con alcance administrativo, no operativo.
-- Objetivo: permitir al propietario de la plataforma administrar empresas y membresías
-- sin otorgarle por defecto acceso a productos, stock, costos, ventas u otros datos del tenant.
-- La asignación inicial de superadmin debe hacerse exclusivamente desde backend/service role
-- o consola SQL controlada. Nunca desde el cliente web.

create table if not exists public.sigo_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.sigo_superadmins enable row level security;

-- No se habilitan políticas INSERT/UPDATE/DELETE para authenticated.
-- Esto impide auto-promoción desde el cliente incluso si conoce la tabla.
drop policy if exists sigo_superadmins_select_self on public.sigo_superadmins;
create policy sigo_superadmins_select_self
on public.sigo_superadmins
for select
to authenticated
using (user_id = auth.uid() and activo = true);

create or replace function public.es_superadmin_sigo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sigo_superadmins sa
    where sa.user_id = auth.uid()
      and sa.activo = true
  );
$$;

revoke all on function public.es_superadmin_sigo() from public;
grant execute on function public.es_superadmin_sigo() to authenticated;

-- El superadmin puede ver y administrar el registro maestro de empresas.
-- Esto NO concede acceso a tablas operativas de esas empresas.
drop policy if exists empresas_select_superadmin on public.empresas;
create policy empresas_select_superadmin
on public.empresas
for select
to authenticated
using (public.es_superadmin_sigo());

drop policy if exists empresas_update_superadmin on public.empresas;
create policy empresas_update_superadmin
on public.empresas
for update
to authenticated
using (public.es_superadmin_sigo())
with check (public.es_superadmin_sigo());

-- El alta normal de empresas sigue pasando por crear_empresa(), que crea owner atómicamente.
-- Se habilita al superadmin a crear una empresa para un owner concreto mediante una RPC
-- controlada, evitando empresas huérfanas y evitando escritura directa desde el cliente.
create or replace function public.superadmin_crear_empresa_para_owner(
  p_owner_user_id uuid,
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
  v_empresa_id uuid;
begin
  if not public.es_superadmin_sigo() then
    raise exception 'FORBIDDEN';
  end if;

  if p_owner_user_id is null then
    raise exception 'OWNER_REQUIRED';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'OWNER_NOT_FOUND';
  end if;

  if nullif(trim(p_nombre), '') is null then
    raise exception 'EMPRESA_NOMBRE_REQUIRED';
  end if;

  insert into public.empresas (nombre, razon_social, cuit, created_by)
  values (
    trim(p_nombre),
    nullif(trim(p_razon_social), ''),
    nullif(trim(p_cuit), ''),
    auth.uid()
  )
  returning id into v_empresa_id;

  insert into public.empresa_usuarios (empresa_id, user_id, rol)
  values (v_empresa_id, p_owner_user_id, 'owner');

  return v_empresa_id;
end;
$$;

revoke all on function public.superadmin_crear_empresa_para_owner(uuid, text, text, text) from public;
grant execute on function public.superadmin_crear_empresa_para_owner(uuid, text, text, text) to authenticated;

-- Administración de membresías por superadmin. Sigue sin dar acceso operativo al contenido
-- de la empresa: estas políticas aplican únicamente a empresa_usuarios.
drop policy if exists empresa_usuarios_select_superadmin on public.empresa_usuarios;
create policy empresa_usuarios_select_superadmin
on public.empresa_usuarios
for select
to authenticated
using (public.es_superadmin_sigo());

drop policy if exists empresa_usuarios_insert_superadmin on public.empresa_usuarios;
create policy empresa_usuarios_insert_superadmin
on public.empresa_usuarios
for insert
to authenticated
with check (
  public.es_superadmin_sigo()
  and rol in ('admin','seller','warehouse','client')
);

drop policy if exists empresa_usuarios_update_superadmin on public.empresa_usuarios;
create policy empresa_usuarios_update_superadmin
on public.empresa_usuarios
for update
to authenticated
using (public.es_superadmin_sigo())
with check (
  public.es_superadmin_sigo()
  -- Evita convertir una membresía existente en owner desde una edición genérica.
  and rol in ('admin','seller','warehouse','client')
);

drop policy if exists empresa_usuarios_delete_superadmin on public.empresa_usuarios;
create policy empresa_usuarios_delete_superadmin
on public.empresa_usuarios
for delete
to authenticated
using (
  public.es_superadmin_sigo()
  and rol <> 'owner'
);

comment on table public.sigo_superadmins is
  'SIGO: administradores globales de plataforma. Administran tenants y membresías; no reciben acceso operativo a datos de cada empresa por esta condición.';

comment on function public.es_superadmin_sigo() is
  'SIGO: verifica superadmin global. No equivale a membresía de tenant ni concede permisos operativos.';

comment on function public.superadmin_crear_empresa_para_owner(uuid, text, text, text) is
  'SIGO: alta atómica de tenant por superadmin con owner inicial obligatorio.';
