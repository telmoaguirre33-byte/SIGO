-- SIGO: módulo opcional de búsqueda de productos por EAN/GTIN.
-- Se administra exclusivamente desde Matriz / Superadmin.
-- No modifica productos, stock, ventas ni módulos existentes.

insert into public.sigo_modulos_catalogo
  (clave, nombre, descripcion, categoria, disponible, obligatorio, orden)
values
  ('busqueda_ean', 'Buscar productos a través de EAN',
   'Identifica productos mediante EAN/GTIN para facilitar el alta en el catálogo de la empresa.',
   'Catálogo / Integraciones', true, false, 120)
on conflict (clave) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  disponible = excluded.disponible,
  obligatorio = excluded.obligatorio,
  orden = excluded.orden,
  updated_at = now();

-- Opt-in: empresas existentes y futuras comienzan con el módulo desactivado.
insert into public.sigo_empresa_modulos (empresa_id, modulo_clave, habilitado)
select e.id, 'busqueda_ean', false
from public.empresas e
on conflict (empresa_id, modulo_clave) do nothing;

create or replace function public.matriz_actualizar_modulo_empresa_sigo(
  p_empresa_id uuid,
  p_modulo_clave text,
  p_habilitado boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modulo public.sigo_modulos_catalogo%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED'; end if;
  if p_empresa_id is null
     or nullif(btrim(coalesce(p_modulo_clave, '')), '') is null
     or p_habilitado is null then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id) then
    raise exception 'EMPRESA_NOT_FOUND';
  end if;

  select * into v_modulo
  from public.sigo_modulos_catalogo
  where clave = p_modulo_clave;

  if not found then raise exception 'MODULE_NOT_FOUND'; end if;
  if v_modulo.obligatorio and not p_habilitado then raise exception 'MODULE_REQUIRED'; end if;
  if p_habilitado and not v_modulo.disponible then raise exception 'MODULE_NOT_AVAILABLE'; end if;

  insert into public.sigo_empresa_modulos
    (empresa_id, modulo_clave, habilitado, actualizado_por, updated_at)
  values
    (p_empresa_id, p_modulo_clave, p_habilitado, auth.uid(), now())
  on conflict (empresa_id, modulo_clave)
  do update set
    habilitado = excluded.habilitado,
    actualizado_por = excluded.actualizado_por,
    updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke all on function public.matriz_actualizar_modulo_empresa_sigo(uuid, text, boolean) from public;
grant execute on function public.matriz_actualizar_modulo_empresa_sigo(uuid, text, boolean) to authenticated;

comment on function public.matriz_actualizar_modulo_empresa_sigo(uuid, text, boolean)
is 'SIGO Matriz: Superadmin activa/desactiva módulos opcionales por empresa.';

-- Extiende la lectura de Matriz para mostrar el estado del módulo EAN sin entrar al tenant.
drop function if exists public.matriz_listar_empresas_sigo();

create function public.matriz_listar_empresas_sigo()
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
  soporte_activo boolean,
  busqueda_ean_habilitada boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_superadmin_sigo() then raise exception 'FORBIDDEN'; end if;
  return query
  select
    e.id, e.nombre, e.razon_social, e.cuit, e.activa, e.created_at,
    (
      select u.email::text
      from public.empresa_usuarios euo
      join auth.users u on u.id = euo.user_id
      where euo.empresa_id = e.id and euo.rol = 'owner' and euo.activo = true
      order by euo.created_at asc limit 1
    ),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id=e.id and eu.activo=true),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id=e.id and eu.activo=true and eu.rol in ('owner','admin')),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id=e.id and eu.activo=true and eu.rol='seller'),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id=e.id and eu.activo=true and eu.rol='warehouse'),
    (select count(*) from public.empresa_usuarios eu where eu.empresa_id=e.id and eu.activo=true and eu.rol='client'),
    exists (
      select 1 from public.sigo_soporte_sesiones ss
      where ss.empresa_id=e.id and ss.superadmin_user_id=auth.uid() and ss.finalizado_at is null
    ),
    coalesce((
      select em.habilitado
      from public.sigo_empresa_modulos em
      where em.empresa_id=e.id and em.modulo_clave='busqueda_ean'
    ), false)
  from public.empresas e
  order by e.activa desc, lower(e.nombre), e.created_at;
end;
$$;

revoke all on function public.matriz_listar_empresas_sigo() from public;
grant execute on function public.matriz_listar_empresas_sigo() to authenticated;
